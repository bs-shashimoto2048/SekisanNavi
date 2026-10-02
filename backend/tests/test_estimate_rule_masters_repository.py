"""`app.repositories.estimate_rule_masters`のJSON serialize/deserialize
テスト (Issue #40 Phase 6-F指示A: `design_data_any_of`(OR表現)の
後方互換性確認)。

`db_path`フィクスチャ(`tests/conftest.py`)は実`estimate_master_a.xlsx`を
importした、migration適用済みのtmp DBを返す。
"""
import json

from app.db.connection import get_connection
from app.domain.estimate_rules import (
    ApplicableUnit,
    CalcType,
    EvidenceRelation,
    JudgmentMethod,
    JudgmentScope,
    MatchMode,
    ProcessingMode,
    QuantityMethod,
    StandardCondition,
    StandardConditionField,
)
from app.repositories.estimate_rule_masters import (
    create_rule_master,
    get_rule_master_by_master_item_id,
)


def _first_master_item_id(conn) -> int:
    row = conn.execute("SELECT id FROM estimate_master_items LIMIT 1").fetchone()
    return row["id"]


def test_and_only_condition_roundtrip_has_no_any_of_key(db_path):
    """OR条件を使わないルール(Phase 6-E以前と同じ形)は、DB保存後のJSONに
    `design_data_any_of`キーが現れない(完全な後方互換)。"""
    with get_connection(db_path) as conn:
        master_item_id = _first_master_item_id(conn)
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_scope=JudgmentScope.DESIGN_DATA,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                design_data_conditions=[StandardConditionField(field="ban_w", operator=">=", value=900)]
            ),
        )
        raw = conn.execute(
            "SELECT judgment_condition FROM estimate_rule_masters WHERE master_item_id = ?",
            (master_item_id,),
        ).fetchone()["judgment_condition"]
        assert "design_data_any_of" not in json.loads(raw)

        reloaded = get_rule_master_by_master_item_id(conn, master_item_id)
    assert reloaded.judgment_condition.design_data_any_of == []
    assert reloaded.judgment_condition.design_data_conditions[0].field == "ban_w"


def test_or_only_condition_roundtrip(db_path):
    with get_connection(db_path) as conn:
        master_item_id = _first_master_item_id(conn)
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_scope=JudgmentScope.DESIGN_DATA,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                design_data_any_of=[
                    [StandardConditionField(field="model", operator="starts_with", value="IS")],
                    [StandardConditionField(field="model", operator="starts_with", value="OS")],
                ]
            ),
        )
        reloaded = get_rule_master_by_master_item_id(conn, master_item_id)

    assert reloaded.judgment_condition.design_data_conditions == []
    assert len(reloaded.judgment_condition.design_data_any_of) == 2
    assert reloaded.judgment_condition.design_data_any_of[0][0].value == "IS"
    assert reloaded.judgment_condition.design_data_any_of[1][0].value == "OS"


def test_and_plus_or_condition_roundtrip(db_path):
    """AND条件とOR条件を同時に持つルール(例: `ban_w>=900` かつ
    (`model starts_with IS` または `model starts_with OS`))。"""
    with get_connection(db_path) as conn:
        master_item_id = _first_master_item_id(conn)
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_scope=JudgmentScope.DESIGN_DATA,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                design_data_conditions=[StandardConditionField(field="ban_w", operator=">=", value=900)],
                design_data_any_of=[
                    [StandardConditionField(field="model", operator="starts_with", value="IS")],
                    [StandardConditionField(field="model", operator="starts_with", value="OS")],
                ],
            ),
        )
        reloaded = get_rule_master_by_master_item_id(conn, master_item_id)

    assert len(reloaded.judgment_condition.design_data_conditions) == 1
    assert len(reloaded.judgment_condition.design_data_any_of) == 2


def test_in_operator_inside_any_of_group_roundtrip(db_path):
    """`in`演算子をOR groupの中で使った場合の往復確認。"""
    with get_connection(db_path) as conn:
        master_item_id = _first_master_item_id(conn)
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_scope=JudgmentScope.DESIGN_DATA,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                design_data_any_of=[
                    [StandardConditionField(field="model", operator="in", value=["IS1", "IS2"])],
                    [StandardConditionField(field="model", operator="in", value=["OS1", "OS2"])],
                ]
            ),
        )
        reloaded = get_rule_master_by_master_item_id(conn, master_item_id)

    assert reloaded.judgment_condition.design_data_any_of[0][0].value == ["IS1", "IS2"]
    assert reloaded.judgment_condition.design_data_any_of[1][0].value == ["OS1", "OS2"]


def test_old_json_without_any_of_key_parses_as_empty_or_constraint(db_path):
    """Phase 6-E以前にDBへ保存された(`design_data_any_of`キーを持たない)
    生JSONを直接書き込んでも、問題なくパースできることを確認する
    (実際の既存DB行を模した互換性テスト)。"""
    with get_connection(db_path) as conn:
        master_item_id = _first_master_item_id(conn)
        old_style_json = json.dumps(
            {
                "required_evidence_types": ["side_door"],
                "design_data_conditions": [{"field": "ban_w", "operator": ">=", "value": 900}],
            }
        )
        conn.execute(
            """
            INSERT INTO estimate_rule_masters
                (master_item_id, judgment_method, judgment_scope, quantity_method,
                 initial_factor, judgment_condition, calc_type, processing_mode,
                 auto_display, enabled)
            VALUES (?, 'drawing_judgment', 'panel', 'per_evidence', 1.0, ?, 'direct', 'standard', 1, 1)
            """,
            (master_item_id, old_style_json),
        )
        reloaded = get_rule_master_by_master_item_id(conn, master_item_id)

    assert reloaded.judgment_condition.required_evidence_types == ["side_door"]
    assert reloaded.judgment_condition.design_data_any_of == []
    assert reloaded.judgment_condition.design_data_conditions[0].field == "ban_w"


# ============================================================
# Issue #40 Phase 6-G指示2: evidence_relations(位置関係条件)のserialize/
# deserialize往復・後方互換性確認。
# ============================================================


def test_evidence_relations_roundtrip(db_path):
    with get_connection(db_path) as conn:
        master_item_id = _first_master_item_id(conn)
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                required_evidence_types=["ch", "vct"],
                evidence_relations=[
                    EvidenceRelation(left_type="ch", relation="above", right_type="vct", tolerance=0.01)
                ],
            ),
        )
        raw = conn.execute(
            "SELECT judgment_condition FROM estimate_rule_masters WHERE master_item_id = ?",
            (master_item_id,),
        ).fetchone()["judgment_condition"]
        parsed_json = json.loads(raw)
        assert parsed_json["evidence_relations"] == [
            {"left_type": "ch", "relation": "above", "right_type": "vct", "tolerance": 0.01}
        ]
        assert "match_mode" not in parsed_json  # 既定値(any_pair)は出力しない

        reloaded = get_rule_master_by_master_item_id(conn, master_item_id)

    assert len(reloaded.judgment_condition.evidence_relations) == 1
    rel = reloaded.judgment_condition.evidence_relations[0]
    assert rel.left_type == "ch"
    assert rel.relation == "above"
    assert rel.right_type == "vct"
    assert rel.tolerance == 0.01
    assert reloaded.judgment_condition.match_mode == MatchMode.ANY_PAIR


def test_condition_without_evidence_relations_has_no_relations_key(db_path):
    """evidence_relationsを使わないルール(Phase 6-F以前相当)のJSONには
    `evidence_relations`/`match_mode`キーが現れない(後方互換)。"""
    with get_connection(db_path) as conn:
        master_item_id = _first_master_item_id(conn)
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_EVIDENCE,
            judgment_condition=StandardCondition(required_evidence_types=["side_door"]),
        )
        raw = conn.execute(
            "SELECT judgment_condition FROM estimate_rule_masters WHERE master_item_id = ?",
            (master_item_id,),
        ).fetchone()["judgment_condition"]
    parsed_json = json.loads(raw)
    assert "evidence_relations" not in parsed_json
    assert "match_mode" not in parsed_json


def test_old_json_without_evidence_relations_key_parses_with_empty_relations(db_path):
    """Phase 6-F以前の生JSON(`evidence_relations`キー無し)を直接書き込んでも
    問題なくパースできる。"""
    with get_connection(db_path) as conn:
        master_item_id = _first_master_item_id(conn)
        old_style_json = json.dumps(
            {
                "required_evidence_types": ["vct", "ch"],
                "design_data_conditions": [],
            }
        )
        conn.execute(
            """
            INSERT INTO estimate_rule_masters
                (master_item_id, judgment_method, judgment_scope, quantity_method,
                 initial_factor, judgment_condition, calc_type, processing_mode,
                 auto_display, enabled)
            VALUES (?, 'drawing_judgment', 'panel', 'per_condition_group', 1.0, ?, 'direct', 'standard', 1, 1)
            """,
            (master_item_id, old_style_json),
        )
        reloaded = get_rule_master_by_master_item_id(conn, master_item_id)

    assert reloaded.judgment_condition.evidence_relations == []
    assert reloaded.judgment_condition.match_mode == MatchMode.ANY_PAIR


def test_evidence_relations_with_non_default_match_mode_roundtrip(db_path):
    """既定値以外のmatch_mode(例: every_pair、評価器は未対応)もschema
    としては保存・復元できる(validatorがreadyでは拒否する、という別の
    責務と切り分ける)。"""
    with get_connection(db_path) as conn:
        master_item_id = _first_master_item_id(conn)
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                required_evidence_types=["ch", "vct"],
                evidence_relations=[EvidenceRelation(left_type="ch", relation="above", right_type="vct")],
                match_mode=MatchMode.EVERY_PAIR,
            ),
        )
        raw = conn.execute(
            "SELECT judgment_condition FROM estimate_rule_masters WHERE master_item_id = ?",
            (master_item_id,),
        ).fetchone()["judgment_condition"]
        assert json.loads(raw)["match_mode"] == "every_pair"

        reloaded = get_rule_master_by_master_item_id(conn, master_item_id)
    assert reloaded.judgment_condition.match_mode == MatchMode.EVERY_PAIR
