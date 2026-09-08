"""判断・修正データの最小event記録 (Issue #4 Phase A-1)、および
その読み出し (Phase A-2)。

設計の詳細・理由付けは `docs/decision-event-design.md` を参照。この
モジュールは`decision_events`テーブルへのINSERT(`record_event`)と、
読み出し専用のSELECT(`list_events_for_product`、Phase A-2で追加)のみを
行う。current state(`detections`)とは独立した薄いレイヤーとして実装する。

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
- `list_events_for_product()`は読み出し専用のSELECTのみで、append-only
  方針(更新・削除する関数は用意しない)には影響しない。保存済みの値を
  そのまま返すのみで、現在の`detections`/`estimate_master_items`から
  値を補完・再計算することもしない。
"""
import sqlite3

from app.domain.models import DecisionEvent, DecisionEventType, DetectionSourceType


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


def list_events_for_product(conn: sqlite3.Connection, *, product_no: str) -> list[DecisionEvent]:
    """製番`product_no`のdecision_eventsを、発生順(古い順。`id`昇順)で返す
    (Issue #4 Phase A-2)。

    `decision_events`自体には`product_no`列が無いため、`drawing_page_id`で
    `drawing_pages`とJOINし、`drawing_pages.product_no`で絞り込む
    (`drawing_pages.product_no`はPhase 1.8で追加済みの列。
    `docs/data-model.md`参照)。`drawing_page_id`にFK制約は無いが、
    `drawing_pages`を削除するAPIは存在しないため、実運用でJOINが
    欠落するケースは無い(理論上そのイベントは対象外として除外される)。

    並び順は`occurred_at`(秒精度)ではなく`id`(AUTOINCREMENT、常に発生順に
    増加する)を使う。同一秒に複数のeventが発生した場合でも、発生順を
    一意に再現するため。「古い順」を採用するのは、Backend/Frontend双方で
    「create→bbox_edit→delete」のように、ユーザーが実際に行った操作の
    時系列をそのまま上から下へ追える表示にするため(新しい順にすると、
    一連の操作が読みづらい逆順になる)。

    読み出し専用のSELECTのみで、保存済みの値を一切変更しない。現在の
    `detections`/`estimate_master_items`から値を補完・再計算することも
    しない。
    """
    rows = conn.execute(
        """
        SELECT
            e.id AS id,
            e.occurred_at AS occurred_at,
            e.event_type AS event_type,
            e.detection_id AS detection_id,
            e.drawing_page_id AS drawing_page_id,
            e.source_type AS source_type,
            e.master_item_id AS master_item_id,
            e.before_bbox_x AS before_bbox_x,
            e.before_bbox_y AS before_bbox_y,
            e.before_bbox_w AS before_bbox_w,
            e.before_bbox_h AS before_bbox_h,
            e.after_bbox_x AS after_bbox_x,
            e.after_bbox_y AS after_bbox_y,
            e.after_bbox_w AS after_bbox_w,
            e.after_bbox_h AS after_bbox_h,
            dp.page_no AS page_no
        FROM decision_events e
        JOIN drawing_pages dp ON dp.id = e.drawing_page_id
        WHERE dp.product_no = ?
        ORDER BY e.id ASC
        """,
        (product_no,),
    ).fetchall()

    return [
        DecisionEvent(
            id=row["id"],
            occurred_at=row["occurred_at"],
            event_type=DecisionEventType(row["event_type"]),
            detection_id=row["detection_id"],
            drawing_page_id=row["drawing_page_id"],
            source_type=DetectionSourceType(row["source_type"]),
            master_item_id=row["master_item_id"],
            before_bbox_x=row["before_bbox_x"],
            before_bbox_y=row["before_bbox_y"],
            before_bbox_w=row["before_bbox_w"],
            before_bbox_h=row["before_bbox_h"],
            after_bbox_x=row["after_bbox_x"],
            after_bbox_y=row["after_bbox_y"],
            after_bbox_w=row["after_bbox_w"],
            after_bbox_h=row["after_bbox_h"],
            page_no=row["page_no"],
        )
        for row in rows
    ]
