"""判断・修正データの最小event記録 (Issue #4 Phase A-1)。

設計の詳細・理由付けは `docs/decision-event-design.md` を参照。この
モジュールは`decision_events`テーブルへのINSERTだけを行う、
current state(`detections`)とは独立した薄いレイヤーとして実装する。

- `record_event()`はcommit/rollbackを一切行わない。呼び出し側
  (`repositories/detections.py`の各関数)が渡す`conn`は、
  `app/api/deps.py::get_db` → `app/db/connection.py::get_connection`が
  提供する「1リクエスト=1トランザクション」の接続をそのまま使う想定であり、
  現在状態を変更するSQL(INSERT/UPDATE/DELETE)と同一トランザクション・
  同一commit/rollback対象になる (設計7章)。
- `detection_id`にFK制約を持たせない設計(設計6章)のため、ここでの
  INSERT自体もDetectionの実在確認を行わない。呼び出し側が既に
  Detectionの実在を確認済みの文脈(作成直後・更新前・削除前)からのみ
  呼ばれることを前提とする。
"""
import sqlite3

from app.domain.models import DecisionEventType, DetectionSourceType


def record_event(
    conn: sqlite3.Connection,
    *,
    event_type: DecisionEventType,
    detection_id: int,
    drawing_page_id: int,
    source_type: DetectionSourceType,
    master_item_id: int | None,
    before_bbox: tuple[float, float, float, float] | None,
    after_bbox: tuple[float, float, float, float] | None,
) -> None:
    """`decision_events`へ1行追加する (append-only、更新・削除はしない)。

    `before_bbox`/`after_bbox`は`(x, y, w, h)`のタプル、またはその区分が
    無いevent(create時のbefore、delete時のafter)ではNoneを渡す。
    """
    before_x, before_y, before_w, before_h = before_bbox if before_bbox is not None else (None, None, None, None)
    after_x, after_y, after_w, after_h = after_bbox if after_bbox is not None else (None, None, None, None)

    conn.execute(
        """
        INSERT INTO decision_events
            (event_type, detection_id, drawing_page_id, source_type, master_item_id,
             before_bbox_x, before_bbox_y, before_bbox_w, before_bbox_h,
             after_bbox_x, after_bbox_y, after_bbox_w, after_bbox_h)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event_type.value,
            detection_id,
            drawing_page_id,
            source_type.value,
            master_item_id,
            before_x,
            before_y,
            before_w,
            before_h,
            after_x,
            after_y,
            after_w,
            after_h,
        ),
    )
