"""`app.services.estimate_rule_evaluator` のテスト (Issue #40 Phase 2)。

`test_estimate_confirmation_api.py`と同じ手法(tmp_path配下に製番ディレクトリを
模したダミー構造を用意し、データ参照ルートを差し替える)を使う。
"""
import sqlite3

from app import config
from app.db.connection import get_connection
from app.domain.estimate_rules import (
    ApplicableUnit,
    EvidenceUsage,
    JudgmentMethod,
    JudgmentScope,
    ProcessingMode,
    QuantityMethod,
    StandardCondition,
    StandardConditionField,
)
from app.repositories.drawing_evidence_types import create_evidence_type
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
