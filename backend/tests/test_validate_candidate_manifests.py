"""`backend/tools/validate_candidate_manifests.py` のテスト
(Issue #40 Phase 6-F指示D)。

本番DBへは一切接続せず、合成した小さなマニフェスト辞書だけで検証する。
"""
import json

from tools.validate_candidate_manifests import (
    DEFAULT_EVIDENCE_TYPES_PATH,
    DEFAULT_RULES_PATH,
    validate_manifests,
)


def _evidence(**overrides) -> dict:
    base = dict(
        key="side_door",
        display_name="側面扉",
        category="扉",
        usage="estimate_target",
        judgment_scope="panel",
        ai_class_keys=["sidedoor_l"],
        related_codes=["18302"],
        source_refs=["積算コードPDF『18302側面扉（追加）.pdf』"],
        status="needs_business_confirmation",
        blocker="標準含有枚数との差分算出が未実装",
    )
    base.update(overrides)
    return base


def _rule(**overrides) -> dict:
    base = dict(
        code="18302",
        name="側面扉(追加)",
        evidence_type_keys=["side_door"],
        judgment_scope="panel",
        judgment_method="drawing_judgment",
        applicable_unit="location",
        quantity_method="per_evidence",
        calc_type="direct",
        condition={
            "required_evidence_types": ["side_door"],
            "design_data_conditions": [],
            "design_data_any_of": [],
        },
        initial_factor=1.0,
        allowed_factors=None,
        source_refs=["積算コードPDF『18302側面扉（追加）.pdf』"],
        status="needs_business_confirmation",
        blocker="標準含有枚数との差分算出が未実装",
    )
    base.update(overrides)
    return base


def test_valid_manifests_produce_no_issues():
    issues = validate_manifests({"candidates": [_evidence()]}, {"candidates": [_rule()]})
    assert issues == []


def test_actual_phase6f_manifests_pass_validation():
    """実際にリポジトリへ置いた候補マニフェストが、常にvalidationを通る
    状態であることを保証する回帰テスト。"""
    evidence_data = json.loads(DEFAULT_EVIDENCE_TYPES_PATH.read_text(encoding="utf-8"))
    rules_data = json.loads(DEFAULT_RULES_PATH.read_text(encoding="utf-8"))
    issues = validate_manifests(evidence_data, rules_data)
    assert issues == [], "\n".join(str(i) for i in issues)


def test_duplicate_evidence_key_is_detected():
    issues = validate_manifests(
        {"candidates": [_evidence(key="dup"), _evidence(key="dup")]}, {"candidates": []}
    )
    assert any("重複したkey" in str(i) for i in issues)


def test_duplicate_rule_code_is_detected():
    issues = validate_manifests(
        {"candidates": [_evidence()]}, {"candidates": [_rule(code="dup"), _rule(code="dup")]}
    )
    assert any("重複したcode" in str(i) for i in issues)


def test_unknown_usage_enum_is_detected():
    issues = validate_manifests({"candidates": [_evidence(usage="not_a_real_usage")]}, {"candidates": []})
    assert any("未知のusage" in str(i) for i in issues)


def test_unknown_judgment_scope_is_detected_on_both_sides():
    issues = validate_manifests(
        {"candidates": [_evidence(judgment_scope="nonexistent")]},
        {"candidates": [_rule(judgment_scope="nonexistent")]},
    )
    assert any("未知のjudgment_scope" in str(i) and "drawing_evidence_types" in str(i) for i in issues)
    assert any("未知のjudgment_scope" in str(i) and "estimate_rules" in str(i) for i in issues)


def test_unknown_quantity_method_and_calc_type_are_detected():
    issues = validate_manifests(
        {"candidates": [_evidence()]},
        {"candidates": [_rule(quantity_method="not_real", calc_type="not_real")]},
    )
    assert any("未知のquantity_method" in str(i) for i in issues)
    assert any("未知のcalc_type" in str(i) for i in issues)


def test_rule_referencing_unknown_evidence_type_key_is_detected():
    issues = validate_manifests(
        {"candidates": [_evidence(key="side_door")]},
        {"candidates": [_rule(evidence_type_keys=["nonexistent_evidence_key"])]},
    )
    assert any("nonexistent_evidence_key" in str(i) for i in issues)


def test_rule_condition_referencing_unknown_evidence_type_is_detected():
    issues = validate_manifests(
        {"candidates": [_evidence(key="side_door")]},
        {
            "candidates": [
                _rule(
                    evidence_type_keys=["side_door"],
                    condition={
                        "required_evidence_types": ["unknown_in_condition"],
                        "design_data_conditions": [],
                        "design_data_any_of": [],
                    },
                )
            ]
        },
    )
    assert any("unknown_in_condition" in str(i) for i in issues)


def test_allowed_factors_must_be_null_or_number_list():
    issues = validate_manifests(
        {"candidates": [_evidence()]}, {"candidates": [_rule(allowed_factors=["not", "numbers"])]}
    )
    assert any("allowed_factors" in str(i) for i in issues)

    issues_ok = validate_manifests(
        {"candidates": [_evidence()]}, {"candidates": [_rule(allowed_factors=[0.5, 0.7, 1.0])]}
    )
    assert issues_ok == []


def test_invalid_condition_schema_is_detected():
    """`StandardConditionField.__post_init__`の型検証(starts_with→str、
    in→list/tuple)がそのままvalidatorにも効くことを確認する。"""
    issues = validate_manifests(
        {"candidates": [_evidence()]},
        {
            "candidates": [
                _rule(
                    condition={
                        "required_evidence_types": [],
                        "design_data_conditions": [
                            {"field": "model", "operator": "starts_with", "value": 123}
                        ],
                        "design_data_any_of": [],
                    }
                )
            ]
        },
    )
    assert any("conditionのschema" in str(i) for i in issues)


def test_empty_source_refs_is_detected_on_both_manifests():
    issues = validate_manifests(
        {"candidates": [_evidence(source_refs=[])]}, {"candidates": [_rule(source_refs=[])]}
    )
    assert any("source_refs" in str(i) and "drawing_evidence_types" in str(i) for i in issues)
    assert any("source_refs" in str(i) and "estimate_rules" in str(i) for i in issues)


def test_non_ready_status_without_blocker_is_detected():
    issues = validate_manifests(
        {"candidates": [_evidence(status="blocked", blocker=None)]}, {"candidates": []}
    )
    assert any("blocker" in str(i) for i in issues)


def test_ready_status_with_blocker_is_detected():
    issues = validate_manifests(
        {"candidates": [_evidence(status="ready", blocker="何かの理由")]}, {"candidates": []}
    )
    assert any("status=ready" in str(i) for i in issues)


def test_ready_status_using_unsupported_scope_is_rejected():
    """readyと主張しているのに、評価器が未対応のjudgment_scope(position)を
    使っている場合は検出する(「技術的に動く」と「本番投入可能」の混同を防ぐ)。"""
    issues = validate_manifests(
        {"candidates": [_evidence(status="ready", blocker=None, judgment_scope="position")]},
        {"candidates": []},
    )
    assert any("評価器" in str(i) and "未対応" in str(i) for i in issues)


def test_ready_rule_using_unsupported_calc_type_is_rejected():
    issues = validate_manifests(
        {"candidates": [_evidence()]},
        {"candidates": [_rule(status="ready", blocker=None, calc_type="multiply_price")]},
    )
    assert any("calc_type" in str(i) and "未対応" in str(i) for i in issues)


def test_ready_rule_fully_supported_passes():
    """評価器が対応する組合せ(panel scope/per_evidence/direct)で、資料根拠
    source_refsもあるready候補は問題なく通る(readyを不当に拒否しない)。"""
    issues = validate_manifests(
        {"candidates": [_evidence(status="ready", blocker=None, judgment_scope="panel")]},
        {
            "candidates": [
                _rule(
                    status="ready",
                    blocker=None,
                    judgment_scope="panel",
                    quantity_method="per_evidence",
                    calc_type="direct",
                )
            ]
        },
    )
    assert issues == []
