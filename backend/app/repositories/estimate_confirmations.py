"""積算確定snapshot (Issue #4 Phase B-1/B-4、Issue #40 Phase 6-Aで
EstimateResultベースへ移行) の最小book-keeping。

設計の詳細・理由付けは `docs/decision-snapshot-design.md` を参照。この
モジュールは `estimate_confirmations` / `estimate_confirmation_items` /
`estimate_confirmation_result_evidence` への INSERT(`save_confirmation`)と、
読み出し専用のSELECT(`list_confirmations`/`get_confirmation`、Issue #4
Phase B-4で追加)のみを行う。current state (`estimate_results`等) とは
独立したレイヤーとして実装し、読み出し関数もsnapshotへ保存済みの値を
そのまま返すだけで、現在のMaster価格やCSVから再計算することはしない。

- `save_confirmation()` はcommit/rollbackを一切行わない。呼び出し側が渡す
  `conn` は、`app/db/connection.py::get_connection` が提供する
  「1コンテキスト=1トランザクション」の接続をそのまま使う想定であり、
  header行・明細行・根拠行いずれのINSERTも、途中で例外が起きれば同じ
  トランザクションとしてロールバックされる(設計8章のtransaction境界と
  同じ考え方。`decision_events`の`record_event()`と同様の設計)。
- append-only専用: 既存snapshotを更新・削除する関数はこのモジュールに
  意図的に用意しない(設計9章: 再確定は新しいheader行を都度追加する)。
  読み出し関数(`list_confirmations`/`get_confirmation`)もSELECTのみで、
  この方針に影響しない。
- `detection_id`/`drawing_page_id` にFK制約を持たせない設計(設計6章)の
  ため、ここでのINSERT自体もDetection/DrawingPageの実在確認を行わない。
  呼び出し側が集めた値をそのまま非正規化コピーとして保存するだけの
  薄いレイヤーである。
- [Issue #40 Phase 6-A] `source_type`/`status`は旧Detectionベースの行にのみ
  意味を持つ列のためnullableになった(`0010_estimate_confirmation_result_
  snapshot.sql`参照)。読み出し時、値がNULLの行はPythonの`None`のまま返す
  (旧Detectionの値が無いことを示す列であり、推測で埋めない)。
"""
from __future__ import annotations

import sqlite3
from collections.abc import Sequence

from app.domain.estimate_rules import ApplicableUnit, EstimateResultStatus, EvidenceKind, JudgmentMethod
from app.domain.models import (
    DetectionSourceType,
    DetectionStatus,
    EstimateConfirmation,
    EstimateConfirmationEvidenceInput,
    EstimateConfirmationEvidenceItem,
    EstimateConfirmationItem,
    EstimateConfirmationItemInput,
    EstimateConfirmationSummary,
    EstimateTargetType,
)


def _insert_evidence(
    conn: sqlite3.Connection, confirmation_item_id: int, evidence: Sequence[EstimateConfirmationEvidenceInput]
) -> list[EstimateConfirmationEvidenceItem]:
    saved: list[EstimateConfirmationEvidenceItem] = []
    for ev in evidence:
        cursor = conn.execute(
            """
            INSERT INTO estimate_confirmation_result_evidence (
                confirmation_item_id, evidence_kind, detection_id, drawing_page_id,
                source_type, evidence_type_key, master_item_code, class_name,
                bbox_x, bbox_y, bbox_w, bbox_h, page_no, design_data_ref
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                confirmation_item_id,
                ev.evidence_kind.value,
                ev.detection_id,
                ev.drawing_page_id,
                ev.source_type.value if ev.source_type is not None else None,
                ev.evidence_type_key,
                ev.master_item_code,
                ev.class_name,
                ev.bbox_x,
                ev.bbox_y,
                ev.bbox_w,
                ev.bbox_h,
                ev.page_no,
                ev.design_data_ref,
            ),
        )
        saved.append(
            EstimateConfirmationEvidenceItem(
                id=cursor.lastrowid,
                confirmation_item_id=confirmation_item_id,
                evidence_kind=ev.evidence_kind,
                detection_id=ev.detection_id,
                drawing_page_id=ev.drawing_page_id,
                source_type=ev.source_type,
                evidence_type_key=ev.evidence_type_key,
                master_item_code=ev.master_item_code,
                class_name=ev.class_name,
                bbox_x=ev.bbox_x,
                bbox_y=ev.bbox_y,
                bbox_w=ev.bbox_w,
                bbox_h=ev.bbox_h,
                page_no=ev.page_no,
                design_data_ref=ev.design_data_ref,
            )
        )
    return saved


def save_confirmation(
    conn: sqlite3.Connection,
    *,
    product_no: str,
    items: Sequence[EstimateConfirmationItemInput],
) -> EstimateConfirmation:
    """1回の確定操作をheader + items (+ 根拠) として同一トランザクションで
    保存する。

    headerを先にINSERTしてからitemsをINSERTし(`confirmation_id`のFK制約が
    安全に成立する順序。設計6章)、各itemをINSERTした直後にその根拠を
    INSERTする(`confirmation_item_id`のFK制約が安全に成立する順序、同じ
    考え方)。`items`が空(確定対象のEstimateResultが1件も無い製番)でも、
    header行だけを持つ確定として保存する(0件の確定をエラー扱いにする判断は
    Phase B-1のスコープ外とする、Phase 6-Aでも変更しない)。
    """
    cursor = conn.execute(
        "INSERT INTO estimate_confirmations (product_no) VALUES (?)",
        (product_no,),
    )
    confirmation_id = cursor.lastrowid

    saved_items: list[EstimateConfirmationItem] = []
    for item in items:
        item_cursor = conn.execute(
            """
            INSERT INTO estimate_confirmation_items (
                confirmation_id, detection_id, drawing_page_id,
                target_id, target_type, ban_menno, ban_no, panel_name,
                master_item_id, code, category, model, rating,
                source_type, status, quantity, unit_price, amount,
                bbox_x, bbox_y, bbox_w, bbox_h, page_no,
                current_factor, factor_overridden, judgment_method,
                applicable_unit, judgment_reason, source_rule_id, result_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                confirmation_id,
                item.detection_id,
                item.drawing_page_id,
                item.target_id,
                item.target_type.value,
                item.ban_menno,
                item.ban_no,
                item.panel_name,
                item.master_item_id,
                item.code,
                item.category,
                item.model,
                item.rating,
                item.source_type.value if item.source_type is not None else None,
                item.status.value if item.status is not None else None,
                item.quantity,
                item.unit_price,
                item.amount,
                item.bbox_x,
                item.bbox_y,
                item.bbox_w,
                item.bbox_h,
                item.page_no,
                item.current_factor,
                (None if item.factor_overridden is None else int(item.factor_overridden)),
                item.judgment_method.value if item.judgment_method is not None else None,
                item.applicable_unit.value if item.applicable_unit is not None else None,
                item.judgment_reason,
                item.source_rule_id,
                item.result_status.value if item.result_status is not None else None,
            ),
        )
        confirmation_item_id = item_cursor.lastrowid
        saved_evidence = _insert_evidence(conn, confirmation_item_id, item.evidence)
        saved_items.append(
            EstimateConfirmationItem(
                id=confirmation_item_id,
                confirmation_id=confirmation_id,
                target_id=item.target_id,
                target_type=item.target_type,
                code=item.code,
                source_type=item.source_type,
                status=item.status,
                detection_id=item.detection_id,
                drawing_page_id=item.drawing_page_id,
                ban_menno=item.ban_menno,
                ban_no=item.ban_no,
                panel_name=item.panel_name,
                master_item_id=item.master_item_id,
                category=item.category,
                model=item.model,
                rating=item.rating,
                quantity=item.quantity,
                unit_price=item.unit_price,
                amount=item.amount,
                bbox_x=item.bbox_x,
                bbox_y=item.bbox_y,
                bbox_w=item.bbox_w,
                bbox_h=item.bbox_h,
                page_no=item.page_no,
                current_factor=item.current_factor,
                factor_overridden=item.factor_overridden,
                judgment_method=item.judgment_method,
                applicable_unit=item.applicable_unit,
                judgment_reason=item.judgment_reason,
                source_rule_id=item.source_rule_id,
                result_status=item.result_status,
                evidence=saved_evidence,
            )
        )

    confirmed_at_row = conn.execute(
        "SELECT confirmed_at FROM estimate_confirmations WHERE id = ?", (confirmation_id,)
    ).fetchone()
    confirmed_at = confirmed_at_row["confirmed_at"]

    return EstimateConfirmation(
        id=confirmation_id,
        product_no=product_no,
        confirmed_at=confirmed_at,
        items=saved_items,
    )


def list_confirmations(
    conn: sqlite3.Connection, *, product_no: str
) -> list[EstimateConfirmationSummary]:
    """製番`product_no`の過去確定headerを新しい順(id降順)で返す
    (Issue #4 Phase B-4)。

    明細(items)は含めない一覧表示用の軽量版。`item_count`/`total_amount`は
    `estimate_confirmation_items`とのLEFT JOIN + GROUP BYで都度算出する
    (headerテーブル自体にこれらを非正規化して持たせていないため。
    集計はSELECT時点で行うだけで、保存済みの値自体には一切書き込まない)。

    `confirmed_at`は秒精度(`datetime('now')`)のため同一秒に複数回確定される
    可能性があり、時刻文字列だけでは新しい順が一意に決まらない。
    `id`(AUTOINCREMENT、常に確定順に増加する)で降順ソートすることで、
    確定順を常に一意に再現する。

    製番が一致するsnapshotが1件も無い場合(=確定履歴0件)は空listを返す。
    これはエラーではなく正常系(製番自体の実在確認はこの関数の責務外。
    `estimate_confirmations`テーブルへの検索のみを行う)。
    """
    rows = conn.execute(
        """
        SELECT
            c.id AS id,
            c.product_no AS product_no,
            c.confirmed_at AS confirmed_at,
            COUNT(i.id) AS item_count,
            COALESCE(SUM(i.amount), 0) AS total_amount
        FROM estimate_confirmations c
        LEFT JOIN estimate_confirmation_items i ON i.confirmation_id = c.id
        WHERE c.product_no = ?
        GROUP BY c.id
        ORDER BY c.id DESC
        """,
        (product_no,),
    ).fetchall()

    return [
        EstimateConfirmationSummary(
            id=row["id"],
            product_no=row["product_no"],
            confirmed_at=row["confirmed_at"],
            item_count=row["item_count"],
            total_amount=row["total_amount"],
        )
        for row in rows
    ]


def _row_to_evidence(row: sqlite3.Row) -> EstimateConfirmationEvidenceItem:
    return EstimateConfirmationEvidenceItem(
        id=row["id"],
        confirmation_item_id=row["confirmation_item_id"],
        evidence_kind=EvidenceKind(row["evidence_kind"]),
        detection_id=row["detection_id"],
        drawing_page_id=row["drawing_page_id"],
        source_type=DetectionSourceType(row["source_type"]) if row["source_type"] else None,
        evidence_type_key=row["evidence_type_key"],
        master_item_code=row["master_item_code"],
        class_name=row["class_name"],
        bbox_x=row["bbox_x"],
        bbox_y=row["bbox_y"],
        bbox_w=row["bbox_w"],
        bbox_h=row["bbox_h"],
        page_no=row["page_no"],
        design_data_ref=row["design_data_ref"],
    )


def _load_evidence(
    conn: sqlite3.Connection, confirmation_item_ids: list[int]
) -> dict[int, list[EstimateConfirmationEvidenceItem]]:
    if not confirmation_item_ids:
        return {}
    placeholders = ",".join("?" for _ in confirmation_item_ids)
    rows = conn.execute(
        f"""
        SELECT * FROM estimate_confirmation_result_evidence
        WHERE confirmation_item_id IN ({placeholders})
        ORDER BY id
        """,
        confirmation_item_ids,
    ).fetchall()
    by_item: dict[int, list[EstimateConfirmationEvidenceItem]] = {iid: [] for iid in confirmation_item_ids}
    for row in rows:
        by_item.setdefault(row["confirmation_item_id"], []).append(_row_to_evidence(row))
    return by_item


def get_confirmation(
    conn: sqlite3.Connection, *, product_no: str, confirmation_id: int
) -> EstimateConfirmation | None:
    """確定snapshot1件の詳細(header + 明細一式 + 根拠一式)を返す
    (Issue #4 Phase B-4、Issue #40 Phase 6-Aで根拠を追加)。

    保存済みの値をそのまま返すのみで、現在の`estimate_master_items`や
    `estcode_df.csv`から再計算しない(設計7章の再現性方針をそのまま踏襲する)。
    過去(Phase 6-A以前)に保存された行は新列が全てNULLのまま返る
    (`EstimateConfirmationItem`側のdataclass定義で該当フィールドが
    `None`許容のため、そのまま安全に構築できる)。

    `product_no`が一致しない、またはそもそも`confirmation_id`が存在しない
    場合は`None`を返す(呼び出し側でHTTP 404へ変換する)。確定snapshotの
    idはproduct横断で連番のため、`product_no`もWHERE句へ含めて絞り込むことで、
    他製番のconfirmation idを指定してもこの製番からは見えないようにする
    (要件6: 別製番のconfirmation idへアクセスできないこと)。
    """
    header = conn.execute(
        "SELECT id, product_no, confirmed_at FROM estimate_confirmations WHERE id = ? AND product_no = ?",
        (confirmation_id, product_no),
    ).fetchone()
    if header is None:
        return None

    item_rows = conn.execute(
        "SELECT * FROM estimate_confirmation_items WHERE confirmation_id = ? ORDER BY id ASC",
        (confirmation_id,),
    ).fetchall()

    evidence_by_item = _load_evidence(conn, [row["id"] for row in item_rows])

    items = [
        EstimateConfirmationItem(
            id=row["id"],
            confirmation_id=row["confirmation_id"],
            detection_id=row["detection_id"],
            drawing_page_id=row["drawing_page_id"],
            target_id=row["target_id"],
            target_type=EstimateTargetType(row["target_type"]),
            ban_menno=row["ban_menno"],
            ban_no=row["ban_no"],
            panel_name=row["panel_name"],
            master_item_id=row["master_item_id"],
            code=row["code"],
            category=row["category"],
            model=row["model"],
            rating=row["rating"],
            source_type=DetectionSourceType(row["source_type"]) if row["source_type"] else None,
            quantity=row["quantity"],
            unit_price=row["unit_price"],
            amount=row["amount"],
            status=DetectionStatus(row["status"]) if row["status"] else None,
            bbox_x=row["bbox_x"],
            bbox_y=row["bbox_y"],
            bbox_w=row["bbox_w"],
            bbox_h=row["bbox_h"],
            page_no=row["page_no"],
            current_factor=row["current_factor"],
            factor_overridden=(None if row["factor_overridden"] is None else bool(row["factor_overridden"])),
            judgment_method=JudgmentMethod(row["judgment_method"]) if row["judgment_method"] else None,
            applicable_unit=ApplicableUnit(row["applicable_unit"]) if row["applicable_unit"] else None,
            judgment_reason=row["judgment_reason"],
            source_rule_id=row["source_rule_id"],
            result_status=EstimateResultStatus(row["result_status"]) if row["result_status"] else None,
            evidence=evidence_by_item.get(row["id"], []),
        )
        for row in item_rows
    ]

    return EstimateConfirmation(
        id=header["id"],
        product_no=header["product_no"],
        confirmed_at=header["confirmed_at"],
        items=items,
    )
