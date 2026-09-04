import sqlite3

from app.domain.models import DecisionEventType, Detection, DetectionSourceType, DetectionStatus
from app.repositories.decision_events import record_event

# Phase 1.11: 積算Master Itemのcategoryを引出線・BBoxの配色決定に使うため、
# LEFT JOINで一緒に取得する (要件2: 色をDetectionへ固定値コピーせず、
# master_item_id→category→presentationの経路を都度たどれるようにする)。
# category自体はEstimateMasterItemの属性そのものであり「色」ではないため、
# ここで都度JOINして返すことは指示書2章の禁止事項(色の固定値コピー)には当たらない。
_COLUMNS = """
    d.id, d.drawing_page_id, d.panel_id, d.class_name, d.bbox_x, d.bbox_y, d.bbox_w, d.bbox_h,
    d.confidence, d.status, d.source_type, d.master_item_id,
    d.leader_label_x, d.leader_label_y, mi.category AS master_item_category,
    mi.model AS master_item_model, mi.code AS master_item_code
"""
_FROM = """
    FROM detections d
    LEFT JOIN estimate_master_items mi ON mi.id = d.master_item_id
"""


def _row_to_detection(row: sqlite3.Row) -> Detection:
    return Detection(
        id=row["id"],
        drawing_page_id=row["drawing_page_id"],
        panel_id=row["panel_id"],
        class_name=row["class_name"],
        bbox_x=row["bbox_x"],
        bbox_y=row["bbox_y"],
        bbox_w=row["bbox_w"],
        bbox_h=row["bbox_h"],
        confidence=row["confidence"],
        status=DetectionStatus(row["status"]),
        source_type=DetectionSourceType(row["source_type"]),
        master_item_id=row["master_item_id"],
        leader_label_x=row["leader_label_x"],
        leader_label_y=row["leader_label_y"],
        master_item_category=row["master_item_category"],
        master_item_model=row["master_item_model"],
        master_item_code=row["master_item_code"],
    )


def list_detections(
    conn: sqlite3.Connection, drawing_page_id: int | None = None
) -> list[Detection]:
    if drawing_page_id is not None:
        rows = conn.execute(
            f"""
            SELECT {_COLUMNS}
            {_FROM}
            WHERE d.drawing_page_id = ?
            ORDER BY d.id
            """,
            (drawing_page_id,),
        ).fetchall()
    else:
        rows = conn.execute(f"SELECT {_COLUMNS} {_FROM} ORDER BY d.id").fetchall()
    return [_row_to_detection(r) for r in rows]


def get_detection(conn: sqlite3.Connection, detection_id: int) -> Detection | None:
    row = conn.execute(
        f"SELECT {_COLUMNS} {_FROM} WHERE d.id = ?",
        (detection_id,),
    ).fetchone()
    return _row_to_detection(row) if row else None


def create_manual_detection(
    conn: sqlite3.Connection,
    *,
    drawing_page_id: int,
    master_item_id: int,
    class_name: str,
    bbox_x: float,
    bbox_y: float,
    bbox_w: float,
    bbox_h: float,
) -> Detection:
    """Manual BBoxを登録する (Phase 1.6)。

    AI検出結果は書き換えず、新規行として追加するのみ。呼び出し側 (router) で
    drawing_page_id/master_item_idの実在確認を済ませてから呼ぶこと。
    - panel_id: 現時点では自動推定しない (未確定。nullのまま)
    - confidence: 手動追加のためnull
    - status: 手動で配置した時点でユーザーが確認済みという扱いとし 'reviewed' とする (暫定)
    """
    (detection_id,) = conn.execute(
        """
        INSERT INTO detections
            (drawing_page_id, panel_id, class_name, bbox_x, bbox_y, bbox_w, bbox_h,
             confidence, status, source_type, master_item_id)
        VALUES (?, NULL, ?, ?, ?, ?, ?, NULL, 'reviewed', 'manual', ?)
        RETURNING id
        """,
        (drawing_page_id, class_name, bbox_x, bbox_y, bbox_w, bbox_h, master_item_id),
    ).fetchone()
    detection = get_detection(conn, detection_id)
    assert detection is not None  # 直前に挿入したレコードなので必ず存在する

    # Issue #4 Phase A-1: 判断・修正データの最小event記録。状態変更のINSERTと
    # 同じ`conn`・同じトランザクションでeventを記録する (呼び出し元のrouterが
    # 属するリクエスト単位のトランザクションにそのまま乗る。commit/rollback共に
    # 状態変更と一体になる。docs/decision-event-design.md 7章参照)。
    record_event(
        conn,
        event_type=DecisionEventType.CREATE,
        detection_id=detection.id,
        drawing_page_id=detection.drawing_page_id,
        source_type=detection.source_type,
        master_item_id=detection.master_item_id,
        before_bbox=None,
        after_bbox=(detection.bbox_x, detection.bbox_y, detection.bbox_w, detection.bbox_h),
    )
    return detection


def update_detection_bbox(
    conn: sqlite3.Connection,
    detection_id: int,
    *,
    before: Detection,
    bbox_x: float,
    bbox_y: float,
    bbox_w: float,
    bbox_h: float,
    leader_label_x: float | None = None,
    leader_label_y: float | None = None,
) -> Detection | None:
    """DetectionのBBox・引出線ラベル位置を更新する (Phase 1.7、Phase 1.11で拡張)。

    Manual/AIの双方が対象。source_type/status/class_name/master_item_id等は
    変更しない。元AIモデル・元図面は一切変更せず、Sekisan Navi DB上の座標のみを
    ユーザー補正する。

    leader_label_x/yはBBox本体の座標(bbox_x/y/w/h)とは独立して保持する
    (指示書10章: 「BBox位置 ≠ 引出線ラベル位置」)。Move/Resize等、ラベル位置を
    変更しない更新ではNoneを渡すことで既存値を保持する (`COALESCE`)。

    `before`は呼び出し側(router)が404判定のために既に`get_detection()`で
    取得済みの更新前スナップショットをそのまま渡す (Issue #4 Phase A-1:
    event記録用の「変更前bbox」を得るために追加のSELECTを増やさないため。
    docs/decision-event-design.md 4.4章参照)。
    """
    cur = conn.execute(
        """
        UPDATE detections
        SET bbox_x = ?, bbox_y = ?, bbox_w = ?, bbox_h = ?,
            leader_label_x = COALESCE(?, leader_label_x),
            leader_label_y = COALESCE(?, leader_label_y)
        WHERE id = ?
        """,
        (bbox_x, bbox_y, bbox_w, bbox_h, leader_label_x, leader_label_y, detection_id),
    )
    if cur.rowcount == 0:
        return None

    # Issue #4 Phase A-1: bbox自体が実際に変化した場合のみbbox_editイベントを
    # 記録する。leader_label_x/yのみを変更する呼び出し(bbox_x/y/w/hは更新前と
    # 同一値のまま送られてくる。既存の`test_updating_leader_label_position_
    # does_not_change_bbox`等が該当)では、before==afterの無意味なイベントを
    # 機械的に量産しない (docs/decision-event-design.md 4.4章)。
    before_bbox = (before.bbox_x, before.bbox_y, before.bbox_w, before.bbox_h)
    after_bbox = (bbox_x, bbox_y, bbox_w, bbox_h)
    if before_bbox != after_bbox:
        record_event(
            conn,
            event_type=DecisionEventType.BBOX_EDIT,
            detection_id=detection_id,
            drawing_page_id=before.drawing_page_id,
            source_type=before.source_type,
            master_item_id=before.master_item_id,
            before_bbox=before_bbox,
            after_bbox=after_bbox,
        )
    return get_detection(conn, detection_id)


def delete_detection(conn: sqlite3.Connection, detection_id: int) -> bool:
    """Detectionを削除する (Phase 1.7, 要件12-15)。Manual/AIの双方が対象。

    EstimateReference.detection_id からこのDetectionが参照されている場合、
    積算結果(EstimateItem)やEstimateReference行そのものは削除せず、
    参照だけをNULLへ解除してから削除する (dangling reference / FK違反を防ぐ。
    指示書15章)。削除するのはSekisan Navi DB上のDetection行のみであり、
    元PDF・元画像・DXF・YOLOモデル・UNC共有元・CCV関連データには一切触れない。

    戻り値: 削除できた場合True、対象が存在しなかった場合False。
    """
    # Issue #4 Phase A-1: 削除前にスナップショットを取得し、削除の事実
    # (削除直前のbbox/source_type/master_item_id)をevent記録に使う。
    # decision_events.detection_idはFK制約を持たないため、Detection行を
    # 削除した後でもevent行自体は残り、この非正規化コピーだけで解釈できる
    # (docs/decision-event-design.md 6章)。
    detection = get_detection(conn, detection_id)
    if detection is None:
        return False

    conn.execute(
        "UPDATE estimate_references SET detection_id = NULL WHERE detection_id = ?",
        (detection_id,),
    )
    cur = conn.execute("DELETE FROM detections WHERE id = ?", (detection_id,))
    if cur.rowcount > 0:
        record_event(
            conn,
            event_type=DecisionEventType.DELETE,
            detection_id=detection_id,
            drawing_page_id=detection.drawing_page_id,
            source_type=detection.source_type,
            master_item_id=detection.master_item_id,
            before_bbox=(detection.bbox_x, detection.bbox_y, detection.bbox_w, detection.bbox_h),
            after_bbox=None,
        )
    return cur.rowcount > 0
