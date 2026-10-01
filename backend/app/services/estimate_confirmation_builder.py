"""積算確定snapshot(Issue #4 Phase B-2)を「現在の積算結果」から組み立てる処理。

設計は `docs/decision-snapshot-design.md` を参照。

[Issue #40 Phase 6-A] 確定対象をDetectionからEstimateResult(積算結果の正本、
`docs/data-model.md` 6.7章)へ移行した。以後の確定snapshotは、
`estimate_results`(+ `estimate_result_evidence`)の現在の値をそのまま
`EstimateConfirmationItemInput`へコピーして組み立てる(Frontendから渡された
計算済みの値は使わず、Backend自身が組み立てる、という既存方針はPhase 6-Aでも
変更していない)。`estimate_results`自体が「評価器/互換レイヤが都度作り直す
現在状態」のテーブルであるため、ここでIDを保持したまま参照するのではなく、
値そのものを確定snapshotへコピーする(再評価で`estimate_results`の行が
消えても、保存済みのconfirmation行は影響を受けない)。

**status=needs_review の確定禁止(指示A-1)**: 新旧コード衝突・盤所属tie等、
未解決の状態を含んだ製番は確定操作自体を拒否する(`NeedsReviewResultsExistError`)。
dedupeの最終ルールは今回決めないため、「確定を防ぐ」以上のことはしない
(needs_review行を黙って除外する、片方だけ採用する、といった推測による解決は
行わない)。

このモジュールはDB書き込みを行わない(`save_confirmation`への入力を組み立てる
だけの読み取り専用ロジック)。実際の保存は呼び出し側(router)が
`app.repositories.estimate_confirmations.save_confirmation`を呼んで行う。
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from app.domain.estimate_rules import EstimateResultEvidence, EstimateResultStatus, EvidenceKind
from app.domain.models import (
    EstimateConfirmationEvidenceInput,
    EstimateConfirmationItemInput,
    EstimateTargetType,
)
from app.repositories.detections import get_detection
from app.repositories.estimate_results import list_results_for_product
from app.repositories.master import get_master_item
from app.services.data_source import DataSourceError, resolve_product_dir
from app.services.estcode_df import EstimatePanelInfo, load_estcode_df
from app.services.panel_assignment import PRODUCT_TARGET_ID
from app.services.product_df import PanelAreaFromDf, load_product_df


class NeedsReviewResultsExistError(Exception):
    """確定対象の製番に`status=needs_review`のEstimateResultが1件以上
    存在する場合 (Issue #40 Phase 6-A指示A-1)。

    新旧コード衝突・盤所属tie等、未解決の状態を含んだまま確定snapshotを
    残さないため、確定操作自体を拒否する(部分確定・黙った除外はしない)。
    呼び出し側(router)がHTTP 422等へ変換する。
    """

    def __init__(self, count: int):
        self.count = count
        super().__init__(
            f"要確認の積算結果が{count}件残っているため確定できません。"
            "積算明細の「要確認」タブで内容を確認・解消してから再度確定してください。"
        )


def _resolve_panel_name(
    ban_menno: int,
    ban_no: int,
    product_panels_by_key: dict[str, PanelAreaFromDf],
    estimate_panels: list[EstimatePanelInfo],
) -> str:
    """盤名称の解決(`PanelInfo.tsx`と同じ優先順位: estcode_df.csvの値を優先し、
    無ければproduct_df自身の値、それも空ならBAN_MENNO/BAN_NOを使う)。

    EstimateResultは所属盤をBBox座標からではなく`target_panel_ban_menno`/
    `target_panel_ban_no`(整数)として直接持つため、Phase 5以前の
    `_resolve_panel_name(panel: PanelAreaFromDf, ...)`(BBox所属判定の結果
    として得た`PanelAreaFromDf`を受け取る版)とは引数の形が異なる。
    """
    matched = next(
        (e for e in estimate_panels if e.ban_menno == ban_menno and e.ban_no == ban_no),
        None,
    )
    name = matched.ban_meisyou if matched else None
    if not name:
        product_panel = product_panels_by_key.get(f"{ban_menno}:{ban_no}")
        name = product_panel.ban_meisyou if product_panel else None
    return name if name and name.strip() != "" else f"{ban_menno}/{ban_no}"


def detection_page_no_map(conn: sqlite3.Connection, product_no: str) -> dict[int, int]:
    """`drawing_pages`のうち、この製番に紐づく行の`id -> source_page_no`。

    `docs/data-model.md`の「Phase 1.8での役割変化」の通り、ダミーDrawingPage行が
    無い実製番は空dictとなる(エラーにはしない)。

    [Issue #40 Phase 2/3] この関数は`estimate_rule_evaluator.py`/
    `legacy_detection_adapter.py`からも共用されている(Backend内の重複実装を
    避けるための共通ユーティリティとして、このモジュールへ元々切り出されて
    いたもの)。Phase 6-Aで確定処理の主ロジックをEstimateResultベースへ
    移行した後も、この関数自体は変更していない。
    """
    rows = conn.execute(
        """
        SELECT id, source_page_no FROM drawing_pages
        WHERE product_no = ? AND source_type = 'product_file' AND source_page_no IS NOT NULL
        """,
        (product_no,),
    ).fetchall()
    return {row["id"]: row["source_page_no"] for row in rows}


def _build_evidence_input(
    conn: sqlite3.Connection,
    evidence: EstimateResultEvidence,
    page_no_by_drawing_page_id: dict[int, int],
) -> EstimateConfirmationEvidenceInput:
    """`EstimateResultEvidence`1件から、確定snapshot用の根拠入力を組み立てる。

    BBox根拠(`evidence_kind=detection`)は、確定時点のDetectionから表示に
    必要な値(表示名解決用の`master_item_code`/`class_name`、BBox座標、
    AI/手動の取得元等)を非正規化コピーする。`detection_id`にFK制約は
    無いため、理論上は根拠Detectionが確定時点で既に削除されている場合も
    ありうる(実運用では、BBox削除時はestimate_results自体も再評価で
    削除される想定のため稀だが、念のため防御する)。その場合は`detection_id`
    のみ歴史的参照として残し、それ以外の表示用情報は推測で埋めずNoneの
    ままにする(既存の`estimate_confirmation_items.detection_id`と同じ方針、
    `test_confirmation_item_survives_detection_deletion`参照)。
    """
    if evidence.evidence_kind == EvidenceKind.DESIGN_DATA:
        return EstimateConfirmationEvidenceInput(
            evidence_kind=EvidenceKind.DESIGN_DATA,
            design_data_ref=evidence.design_data_ref,
        )

    detection = get_detection(conn, evidence.detection_id) if evidence.detection_id is not None else None
    if detection is None:
        return EstimateConfirmationEvidenceInput(
            evidence_kind=EvidenceKind.DETECTION,
            detection_id=evidence.detection_id,
        )
    return EstimateConfirmationEvidenceInput(
        evidence_kind=EvidenceKind.DETECTION,
        detection_id=detection.id,
        drawing_page_id=detection.drawing_page_id,
        source_type=detection.source_type,
        evidence_type_key=detection.evidence_type_key,
        master_item_code=detection.master_item_code,
        class_name=detection.class_name,
        bbox_x=detection.bbox_x,
        bbox_y=detection.bbox_y,
        bbox_w=detection.bbox_w,
        bbox_h=detection.bbox_h,
        page_no=page_no_by_drawing_page_id.get(detection.drawing_page_id),
    )


def build_confirmation_items(
    conn: sqlite3.Connection, data_source_root: Path, product_no: str
) -> list[EstimateConfirmationItemInput]:
    """製番`product_no`の「現在のEstimateResult」から確定snapshot明細の
    入力一覧を組み立てる (Issue #40 Phase 6-A)。

    1 EstimateResult = 1確定明細行の粒度で組み立てる(Phase 5以前は
    1 Detection = 1行だった)。`estimate_results`テーブルを直接読み出す
    だけで、評価器の再実行は行わない(Frontendが`reevaluateEstimateResults()`
    経由でBBox編集のたびに評価済みである前提。既存のDetectionベース確定が
    `detections`テーブルを直接読んでいたのと同じ考え方)。

    `status=needs_review`のEstimateResultが1件でも存在する場合は
    `NeedsReviewResultsExistError`を送出し、呼び出し側(router)で確定操作
    自体を拒否する(指示A-1、部分確定・黙った除外はしない)。

    `resolve_product_dir`が投げる`DataSourceError`(製番が存在しない等)は
    そのまま呼び出し側(router)へ伝播させ、他の製番スコープAPIと同じ
    エラーハンドリングに委ねる。
    """
    results = list_results_for_product(conn, product_no=product_no)

    needs_review_count = sum(1 for r in results if r.status == EstimateResultStatus.NEEDS_REVIEW)
    if needs_review_count > 0:
        raise NeedsReviewResultsExistError(needs_review_count)

    resolution = resolve_product_dir(data_source_root, product_no)
    estcode_result = load_estcode_df(resolution.ccv_dir, resolution.product_no)
    df_result = load_product_df(resolution.ccv_dir, resolution.product_no)
    page_no_by_drawing_page_id = detection_page_no_map(conn, product_no)

    # 物理盤キー(面番号:盤番号) -> product_df由来の代表行(盤名称fallback用)。
    # 同一物理盤が複数ページ(矢視違い)にまたがる場合は最初に見つかった行を
    # 採用する(`design_data_context.py::build_design_data_context`と同じ考え方)。
    product_panels_by_key: dict[str, PanelAreaFromDf] = {}
    for panels in df_result.panels_by_page.values():
        for panel in panels:
            key = f"{panel.ban_menno}:{panel.ban_no}"
            product_panels_by_key.setdefault(key, panel)

    master_cache: dict[int, object] = {}

    def _master(master_item_id: int):
        if master_item_id not in master_cache:
            master_cache[master_item_id] = get_master_item(conn, master_item_id)
        return master_cache[master_item_id]

    items: list[EstimateConfirmationItemInput] = []
    for result in results:
        master = _master(result.master_item_id) if result.master_item_id is not None else None
        category = master.category if master is not None else None
        model = master.model if master is not None else None
        rating = master.rating if master is not None else None

        if result.target_panel_ban_menno is not None and result.target_panel_ban_no is not None:
            target_type = EstimateTargetType.PANEL
            target_id = f"panel:{result.target_panel_ban_menno}:{result.target_panel_ban_no}"
            panel_name = _resolve_panel_name(
                result.target_panel_ban_menno,
                result.target_panel_ban_no,
                product_panels_by_key,
                estcode_result.panels,
            )
        else:
            target_type = EstimateTargetType.PRODUCT
            target_id = PRODUCT_TARGET_ID
            panel_name = None

        evidence_inputs = [
            _build_evidence_input(conn, ev, page_no_by_drawing_page_id) for ev in result.evidence
        ]
        # [Issue #40 Phase 6-A] 旧`decision-analysis`(Issue #17 Phase C-1)等、
        # 「確定明細1行 = 1 detection_id」という旧来の前提のまま
        # `estimate_confirmation_items.detection_id`だけを見ている既存の
        # 読み出し専用機能が、EstimateResultベースの新しい行でも最低限の
        # 突合を続けられるよう、先頭のBBox根拠の`detection_id`をこの行の
        # 代表値としてミラーする(根拠一覧そのものはevidenceへ別途全件
        # 記録済みのため、ここでの重複保持はdetection_id 1列のみに留める)。
        # `source_type`/`status`/`bbox_x,y,w,h`は1根拠に対して一意に決まらない
        # 情報(複数BBoxが異なる取得元・座標を持ちうる)であるため、推測せず
        # Noneのままにする。
        representative_evidence = next(
            (e for e in evidence_inputs if e.evidence_kind == EvidenceKind.DETECTION and e.detection_id is not None),
            None,
        )

        items.append(
            EstimateConfirmationItemInput(
                target_id=target_id,
                target_type=target_type,
                code=result.code,
                source_type=None,
                status=None,
                detection_id=representative_evidence.detection_id if representative_evidence is not None else None,
                drawing_page_id=result.target_drawing_page_id,
                ban_menno=result.target_panel_ban_menno,
                ban_no=result.target_panel_ban_no,
                panel_name=panel_name,
                master_item_id=result.master_item_id,
                category=category,
                model=model,
                rating=rating,
                quantity=result.quantity,
                unit_price=result.unit_price,
                amount=result.price,
                bbox_x=None,
                bbox_y=None,
                bbox_w=None,
                bbox_h=None,
                page_no=page_no_by_drawing_page_id.get(result.target_drawing_page_id)
                if result.target_drawing_page_id is not None
                else None,
                current_factor=result.current_factor,
                factor_overridden=result.factor_overridden,
                judgment_method=result.judgment_method,
                applicable_unit=result.applicable_unit,
                judgment_reason=result.judgment_reason,
                source_rule_id=result.source_rule_id,
                result_status=result.status,
                evidence=evidence_inputs,
            )
        )

    return items


__all__ = [
    "build_confirmation_items",
    "detection_page_no_map",
    "DataSourceError",
    "NeedsReviewResultsExistError",
]
