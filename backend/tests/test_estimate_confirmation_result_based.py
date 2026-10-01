"""積算確定(EstimateConfirmation)のEstimateResultベース移行 (Issue #40
Phase 6-A/B) に関する結合テスト。

旧Detectionベースの確定フロー自体のテストは`test_estimate_confirmation_api.py`
(legacy Manual BBox互換のEstimateResult経由の確定)を、repository層の
snapshot保存自体のテストは`test_estimate_confirmations.py`を参照。
ここでは以下、Phase 6-Aで新たに追加した挙動のみを対象にする。

- design_data判定のみ/図面情報(evidence_type_key)経由/複数BBox条件の
  EstimateResultも確定対象になること
- 係数override(current_factor)が確定snapshotへ反映されること
- status=needs_reviewのEstimateResultが1件でもあれば確定operation自体を
  HTTP 422で拒否すること(部分確定・黙った除外をしないこと)
- 根拠(evidence)のsnapshot(BBox根拠・設計データ根拠、複数件)
- 過去(Phase 6-A以前)に保存された旧shapeの行が、新列NULLのまま安全に
  読み出せること(後方互換)
"""
import json
import sqlite3

from app import config
from app.db.connection import get_connection
from app.domain.estimate_rules import (
    JudgmentMethod,
    JudgmentScope,
    QuantityMethod,
    StandardCondition,
    StandardConditionField,
)
from app.repositories.estimate_rule_masters import create_rule_master

_PRODUCT_DF_HEADER = (
    "BAN_MENNO,BAN_NO,PAGE,ZUMEI,BAN_MEISYOU,BAN_TYPE,BAN_H1,BAN_H2,BAN_W,BAN_D,"
    "KITEN_X,KITEN_Y,DETECT_AREA_X,DETECT_AREA_Y,FRAME_ORG_X,FRAME_ORG_Y,"
    "FRAME_MINI_X,FRAME_MINI_Y,SCALE_X,SCALE_Y"
)
_PANEL_1_1_ROW = "1,1.0,16,外形図,盤A,正面図,2300,2000,900,2200,100,100,900,2300,15990,11430,100,100,10,10"
_PANEL_2_2_ROW = "2,2.0,16,外形図,盤B,正面図,2300,2000,900,2200,100,100,900,2300,15990,11430,100,100,10,10"

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


def _evaluate(client, product_no: str = "A1GV2421") -> dict:
    res = client.post(f"/api/products/{product_no}/estimate-results/evaluate")
    assert res.status_code == 200
    return res.json()


def _confirm(client, product_no: str = "A1GV2421"):
    return client.post(f"/api/products/{product_no}/estimate-confirmations")


def _setup_single_panel_product(client, monkeypatch, tmp_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _write_cp932_csv(product / "product_df.csv", _PRODUCT_DF_HEADER, [_PANEL_1_1_ROW])
    _write_cp932_csv(product / "estcode_df.csv", _ESTCODE_DF_HEADER, [_ESTCODE_ROW_1_1])
    _configure_root(client, monkeypatch, tmp_path)


# --- needs_review (status=needs_review) は確定自体を禁止する (指示A-1) ---


def test_needs_review_result_blocks_confirmation_with_422(client, monkeypatch, tmp_path, db_path):
    """複数盤の交差面積が同値(tie)のEstimateResultが1件でもあれば、
    確定操作自体をHTTP 422で拒否する(部分確定・黙った除外をしない)。"""
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _write_cp932_csv(product / "product_df.csv", _PRODUCT_DF_HEADER, [_PANEL_1_1_ROW, _PANEL_2_2_ROW])
    _configure_root(client, monkeypatch, tmp_path)
    _create_manual_detection(client)
    _evaluate(client)

    res = _confirm(client)
    assert res.status_code == 422
    assert "要確認" in res.json()["detail"]

    # DBには一切保存されない(確定自体が成立していないこと)。
    conn = sqlite3.connect(db_path)
    count = conn.execute("SELECT COUNT(*) FROM estimate_confirmations").fetchone()[0]
    conn.close()
    assert count == 0


def test_confirmation_succeeds_once_needs_review_is_resolved(client, monkeypatch, tmp_path):
    """tieを解消(片方の盤をproduct_df.csvから無くす)すれば、通常どおり
    確定できることを確認する(ブロック自体がstatus=needs_reviewの存在のみに
    連動しており、過剰に広い条件で拒否していないことの裏付け)。"""
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _write_cp932_csv(product / "product_df.csv", _PRODUCT_DF_HEADER, [_PANEL_1_1_ROW, _PANEL_2_2_ROW])
    _configure_root(client, monkeypatch, tmp_path)
    _create_manual_detection(client)
    _evaluate(client)
    assert _confirm(client).status_code == 422

    _write_cp932_csv(product / "product_df.csv", _PRODUCT_DF_HEADER, [_PANEL_1_1_ROW])
    _evaluate(client)
    res = _confirm(client)
    assert res.status_code == 201
    assert res.json()["item_count"] == 1


# --- design_data判定のみのEstimateResultも確定対象になる ---


def test_design_data_only_result_is_confirmable_with_evidence_snapshot(client, monkeypatch, tmp_path, db_path):
    _setup_single_panel_product(client, monkeypatch, tmp_path)
    master_item = _first_master_item(client)
    with get_connection(db_path) as conn:
        create_rule_master(
            conn,
            master_item_id=master_item["id"],
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_scope=JudgmentScope.DESIGN_DATA,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(
                design_data_conditions=[StandardConditionField(field="ban_w", operator=">=", value=500)]
            ),
        )

    _evaluate(client)
    res = _confirm(client)
    assert res.status_code == 201
    body = res.json()
    assert body["item_count"] == 1
    item = body["items"][0]
    assert item["judgment_method"] == "design_data"
    assert item["detection_id"] is None

    assert len(item["evidence"]) == 1
    evidence = item["evidence"][0]
    assert evidence["evidence_kind"] == "design_data"
    assert evidence["detection_id"] is None
    ref = json.loads(evidence["design_data_ref"])
    assert ref["panel"] == "1:1"
    assert ref["conditions"] == [
        {"field": "ban_w", "operator": ">=", "expected_value": 500, "actual_value": 900.0}
    ]


# --- 図面情報(evidence_type_key)経由のEstimateResultも確定対象になる ---


def test_evidence_type_based_result_is_confirmable(client, monkeypatch, tmp_path, db_path):
    _setup_single_panel_product(client, monkeypatch, tmp_path)
    detection = _create_manual_detection(client)
    _set_evidence_type(db_path, detection["id"], "side_door")

    master_item = _first_master_item(client)
    with get_connection(db_path) as conn:
        create_rule_master(
            conn,
            master_item_id=master_item["id"],
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_EVIDENCE,
            judgment_condition=StandardCondition(required_evidence_types=["side_door"]),
        )

    _evaluate(client)
    res = _confirm(client)
    assert res.status_code == 201
    item = res.json()["items"][0]
    assert item["judgment_method"] == "drawing_judgment"
    assert item["detection_id"] == detection["id"]
    assert len(item["evidence"]) == 1
    evidence = item["evidence"][0]
    assert evidence["evidence_kind"] == "detection"
    assert evidence["detection_id"] == detection["id"]
    assert evidence["evidence_type_key"] == "side_door"
    assert evidence["source_type"] == "manual"


# --- 複数BBox条件(PER_CONDITION_GROUP)の結果は複数の根拠をsnapshotする ---


def test_multiple_evidence_results_in_multiple_evidence_snapshot_rows(client, monkeypatch, tmp_path, db_path):
    _setup_single_panel_product(client, monkeypatch, tmp_path)
    vct = _create_manual_detection(client, bbox_x=0.1, bbox_y=0.1)
    ch = _create_manual_detection(client, bbox_x=0.3, bbox_y=0.3)
    _set_evidence_type(db_path, vct["id"], "vct")
    _set_evidence_type(db_path, ch["id"], "ch")

    master_item = _first_master_item(client)
    with get_connection(db_path) as conn:
        create_rule_master(
            conn,
            master_item_id=master_item["id"],
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_CONDITION_GROUP,
            judgment_condition=StandardCondition(required_evidence_types=["vct", "ch"]),
        )

    _evaluate(client)
    res = _confirm(client)
    assert res.status_code == 201
    item = res.json()["items"][0]
    assert item["quantity"] == 1  # 条件成立グループにつき1行
    assert len(item["evidence"]) == 2
    detection_ids = {e["detection_id"] for e in item["evidence"]}
    assert detection_ids == {vct["id"], ch["id"]}


# --- 係数override(current_factor)が確定snapshotへ反映される (指示A-4) ---


def test_factor_override_is_reflected_in_confirmation_and_frozen_afterward(client, monkeypatch, tmp_path, db_path):
    _setup_single_panel_product(client, monkeypatch, tmp_path)
    _create_manual_detection(client)
    evaluated = _evaluate(client)
    result_id = evaluated["results"][0]["id"]

    override_res = client.patch(
        f"/api/products/A1GV2421/estimate-results/{result_id}",
        json={"current_factor": 0.7, "reason": "現地確認", "updated_by": "tester"},
    )
    assert override_res.status_code == 200
    overridden_price = override_res.json()["price"]

    confirmed = _confirm(client).json()
    item = confirmed["items"][0]
    assert item["current_factor"] == 0.7
    assert item["factor_overridden"] is True
    assert item["amount"] == overridden_price

    # 確定後に係数をさらに変更しても、過去snapshotは変化しない。
    client.patch(
        f"/api/products/A1GV2421/estimate-results/{result_id}",
        json={"current_factor": 0.5, "reason": "再確認", "updated_by": "tester"},
    )
    detail = client.get(f"/api/products/A1GV2421/estimate-confirmations/{confirmed['id']}").json()
    assert detail["items"][0]["current_factor"] == 0.7
    assert detail["items"][0]["amount"] == overridden_price


# --- 後方互換: Phase 6-A以前に保存された旧shapeの行が壊れず読み出せる ---


def test_legacy_shaped_confirmation_row_reads_back_with_new_columns_null(client, monkeypatch, tmp_path, db_path):
    """Phase 6-A以前のconfirmation行(新列を一切持たないINSERT)を直接DBへ
    投入し、読み出しAPIが新列をNoneのまま安全に返すことを確認する
    (migration後方互換、`docs/decision-snapshot-design.md`の再現性方針)。"""
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    conn = sqlite3.connect(db_path)
    conn.execute("INSERT INTO estimate_confirmations (product_no) VALUES ('A1GV2421')")
    confirmation_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
    conn.execute(
        """
        INSERT INTO estimate_confirmation_items (
            confirmation_id, detection_id, drawing_page_id,
            target_id, target_type, code, source_type, status,
            quantity, unit_price, amount, bbox_x, bbox_y, bbox_w, bbox_h, page_no
        ) VALUES (?, 999, 1, 'product', 'product', '11001', 'manual', 'reviewed',
                  1, 1000, 1000, 0.1, 0.1, 0.05, 0.05, 16)
        """,
        (confirmation_id,),
    )
    conn.commit()
    conn.close()

    res = client.get(f"/api/products/A1GV2421/estimate-confirmations/{confirmation_id}")
    assert res.status_code == 200
    item = res.json()["items"][0]
    assert item["detection_id"] == 999
    assert item["source_type"] == "manual"
    assert item["current_factor"] is None
    assert item["factor_overridden"] is None
    assert item["judgment_method"] is None
    assert item["applicable_unit"] is None
    assert item["result_status"] is None
    assert item["evidence"] == []
