"""積算コード/ルールマスタ (Issue #40 Phase 2、10-2章) の最小book-keeping。

Phase 2では実データを1件も投入しない。テスト・将来の管理画面/投入スクリプト
から使うCRUDの基礎のみを用意する。
"""
from __future__ import annotations

import json
import sqlite3

from app.domain.estimate_rules import (
    ApplicableUnit,
    CalcType,
    EstimateRuleMaster,
    EvidenceRelation,
    JudgmentMethod,
    JudgmentScope,
    MatchMode,
    ProcessingMode,
    QuantityMethod,
    StandardCondition,
    StandardConditionField,
)

_COLUMNS = """
    id, master_item_id, judgment_method, judgment_scope, applicable_unit,
    quantity_method, initial_factor, allowed_factors, judgment_condition,
    judgment_reason_template, calc_type, processing_mode, custom_handler_key,
    auto_display, enabled, note
"""


def _parse_condition(raw: str | None) -> StandardCondition | None:
    """`judgment_condition`(JSON文字列)をパースする。

    Issue #40 Phase 6-Fで`design_data_any_of`(OR表現)、Phase 6-Gで
    `evidence_relations`/`match_mode`(位置関係表現)を追加したが、これらの
    キーを持たない旧JSON(Phase 6-E以前にDBへ保存済みの行)は
    `data.get(..., [])`により空リスト・既定値として扱われ、
    「OR制約なし」「位置関係制約なし」として問題なくパースできる
    (完全な後方互換性)。
    """
    if raw is None:
        return None
    data = json.loads(raw)
    return StandardCondition(
        required_evidence_types=list(data.get("required_evidence_types", [])),
        design_data_conditions=[
            StandardConditionField(field=c["field"], operator=c["operator"], value=c["value"])
            for c in data.get("design_data_conditions", [])
        ],
        design_data_any_of=[
            [
                StandardConditionField(field=c["field"], operator=c["operator"], value=c["value"])
                for c in group
            ]
            for group in data.get("design_data_any_of", [])
        ],
        evidence_relations=[
            EvidenceRelation(
                left_type=r["left_type"],
                relation=r["relation"],
                right_type=r["right_type"],
                tolerance=r.get("tolerance", 0.0),
            )
            for r in data.get("evidence_relations", [])
        ],
        match_mode=data.get("match_mode", MatchMode.ANY_PAIR.value),
    )


def _serialize_condition(condition: StandardCondition | None) -> str | None:
    """`judgment_condition`をJSON文字列へ直列化する。

    Issue #40 Phase 6-F/6-G: `design_data_any_of`/`evidence_relations`が
    空の場合(OR条件・位置関係条件を持たないルール、Phase 6-F以前からある
    全ルールが該当)は、それぞれのキー自体を出力しない。`match_mode`も
    既定値(`any_pair`)の場合は出力しない。これにより、これらの新機能を
    使わないルールのJSON表現は旧Phase時点と完全に同じバイト列になり、
    既存DBとの差分を生まない(明示的な後方互換設計)。
    """
    if condition is None:
        return None
    payload: dict = {
        "required_evidence_types": condition.required_evidence_types,
        "design_data_conditions": [
            {"field": c.field, "operator": c.operator, "value": c.value}
            for c in condition.design_data_conditions
        ],
    }
    if condition.design_data_any_of:
        payload["design_data_any_of"] = [
            [{"field": c.field, "operator": c.operator, "value": c.value} for c in group]
            for group in condition.design_data_any_of
        ]
    if condition.evidence_relations:
        payload["evidence_relations"] = [
            {
                "left_type": r.left_type,
                "relation": r.relation.value,
                "right_type": r.right_type,
                "tolerance": r.tolerance,
            }
            for r in condition.evidence_relations
        ]
        if condition.match_mode != MatchMode.ANY_PAIR:
            payload["match_mode"] = condition.match_mode.value
    return json.dumps(payload)


def _row_to_rule_master(row: sqlite3.Row) -> EstimateRuleMaster:
    allowed_factors_raw = row["allowed_factors"]
    return EstimateRuleMaster(
        id=row["id"],
        master_item_id=row["master_item_id"],
        judgment_method=JudgmentMethod(row["judgment_method"]),
        judgment_scope=JudgmentScope(row["judgment_scope"]),
        applicable_unit=ApplicableUnit(row["applicable_unit"]) if row["applicable_unit"] else None,
        quantity_method=QuantityMethod(row["quantity_method"]),
        initial_factor=row["initial_factor"],
        allowed_factors=json.loads(allowed_factors_raw) if allowed_factors_raw else None,
        judgment_condition=_parse_condition(row["judgment_condition"]),
        judgment_reason_template=row["judgment_reason_template"],
        calc_type=CalcType(row["calc_type"]),
        processing_mode=ProcessingMode(row["processing_mode"]),
        custom_handler_key=row["custom_handler_key"],
        auto_display=bool(row["auto_display"]),
        enabled=bool(row["enabled"]),
        note=row["note"],
    )


def list_rule_masters(conn: sqlite3.Connection, *, enabled_only: bool = False) -> list[EstimateRuleMaster]:
    sql = f"SELECT {_COLUMNS} FROM estimate_rule_masters"
    if enabled_only:
        sql += " WHERE enabled = 1"
    sql += " ORDER BY id"
    rows = conn.execute(sql).fetchall()
    return [_row_to_rule_master(r) for r in rows]


def get_rule_master_by_master_item_id(
    conn: sqlite3.Connection, master_item_id: int
) -> EstimateRuleMaster | None:
    row = conn.execute(
        f"SELECT {_COLUMNS} FROM estimate_rule_masters WHERE master_item_id = ?",
        (master_item_id,),
    ).fetchone()
    return _row_to_rule_master(row) if row else None


def get_allowed_factors(conn: sqlite3.Connection, rule_master_id: int) -> list[float] | None:
    """`estimate_rule_masters.id`(`estimate_results.source_rule_id`が指す先)
    から許容係数候補を取得する (Issue #40 7-3章「係数は可能な限り自由入力では
    なく、その積算コードで取り得る候補値から選択する」)。

    未設定(NULL)の場合はNoneを返す(=候補未定義。呼び出し側が「現時点では
    自由入力を許可する」判断に使う。PR #41レビュー指摘対応)。行自体が
    存在しない場合もNoneを返す(存在確認は呼び出し側の責務外とする、
    他のread-only参照系関数と同じ方針)。
    """
    row = conn.execute(
        "SELECT allowed_factors FROM estimate_rule_masters WHERE id = ?", (rule_master_id,)
    ).fetchone()
    if row is None or row["allowed_factors"] is None:
        return None
    return json.loads(row["allowed_factors"])


def create_rule_master(
    conn: sqlite3.Connection,
    *,
    master_item_id: int,
    judgment_method: JudgmentMethod,
    judgment_scope: JudgmentScope,
    applicable_unit: ApplicableUnit | None = None,
    quantity_method: QuantityMethod = QuantityMethod.PER_EVIDENCE,
    initial_factor: float = 1.0,
    allowed_factors: list[float] | None = None,
    judgment_condition: StandardCondition | None = None,
    judgment_reason_template: str | None = None,
    calc_type: CalcType = CalcType.DIRECT,
    processing_mode: ProcessingMode = ProcessingMode.STANDARD,
    custom_handler_key: str | None = None,
    auto_display: bool = True,
    enabled: bool = True,
    note: str | None = None,
) -> EstimateRuleMaster:
    conn.execute(
        """
        INSERT INTO estimate_rule_masters
            (master_item_id, judgment_method, judgment_scope, applicable_unit,
             quantity_method, initial_factor, allowed_factors, judgment_condition,
             judgment_reason_template, calc_type, processing_mode, custom_handler_key,
             auto_display, enabled, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            master_item_id,
            judgment_method.value,
            judgment_scope.value,
            applicable_unit.value if applicable_unit else None,
            quantity_method.value,
            initial_factor,
            json.dumps(allowed_factors) if allowed_factors is not None else None,
            _serialize_condition(judgment_condition),
            judgment_reason_template,
            calc_type.value,
            processing_mode.value,
            custom_handler_key,
            int(auto_display),
            int(enabled),
            note,
        ),
    )
    result = get_rule_master_by_master_item_id(conn, master_item_id)
    assert result is not None
    return result


__all__ = [
    "list_rule_masters",
    "get_rule_master_by_master_item_id",
    "create_rule_master",
]
