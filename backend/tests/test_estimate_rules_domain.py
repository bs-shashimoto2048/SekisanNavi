"""`app.domain.estimate_rules.StandardConditionField` の演算子拡張テスト
(Issue #40 Phase 6-E指示3-A)。

Phase 6-Dで18322(盤内通路IS/OS系)の検証条件が`model == "IS2"`という
デモ専用の固定値一致になってしまった原因(前方一致・複数候補値のいずれか、
という条件を表現する手段がStandardConditionに無かったこと)を解消する
`starts_with`/`in`演算子の型安全性を確認する。
"""
import pytest

from app.domain.estimate_rules import (
    STANDARD_CONDITION_OPERATORS,
    EvidenceRelation,
    MatchMode,
    PositionRelation,
    StandardCondition,
    StandardConditionField,
)


def test_standard_condition_operators_includes_new_and_existing_ones():
    assert STANDARD_CONDITION_OPERATORS == {
        "==", "!=", ">=", "<=", ">", "<", "starts_with", "in",
    }


def test_starts_with_accepts_string_value():
    field = StandardConditionField(field="model", operator="starts_with", value="IS")
    assert field.value == "IS"


def test_starts_with_rejects_non_string_value():
    with pytest.raises(ValueError):
        StandardConditionField(field="model", operator="starts_with", value=123)


def test_in_accepts_list_value():
    field = StandardConditionField(field="model", operator="in", value=["IS1", "IS2", "OS1"])
    assert field.value == ["IS1", "IS2", "OS1"]


def test_in_accepts_tuple_value():
    field = StandardConditionField(field="model", operator="in", value=("IS1", "OS1"))
    assert field.value == ("IS1", "OS1")


def test_in_rejects_bare_string_value():
    """`in`に素の文字列を渡すと部分一致(`"IS" in "IS2"`)として暗黙に解釈
    されてしまうため、明示的にlist/tupleのみを許可する(指示3-A「明示的な
    候補値」)。"""
    with pytest.raises(ValueError):
        StandardConditionField(field="model", operator="in", value="IS2")


def test_in_rejects_non_iterable_value():
    with pytest.raises(ValueError):
        StandardConditionField(field="model", operator="in", value=123)


def test_unknown_operator_is_rejected():
    with pytest.raises(ValueError):
        StandardConditionField(field="model", operator="contains", value="IS")


def test_existing_operators_still_accept_numeric_and_string_values():
    # 既存の==/!=/>=/<=/>/<は従来通りfloat/strどちらも許可する(回帰確認)。
    StandardConditionField(field="ban_w", operator=">=", value=900)
    StandardConditionField(field="model", operator="==", value="IS2")


# ============================================================
# Issue #40 Phase 6-F指示A: StandardCondition.design_data_any_of (OR表現)
# ============================================================


def test_standard_condition_default_any_of_is_empty_list():
    condition = StandardCondition()
    assert condition.design_data_any_of == []


def test_standard_condition_accepts_or_groups():
    condition = StandardCondition(
        design_data_any_of=[
            [StandardConditionField(field="model", operator="starts_with", value="IS")],
            [StandardConditionField(field="model", operator="starts_with", value="OS")],
        ]
    )
    assert len(condition.design_data_any_of) == 2


def test_standard_condition_rejects_empty_or_group():
    """空のANDグループは常に成立してしまう(`all([])`がTrueになるため)ので
    明示的に禁止する。"""
    with pytest.raises(ValueError):
        StandardCondition(design_data_any_of=[[]])


def test_standard_condition_allows_multi_condition_and_group_inside_or():
    condition = StandardCondition(
        design_data_any_of=[
            [
                StandardConditionField(field="model", operator="starts_with", value="IS"),
                StandardConditionField(field="ban_w", operator=">=", value=900),
            ],
        ]
    )
    assert len(condition.design_data_any_of[0]) == 2


# ============================================================
# Issue #40 Phase 6-G指示2/3: EvidenceRelation/MatchMode(位置関係条件)
# ============================================================


def test_evidence_relation_accepts_valid_relation_string():
    rel = EvidenceRelation(left_type="ch", relation="above", right_type="vct")
    assert rel.relation == PositionRelation.ABOVE
    assert rel.tolerance == 0.0


def test_evidence_relation_accepts_all_position_relations():
    for value in ("above", "below", "left_of", "right_of", "overlaps"):
        rel = EvidenceRelation(left_type="a", relation=value, right_type="b")
        assert rel.relation.value == value


def test_evidence_relation_rejects_unknown_relation_string():
    with pytest.raises(ValueError):
        EvidenceRelation(left_type="ch", relation="diagonally_adjacent_to", right_type="vct")


def test_evidence_relation_rejects_non_numeric_tolerance():
    with pytest.raises(ValueError):
        EvidenceRelation(left_type="ch", relation="above", right_type="vct", tolerance="large")


def test_evidence_relation_rejects_bool_tolerance():
    """`bool`は`int`のサブクラスのため、明示的に拒否しないと`True`/`False`が
    数値として紛れ込んでしまう。"""
    with pytest.raises(ValueError):
        EvidenceRelation(left_type="ch", relation="above", right_type="vct", tolerance=True)


def test_evidence_relation_rejects_empty_left_or_right_type():
    with pytest.raises(ValueError):
        EvidenceRelation(left_type="", relation="above", right_type="vct")
    with pytest.raises(ValueError):
        EvidenceRelation(left_type="ch", relation="above", right_type="")


def test_standard_condition_default_evidence_relations_is_empty_and_match_mode_is_any_pair():
    condition = StandardCondition()
    assert condition.evidence_relations == []
    assert condition.match_mode == MatchMode.ANY_PAIR


def test_standard_condition_accepts_match_mode_as_string():
    condition = StandardCondition(match_mode="every_pair")
    assert condition.match_mode == MatchMode.EVERY_PAIR


def test_standard_condition_rejects_unknown_match_mode():
    with pytest.raises(ValueError):
        StandardCondition(match_mode="first_pair_only")
