"""判断履歴(decision_events)読み出しAPIのレスポンススキーマ (Issue #4 Phase A-2)。

`GET /api/products/{product_no}/decision-events`専用。書き込み側
(`record_event()`)はPhase A-1のまま変更しておらず、対応するスキーマも
公開していない(そもそも書き込みAPI自体が無く、`repositories/detections.py`
内部から直接呼ばれるのみのため)。
"""
from __future__ import annotations

from pydantic import BaseModel

from app.domain.models import DecisionEventType, DetectionSourceType


class DecisionEventOut(BaseModel):
    id: int
    occurred_at: str
    event_type: DecisionEventType
    detection_id: int
    drawing_page_id: int
    page_no: int | None
    source_type: DetectionSourceType
    master_item_id: int | None
    before_bbox_x: float | None
    before_bbox_y: float | None
    before_bbox_w: float | None
    before_bbox_h: float | None
    after_bbox_x: float | None
    after_bbox_y: float | None
    after_bbox_w: float | None
    after_bbox_h: float | None
