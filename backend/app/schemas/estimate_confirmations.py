"""積算確定snapshot (Issue #4 Phase B-2) のAPI入出力スキーマ。

読み出しAPI(過去snapshotの一覧・詳細取得)はPhase B-2のスコープ外のため、
ここには確定操作(作成)のレスポンス形のみを定義する
(`docs/decision-snapshot-design.md` 10章/11章、Issue #4コメント参照)。
"""
from __future__ import annotations

from pydantic import BaseModel

from app.domain.models import DetectionSourceType, DetectionStatus, EstimateTargetType


class EstimateConfirmationItemOut(BaseModel):
    id: int
    detection_id: int | None
    drawing_page_id: int | None
    target_id: str
    target_type: EstimateTargetType
    ban_menno: int | None
    ban_no: int | None
    panel_name: str | None
    master_item_id: int | None
    code: str
    category: str | None
    model: str | None
    rating: str | None
    source_type: DetectionSourceType
    quantity: float
    unit_price: float | None
    amount: float | None
    status: DetectionStatus
    bbox_x: float | None
    bbox_y: float | None
    bbox_w: float | None
    bbox_h: float | None
    page_no: int | None


class EstimateConfirmationOut(BaseModel):
    id: int
    product_no: str
    confirmed_at: str
    item_count: int
    items: list[EstimateConfirmationItemOut]
