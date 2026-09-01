import sqlite3

from app.domain.models import Detection, DetectionSourceType, DetectionStatus

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
    return detection


def update_detection_bbox(
    conn: sqlite3.Connection,
    detection_id: int,
    *,
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
    conn.execute(
        "UPDATE estimate_references SET detection_id = NULL WHERE detection_id = ?",
        (detection_id,),
    )
    cur = conn.execute("DELETE FROM detections WHERE id = ?", (detection_id,))
    return cur.rowcount > 0
