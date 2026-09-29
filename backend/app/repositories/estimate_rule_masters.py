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
    JudgmentMethod,
    JudgmentScope,
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
    if raw is None:
        return None
    data = json.loads(raw)
    return StandardCondition(
        required_evidence_types=list(data.get("required_evidence_types", [])),
        design_data_conditions=[
            StandardConditionField(field=c["field"], operator=c["operator"], value=c["value"])
            for c in data.get("design_data_conditions", [])
        ],
    )


def _serialize_condition(condition: StandardCondition | None) -> str | None:
    if condition is None:
        return None
    return json.dumps(
        {
            "required_evidence_types": condition.required_evidence_types,
            "design_data_conditions": [
                {"field": c.field, "operator": c.operator, "value": c.value}
                for c in condition.design_data_conditions
            ],
        }
    )


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
