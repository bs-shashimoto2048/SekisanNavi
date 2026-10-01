"""Issue #40 Phase 6-F: 本番投入候補マニフェスト(`backend/data_candidates/
phase6f_drawing_evidence_types.json`・`phase6f_estimate_rules.json`)の
validator。

**重要**: このツールはマニフェストJSONを読むだけで、本番DBへは一切接続しない
(マニフェスト自体も自動ロードされない、レビュー専用のファイル)。

チェック項目(Issue #40 Phase 6-F指示D):
  - duplicate key/code
  - unknown enum(usage/judgment_scope/applicable_unit/quantity_method/
    judgment_method/calc_type/status)
  - ruleが存在しないevidence keyを参照していないか
  - allowed_factorsの型(null、またはnumberのlist)
  - condition schema(`app.domain.estimate_rules.StandardCondition`として
    構築できるか。`StandardConditionField.__post_init__`の型検証をそのまま
    再利用する)
  - source_refsが空でないか
  - status/blockerの整合(ready以外はblocker必須、readyはblocker無し)
  - readyなのに評価器が未対応のjudgment_scope/quantity_method/calc_typeを
    使っていないか(`app.services.estimate_rule_evaluator`の対応状況を
    単一の真実源として再利用する。重複定義による乖離を避ける)
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.domain.estimate_rules import (  # noqa: E402
    ApplicableUnit,
    CalcType,
    EvidenceUsage,
    JudgmentMethod,
    JudgmentScope,
    QuantityMethod,
    StandardCondition,
    StandardConditionField,
)
from app.services.estimate_rule_evaluator import (  # noqa: E402
    _SUPPORTED_QUANTITY_METHODS,
    _SUPPORTED_SCOPES,
)

DEFAULT_EVIDENCE_TYPES_PATH = BACKEND_DIR / "data_candidates" / "phase6f_drawing_evidence_types.json"
DEFAULT_RULES_PATH = BACKEND_DIR / "data_candidates" / "phase6f_estimate_rules.json"

VALID_STATUSES = frozenset({"ready", "needs_business_confirmation", "blocked"})
VALID_USAGES = frozenset(u.value for u in EvidenceUsage)
VALID_SCOPES = frozenset(s.value for s in JudgmentScope)
VALID_UNITS = frozenset(u.value for u in ApplicableUnit)
VALID_QUANTITY_METHODS = frozenset(q.value for q in QuantityMethod)
VALID_JUDGMENT_METHODS = frozenset(m.value for m in JudgmentMethod)
VALID_CALC_TYPES = frozenset(c.value for c in CalcType)

# status="ready"の候補に対しては、評価器が実際に計算できる組合せ
# (calc_type=directのみ)まで厳格にチェックする(「技術的に動く」と
# 「本番投入可能」を混同しないため)。
_READY_ALLOWED_CALC_TYPES = frozenset({CalcType.DIRECT.value})


@dataclass
class ValidationIssue:
    location: str
    message: str

    def __str__(self) -> str:
        return f"[{self.location}] {self.message}"


def _parse_condition(raw: dict | None) -> StandardCondition | None:
    """マニフェストJSON内の`condition`辞書から`StandardCondition`を構築する。
    不正な場合は例外を送出する(呼び出し側でcatchしてValidationIssue化する)。
    `app.repositories.estimate_rule_masters._parse_condition`と同じ構造
    (本番DBへのJSON保存形式)をそのまま検証対象にする。
    """
    if raw is None:
        return None
    return StandardCondition(
        required_evidence_types=list(raw.get("required_evidence_types", [])),
        design_data_conditions=[
            StandardConditionField(field=c["field"], operator=c["operator"], value=c["value"])
            for c in raw.get("design_data_conditions", [])
        ],
        design_data_any_of=[
            [StandardConditionField(field=c["field"], operator=c["operator"], value=c["value"]) for c in group]
            for group in raw.get("design_data_any_of", [])
        ],
    )


def _check_source_refs(location: str, source_refs: object, issues: list[ValidationIssue]) -> None:
    if not isinstance(source_refs, list) or len(source_refs) == 0:
        issues.append(ValidationIssue(location, "source_refsが空、またはlistではありません"))
        return
    for i, ref in enumerate(source_refs):
        if not isinstance(ref, str) or ref.strip() == "":
            issues.append(ValidationIssue(location, f"source_refs[{i}]が空文字、または文字列ではありません"))


def _check_status_and_blocker(location: str, status: object, blocker: object, issues: list[ValidationIssue]) -> None:
    if status not in VALID_STATUSES:
        issues.append(ValidationIssue(location, f"未知のstatusです: {status!r} (サポート対象: {sorted(VALID_STATUSES)})"))
        return
    if status == "ready":
        if blocker not in (None, ""):
            issues.append(ValidationIssue(location, "status=readyのblockerはnull(または空)である必要があります"))
    else:
        if not isinstance(blocker, str) or blocker.strip() == "":
            issues.append(ValidationIssue(location, f"status={status!r}はblocker(理由)が必須です"))


def _check_allowed_factors(location: str, allowed_factors: object, issues: list[ValidationIssue]) -> None:
    if allowed_factors is None:
        return
    if not isinstance(allowed_factors, list) or not all(isinstance(v, (int, float)) for v in allowed_factors):
        issues.append(ValidationIssue(location, f"allowed_factorsはnull、またはnumberのlistである必要があります: {allowed_factors!r}"))


def validate_evidence_types(data: dict) -> tuple[list[ValidationIssue], set[str]]:
    """`phase6f_drawing_evidence_types.json`を検証する。
    戻り値は(issues, 検証済みのkey集合)。key集合はルール側のクロスチェックに使う。
    """
    issues: list[ValidationIssue] = []
    seen_keys: set[str] = set()
    candidates = data.get("candidates", [])
    if not isinstance(candidates, list):
        return [ValidationIssue("drawing_evidence_types", "candidatesがlistではありません")], seen_keys

    for i, c in enumerate(candidates):
        key = c.get("key")
        loc = f"drawing_evidence_types[{i}:{key!r}]"
        if not isinstance(key, str) or key == "":
            issues.append(ValidationIssue(loc, "keyが空、または文字列ではありません"))
            continue
        if key in seen_keys:
            issues.append(ValidationIssue(loc, f"重複したkeyです: {key!r}"))
        seen_keys.add(key)

        if not isinstance(c.get("display_name"), str) or c.get("display_name") == "":
            issues.append(ValidationIssue(loc, "display_nameが空、または文字列ではありません"))

        usage = c.get("usage")
        if usage not in VALID_USAGES:
            issues.append(ValidationIssue(loc, f"未知のusageです: {usage!r} (サポート対象: {sorted(VALID_USAGES)})"))

        scope = c.get("judgment_scope")
        if scope not in VALID_SCOPES:
            issues.append(ValidationIssue(loc, f"未知のjudgment_scopeです: {scope!r} (サポート対象: {sorted(VALID_SCOPES)})"))

        ai_class_keys = c.get("ai_class_keys", [])
        if not isinstance(ai_class_keys, list) or not all(isinstance(k, str) for k in ai_class_keys):
            issues.append(ValidationIssue(loc, "ai_class_keysはstrのlistである必要があります"))

        _check_source_refs(loc, c.get("source_refs"), issues)
        _check_status_and_blocker(loc, c.get("status"), c.get("blocker"), issues)

        if c.get("status") == "ready" and scope in VALID_SCOPES and JudgmentScope(scope) not in _SUPPORTED_SCOPES:
            issues.append(
                ValidationIssue(
                    loc,
                    f"status=readyですが、judgment_scope={scope!r}は評価器(estimate_rule_evaluator)が未対応です",
                )
            )

    return issues, seen_keys


def validate_rules(data: dict, known_evidence_keys: set[str]) -> list[ValidationIssue]:
    """`phase6f_estimate_rules.json`を検証する。"""
    issues: list[ValidationIssue] = []
    seen_codes: set[str] = set()
    candidates = data.get("candidates", [])
    if not isinstance(candidates, list):
        return [ValidationIssue("estimate_rules", "candidatesがlistではありません")]

    for i, c in enumerate(candidates):
        code = c.get("code")
        loc = f"estimate_rules[{i}:{code!r}]"
        if not isinstance(code, str) or code == "":
            issues.append(ValidationIssue(loc, "codeが空、または文字列ではありません"))
            continue
        if code in seen_codes:
            issues.append(ValidationIssue(loc, f"重複したcodeです: {code!r}"))
        seen_codes.add(code)

        if not isinstance(c.get("name"), str) or c.get("name") == "":
            issues.append(ValidationIssue(loc, "nameが空、または文字列ではありません"))

        scope = c.get("judgment_scope")
        if scope not in VALID_SCOPES:
            issues.append(ValidationIssue(loc, f"未知のjudgment_scopeです: {scope!r}"))

        judgment_method = c.get("judgment_method")
        if judgment_method not in VALID_JUDGMENT_METHODS:
            issues.append(ValidationIssue(loc, f"未知のjudgment_methodです: {judgment_method!r}"))

        applicable_unit = c.get("applicable_unit")
        if applicable_unit is not None and applicable_unit not in VALID_UNITS:
            issues.append(ValidationIssue(loc, f"未知のapplicable_unitです: {applicable_unit!r}"))

        quantity_method = c.get("quantity_method")
        if quantity_method not in VALID_QUANTITY_METHODS:
            issues.append(ValidationIssue(loc, f"未知のquantity_methodです: {quantity_method!r}"))

        calc_type = c.get("calc_type")
        if calc_type not in VALID_CALC_TYPES:
            issues.append(ValidationIssue(loc, f"未知のcalc_typeです: {calc_type!r}"))

        evidence_type_keys = c.get("evidence_type_keys", [])
        if not isinstance(evidence_type_keys, list) or not all(isinstance(k, str) for k in evidence_type_keys):
            issues.append(ValidationIssue(loc, "evidence_type_keysはstrのlistである必要があります"))
        else:
            for k in evidence_type_keys:
                if k not in known_evidence_keys:
                    issues.append(
                        ValidationIssue(loc, f"evidence_type_keys内のkey {k!r} はdrawing_evidence_types候補に存在しません")
                    )

        condition_raw = c.get("condition")
        condition: StandardCondition | None = None
        if condition_raw is not None:
            try:
                condition = _parse_condition(condition_raw)
            except (ValueError, KeyError, TypeError) as e:
                issues.append(ValidationIssue(loc, f"conditionのschemaが不正です: {e}"))
            else:
                for t in condition.required_evidence_types:
                    if t not in known_evidence_keys:
                        issues.append(
                            ValidationIssue(
                                loc, f"condition.required_evidence_types内のkey {t!r} はdrawing_evidence_types候補に存在しません"
                            )
                        )

        _check_allowed_factors(loc, c.get("allowed_factors"), issues)
        _check_source_refs(loc, c.get("source_refs"), issues)
        _check_status_and_blocker(loc, c.get("status"), c.get("blocker"), issues)

        if c.get("status") == "ready":
            if scope in VALID_SCOPES and JudgmentScope(scope) not in _SUPPORTED_SCOPES:
                issues.append(ValidationIssue(loc, f"status=readyですが、judgment_scope={scope!r}は評価器が未対応です"))
            if quantity_method in VALID_QUANTITY_METHODS and QuantityMethod(quantity_method) not in _SUPPORTED_QUANTITY_METHODS:
                issues.append(ValidationIssue(loc, f"status=readyですが、quantity_method={quantity_method!r}は評価器が未対応です"))
            if calc_type in VALID_CALC_TYPES and calc_type not in _READY_ALLOWED_CALC_TYPES:
                issues.append(ValidationIssue(loc, f"status=readyですが、calc_type={calc_type!r}は評価器が未対応です(directのみ対応)"))
            if condition_raw is not None and condition is None:
                pass  # 既にschemaエラーとして記録済み

    return issues


def validate_manifests(evidence_data: dict, rules_data: dict) -> list[ValidationIssue]:
    evidence_issues, known_keys = validate_evidence_types(evidence_data)
    rule_issues = validate_rules(rules_data, known_keys)
    return evidence_issues + rule_issues


def main() -> None:
    parser = argparse.ArgumentParser(description="Issue #40 Phase 6-F 候補マニフェストvalidator(本番DBへは接続しない)")
    parser.add_argument("--evidence-types", type=Path, default=DEFAULT_EVIDENCE_TYPES_PATH)
    parser.add_argument("--rules", type=Path, default=DEFAULT_RULES_PATH)
    args = parser.parse_args()

    evidence_data = json.loads(args.evidence_types.read_text(encoding="utf-8"))
    rules_data = json.loads(args.rules.read_text(encoding="utf-8"))

    issues = validate_manifests(evidence_data, rules_data)
    if issues:
        for issue in issues:
            print(str(issue), file=sys.stderr)
        print(f"\nNG: {len(issues)}件の問題が見つかりました。", file=sys.stderr)
        sys.exit(1)

    evidence_count = len(evidence_data.get("candidates", []))
    rule_count = len(rules_data.get("candidates", []))
    print(f"OK: drawing_evidence_types候補{evidence_count}件 / estimate_rules候補{rule_count}件、問題なし。")


if __name__ == "__main__":
    main()
