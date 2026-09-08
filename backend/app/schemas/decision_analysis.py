"""decision_events × estimate_confirmations の最小read-only分析API
(Issue #17 Phase C-1) のレスポンススキーマ。

`GET /api/products/{product_no}/decision-analysis/summary` /
`.../decision-analysis/detections` / `.../decision-analysis/confirmations`
専用。書き込みAPIは無い(read-only)。
"""
from __future__ import annotations

from pydantic import BaseModel

from app.domain.models import DetectionSourceType


class DecisionAnalysisMasterItemBreakdownOut(BaseModel):
    master_item_id: int
    current_code: str | None
    bbox_edit_count: int


class DecisionAnalysisSummaryOut(BaseModel):
    product_no: str
    event_counts: dict[str, int]
    total_events: int
    bbox_edit_count_by_page_no: dict[int, int]
    bbox_edit_count_by_master_item: list[DecisionAnalysisMasterItemBreakdownOut]


class DecisionAnalysisDetectionSummaryOut(BaseModel):
    detection_id: int
    page_no: int | None
    source_type: DetectionSourceType
    master_item_id: int | None
    event_count: int
    bbox_edit_count: int
    first_event_id: int
    last_event_id: int


class DecisionAnalysisConfirmationItemOut(BaseModel):
    detection_id: int | None
    code: str
    event_count_before_confirmation: int
    bbox_edit_count_before_confirmation: int


class DecisionAnalysisConfirmationOut(BaseModel):
    confirmation_id: int
    confirmed_at: str
    items: list[DecisionAnalysisConfirmationItemOut]


__all__ = [
    "DecisionAnalysisMasterItemBreakdownOut",
    "DecisionAnalysisSummaryOut",
    "DecisionAnalysisDetectionSummaryOut",
    "DecisionAnalysisConfirmationItemOut",
    "DecisionAnalysisConfirmationOut",
]
