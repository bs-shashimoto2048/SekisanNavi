"""積算確定snapshot (Issue #4 Phase B-2/B-4、Issue #40 Phase 6-Aで
EstimateResultベースへ移行) のAPI入出力スキーマ。

Phase B-2時点では確定操作(作成)のレスポンス形(`EstimateConfirmationOut`)
のみを定義していたが、Issue #4 Phase B-4で過去snapshotの一覧・詳細取得API
向けのレスポンス形(`EstimateConfirmationSummaryOut`/
`EstimateConfirmationDetailOut`)を追加した。既存の`EstimateConfirmationOut`
(作成APIのレスポンス)はPhase B-4で変更していない
(`docs/decision-snapshot-design.md` 10章/11章、Issue #4コメント参照)。

[Issue #40 Phase 6-A] `EstimateConfirmationItemOut`へ、EstimateResultの
snapshot列(`current_factor`等)と根拠一覧(`evidence`)を追加した。
`source_type`/`status`は旧Detectionベースの行にのみ意味を持つため
optionalへ変更した(値自体の意味は変えていない)。
"""
from __future__ import annotations

from pydantic import BaseModel

from app.domain.estimate_rules import ApplicableUnit, EstimateResultStatus, EvidenceKind, JudgmentMethod
from app.domain.models import DetectionSourceType, DetectionStatus, EstimateTargetType


class EstimateConfirmationEvidenceOut(BaseModel):
    """確定snapshot明細1行の根拠1件分 (Issue #40 Phase 6-A)。"""

    id: int
    evidence_kind: EvidenceKind
    detection_id: int | None
    drawing_page_id: int | None
    source_type: DetectionSourceType | None
    evidence_type_key: str | None
    master_item_code: str | None
    class_name: str | None
    bbox_x: float | None
    bbox_y: float | None
    bbox_w: float | None
    bbox_h: float | None
    page_no: int | None
    design_data_ref: str | None


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
    # [Issue #40 Phase 6-A] 旧Detectionベースの行にのみ意味を持つためoptional化。
    source_type: DetectionSourceType | None
    quantity: float
    unit_price: float | None
    amount: float | None
    status: DetectionStatus | None
    bbox_x: float | None
    bbox_y: float | None
    bbox_w: float | None
    bbox_h: float | None
    page_no: int | None
    # [Issue #40 Phase 6-A新規] EstimateResultのsnapshot。旧Detectionベースの
    # 行(Phase 6-A以前に確定されたもの)では全てNoneのまま返る。
    current_factor: float | None = None
    factor_overridden: bool | None = None
    judgment_method: JudgmentMethod | None = None
    applicable_unit: ApplicableUnit | None = None
    judgment_reason: str | None = None
    source_rule_id: int | None = None
    result_status: EstimateResultStatus | None = None
    # [Issue #40 Phase 6後半新規] 数量override snapshot。Phase 6後半以前に
    # 確定された行では全てNoneのまま返る。
    initial_quantity: float | None = None
    current_quantity: float | None = None
    quantity_overridden: bool | None = None
    quantity_override_reason: str | None = None
    # [PR #46レビュー指摘対応] 確定時点のoverride実行時刻・actor。
    # Phase 6後半以前の過去snapshotでは全てNoneのまま返る。
    quantity_updated_at: str | None = None
    quantity_updated_by: str | None = None
    evidence: list[EstimateConfirmationEvidenceOut] = []


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
