"""Issue #40 Phase 2: 積算コード選定〜数量・係数・金額/工数算出の一貫ルール化。

API入出力スキーマ。Phase 2ではUIを一切実装しないため、これらは将来の
Phase 3/4向けの基盤として用意するのみ(`docs`にも未反映。PR/Issue報告参照)。
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.domain.estimate_rules import (
    ApplicableUnit,
    EvidenceKind,
    EvidenceUsage,
    JudgmentMethod,
    JudgmentScope,
)


class DrawingEvidenceTypeOut(BaseModel):
    id: int
    key: str
    display_name: str
    category: str | None
    usage: EvidenceUsage
    default_judgment_scope: JudgmentScope
    description: str | None
    enabled: bool


class EstimateResultEvidenceOut(BaseModel):
    id: int
    evidence_kind: EvidenceKind
    detection_id: int | None
    design_data_ref: str | None


class EstimateResultOut(BaseModel):
    id: int
    product_no: str
    result_key: str
    master_item_id: int | None
    code: str
    quantity: float
    applicable_unit: ApplicableUnit | None
    initial_factor: float
    current_factor: float
    factor_overridden: bool
    factor_override_reason: str | None
    factor_updated_at: str | None
    factor_updated_by: str | None
    judgment_method: JudgmentMethod
    judgment_scope: JudgmentScope
    target_panel_ban_menno: int | None
    target_panel_ban_no: int | None
    target_drawing_page_id: int | None
    judgment_reason: str | None
    source_rule_id: int | None
    unit_price: float | None
    unit_labor: float | None
    price: float | None
    labor: float | None
    status: str
    # Issue #40 Phase 4: 係数編集UIが候補値を知るためのAPI専用フィールド
    # (`estimate_results`自体には保存しない。`source_rule_id`が指す
    # `estimate_rule_masters.allowed_factors`をrouter側で都度引く。
    # `app/api/routers/estimate_results.py::_result_out`参照)。
    # 未設定(候補未定義=自由入力)、または`source_rule_id`自体がnullの場合はnull。
    allowed_factors: list[float] | None = None
    evidence: list[EstimateResultEvidenceOut] = []


class EstimateResultEvaluateOut(BaseModel):
    """`POST .../estimate-results/evaluate`のレスポンス。

    `skipped_rule_master_ids`は、Phase 2の評価器が未実装のため評価しなかった
    ルールの一覧(診断用。UIには出さない想定だが、Phase 3以降の実装優先度
    検討に使えるようそのまま返す)。
    """

    results: list[EstimateResultOut]
    skipped_rule_master_ids: list[int]


class EstimateResultFactorOverrideIn(BaseModel):
    """係数の手修正 (Issue #40 7-3章)。"""

    current_factor: float
    reason: str | None = Field(default=None)
    updated_by: str | None = Field(default=None)
