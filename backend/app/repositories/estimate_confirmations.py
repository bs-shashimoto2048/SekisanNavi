"""積算確定snapshot (Issue #4 Phase B-1) の最小book-keeping。

設計の詳細・理由付けは `docs/decision-snapshot-design.md` を参照。この
モジュールは `estimate_confirmations` / `estimate_confirmation_items` への
INSERTのみを行う、current state (`detections`/`estimate_master_items`) とは
独立した書き込み専用レイヤーとして実装する。読み出しAPI・確定操作を呼び出す
API・UIはいずれもPhase B-1のスコープ外であり、今回追加しない(設計10章/11章)。

- `save_confirmation()` はcommit/rollbackを一切行わない。呼び出し側が渡す
  `conn` は、`app/db/connection.py::get_connection` が提供する
  「1コンテキスト=1トランザクション」の接続をそのまま使う想定であり、
  header行・明細行いずれのINSERTも、途中で例外が起きれば同じトランザクション
  としてロールバックされる(設計8章のtransaction境界と同じ考え方。
  `decision_events`の`record_event()`と同様の設計)。
- append-only専用: 既存snapshotを更新・削除する関数はこのモジュールに
  意図的に用意しない(設計9章: 再確定は新しいheader行を都度追加する)。
- `detection_id`/`drawing_page_id` にFK制約を持たせない設計(設計6章)の
  ため、ここでのINSERT自体もDetection/DrawingPageの実在確認を行わない。
  呼び出し側が集めた値をそのまま非正規化コピーとして保存するだけの
  薄いレイヤーである。
"""
from __future__ import annotations

import sqlite3
from collections.abc import Sequence

from app.domain.models import (
    EstimateConfirmation,
    EstimateConfirmationItem,
    EstimateConfirmationItemInput,
)


def save_confirmation(
    conn: sqlite3.Connection,
    *,
    product_no: str,
    items: Sequence[EstimateConfirmationItemInput],
) -> EstimateConfirmation:
    """1回の確定操作をheader + items として同一トランザクションで保存する。

    headerを先にINSERTしてからitemsをINSERTする(`confirmation_id`のFK制約が
    安全に成立する順序。設計6章)。`items`が空(積算コード紐付きのDetectionが
    1件も無い製番)でも、header行だけを持つ確定として保存する(0件の確定を
    エラー扱いにする判断はPhase B-1のスコープ外とする)。
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
                source_type, quantity, unit_price, amount, status,
                bbox_x, bbox_y, bbox_w, bbox_h, page_no
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                item.source_type.value,
                item.quantity,
                item.unit_price,
                item.amount,
                item.status.value,
                item.bbox_x,
                item.bbox_y,
                item.bbox_w,
                item.bbox_h,
                item.page_no,
            ),
        )
        saved_items.append(
            EstimateConfirmationItem(
                id=item_cursor.lastrowid,
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
