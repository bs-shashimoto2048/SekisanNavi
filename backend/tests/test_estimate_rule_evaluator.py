"""`app.services.estimate_rule_evaluator` のテスト (Issue #40 Phase 2)。

`test_estimate_confirmation_api.py`と同じ手法(tmp_path配下に製番ディレクトリを
模したダミー構造を用意し、データ参照ルートを差し替える)を使う。
"""
import json
import sqlite3

from app import config
from app.db.connection import get_connection
from app.domain.estimate_rules import (
    ApplicableUnit,
    EvidenceRelation,
    EvidenceUsage,
    JudgmentMethod,
    JudgmentScope,
    MatchMode,
    ProcessingMode,
    QuantityMethod,
    StandardCondition,
    StandardConditionField,
)
from app.repositories.drawing_evidence_types import create_evidence_type
from app.repositories.estimate_results import replace_results_for_product
from app.repositories.estimate_rule_masters import create_rule_master
from app.services.estimate_rule_evaluator import evaluate_product

_PRODUCT_DF_HEADER = (
    "BAN_MENNO,BAN_NO,PAGE,ZUMEI,BAN_MEISYOU,BAN_TYPE,BAN_H1,BAN_H2,BAN_W,BAN_D,"
    "KITEN_X,KITEN_Y,DETECT_AREA_X,DETECT_AREA_Y,FRAME_ORG_X,FRAME_ORG_Y,"
    "FRAME_MINI_X,FRAME_MINI_Y,SCALE_X,SCALE_Y"
)
# 面番号1/盤番号1。正規化後、x=[0.1, 1.0] x y=[-1.4, 0.9] の広い矩形になり、
# 下記のManual BBox(x=0.1〜0.15, y=0.1〜0.15付近)と必ず交差する
# (test_api_products.py/test_estimate_confirmation_api.pyと同じ合成行)。
_PANEL_1_1_ROW = "1,1.0,16,外形図,盤A,正面図,2300,2000,900,2200,100,100,900,2300,15990,11430,100,100,10,10"

_ESTCODE_DF_HEADER = (
    "MODEL,BAN_MENNO,BAN_NO,BAN_MEISYOU,BAN_H,BAN_W,BAN_D,BAN_CONNECT,PANEL,TRANS,"
    "IN_PANEL,SHIELD,DOOR_FRONT,DOOR_BACK,DOOR_STACK,DOOR_SIDE,DOOR_SMALL,FAN_ROOF,"
    "FAN_DOOR,MAIN_LINE,WIRE_MESH,STACK_PLATE,DRAWER_DEVICE,VCT_STAND,BUS_DUCT,"
    "PASSAGE,INPUT_CU_COEFF,SORT_ORDER"
)
_ESTCODE_ROW_1_1 = (
    "IS2,1,1.0,高圧受電盤,2300,900,2200,箱･左右(R),0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0,5"
)


def _write_cp932_csv(path, header: str, rows: list[str]):
    content = "\n".join([header, *rows]) + "\n"
    path.write_bytes(content.encode("cp932"))


def _configure_root(client, monkeypatch, root):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "test-admin-pass")
    res = client.put(
        "/api/settings/data-source",
        json={"root": str(root), "admin_password": "test-admin-pass"},
    )
    assert res.status_code == 200


def _page16_id(client) -> int:
    pages = client.get("/api/drawing-pages").json()
    return next(p["id"] for p in pages if p["page_no"] == 16)


def _page18_id(client) -> int:
    pages = client.get("/api/drawing-pages").json()
    return next(p["id"] for p in pages if p["page_no"] == 18)


def _first_master_item(client) -> dict:
    return client.get("/api/master-items").json()[0]


def _create_manual_detection(client, **overrides) -> dict:
    page_id = _page16_id(client)
    master_item = _first_master_item(client)
    body = {
        "drawing_page_id": page_id,
        "master_item_id": master_item["id"],
        "bbox_x": 0.1,
        "bbox_y": 0.1,
        "bbox_w": 0.05,
        "bbox_h": 0.05,
        **overrides,
    }
    res = client.post("/api/detections", json=body)
    assert res.status_code == 201
    return res.json()


def _set_evidence_type(db_path, detection_id: int, key: str) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE detections SET evidence_type_key = ? WHERE id = ?", (key, detection_id))
    conn.commit()
    conn.close()


def _setup_product_dir(tmp_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _write_cp932_csv(product / "product_df.csv", _PRODUCT_DF_HEADER, [_PANEL_1_1_ROW])
    _write_cp932_csv(product / "estcode_df.csv", _ESTCODE_DF_HEADER, [_ESTCODE_ROW_1_1])
    return product


def test_evaluate_product_produces_no_candidates_when_no_rules_enabled(client, monkeypatch, tmp_path, db_path):
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        from pathlib import Path

        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []
    assert outcome.skipped_rule_master_ids == []


def test_evaluate_product_per_evidence_rule_produces_one_result_per_matching_detection(
    client, monkeypatch, tmp_path, db_path
):
    """根拠1件につき1行 (QuantityMethod.PER_EVIDENCE) の動作確認。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    created1 = _create_manual_detection(client, bbox_x=0.1, bbox_y=0.1)
    created2 = _create_manual_detection(client, bbox_x=0.2, bbox_y=0.1)
    _set_evidence_type(db_path, created1["id"], "side_door")
    _set_evidence_type(db_path, created2["id"], "side_door")

    with get_connection(db_path) as conn:
        create_evidence_type(
            conn,
            key="side_door",
            display_name="側面扉",
            category=None,
            usage=EvidenceUsage.ESTIMATE_TARGET,
            default_judgment_scope=JudgmentScope.PANEL,
            description=None,
        )
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            applicable_unit=ApplicableUnit.UNIT,
            quantity_method=QuantityMethod.PER_EVIDENCE,
            judgment_condition=StandardCondition(required_evidence_types=["side_door"]),
        )

        from pathlib import Path

        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 2
    result_keys = {c.result_key for c in outcome.candidates}
    assert result_keys == {
        f"{_first_master_item(client)['code']}:evidence:{created1['id']}",
        f"{_first_master_item(client)['code']}:evidence:{created2['id']}",
    }
    for c in outcome.candidates:
        assert c.quantity == 1
        assert len(c.evidence) == 1


def test_evaluate_product_condition_group_rule_requires_all_evidence_types(
    client, monkeypatch, tmp_path, db_path
):
    """複数図面情報の組合せ (VCT+CH相当) が揃って初めて1件成立するケース。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    vct = _create_manual_detection(client, bbox_x=0.1, bbox_y=0.1)
    _set_evidence_type(db_path, vct["id"], "vct")

    with get_connection(db_path) as conn:
        create_evidence_type(
            conn, key="vct", display_name="VCT", category=None,
            usage=EvidenceUsage.CONDITION, default_judgment_scope=JudgmentScope.PANEL, description=None,
        )
        create_evidence_type(
            conn, key="ch", display_name="CH", category=None,
            usage=EvidenceUsage.CONDITION, default_judgment_scope=JudgmentScope.PANEL, description=None,
        )
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(required_evidence_types=["vct", "ch"]),
        )

        from pathlib import Path

        # CHがまだ無いので不成立。
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")
    assert outcome.candidates == []

    ch = _create_manual_detection(client, bbox_x=0.11, bbox_y=0.11)
    _set_evidence_type(db_path, ch["id"], "ch")

    with get_connection(db_path) as conn:
        from pathlib import Path

        outcome2 = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome2.candidates) == 1
    candidate = outcome2.candidates[0]
    assert candidate.quantity == 1
    detection_ids = {e.detection_id for e in candidate.evidence}
    assert detection_ids == {vct["id"], ch["id"]}


def test_evaluate_product_design_data_only_rule_matches_without_any_bbox(
    client, monkeypatch, tmp_path, db_path
):
    """設計データのみで判定可能なコード (Issue #38の「底板なし+W/D」相当)。
    根拠となるBBoxが1件も無くても、設計データ条件だけで1件成立する。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
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

        from pathlib import Path

        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 1
    candidate = outcome.candidates[0]
    assert candidate.judgment_method == JudgmentMethod.DESIGN_DATA
    assert candidate.evidence[0].detection_id is None
    assert candidate.evidence[0].design_data_ref is not None

    # [Issue #40 Phase 6-B] design_data_refは「判定に実際に使った項目だけ」を
    # 保存する(DesignDataContext全体ではなく、この条件が参照したfield/
    # operator/expected_value/実際値のみ)。
    import json

    ref = json.loads(candidate.evidence[0].design_data_ref)
    assert ref == {
        "panel": "1:1",
        "conditions": [{"field": "ban_w", "operator": ">=", "expected_value": 900, "actual_value": 900.0}],
    }


def test_evaluate_product_skips_rules_with_unsupported_scope(client, monkeypatch, tmp_path, db_path):
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
        rule = create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.POSITION,  # Phase 2未対応
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
        )

        from pathlib import Path

        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []
    assert outcome.skipped_rule_master_ids == [rule.id]


def test_evaluate_product_skips_custom_processing_mode(client, monkeypatch, tmp_path, db_path):
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
        rule = create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.NEEDS_CONFIRMATION,
            judgment_scope=JudgmentScope.PANEL,
            processing_mode=ProcessingMode.CUSTOM,
            custom_handler_key="main_line_copper_bar",
        )

        from pathlib import Path

        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []
    assert outcome.skipped_rule_master_ids == [rule.id]


# ============================================================
# Issue #40 Phase 6-E指示3-A: StandardConditionの演算子拡張
# (starts_with/in)をevaluate_product経由で確認する。
#
# Phase 6-Dで18322(盤内通路IS/OS系)の検証条件が`model == "IS2"`という
# デモ専用の固定値一致になっていた原因(前方一致・複数候補値のいずれか、を
# 表現する手段が無かったこと)を、ここで解消する。
# ============================================================


def test_evaluate_product_design_data_condition_starts_with_matches_prefix(
    client, monkeypatch, tmp_path, db_path
):
    """合成データのMODEL='IS2'が、固定値一致ではなく前方一致
    (`model starts_with "IS"`)で成立することを確認する(18322相当の表現)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_scope=JudgmentScope.DESIGN_DATA,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                design_data_conditions=[StandardConditionField(field="model", operator="starts_with", value="IS")]
            ),
        )
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 1


def test_evaluate_product_design_data_condition_starts_with_does_not_match_other_prefix(
    client, monkeypatch, tmp_path, db_path
):
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_scope=JudgmentScope.DESIGN_DATA,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                design_data_conditions=[StandardConditionField(field="model", operator="starts_with", value="OS")]
            ),
        )
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []


def test_evaluate_product_design_data_condition_in_matches_one_of_candidates(
    client, monkeypatch, tmp_path, db_path
):
    """複数候補値のいずれかに一致する場合に成立する(`in`演算子)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_scope=JudgmentScope.DESIGN_DATA,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                design_data_conditions=[
                    StandardConditionField(field="model", operator="in", value=["IS1", "IS2", "OS1"])
                ]
            ),
        )
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 1


def test_evaluate_product_design_data_condition_in_does_not_match_when_absent(
    client, monkeypatch, tmp_path, db_path
):
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_scope=JudgmentScope.DESIGN_DATA,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                design_data_conditions=[StandardConditionField(field="model", operator="in", value=["OS1", "OS2"])]
            ),
        )
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []


def test_evaluate_product_starts_with_condition_evaluates_false_for_non_string_actual_value(
    client, monkeypatch, tmp_path, db_path
):
    """型不一致は例外ではなく条件不成立として扱う(指示3-A)。`ban_w`はfloatの
    ため、`starts_with`を適用すると常に不成立になる(クラッシュしない)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_scope=JudgmentScope.DESIGN_DATA,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                design_data_conditions=[StandardConditionField(field="ban_w", operator="starts_with", value="9")]
            ),
        )
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []


# ============================================================
# Issue #40 Phase 6-E指示3-C: 図面情報+設計データの複合条件(AND)
# ============================================================


def test_evaluate_product_requires_both_evidence_and_design_data_condition(
    client, monkeypatch, tmp_path, db_path
):
    """同一盤にevidence Aがあり、かつdesign_data条件も成立する場合のみ
    1件成立する(いずれか一方だけでは不成立)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        create_evidence_type(
            conn, key="test_evidence_a", display_name="テスト用図面情報A", category=None,
            usage=EvidenceUsage.CONDITION, default_judgment_scope=JudgmentScope.PANEL, description=None,
        )
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                required_evidence_types=["test_evidence_a"],
                design_data_conditions=[StandardConditionField(field="ban_w", operator=">=", value=900)],
            ),
        )

        # 1. まだevidenceが無い: 不成立。
        outcome_none = evaluate_product(conn, str(tmp_path), "A1GV2421")
    assert outcome_none.candidates == []

    evidence_detection = _create_manual_detection(client, bbox_x=0.1, bbox_y=0.1)
    _set_evidence_type(db_path, evidence_detection["id"], "test_evidence_a")

    with get_connection(db_path) as conn:
        # 2. evidence + design_data両方成立: 1件成立。
        outcome_both = evaluate_product(conn, str(tmp_path), "A1GV2421")
    assert len(outcome_both.candidates) == 1
    assert outcome_both.candidates[0].evidence[0].detection_id == evidence_detection["id"]


def test_evaluate_product_evidence_without_design_data_condition_does_not_match(
    client, monkeypatch, tmp_path, db_path
):
    """evidenceだけ成立していても、design_data条件が不成立なら成立しない。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        create_evidence_type(
            conn, key="test_evidence_b", display_name="テスト用図面情報B", category=None,
            usage=EvidenceUsage.CONDITION, default_judgment_scope=JudgmentScope.PANEL, description=None,
        )
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                required_evidence_types=["test_evidence_b"],
                # 実データのban_w=900なので、>=99999は常に不成立。
                design_data_conditions=[StandardConditionField(field="ban_w", operator=">=", value=99999)],
            ),
        )

    evidence_detection = _create_manual_detection(client, bbox_x=0.1, bbox_y=0.1)
    _set_evidence_type(db_path, evidence_detection["id"], "test_evidence_b")

    with get_connection(db_path) as conn:
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")
    assert outcome.candidates == []


def test_evaluate_product_result_disappears_when_evidence_is_removed(client, monkeypatch, tmp_path, db_path):
    """成立後にevidenceを削除すると、再評価でresultが消滅する
    (`replace_results_for_product`との組合せで確認)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        create_evidence_type(
            conn, key="test_evidence_c", display_name="テスト用図面情報C", category=None,
            usage=EvidenceUsage.CONDITION, default_judgment_scope=JudgmentScope.PANEL, description=None,
        )
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                required_evidence_types=["test_evidence_c"],
                design_data_conditions=[StandardConditionField(field="ban_w", operator=">=", value=900)],
            ),
        )

    evidence_detection = _create_manual_detection(client, bbox_x=0.1, bbox_y=0.1)
    _set_evidence_type(db_path, evidence_detection["id"], "test_evidence_c")

    with get_connection(db_path) as conn:
        outcome_before = evaluate_product(conn, str(tmp_path), "A1GV2421")
        replace_results_for_product(conn, product_no="A1GV2421", candidates=outcome_before.candidates)
        results_before = conn.execute(
            "SELECT COUNT(*) FROM estimate_results WHERE product_no = 'A1GV2421'"
        ).fetchone()[0]
    assert results_before == 1

    res = client.delete(f"/api/detections/{evidence_detection['id']}")
    assert res.status_code == 204

    with get_connection(db_path) as conn:
        outcome_after = evaluate_product(conn, str(tmp_path), "A1GV2421")
        replace_results_for_product(conn, product_no="A1GV2421", candidates=outcome_after.candidates)
        results_after = conn.execute(
            "SELECT COUNT(*) FROM estimate_results WHERE product_no = 'A1GV2421'"
        ).fetchone()[0]
    assert outcome_after.candidates == []
    assert results_after == 0


def test_evaluate_product_result_disappears_when_design_data_changes(client, monkeypatch, tmp_path, db_path):
    """evidence+design_data両方成立後、design_dataが変化して条件不成立になると
    再評価でresultが消滅する。"""
    product_dir = _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        create_evidence_type(
            conn, key="test_evidence_d", display_name="テスト用図面情報D", category=None,
            usage=EvidenceUsage.CONDITION, default_judgment_scope=JudgmentScope.PANEL, description=None,
        )
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                required_evidence_types=["test_evidence_d"],
                design_data_conditions=[StandardConditionField(field="ban_w", operator=">=", value=900)],
            ),
        )

    evidence_detection = _create_manual_detection(client, bbox_x=0.1, bbox_y=0.1)
    _set_evidence_type(db_path, evidence_detection["id"], "test_evidence_d")

    with get_connection(db_path) as conn:
        outcome_before = evaluate_product(conn, str(tmp_path), "A1GV2421")
    assert len(outcome_before.candidates) == 1

    # 設計データを変更(ban_w=900 → 500、>=900を不成立にする)。
    _write_cp932_csv(
        product_dir / "estcode_df.csv",
        _ESTCODE_DF_HEADER,
        [_ESTCODE_ROW_1_1.replace(",900,", ",500,")],
    )

    with get_connection(db_path) as conn:
        outcome_after = evaluate_product(conn, str(tmp_path), "A1GV2421")
    assert outcome_after.candidates == []


# ============================================================
# Issue #40 Phase 6-E指示3-D: JudgmentScope.DRAWING/PRODUCT
# (「業務意味に依存しない純粋な数量scope処理」として追加。evidenceの存在判定
# のみを対象とし、design_data_conditionsとの組合せは評価せず
# skipped_rule_master_idsへ記録する)。
# ============================================================


def test_evaluate_product_drawing_scope_groups_by_page_not_panel(client, monkeypatch, tmp_path, db_path):
    """同じevidence種別が別々の図面ページ(page16/page18)にあれば、
    DRAWING scopeではページごとに独立した結果になる(PANEL scopeとは異なり
    盤割当を一切見ない)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        create_evidence_type(
            conn, key="test_drawing_evidence", display_name="テスト用(図面単位)", category=None,
            usage=EvidenceUsage.ESTIMATE_TARGET, default_judgment_scope=JudgmentScope.DRAWING, description=None,
        )
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.DRAWING,
            quantity_method=QuantityMethod.PER_EVIDENCE,
            judgment_condition=StandardCondition(required_evidence_types=["test_drawing_evidence"]),
        )

    d16 = _create_manual_detection(client, drawing_page_id=_page16_id(client), bbox_x=0.1, bbox_y=0.1)
    _set_evidence_type(db_path, d16["id"], "test_drawing_evidence")
    d18 = _create_manual_detection(client, drawing_page_id=_page18_id(client), bbox_x=0.1, bbox_y=0.1)
    _set_evidence_type(db_path, d18["id"], "test_drawing_evidence")

    with get_connection(db_path) as conn:
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 2
    detection_ids = {c.evidence[0].detection_id for c in outcome.candidates}
    assert detection_ids == {d16["id"], d18["id"]}
    for c in outcome.candidates:
        assert c.target_panel_ban_menno is None
        assert c.target_panel_ban_no is None
        assert c.judgment_scope == JudgmentScope.DRAWING


def test_evaluate_product_drawing_scope_condition_group_requires_both_types_on_same_page(
    client, monkeypatch, tmp_path, db_path
):
    """複数種類のevidenceがそれぞれ別ページにある場合、DRAWING scopeでは
    どちらのページも成立しない(同一ページ内に揃う必要がある)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        for key in ("test_drawing_a", "test_drawing_b"):
            create_evidence_type(
                conn, key=key, display_name=key, category=None,
                usage=EvidenceUsage.CONDITION, default_judgment_scope=JudgmentScope.DRAWING, description=None,
            )
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.DRAWING,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(required_evidence_types=["test_drawing_a", "test_drawing_b"]),
        )

    d16 = _create_manual_detection(client, drawing_page_id=_page16_id(client), bbox_x=0.1, bbox_y=0.1)
    _set_evidence_type(db_path, d16["id"], "test_drawing_a")
    d18 = _create_manual_detection(client, drawing_page_id=_page18_id(client), bbox_x=0.1, bbox_y=0.1)
    _set_evidence_type(db_path, d18["id"], "test_drawing_b")

    with get_connection(db_path) as conn:
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")
    assert outcome.candidates == []


def test_evaluate_product_drawing_scope_skips_rule_combined_with_design_data_condition(
    client, monkeypatch, tmp_path, db_path
):
    """DRAWING scope + design_data_conditionsの組合せは、業務的な集約判断が
    必要なため評価せずskipする(指示3-Dの制限)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        create_evidence_type(
            conn, key="test_drawing_c", display_name="test_drawing_c", category=None,
            usage=EvidenceUsage.CONDITION, default_judgment_scope=JudgmentScope.DRAWING, description=None,
        )
        master_item_id = _first_master_item(client)["id"]
        rule = create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.DRAWING,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                required_evidence_types=["test_drawing_c"],
                design_data_conditions=[StandardConditionField(field="ban_w", operator=">=", value=900)],
            ),
        )
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []
    assert outcome.skipped_rule_master_ids == [rule.id]


def test_evaluate_product_drawing_scope_skips_rule_combined_with_design_data_any_of(
    client, monkeypatch, tmp_path, db_path
):
    """PR #50レビュー指摘の再発防止テスト: DRAWING scope + design_data_any_of
    (OR条件)の組合せも、design_data_conditions(AND)と同じ理由で評価せず
    skipする。修正前はこのOR条件の有無チェックが漏れており、evidenceさえ
    揃えばOR条件を無視して黙って成立してしまう不具合があった。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        create_evidence_type(
            conn, key="test_drawing_any_of", display_name="test_drawing_any_of", category=None,
            usage=EvidenceUsage.CONDITION, default_judgment_scope=JudgmentScope.DRAWING, description=None,
        )
        master_item_id = _first_master_item(client)["id"]
        rule = create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.DRAWING,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                required_evidence_types=["test_drawing_any_of"],
                design_data_any_of=[
                    [StandardConditionField(field="model", operator="starts_with", value="IS")]
                ],
            ),
        )

    d = _create_manual_detection(client, bbox_x=0.1, bbox_y=0.1)
    _set_evidence_type(db_path, d["id"], "test_drawing_any_of")

    with get_connection(db_path) as conn:
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []
    assert outcome.skipped_rule_master_ids == [rule.id]


def test_evaluate_product_product_scope_skips_rule_combined_with_design_data_any_of(
    client, monkeypatch, tmp_path, db_path
):
    """同上、PRODUCT scope版。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        create_evidence_type(
            conn, key="test_product_any_of", display_name="test_product_any_of", category=None,
            usage=EvidenceUsage.CONDITION, default_judgment_scope=JudgmentScope.PRODUCT, description=None,
        )
        master_item_id = _first_master_item(client)["id"]
        rule = create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PRODUCT,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                required_evidence_types=["test_product_any_of"],
                design_data_any_of=[
                    [StandardConditionField(field="model", operator="starts_with", value="IS")]
                ],
            ),
        )

    d = _create_manual_detection(client, bbox_x=0.1, bbox_y=0.1)
    _set_evidence_type(db_path, d["id"], "test_product_any_of")

    with get_connection(db_path) as conn:
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []
    assert outcome.skipped_rule_master_ids == [rule.id]


def test_evaluate_product_drawing_scope_skips_rule_without_required_evidence_types(
    client, monkeypatch, tmp_path, db_path
):
    """DRAWING scopeでevidenceを1件も要求しないルール(設計データのみ相当)は
    集約方法が未確定なためskipする。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
        rule = create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.DRAWING,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(),
        )
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []
    assert outcome.skipped_rule_master_ids == [rule.id]


def test_evaluate_product_product_scope_combines_evidence_across_pages(client, monkeypatch, tmp_path, db_path):
    """PRODUCT scopeでは、異なる図面ページにまたがるevidenceの組合せでも
    1件成立する(製番全体を1グループとする)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        for key in ("test_product_a", "test_product_b"):
            create_evidence_type(
                conn, key=key, display_name=key, category=None,
                usage=EvidenceUsage.CONDITION, default_judgment_scope=JudgmentScope.PRODUCT, description=None,
            )
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PRODUCT,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(required_evidence_types=["test_product_a", "test_product_b"]),
        )

    d16 = _create_manual_detection(client, drawing_page_id=_page16_id(client), bbox_x=0.1, bbox_y=0.1)
    _set_evidence_type(db_path, d16["id"], "test_product_a")
    d18 = _create_manual_detection(client, drawing_page_id=_page18_id(client), bbox_x=0.1, bbox_y=0.1)
    _set_evidence_type(db_path, d18["id"], "test_product_b")

    with get_connection(db_path) as conn:
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 1
    candidate = outcome.candidates[0]
    assert candidate.quantity == 1
    assert candidate.target_panel_ban_menno is None
    assert candidate.target_drawing_page_id is None
    detection_ids = {e.detection_id for e in candidate.evidence}
    assert detection_ids == {d16["id"], d18["id"]}


def test_evaluate_product_product_scope_per_evidence_counts_across_pages(
    client, monkeypatch, tmp_path, db_path
):
    """PRODUCT scope + PER_EVIDENCEは、ページをまたいでも根拠1件につき1行
    (同種BBox複数→数量複数、の製番全体版)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        create_evidence_type(
            conn, key="test_product_c", display_name="test_product_c", category=None,
            usage=EvidenceUsage.ESTIMATE_TARGET, default_judgment_scope=JudgmentScope.PRODUCT, description=None,
        )
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PRODUCT,
            quantity_method=QuantityMethod.PER_EVIDENCE,
            judgment_condition=StandardCondition(required_evidence_types=["test_product_c"]),
        )

    d16 = _create_manual_detection(client, drawing_page_id=_page16_id(client), bbox_x=0.1, bbox_y=0.1)
    _set_evidence_type(db_path, d16["id"], "test_product_c")
    d18 = _create_manual_detection(client, drawing_page_id=_page18_id(client), bbox_x=0.1, bbox_y=0.1)
    _set_evidence_type(db_path, d18["id"], "test_product_c")

    with get_connection(db_path) as conn:
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 2
    detection_ids = {c.evidence[0].detection_id for c in outcome.candidates}
    assert detection_ids == {d16["id"], d18["id"]}


# ============================================================
# Issue #40 Phase 6-F指示A: StandardConditionのOR表現(design_data_any_of)
# ============================================================


def test_evaluate_product_or_condition_matches_when_either_branch_holds(
    client, monkeypatch, tmp_path, db_path
):
    """合成データのMODEL='IS2'が、OR条件(IS系 または OS系)のIS側の枝で
    成立することを確認する(18322相当、資料どおりのOR表現)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
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
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 1


def test_evaluate_product_or_condition_matches_via_os_branch_with_synthetic_data(
    client, monkeypatch, tmp_path, db_path
):
    """OS系のデータ(合成)でもOR条件のOS側の枝で成立することを確認する
    (実データにOS系が無いため、指示通り合成データで検証する)。"""
    product_dir = _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)
    _write_cp932_csv(
        product_dir / "estcode_df.csv",
        _ESTCODE_DF_HEADER,
        [_ESTCODE_ROW_1_1.replace("IS2,", "OS1,")],
    )

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
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
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 1


def test_evaluate_product_18321_style_or_condition_matches_ia_branch_with_synthetic_data(
    client, monkeypatch, tmp_path, db_path
):
    """Issue #40 Phase 6-G指示8: 18321(盤内通路IA/OA系)の技術検証。18322
    (IS/OS系)と同じOR engineで`model starts_with "IA"` **または**
    `model starts_with "OA"`が資料どおりに表現・評価できることを、合成
    データ(IA2)で確認する。業務ルール(「IA/OAなら必ず18321」の断定)は
    資料で確定していないため、ここでは技術的な表現可能性の検証にとどめ、
    本番マスタ投入は行わない(手動で候補マニフェストへ反映する際も、
    statusはneeds_business_confirmationのまま)。"""
    product_dir = _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)
    _write_cp932_csv(
        product_dir / "estcode_df.csv",
        _ESTCODE_DF_HEADER,
        [_ESTCODE_ROW_1_1.replace("IS2,", "IA2,")],
    )

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_scope=JudgmentScope.DESIGN_DATA,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                design_data_any_of=[
                    [StandardConditionField(field="model", operator="starts_with", value="IA")],
                    [StandardConditionField(field="model", operator="starts_with", value="OA")],
                ]
            ),
        )
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 1


def test_evaluate_product_18321_style_or_condition_matches_oa_branch_with_synthetic_data(
    client, monkeypatch, tmp_path, db_path
):
    """同上、OA側の枝。"""
    product_dir = _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)
    _write_cp932_csv(
        product_dir / "estcode_df.csv",
        _ESTCODE_DF_HEADER,
        [_ESTCODE_ROW_1_1.replace("IS2,", "OA1,")],
    )

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_scope=JudgmentScope.DESIGN_DATA,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                design_data_any_of=[
                    [StandardConditionField(field="model", operator="starts_with", value="IA")],
                    [StandardConditionField(field="model", operator="starts_with", value="OA")],
                ]
            ),
        )
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 1


def test_evaluate_product_18321_style_or_condition_does_not_match_is_os(
    client, monkeypatch, tmp_path, db_path
):
    """18321(IA/OA系)の条件は、18322(IS/OS系、実データIS2)には成立しない
    (コード同士が混同されないことの確認)。"""
    _setup_product_dir(tmp_path)  # 実データのままIS2。
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_scope=JudgmentScope.DESIGN_DATA,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                design_data_any_of=[
                    [StandardConditionField(field="model", operator="starts_with", value="IA")],
                    [StandardConditionField(field="model", operator="starts_with", value="OA")],
                ]
            ),
        )
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []


def test_evaluate_product_or_condition_all_branches_fail(client, monkeypatch, tmp_path, db_path):
    """OR条件のどちらの枝も成立しない(合成データのmodelがIS/OSどちらでもない)
    場合、不成立になる。"""
    product_dir = _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)
    _write_cp932_csv(
        product_dir / "estcode_df.csv",
        _ESTCODE_DF_HEADER,
        [_ESTCODE_ROW_1_1.replace("IS2,", "IA2,")],
    )

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
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
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []


def test_evaluate_product_and_plus_or_requires_both(client, monkeypatch, tmp_path, db_path):
    """AND条件(`ban_w>=900`)とOR条件(IS系またはOS系)を同時に満たす必要が
    ある場合、どちらか片方だけでは不成立。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_scope=JudgmentScope.DESIGN_DATA,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                design_data_conditions=[StandardConditionField(field="ban_w", operator=">=", value=99999)],
                design_data_any_of=[
                    [StandardConditionField(field="model", operator="starts_with", value="IS")],
                    [StandardConditionField(field="model", operator="starts_with", value="OS")],
                ],
            ),
        )
        # AND条件(ban_w>=99999)が成立しないため、OR側(IS2で成立するはず)が
        # 真でも全体としては不成立。
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []


def test_evaluate_product_or_condition_with_in_operator_inside_group(
    client, monkeypatch, tmp_path, db_path
):
    """OR groupの中で`in`演算子を使う組合せ。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
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
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 1


def test_evaluate_product_design_data_ref_includes_any_of_when_present(
    client, monkeypatch, tmp_path, db_path
):
    """design_data_refのJSONに、OR各枝の成立有無・実際値が記録される
    (Issue #40 Phase 6-F指示B: 後から「どのOR枝が成立したか」を説明可能に)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
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
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 1
    ref = json.loads(outcome.candidates[0].evidence[0].design_data_ref)
    assert ref["conditions"] == []  # AND条件は無し
    assert len(ref["any_of"]) == 2
    assert ref["any_of"][0]["matched"] is True  # IS系の枝(model='IS2')
    assert ref["any_of"][0]["conditions"][0]["actual_value"] == "IS2"
    assert ref["any_of"][1]["matched"] is False  # OS系の枝


def test_evaluate_product_design_data_ref_omits_any_of_key_when_no_or_condition(
    client, monkeypatch, tmp_path, db_path
):
    """OR条件を使わない既存ルールのdesign_data_refは、Phase 6-B時点と全く
    同じ形(`any_of`キー無し)のまま(後方互換の確認)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
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
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    ref = json.loads(outcome.candidates[0].evidence[0].design_data_ref)
    assert "any_of" not in ref


# ============================================================
# Issue #40 Phase 6-G指示2/3: 位置関係条件(evidence_relations)の評価。
# 座標系はY軸下向き(product_df.pyのdocstring参照): yが小さい方が画面上で
# 上(above)。
# ============================================================


def test_evaluate_product_position_relation_matches_when_above_holds(client, monkeypatch, tmp_path, db_path):
    """CHがVCTより上(yが小さい)にある場合、位置関係条件が成立する。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        for key in ("test_ch", "test_vct"):
            create_evidence_type(
                conn, key=key, display_name=key, category=None,
                usage=EvidenceUsage.CONDITION, default_judgment_scope=JudgmentScope.PANEL, description=None,
            )
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                required_evidence_types=["test_ch", "test_vct"],
                evidence_relations=[EvidenceRelation(left_type="test_ch", relation="above", right_type="test_vct")],
            ),
        )

    ch = _create_manual_detection(client, bbox_x=0.10, bbox_y=0.10, bbox_w=0.02, bbox_h=0.02)
    _set_evidence_type(db_path, ch["id"], "test_ch")
    vct = _create_manual_detection(client, bbox_x=0.10, bbox_y=0.30, bbox_w=0.02, bbox_h=0.02)
    _set_evidence_type(db_path, vct["id"], "test_vct")

    with get_connection(db_path) as conn:
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 1
    detection_ids = {e.detection_id for e in outcome.candidates[0].evidence}
    assert detection_ids == {ch["id"], vct["id"]}


def test_evaluate_product_position_relation_does_not_match_when_reversed(
    client, monkeypatch, tmp_path, db_path
):
    """CHがVCTより下にある(=above不成立)場合は、evidenceが両方揃っていても
    成立しない。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        for key in ("test_ch2", "test_vct2"):
            create_evidence_type(
                conn, key=key, display_name=key, category=None,
                usage=EvidenceUsage.CONDITION, default_judgment_scope=JudgmentScope.PANEL, description=None,
            )
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                required_evidence_types=["test_ch2", "test_vct2"],
                evidence_relations=[
                    EvidenceRelation(left_type="test_ch2", relation="above", right_type="test_vct2")
                ],
            ),
        )

    # CHをVCTより下(yが大きい)に配置する → above不成立。
    ch = _create_manual_detection(client, bbox_x=0.10, bbox_y=0.30, bbox_w=0.02, bbox_h=0.02)
    _set_evidence_type(db_path, ch["id"], "test_ch2")
    vct = _create_manual_detection(client, bbox_x=0.10, bbox_y=0.10, bbox_w=0.02, bbox_h=0.02)
    _set_evidence_type(db_path, vct["id"], "test_vct2")

    with get_connection(db_path) as conn:
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []


def test_evaluate_product_position_relation_any_pair_matches_if_one_pair_holds(
    client, monkeypatch, tmp_path, db_path
):
    """複数のCH・複数のVCTがある場合、ANY_PAIR(既定)は全組合せのうち
    1組でも関係を満たせば成立する(指示3: 暗黙に最初の1件同士を比較しない、
    の確認。1組目は不成立・2組目のみ成立するよう配置する)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        for key in ("test_ch3", "test_vct3"):
            create_evidence_type(
                conn, key=key, display_name=key, category=None,
                usage=EvidenceUsage.CONDITION, default_judgment_scope=JudgmentScope.PANEL, description=None,
            )
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                required_evidence_types=["test_ch3", "test_vct3"],
                evidence_relations=[
                    EvidenceRelation(left_type="test_ch3", relation="above", right_type="test_vct3")
                ],
                match_mode=MatchMode.ANY_PAIR,
            ),
        )

    # 1組目: ch_low(下)/vct_high(上) → above不成立。
    ch_low = _create_manual_detection(client, bbox_x=0.10, bbox_y=0.40, bbox_w=0.02, bbox_h=0.02)
    _set_evidence_type(db_path, ch_low["id"], "test_ch3")
    vct_high = _create_manual_detection(client, bbox_x=0.30, bbox_y=0.10, bbox_w=0.02, bbox_h=0.02)
    _set_evidence_type(db_path, vct_high["id"], "test_vct3")
    # 2組目: ch_high(上)/vct_low(下) → above成立。
    ch_high = _create_manual_detection(client, bbox_x=0.50, bbox_y=0.10, bbox_w=0.02, bbox_h=0.02)
    _set_evidence_type(db_path, ch_high["id"], "test_ch3")
    vct_low = _create_manual_detection(client, bbox_x=0.70, bbox_y=0.40, bbox_w=0.02, bbox_h=0.02)
    _set_evidence_type(db_path, vct_low["id"], "test_vct3")

    with get_connection(db_path) as conn:
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 1


def test_evaluate_product_position_relation_tolerance_absorbs_small_difference(
    client, monkeypatch, tmp_path, db_path
):
    """toleranceを指定すると、わずかな差は「above」とみなされなくなる
    (`app.domain.geometry.is_above`のtolerance仕様をそのまま反映)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        for key in ("test_ch4", "test_vct4"):
            create_evidence_type(
                conn, key=key, display_name=key, category=None,
                usage=EvidenceUsage.CONDITION, default_judgment_scope=JudgmentScope.PANEL, description=None,
            )
        master_item_id = _first_master_item(client)["id"]
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                required_evidence_types=["test_ch4", "test_vct4"],
                evidence_relations=[
                    EvidenceRelation(
                        left_type="test_ch4", relation="above", right_type="test_vct4", tolerance=0.1
                    )
                ],
            ),
        )

    # center_yの差はごくわずか(0.01)。tolerance=0.1より小さいため不成立。
    ch = _create_manual_detection(client, bbox_x=0.10, bbox_y=0.100, bbox_w=0.02, bbox_h=0.02)
    _set_evidence_type(db_path, ch["id"], "test_ch4")
    vct = _create_manual_detection(client, bbox_x=0.10, bbox_y=0.110, bbox_w=0.02, bbox_h=0.02)
    _set_evidence_type(db_path, vct["id"], "test_vct4")

    with get_connection(db_path) as conn:
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []


def test_evaluate_product_design_data_scope_skips_rule_with_evidence_relations(
    client, monkeypatch, tmp_path, db_path
):
    """evidence_relationsはPANEL scopeのみ対応。DESIGN_DATA scopeでは
    (指示2「PANEL scopeから開始してよい」の範囲外のため)skipする。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
        rule = create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.NEEDS_CONFIRMATION,
            judgment_scope=JudgmentScope.DESIGN_DATA,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                required_evidence_types=["test_ch5", "test_vct5"],
                evidence_relations=[
                    EvidenceRelation(left_type="test_ch5", relation="above", right_type="test_vct5")
                ],
            ),
        )
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []
    assert outcome.skipped_rule_master_ids == [rule.id]


def test_evaluate_product_skips_rule_with_evidence_relations_and_unsupported_match_mode(
    client, monkeypatch, tmp_path, db_path
):
    """未対応のmatch_mode(any_pair以外)を使うルールはskipする(指示3:
    実装するのはany_pairのみ、他はunsupported)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        master_item_id = _first_master_item(client)["id"]
        rule = create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.NEEDS_CONFIRMATION,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                required_evidence_types=["test_ch6", "test_vct6"],
                evidence_relations=[
                    EvidenceRelation(left_type="test_ch6", relation="above", right_type="test_vct6")
                ],
                match_mode=MatchMode.EVERY_PAIR,
            ),
        )
        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")

    assert outcome.candidates == []
    assert outcome.skipped_rule_master_ids == [rule.id]


def test_evidence_relations_hold_is_false_across_panels():
    """`_evidence_relations_hold`は`evidence_by_type`に渡された根拠だけを
    見る。盤ごとの絞り込みは呼び出し元(`_panel_evidence_by_type`、既存の
    panel_assignmentベースのグルーピング、Phase 2から変更していない)が
    行うため、異なる盤のevidenceが同じ`evidence_by_type`へ混ざることは
    無い(=この関数自身のテストとしては「right_type側のevidenceが
    (他の盤にあって)この盤には無い」状態を模せば十分。cross-panel不成立の
    実質的な保証はpanel_assignment側のテストが担う)。"""
    from app.domain.models import Detection, DetectionSourceType, DetectionStatus
    from app.services.estimate_rule_evaluator import _evidence_relations_hold

    def _detection(id_: int, y: float) -> Detection:
        return Detection(
            id=id_,
            drawing_page_id=1,
            panel_id=None,
            class_name="test",
            bbox_x=0.1,
            bbox_y=y,
            bbox_w=0.02,
            bbox_h=0.02,
            confidence=None,
            status=DetectionStatus.REVIEWED,
            source_type=DetectionSourceType.MANUAL,
            master_item_id=None,
            leader_label_x=None,
            leader_label_y=None,
            master_item_category=None,
            master_item_model=None,
            master_item_code=None,
            evidence_type_key="test_ch",
        )

    condition = StandardCondition(
        required_evidence_types=["test_ch", "test_vct"],
        evidence_relations=[EvidenceRelation(left_type="test_ch", relation="above", right_type="test_vct")],
    )

    # 同じ盤にtest_ch/test_vct両方がある場合は成立する(above成立の配置)。
    same_panel_evidence = {"test_ch": [_detection(1, 0.1)], "test_vct": [_detection(2, 0.3)]}
    assert _evidence_relations_hold(condition, same_panel_evidence) is True

    # test_vctがこの盤のevidence_by_typeに存在しない(=別の盤にしか無い、と
    # いう状況を模す)場合は不成立。
    cross_panel_evidence = {"test_ch": [_detection(1, 0.1)]}
    assert _evidence_relations_hold(condition, cross_panel_evidence) is False
