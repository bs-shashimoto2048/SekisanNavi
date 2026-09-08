"""decision_events × estimate_confirmations の最小read-only分析
(Issue #17 Phase C-1)。

Phase C-0の棚卸し(Issue #17調査コメント)で推奨された「候補1: 既存データだけを
使った最小分析API」に対応する。新規テーブル・カラムは追加せず、既存の
`decision_events`/`estimate_confirmations`/`estimate_confirmation_items`への
read-only SELECTのみを行う。

このモジュールはSELECT専用であり、以下のいずれも変更しない:
- `decision_events`のappend-only保存・`record_event()`(Phase A-1/A-2)
- `estimate_confirmations`/`estimate_confirmation_items`のappend-only保存・
  `save_confirmation()`(Phase B-1〜B-4)
- BBox編集・Undo/Redoの書き込み処理

既知の制約(隠さず、呼び出し側にも伝える):
- Undo/Redoは通常のbbox_edit/create/deleteと区別できないため、この分析でも
  区別しない(`docs/decision-event-design.md` §8参照)。
- move/resizeは保存時に区別していないため、`bbox_edit`のまま扱う(区別しない)。
- `decision_events.occurred_at`/`estimate_confirmations.confirmed_at`はいずれも
  秒精度の文字列(`datetime('now')`由来)のため、同一秒に発生したevent/確定の
  前後関係は厳密には区別できない。
- `detection_id`はUndo/Redoによるcreate/delete(AUTOINCREMENTでの再採番)で
  分断されうる(既知の制約。Issue #4本文/`docs/decision-event-design.md`参照)。
  このモジュールは`detection_id`をそのまま突合キーとして使うため、分断された
  前後のIDは別のDetectionとして扱われる(統合しない)。
"""
from __future__ import annotations

import sqlite3

from app.domain.models import (
    DecisionAnalysisConfirmation,
    DecisionAnalysisConfirmationItemAnalysis,
    DecisionAnalysisDetectionSummary,
    DecisionAnalysisMasterItemBreakdown,
    DecisionAnalysisSummary,
    DetectionSourceType,
)


def summarize_events_for_product(conn: sqlite3.Connection, *, product_no: str) -> DecisionAnalysisSummary:
    """製番`product_no`のdecision_eventsをevent_type別・ページ別・積算コード別に
    集計する(Issue #17 Phase C-1)。

    `decision_events`自体には`product_no`列が無いため、`drawing_page_id`から
    `drawing_pages.product_no`をJOINで解決して絞り込む
    (`repositories/decision_events.py::list_events_for_product`と同じ方式)。

    `bbox_edit_count_by_master_item`の`current_code`のみ、表示用に**現在の**
    `estimate_master_items`をLEFT JOINして参照する(現在値JOINであることを
    呼び出し側にも伝える。参照先のMaster行が無い場合は`None`)。
    """
    event_count_rows = conn.execute(
        """
        SELECT e.event_type AS event_type, COUNT(*) AS c
        FROM decision_events e
        JOIN drawing_pages dp ON dp.id = e.drawing_page_id
        WHERE dp.product_no = ?
        GROUP BY e.event_type
        """,
        (product_no,),
    ).fetchall()
    event_counts = {row["event_type"]: row["c"] for row in event_count_rows}
    total_events = sum(event_counts.values())

    page_rows = conn.execute(
        """
        SELECT dp.page_no AS page_no, COUNT(*) AS c
        FROM decision_events e
        JOIN drawing_pages dp ON dp.id = e.drawing_page_id
        WHERE dp.product_no = ? AND e.event_type = 'bbox_edit'
        GROUP BY dp.page_no
        """,
        (product_no,),
    ).fetchall()
    bbox_edit_count_by_page_no = {row["page_no"]: row["c"] for row in page_rows}

    master_rows = conn.execute(
        """
        SELECT e.master_item_id AS master_item_id, m.code AS current_code, COUNT(*) AS c
        FROM decision_events e
        JOIN drawing_pages dp ON dp.id = e.drawing_page_id
        LEFT JOIN estimate_master_items m ON m.id = e.master_item_id
        WHERE dp.product_no = ? AND e.event_type = 'bbox_edit' AND e.master_item_id IS NOT NULL
        GROUP BY e.master_item_id, m.code
        ORDER BY c DESC, e.master_item_id ASC
        """,
        (product_no,),
    ).fetchall()
    bbox_edit_count_by_master_item = [
        DecisionAnalysisMasterItemBreakdown(
            master_item_id=row["master_item_id"],
            current_code=row["current_code"],
            bbox_edit_count=row["c"],
        )
        for row in master_rows
    ]

    return DecisionAnalysisSummary(
        product_no=product_no,
        event_counts=event_counts,
        total_events=total_events,
        bbox_edit_count_by_page_no=bbox_edit_count_by_page_no,
        bbox_edit_count_by_master_item=bbox_edit_count_by_master_item,
    )


def list_detection_summaries_for_product(
    conn: sqlite3.Connection, *, product_no: str
) -> list[DecisionAnalysisDetectionSummary]:
    """製番`product_no`について、decision_eventsが1件以上存在するDetection単位で
    操作系列・編集回数を集計する(Issue #17 Phase C-1)。

    `page_no`/`source_type`/`master_item_id`は、その`detection_id`の
    **最初に記録されたevent**(`first_event_id`)の値をそのまま使う(現在の
    `detections`へは依存しないため、Detectionが既に削除されていても取得できる。
    ただし、あるDetectionの最初のeventがseed直接投入等の理由で`create`ではない
    場合(既知の制約)、その最初に記録されたevent時点の値になる)。

    `event_count`/`bbox_edit_count`のみ集計、それ以外は最初のevent行から
    そのまま転記するだけで、値の補完・再計算は行わない。
    """
    rows = conn.execute(
        """
        WITH agg AS (
            SELECT
                e.detection_id AS detection_id,
                COUNT(*) AS event_count,
                SUM(CASE WHEN e.event_type = 'bbox_edit' THEN 1 ELSE 0 END) AS bbox_edit_count,
                MIN(e.id) AS first_event_id,
                MAX(e.id) AS last_event_id
            FROM decision_events e
            JOIN drawing_pages dp ON dp.id = e.drawing_page_id
            WHERE dp.product_no = ?
            GROUP BY e.detection_id
        )
        SELECT
            agg.detection_id AS detection_id,
            agg.event_count AS event_count,
            agg.bbox_edit_count AS bbox_edit_count,
            agg.first_event_id AS first_event_id,
            agg.last_event_id AS last_event_id,
            fe.source_type AS source_type,
            fe.master_item_id AS master_item_id,
            dp.page_no AS page_no
        FROM agg
        JOIN decision_events fe ON fe.id = agg.first_event_id
        JOIN drawing_pages dp ON dp.id = fe.drawing_page_id
        ORDER BY agg.first_event_id ASC
        """,
        (product_no,),
    ).fetchall()

    return [
        DecisionAnalysisDetectionSummary(
            detection_id=row["detection_id"],
            page_no=row["page_no"],
            source_type=DetectionSourceType(row["source_type"]),
            master_item_id=row["master_item_id"],
            event_count=row["event_count"],
            bbox_edit_count=row["bbox_edit_count"],
            first_event_id=row["first_event_id"],
            last_event_id=row["last_event_id"],
        )
        for row in rows
    ]


def list_confirmation_analysis_for_product(
    conn: sqlite3.Connection, *, product_no: str
) -> list[DecisionAnalysisConfirmation]:
    """製番`product_no`の各確定snapshotについて、明細ごとに「確定時点以前に
    そのdetection_idへ何件のevent/bbox_editが存在したか」を突合する
    (Issue #17 Phase C-1)。

    `estimate_confirmations.product_no`は直接列として持つため
    (`decision_events`と異なりJOINは不要)、そのまま絞り込める。

    明細の`detection_id`が`None`(対象Detectionを特定できない明細。仕様上
    起こり得る)の場合、event件数はいずれも0とする(decision_events側に
    対応する行が無いため。エラーにはしない)。

    `occurred_at <= confirmed_at`の文字列比較で「確定時点以前」を判定する
    (いずれも秒精度のため、同一秒に発生したevent/確定の前後関係は厳密には
    区別できない。既知の制約としてモジュールdocstring参照)。
    """
    confirmation_rows = conn.execute(
        "SELECT id, confirmed_at FROM estimate_confirmations WHERE product_no = ? ORDER BY id ASC",
        (product_no,),
    ).fetchall()
    if not confirmation_rows:
        return []

    confirmation_ids = [row["id"] for row in confirmation_rows]
    confirmed_at_by_id = {row["id"]: row["confirmed_at"] for row in confirmation_rows}

    placeholders = ",".join("?" for _ in confirmation_ids)
    item_rows = conn.execute(
        f"""
        SELECT confirmation_id, detection_id, code
        FROM estimate_confirmation_items
        WHERE confirmation_id IN ({placeholders})
        ORDER BY id ASC
        """,
        confirmation_ids,
    ).fetchall()

    detection_ids = sorted({row["detection_id"] for row in item_rows if row["detection_id"] is not None})
    events_by_detection: dict[int, list[tuple[str, str]]] = {}
    if detection_ids:
        event_placeholders = ",".join("?" for _ in detection_ids)
        event_rows = conn.execute(
            f"""
            SELECT detection_id, event_type, occurred_at
            FROM decision_events
            WHERE detection_id IN ({event_placeholders})
            """,
            detection_ids,
        ).fetchall()
        for row in event_rows:
            events_by_detection.setdefault(row["detection_id"], []).append(
                (row["event_type"], row["occurred_at"])
            )

    items_by_confirmation: dict[int, list[DecisionAnalysisConfirmationItemAnalysis]] = {
        cid: [] for cid in confirmation_ids
    }

    for item in item_rows:
        confirmation_id = item["confirmation_id"]
        detection_id = item["detection_id"]
        confirmed_at = confirmed_at_by_id[confirmation_id]

        event_count = 0
        bbox_edit_count = 0
        if detection_id is not None:
            for event_type, occurred_at in events_by_detection.get(detection_id, []):
                if occurred_at <= confirmed_at:
                    event_count += 1
                    if event_type == "bbox_edit":
                        bbox_edit_count += 1

        items_by_confirmation[confirmation_id].append(
            DecisionAnalysisConfirmationItemAnalysis(
                detection_id=detection_id,
                code=item["code"],
                event_count_before_confirmation=event_count,
                bbox_edit_count_before_confirmation=bbox_edit_count,
            )
        )

    return [
        DecisionAnalysisConfirmation(
            confirmation_id=row["id"],
            confirmed_at=row["confirmed_at"],
            items=items_by_confirmation[row["id"]],
        )
        for row in confirmation_rows
    ]
