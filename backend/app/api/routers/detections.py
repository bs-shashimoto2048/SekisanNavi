import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_db
from app.repositories.detections import (
    create_manual_detection,
    delete_detection,
    get_detection,
    list_detections,
    update_detection_bbox,
)
from app.repositories.drawings import get_drawing_page
from app.repositories.master import get_master_item
from app.schemas.common import DetectionBBoxUpdateIn, DetectionOut, ManualDetectionCreateIn

router = APIRouter(prefix="/api/detections", tags=["detections"])


@router.get("", response_model=list[DetectionOut])
def read_detections(
    drawing_page_id: int | None = Query(default=None),
    conn: sqlite3.Connection = Depends(get_db),
) -> list[DetectionOut]:
    return [DetectionOut(**d.__dict__) for d in list_detections(conn, drawing_page_id)]


@router.post("", response_model=DetectionOut, status_code=201)
def create_detection(
    body: ManualDetectionCreateIn, conn: sqlite3.Connection = Depends(get_db)
) -> DetectionOut:
    """Manual BBoxを登録する (Phase 1.6, 要件9/17)。

    - drawing_page_id / master_item_id は事前に実在確認する (不正なIDは404)。
    - AI検出結果 (既存のdetections行) は一切変更しない。新規行の追加のみ。
    """
    page = get_drawing_page(conn, body.drawing_page_id)
    if page is None:
        raise HTTPException(status_code=404, detail="指定された図面ページが見つかりません。")

    master_item = get_master_item(conn, body.master_item_id)
    if master_item is None:
        raise HTTPException(status_code=404, detail="指定された積算コードが見つかりません。")

    detection = create_manual_detection(
        conn,
        drawing_page_id=body.drawing_page_id,
        master_item_id=body.master_item_id,
        # 表示ラベルにはMaster Itemのコードを用いる (要件11: 名称・価格情報の大量コピーはしない)。
        class_name=master_item.code,
        bbox_x=body.bbox_x,
        bbox_y=body.bbox_y,
        bbox_w=body.bbox_w,
        bbox_h=body.bbox_h,
    )
    return DetectionOut(**detection.__dict__)


@router.patch("/{detection_id}", response_model=DetectionOut)
def update_detection(
    detection_id: int, body: DetectionBBoxUpdateIn, conn: sqlite3.Connection = Depends(get_db)
) -> DetectionOut:
    """DetectionのBBoxをリサイズ/移動保存する (Phase 1.7, 要件23/24)。
    Phase 1.11で引出線ラベル位置(leader_label_x/y)の保存にも流用する。

    Manual/AIの双方が対象 (source_typeによる制限はしない)。座標は0.0〜1.0の
    正規化座標のまま受け取る (Frontend側でzoom/pan非依存の座標へ変換済みであること)。
    leader_label_x/yを省略した場合、既存のラベル位置は変更されない。
    """
    detection = get_detection(conn, detection_id)
    if detection is None:
        raise HTTPException(status_code=404, detail="指定されたDetectionが見つかりません。")

    updated = update_detection_bbox(
        conn,
        detection_id,
        # Issue #4 Phase A-1: 上で404判定のために取得済みのスナップショットを
        # 「変更前」としてそのまま渡す (追加のSELECTを増やさない。
        # docs/decision-event-design.md 4.4章)。
        before=detection,
        bbox_x=body.bbox_x,
        bbox_y=body.bbox_y,
        bbox_w=body.bbox_w,
        bbox_h=body.bbox_h,
        leader_label_x=body.leader_label_x,
        leader_label_y=body.leader_label_y,
    )
    assert updated is not None
    return DetectionOut(**updated.__dict__)


@router.delete("/{detection_id}", status_code=204)
def remove_detection(detection_id: int, conn: sqlite3.Connection = Depends(get_db)) -> None:
    """Detectionを削除する (Phase 1.7, 要件12-15)。Manual/AIの双方が対象。

    このDetectionを参照しているEstimateReferenceは、行ごと削除せず
    detection_id をNULLへ解除してから削除する (積算結果自体は保持する)。
    Sekisan Navi DB上のデータのみを削除し、元図面・UNC共有元・CCV関連データ等には
    一切影響しない。
    """
    deleted = delete_detection(conn, detection_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="指定されたDetectionが見つかりません。")
