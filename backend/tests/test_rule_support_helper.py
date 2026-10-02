"""`app.services.estimate_rule_evaluator.is_standard_rule_supported`
(および内部の`_rule_shape_supported`)の単体テスト
(Issue #40 Phase 6-F PR #50レビュー指摘対応: evaluatorとvalidatorのrule
support判定を共通化する単一の真実源)。

`evaluate_product`自身のテスト(`test_estimate_rule_evaluator.py`)・候補
マニフェストvalidatorのテスト(`test_validate_candidate_manifests.py`)は
それぞれの統合経路からこの関数を間接的に検証しているが、ここでは
関数そのものの入出力を直接・網羅的に確認する。
"""
from app.domain.estimate_rules import (
    CalcType,
    EvidenceRelation,
    JudgmentScope,
    MatchMode,
    QuantityMethod,
    StandardCondition,
    StandardConditionField,
)
from app.services.estimate_rule_evaluator import is_standard_rule_supported


def _condition(**overrides) -> StandardCondition:
    base = dict(required_evidence_types=[], design_data_conditions=[], design_data_any_of=[])
    base.update(overrides)
    return StandardCondition(**base)


def test_panel_scope_with_design_data_conditions_and_any_of_is_supported():
    """PANEL/DESIGN_DATAはdesign_data_conditions/design_data_any_ofの
    有無に関わらずサポート対象(evaluate_productが元々この2 scopeを完全
    サポートしているため)。"""
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.PANEL,
        quantity_method=QuantityMethod.PER_CONDITION_GROUP,
        calc_type=CalcType.DIRECT,
        condition=_condition(
            design_data_conditions=[StandardConditionField(field="ban_w", operator=">=", value=900)],
            design_data_any_of=[[StandardConditionField(field="model", operator="starts_with", value="IS")]],
        ),
    )
    assert result.supported is True


def test_design_data_scope_is_supported():
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.DESIGN_DATA,
        quantity_method=QuantityMethod.PER_EVIDENCE,
        calc_type=CalcType.DIRECT,
        condition=_condition(required_evidence_types=["side_door"]),
    )
    assert result.supported is True


def test_drawing_scope_with_design_data_conditions_is_not_supported():
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.DRAWING,
        quantity_method=QuantityMethod.PER_EVIDENCE,
        calc_type=CalcType.DIRECT,
        condition=_condition(
            required_evidence_types=["side_door"],
            design_data_conditions=[StandardConditionField(field="ban_w", operator=">=", value=900)],
        ),
    )
    assert result.supported is False
    assert "design_data_conditions" in result.reason
    assert "drawing" in result.reason


def test_product_scope_with_design_data_any_of_is_not_supported():
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.PRODUCT,
        quantity_method=QuantityMethod.PER_CONDITION_GROUP,
        calc_type=CalcType.DIRECT,
        condition=_condition(
            required_evidence_types=["side_door"],
            design_data_any_of=[[StandardConditionField(field="model", operator="starts_with", value="IS")]],
        ),
    )
    assert result.supported is False
    assert "design_data_any_of" in result.reason
    assert "product" in result.reason


def test_drawing_scope_without_required_evidence_types_is_not_supported():
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.DRAWING,
        quantity_method=QuantityMethod.PER_EVIDENCE,
        calc_type=CalcType.DIRECT,
        condition=_condition(),
    )
    assert result.supported is False
    assert "required_evidence_types" in result.reason


def test_product_scope_without_required_evidence_types_is_not_supported():
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.PRODUCT,
        quantity_method=QuantityMethod.PER_CONDITION_GROUP,
        calc_type=CalcType.DIRECT,
        condition=_condition(),
    )
    assert result.supported is False
    assert "required_evidence_types" in result.reason


def test_drawing_scope_evidence_only_per_evidence_direct_is_supported():
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.DRAWING,
        quantity_method=QuantityMethod.PER_EVIDENCE,
        calc_type=CalcType.DIRECT,
        condition=_condition(required_evidence_types=["side_door"]),
    )
    assert result.supported is True


def test_product_scope_evidence_only_per_condition_group_direct_is_supported():
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.PRODUCT,
        quantity_method=QuantityMethod.PER_CONDITION_GROUP,
        calc_type=CalcType.DIRECT,
        condition=_condition(required_evidence_types=["side_door"]),
    )
    assert result.supported is True


def test_position_and_range_scopes_are_never_supported():
    for scope in (JudgmentScope.POSITION, JudgmentScope.RANGE):
        result = is_standard_rule_supported(
            judgment_scope=scope,
            quantity_method=QuantityMethod.PER_EVIDENCE,
            calc_type=CalcType.DIRECT,
            condition=_condition(required_evidence_types=["side_door"]),
        )
        assert result.supported is False, scope


def test_unsupported_quantity_methods_are_rejected_for_every_scope():
    unsupported = [
        QuantityMethod.PER_FACE,
        QuantityMethod.PER_UNIT,
        QuantityMethod.PER_PRODUCT,
        QuantityMethod.PER_COMBINATION_SET,
        QuantityMethod.DIFF_FROM_STANDARD,
        QuantityMethod.CUSTOM,
    ]
    for qm in unsupported:
        result = is_standard_rule_supported(
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=qm,
            calc_type=CalcType.DIRECT,
            condition=_condition(),
        )
        assert result.supported is False, qm
        assert "quantity_method" in result.reason


def test_non_direct_calc_types_are_rejected():
    for calc_type in (
        CalcType.ADD,
        CalcType.SUBTRACT,
        CalcType.MULTIPLY_PRICE,
        CalcType.MULTIPLY_LABOR,
        CalcType.MULTIPLY_BOTH,
        CalcType.CUSTOM,
    ):
        result = is_standard_rule_supported(
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_EVIDENCE,
            calc_type=calc_type,
            condition=_condition(required_evidence_types=["side_door"]),
        )
        assert result.supported is False, calc_type
        assert "calc_type" in result.reason


def test_shape_failure_takes_priority_over_calc_type_in_reason():
    """shapeが既に未対応の場合、理由はshape側のものが返る(calc_typeの
    チェックまで進まない)。"""
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.DRAWING,
        quantity_method=QuantityMethod.PER_EVIDENCE,
        calc_type=CalcType.MULTIPLY_PRICE,
        condition=_condition(),  # required_evidence_types空 → shape不成立
    )
    assert result.supported is False
    assert "required_evidence_types" in result.reason


# ============================================================
# Issue #40 Phase 6-G指示2/3: evidence_relations(位置関係条件)のsupport判定
# ============================================================


def test_panel_scope_with_evidence_relations_is_supported():
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.PANEL,
        quantity_method=QuantityMethod.PER_CONDITION_GROUP,
        calc_type=CalcType.DIRECT,
        condition=_condition(
            required_evidence_types=["ch", "vct"],
            evidence_relations=[EvidenceRelation(left_type="ch", relation="above", right_type="vct")],
        ),
    )
    assert result.supported is True


def test_design_data_scope_with_evidence_relations_is_not_supported():
    """evidence_relationsはPANEL scopeのみ対応(指示2「PANEL scopeから
    開始してよい」)。"""
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.DESIGN_DATA,
        quantity_method=QuantityMethod.PER_CONDITION_GROUP,
        calc_type=CalcType.DIRECT,
        condition=_condition(
            evidence_relations=[EvidenceRelation(left_type="ch", relation="above", right_type="vct")],
        ),
    )
    assert result.supported is False
    assert "evidence_relations" in result.reason


def test_drawing_scope_with_evidence_relations_is_not_supported():
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.DRAWING,
        quantity_method=QuantityMethod.PER_EVIDENCE,
        calc_type=CalcType.DIRECT,
        condition=_condition(
            required_evidence_types=["ch"],
            evidence_relations=[EvidenceRelation(left_type="ch", relation="above", right_type="vct")],
        ),
    )
    assert result.supported is False
    assert "evidence_relations" in result.reason


def test_unsupported_match_mode_is_rejected_even_on_panel_scope():
    for mode in (MatchMode.EVERY_PAIR, MatchMode.ONE_TO_ONE, MatchMode.NEAREST_PAIR):
        result = is_standard_rule_supported(
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            calc_type=CalcType.DIRECT,
            condition=_condition(
                required_evidence_types=["ch", "vct"],
                evidence_relations=[EvidenceRelation(left_type="ch", relation="above", right_type="vct")],
                match_mode=mode,
            ),
        )
        assert result.supported is False, mode
        assert "match_mode" in result.reason


def test_any_pair_match_mode_is_supported_on_panel_scope():
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.PANEL,
        quantity_method=QuantityMethod.PER_CONDITION_GROUP,
        calc_type=CalcType.DIRECT,
        condition=_condition(
            required_evidence_types=["ch", "vct"],
            evidence_relations=[EvidenceRelation(left_type="ch", relation="above", right_type="vct")],
            match_mode=MatchMode.ANY_PAIR,
        ),
    )
    assert result.supported is True


# ============================================================
# Issue #40 PR #51レビュー指摘: overlaps + tolerance!=0 のsilent ignore防止
# ============================================================


def test_overlaps_with_zero_tolerance_is_supported():
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.PANEL,
        quantity_method=QuantityMethod.PER_CONDITION_GROUP,
        calc_type=CalcType.DIRECT,
        condition=_condition(
            required_evidence_types=["ch", "vct"],
            evidence_relations=[
                EvidenceRelation(left_type="ch", relation="overlaps", right_type="vct", tolerance=0.0)
            ],
        ),
    )
    assert result.supported is True


def test_overlaps_with_nonzero_tolerance_is_not_supported():
    """`app.domain.geometry.overlaps`はtolerance引数を受け取らないため、
    指定したtoleranceが評価時にsilent ignoreされる状態を避ける
    (Issue #40 PR #51レビュー指摘)。"""
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.PANEL,
        quantity_method=QuantityMethod.PER_CONDITION_GROUP,
        calc_type=CalcType.DIRECT,
        condition=_condition(
            required_evidence_types=["ch", "vct"],
            evidence_relations=[
                EvidenceRelation(left_type="ch", relation="overlaps", right_type="vct", tolerance=0.1)
            ],
        ),
    )
    assert result.supported is False
    assert "overlaps" in result.reason
    assert "tolerance" in result.reason


def test_overlaps_with_negative_nonzero_tolerance_is_not_supported():
    result = is_standard_rule_supported(
        judgment_scope=JudgmentScope.PANEL,
        quantity_method=QuantityMethod.PER_CONDITION_GROUP,
        calc_type=CalcType.DIRECT,
        condition=_condition(
            required_evidence_types=["ch", "vct"],
            evidence_relations=[
                EvidenceRelation(left_type="ch", relation="overlaps", right_type="vct", tolerance=-0.1)
            ],
        ),
    )
    assert result.supported is False
    assert "overlaps" in result.reason


def test_above_below_left_right_with_nonzero_tolerance_remain_supported():
    """overlaps以外のrelationは従来通りtolerance!=0でもサポート対象のまま
    (Issue #40 PR #51レビュー指摘による制約はoverlapsのみ)。"""
    for relation in ("above", "below", "left_of", "right_of"):
        result = is_standard_rule_supported(
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            calc_type=CalcType.DIRECT,
            condition=_condition(
                required_evidence_types=["ch", "vct"],
                evidence_relations=[
                    EvidenceRelation(left_type="ch", relation=relation, right_type="vct", tolerance=0.1)
                ],
            ),
        )
        assert result.supported is True, relation
