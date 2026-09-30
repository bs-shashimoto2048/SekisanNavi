"""`app.services.estimate_result_pipeline` のテスト (Issue #40 Phase 5)。

新方式(rule evaluator)・旧方式(legacy Detection互換)の候補統合と、
新旧同一(対象, コード)衝突の検出を確認する。
"""
import sqlite3

from app import config
from app.db.connection import get_connection
from app.domain.estimate_rules import (
    EstimateResultStatus,
    EvidenceUsage,
    JudgmentMethod,
    JudgmentScope,
    QuantityMethod,
    StandardCondition,
)
from app.repositories.drawing_evidence_types import create_evidence_type
from app.repositories.estimate_rule_masters import create_rule_master
from app.services.estimate_result_pipeline import build_all_candidates

_PRODUCT_DF_HEADER = (
    "BAN_MENNO,BAN_NO,PAGE,ZUMEI,BAN_MEISYOU,BAN_TYPE,BAN_H1,BAN_H2,BAN_W,BAN_D,"
    "KITEN_X,KITEN_Y,DETECT_AREA_X,DETECT_AREA_Y,FRAME_ORG_X,FRAME_ORG_Y,"
    "FRAME_MINI_X,FRAME_MINI_Y,SCALE_X,SCALE_Y"
)
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


def _create_evidence_detection(client, key: str, **overrides) -> dict:
    page_id = _page16_id(client)
    body = {
        "drawing_page_id": page_id,
        "evidence_type_key": key,
        "bbox_x": 0.1,
        "bbox_y": 0.1,
        "bbox_w": 0.05,
        "bbox_h": 0.05,
        **overrides,
    }
    res = client.post("/api/detections/by-evidence-type", json=body)
    assert res.status_code == 201
    return res.json()


def _setup_product_dir(tmp_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _write_cp932_csv(product / "product_df.csv", _PRODUCT_DF_HEADER, [_PANEL_1_1_ROW])
    _write_cp932_csv(product / "estcode_df.csv", _ESTCODE_DF_HEADER, [_ESTCODE_ROW_1_1])
    return product


def test_merges_legacy_and_rule_candidates_when_codes_differ(client, monkeypatch, tmp_path, db_path):
    """異なるコードであれば、新旧どちらの候補もそのまま(NEEDS_REVIEWにせず)
    合流する。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    # 旧方式: 1件目のMaster Itemを直接付与。
    master_items = client.get("/api/master-items").json()
    legacy_detection = _create_manual_detection(client, master_item_id=master_items[0]["id"])

    # 新方式: 2件目のMaster Itemに対するルール + 図面情報付きBBox。
    with get_connection(db_path) as conn:
        create_evidence_type(
            conn,
            key="side_door",
            display_name="側面扉",
            category=None,
            usage=EvidenceUsage.BOTH,
            default_judgment_scope=JudgmentScope.PANEL,
            description=None,
        )
        create_rule_master(
            conn,
            master_item_id=master_items[1]["id"],
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_EVIDENCE,
            judgment_condition=StandardCondition(required_evidence_types=["side_door"]),
        )
    _create_evidence_detection(client, "side_door", bbox_x=0.2, bbox_y=0.1)

    with get_connection(db_path) as conn:
        outcome = build_all_candidates(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 2
    assert outcome.conflicting_code_targets == []
    for c in outcome.candidates:
        assert c.status == EstimateResultStatus.AUTO


def test_same_code_from_both_origins_at_the_same_target_is_flagged_needs_review(
    client, monkeypatch, tmp_path, db_path
):
    """新旧経路が同一(対象, コード)を算出した場合、どちらも破棄せず
    NEEDS_REVIEWへ設定する(Phase 5指示13章)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)
    master_item = _first_master_item(client)

    # 旧方式: このMaster Itemを直接付与するBBox(盤1/1上)。
    legacy_detection = _create_manual_detection(client, master_item_id=master_item["id"], bbox_x=0.11, bbox_y=0.1)

    # 新方式: 同じMaster Itemに対するルール + 図面情報付きBBox(同じ盤1/1)。
    with get_connection(db_path) as conn:
        create_evidence_type(
            conn,
            key="side_door",
            display_name="側面扉",
            category=None,
            usage=EvidenceUsage.BOTH,
            default_judgment_scope=JudgmentScope.PANEL,
            description=None,
        )
        create_rule_master(
            conn,
            master_item_id=master_item["id"],
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_EVIDENCE,
            judgment_condition=StandardCondition(required_evidence_types=["side_door"]),
        )
    _create_evidence_detection(client, "side_door", bbox_x=0.2, bbox_y=0.1)

    with get_connection(db_path) as conn:
        outcome = build_all_candidates(conn, str(tmp_path), "A1GV2421")

    assert len(outcome.candidates) == 2
    assert len(outcome.conflicting_code_targets) == 1
    assert all(c.status == EstimateResultStatus.NEEDS_REVIEW for c in outcome.candidates)
    # 衝突検出後も、根拠(evidence)・result_keyはそれぞれ元のまま保持される
    # (機械的に一方を破棄しない)。
    result_keys = {c.result_key for c in outcome.candidates}
    assert len(result_keys) == 2


def test_persisting_conflicting_candidates_keeps_both_rows_and_marks_needs_review(
    client, monkeypatch, tmp_path, db_path
):
    """`replace_results_for_product`へ実際に保存しても、両方の行が残り、
    どちらも`status=needs_review`になっていることを確認する(統合テスト)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)
    master_item = _first_master_item(client)
    _create_manual_detection(client, master_item_id=master_item["id"], bbox_x=0.11, bbox_y=0.1)

    with get_connection(db_path) as conn:
        create_evidence_type(
            conn,
            key="side_door",
            display_name="側面扉",
            category=None,
            usage=EvidenceUsage.BOTH,
            default_judgment_scope=JudgmentScope.PANEL,
            description=None,
        )
        create_rule_master(
            conn,
            master_item_id=master_item["id"],
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_EVIDENCE,
            judgment_condition=StandardCondition(required_evidence_types=["side_door"]),
        )
    _create_evidence_detection(client, "side_door", bbox_x=0.2, bbox_y=0.1)

    res = client.post("/api/products/A1GV2421/estimate-results/evaluate")
    assert res.status_code == 200
    results = res.json()["results"]
    assert len(results) == 2
    assert all(r["status"] == "needs_review" for r in results)
