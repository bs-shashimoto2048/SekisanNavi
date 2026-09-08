"""積算確定snapshot (Issue #4 Phase B-2/B-4) のAPI入出力スキーマ。

Phase B-2時点では確定操作(作成)のレスポンス形(`EstimateConfirmationOut`)
のみを定義していたが、Issue #4 Phase B-4で過去snapshotの一覧・詳細取得API
向けのレスポンス形(`EstimateConfirmationSummaryOut`/
`EstimateConfirmationDetailOut`)を追加した。既存の`EstimateConfirmationOut`
(作成APIのレスポンス)はPhase B-4で変更していない
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


class EstimateConfirmationSummaryOut(BaseModel):
    """過去確定snapshot一覧 (`GET /api/products/{product_no}/estimate-confirmations`、
    Issue #4 Phase B-4) の1件分。明細(items)は含まない一覧表示専用の軽量版。

    `total_amount`は明細のうち`amount`がNULL(単価不明)の行を除いた合計
    (`repositories/estimate_confirmations.py::list_confirmations`のSQLで算出)。
    """

    id: int
    product_no: str
    confirmed_at: str
    item_count: int
    total_amount: float


class EstimateConfirmationDetailOut(BaseModel):
    """過去確定snapshot詳細 (`GET /api/products/{product_no}/estimate-confirmations/
    {confirmation_id}`、Issue #4 Phase B-4)。保存済みの値をそのまま返すのみで、
    現在のEstimate Masterや現在のBBox/CSVから再計算しない。
    """

    id: int
    product_no: str
    confirmed_at: str
    item_count: int
    total_amount: float
    items: list[EstimateConfirmationItemOut]
