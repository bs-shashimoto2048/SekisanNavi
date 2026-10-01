"""`POST/GET/PATCH /api/products/{product_no}/estimate-results*` (Issue #40 Phase 2)
のAPI結合テスト。

repository層自体のテストは`test_estimate_results_repository.py`、evaluator自体の
テストは`test_estimate_rule_evaluator.py`を参照。ここではAPI層(evaluate→list→
手修正→reset)の一連の流れを結合テストする。
"""
import sqlite3

from app import config
from app.db.connection import get_connection
from app.domain.estimate_rules import (
    JudgmentMethod,
    JudgmentScope,
    QuantityMethod,
    StandardCondition,
)
from app.repositories.estimate_rule_masters import create_rule_master

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


def _set_evidence_type(db_path, detection_id: int, key: str) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE detections SET evidence_type_key = ? WHERE id = ?", (key, detection_id))
    conn.commit()
    conn.close()


def _set_detection_status(db_path, detection_id: int, status: str) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE detections SET status = ? WHERE id = ?", (status, detection_id))
    conn.commit()
    conn.close()


def _setup_product_and_rule(client, monkeypatch, tmp_path, db_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _write_cp932_csv(product / "product_df.csv", _PRODUCT_DF_HEADER, [_PANEL_1_1_ROW])
    _write_cp932_csv(product / "estcode_df.csv", _ESTCODE_DF_HEADER, [_ESTCODE_ROW_1_1])
    _configure_root(client, monkeypatch, tmp_path)

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
    return detection, master_item


def test_evaluate_endpoint_creates_results_and_list_endpoint_reads_them_back(
    client, monkeypatch, tmp_path, db_path
):
    _setup_product_and_rule(client, monkeypatch, tmp_path, db_path)

    res = client.post("/api/products/A1GV2421/estimate-results/evaluate")
    assert res.status_code == 200
    body = res.json()
    assert len(body["results"]) == 1
    assert body["skipped_rule_master_ids"] == []
    result = body["results"][0]
    assert result["status"] == "auto"
    assert result["factor_overridden"] is False
    assert len(result["evidence"]) == 1

    listed = client.get("/api/products/A1GV2421/estimate-results")
    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert listed.json()[0]["id"] == result["id"]


def test_factor_override_and_reset_roundtrip(client, monkeypatch, tmp_path, db_path):
    _setup_product_and_rule(client, monkeypatch, tmp_path, db_path)
    evaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    result_id = evaluated["results"][0]["id"]

    override_res = client.patch(
        f"/api/products/A1GV2421/estimate-results/{result_id}",
        json={"current_factor": 0.7, "reason": "現地確認", "updated_by": "tester"},
    )
    assert override_res.status_code == 200
    overridden = override_res.json()
    assert overridden["current_factor"] == 0.7
    assert overridden["factor_overridden"] is True
    assert overridden["factor_override_reason"] == "現地確認"

    # 再評価しても手修正は保持される。
    reevaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    assert reevaluated["results"][0]["current_factor"] == 0.7
    assert reevaluated["results"][0]["factor_overridden"] is True

    reset_res = client.post(f"/api/products/A1GV2421/estimate-results/{result_id}/reset-factor")
    assert reset_res.status_code == 200
    reset_body = reset_res.json()
    assert reset_body["factor_overridden"] is False
    assert reset_body["current_factor"] == reset_body["initial_factor"]


def test_override_unknown_result_returns_404(client, monkeypatch, tmp_path, db_path):
    _setup_product_and_rule(client, monkeypatch, tmp_path, db_path)
    res = client.patch(
        "/api/products/A1GV2421/estimate-results/999999",
        json={"current_factor": 0.5},
    )
    assert res.status_code == 404


def test_deleting_the_only_evidence_removes_the_result_on_reevaluation(
    client, monkeypatch, tmp_path, db_path
):
    """Issue #40 6章: 根拠BBoxの削除で条件不成立になれば結果も削除される。"""
    detection, _ = _setup_product_and_rule(client, monkeypatch, tmp_path, db_path)
    client.post("/api/products/A1GV2421/estimate-results/evaluate")

    del_res = client.delete(f"/api/detections/{detection['id']}")
    assert del_res.status_code == 204

    reevaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    assert reevaluated["results"] == []

    listed = client.get("/api/products/A1GV2421/estimate-results").json()
    assert listed == []


def test_drawing_evidence_types_endpoint_returns_empty_when_none_seeded(client):
    """Issue #40 Phase 2では実データを投入しないため、既定では空配列。"""
    res = client.get("/api/drawing-evidence-types")
    assert res.status_code == 200
    assert res.json() == []


# --- PR #41レビュー指摘対応: 係数override APIのallowed_factors制約 ---


def _setup_product_and_rule_with_allowed_factors(client, monkeypatch, tmp_path, db_path, allowed_factors):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _write_cp932_csv(product / "product_df.csv", _PRODUCT_DF_HEADER, [_PANEL_1_1_ROW])
    _write_cp932_csv(product / "estcode_df.csv", _ESTCODE_DF_HEADER, [_ESTCODE_ROW_1_1])
    _configure_root(client, monkeypatch, tmp_path)

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
            allowed_factors=allowed_factors,
        )
    return detection, master_item


def test_override_with_value_in_allowed_factors_succeeds(client, monkeypatch, tmp_path, db_path):
    _setup_product_and_rule_with_allowed_factors(client, monkeypatch, tmp_path, db_path, [0.5, 0.7, 1.0])
    evaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    result_id = evaluated["results"][0]["id"]

    res = client.patch(
        f"/api/products/A1GV2421/estimate-results/{result_id}",
        json={"current_factor": 0.7},
    )
    assert res.status_code == 200
    assert res.json()["current_factor"] == 0.7
    assert res.json()["factor_overridden"] is True


def test_override_with_value_outside_allowed_factors_is_rejected(client, monkeypatch, tmp_path, db_path):
    _setup_product_and_rule_with_allowed_factors(client, monkeypatch, tmp_path, db_path, [0.5, 0.7, 1.0])
    evaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    result_id = evaluated["results"][0]["id"]

    res = client.patch(
        f"/api/products/A1GV2421/estimate-results/{result_id}",
        json={"current_factor": 0.9},
    )
    assert res.status_code == 422
    assert "0.9" in res.json()["detail"]

    # 拒否された場合、値は変更されずに残る。
    unchanged = client.get("/api/products/A1GV2421/estimate-results").json()[0]
    assert unchanged["current_factor"] == 1.0
    assert unchanged["factor_overridden"] is False


def test_override_succeeds_with_any_value_when_allowed_factors_is_null(client, monkeypatch, tmp_path, db_path):
    """allowed_factors未設定のルールは、現行互換で自由入力を許容する
    (PR #41レビュー指摘の明示要件)。"""
    _setup_product_and_rule_with_allowed_factors(client, monkeypatch, tmp_path, db_path, None)
    evaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    result_id = evaluated["results"][0]["id"]

    res = client.patch(
        f"/api/products/A1GV2421/estimate-results/{result_id}",
        json={"current_factor": 0.37},
    )
    assert res.status_code == 200
    assert res.json()["current_factor"] == 0.37


def test_override_with_allowed_factors_survives_reevaluation(client, monkeypatch, tmp_path, db_path):
    """allowed_factorsが設定されたルールでも、手修正した係数は再評価後も
    保持される(PR #41レビュー指摘の要件5「再評価後も手修正係数保持」)。"""
    _setup_product_and_rule_with_allowed_factors(client, monkeypatch, tmp_path, db_path, [0.5, 0.7, 1.0])
    evaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    result_id = evaluated["results"][0]["id"]

    override_res = client.patch(
        f"/api/products/A1GV2421/estimate-results/{result_id}",
        json={"current_factor": 0.7},
    )
    assert override_res.status_code == 200

    reevaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    assert reevaluated["results"][0]["current_factor"] == 0.7
    assert reevaluated["results"][0]["factor_overridden"] is True

    # 保持されたcurrent_factorに対して、再度候補外の値で上書きしようとすると
    # 引き続き拒否される(再評価後もallowed_factors制約自体は効き続ける)。
    rejected = client.patch(
        f"/api/products/A1GV2421/estimate-results/{result_id}",
        json={"current_factor": 0.42},
    )
    assert rejected.status_code == 422


def test_reset_factor_endpoint_unaffected_by_allowed_factors(client, monkeypatch, tmp_path, db_path):
    """reset-factorの挙動は変更しない(PR #41レビュー指摘の明示要件)。"""
    _setup_product_and_rule_with_allowed_factors(client, monkeypatch, tmp_path, db_path, [0.5, 0.7])
    evaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    result_id = evaluated["results"][0]["id"]

    client.patch(f"/api/products/A1GV2421/estimate-results/{result_id}", json={"current_factor": 0.7})
    res = client.post(f"/api/products/A1GV2421/estimate-results/{result_id}/reset-factor")

    assert res.status_code == 200
    assert res.json()["current_factor"] == res.json()["initial_factor"] == 1.0
    assert res.json()["factor_overridden"] is False


def test_estimate_result_exposes_allowed_factors_from_source_rule(client, monkeypatch, tmp_path, db_path):
    """Issue #40 Phase 4: 係数編集UIが候補値を表示できるよう、
    `source_rule_id`が指すルールの`allowed_factors`をAPI応答へ展開する。"""
    _setup_product_and_rule_with_allowed_factors(client, monkeypatch, tmp_path, db_path, [0.5, 0.7, 1.0])
    evaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    assert evaluated["results"][0]["allowed_factors"] == [0.5, 0.7, 1.0]

    listed = client.get("/api/products/A1GV2421/estimate-results").json()
    assert listed[0]["allowed_factors"] == [0.5, 0.7, 1.0]


def test_estimate_result_allowed_factors_is_null_when_rule_has_no_candidates(client, monkeypatch, tmp_path, db_path):
    _setup_product_and_rule(client, monkeypatch, tmp_path, db_path)
    evaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    assert evaluated["results"][0]["allowed_factors"] is None


def test_list_estimate_results_filters_by_detection_id(client, monkeypatch, tmp_path, db_path):
    """Issue #40 Phase 3: 根拠BBox→関係する積算結果(detection_idでの絞り込み)。

    Issue #40 Phase 5より、`master_item_id`直結の通常Manual BBox
    (`other_detection`)自体も旧方式互換レイヤ経由でEstimateResultを持つように
    なった(`legacy_detection_adapter`)。そのため、この`other_detection`は
    もはや「EstimateResultを一切持たないDetection」の例としては使えない。
    ここでは`status='excluded'`のDetection(旧方式でも積算結果を生成しない、
    唯一「EstimateResultを一切持たない」ケース)を「無関係の対象」として使い、
    絞り込みが引き続き正確であることを確認する。"""
    detection, _ = _setup_product_and_rule(client, monkeypatch, tmp_path, db_path)
    other_detection = _create_manual_detection(client, bbox_x=0.5, bbox_y=0.5)
    excluded_detection = _create_manual_detection(client, bbox_x=0.7, bbox_y=0.7)
    _set_detection_status(db_path, excluded_detection["id"], "excluded")
    client.post("/api/products/A1GV2421/estimate-results/evaluate")

    matches = client.get(
        f"/api/products/A1GV2421/estimate-results?detection_id={detection['id']}"
    ).json()
    assert len(matches) == 1
    assert detection["id"] in [e["detection_id"] for e in matches[0]["evidence"]]

    # 無関係の(通常の)Detectionで絞り込んでも、他方の積算結果は混ざらない
    # (自分自身の旧方式互換結果のみが返る)。
    other_matches = client.get(
        f"/api/products/A1GV2421/estimate-results?detection_id={other_detection['id']}"
    ).json()
    assert len(other_matches) == 1
    assert other_detection["id"] in [e["detection_id"] for e in other_matches[0]["evidence"]]
    assert detection["id"] not in [e["detection_id"] for e in other_matches[0]["evidence"]]

    # status='excluded'のDetectionは旧方式互換レイヤでも積算結果を生成しない
    # (唯一、EstimateResultを一切持たないケース)。
    no_matches = client.get(
        f"/api/products/A1GV2421/estimate-results?detection_id={excluded_detection['id']}"
    ).json()
    assert no_matches == []


# --- Issue #40 Phase 6後半: 数量override API ---


def test_quantity_override_and_reset_roundtrip(client, monkeypatch, tmp_path, db_path):
    _setup_product_and_rule(client, monkeypatch, tmp_path, db_path)
    evaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    result_id = evaluated["results"][0]["id"]

    override_res = client.patch(
        f"/api/products/A1GV2421/estimate-results/{result_id}/quantity",
        json={"current_quantity": 5, "reason": "現地確認", "updated_by": "tester"},
    )
    assert override_res.status_code == 200
    overridden = override_res.json()
    assert overridden["current_quantity"] == 5
    assert overridden["quantity"] == 5
    assert overridden["quantity_overridden"] is True
    assert overridden["quantity_override_reason"] == "現地確認"
    # PR #46レビュー指摘対応: updated_by指定時はそのまま保存され、
    # updated_atも保存される。
    assert overridden["quantity_updated_by"] == "tester"
    assert overridden["quantity_updated_at"] is not None

    # 再評価しても手修正は保持される(updated_at/byも含む、指示3章)。
    reevaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    assert reevaluated["results"][0]["current_quantity"] == 5
    assert reevaluated["results"][0]["quantity_overridden"] is True
    assert reevaluated["results"][0]["quantity_updated_by"] == "tester"
    assert reevaluated["results"][0]["quantity_updated_at"] == overridden["quantity_updated_at"]

    reset_res = client.post(f"/api/products/A1GV2421/estimate-results/{result_id}/reset-quantity")
    assert reset_res.status_code == 200
    reset_body = reset_res.json()
    assert reset_body["quantity_overridden"] is False
    assert reset_body["current_quantity"] == reset_body["initial_quantity"]
    assert reset_body["quantity_override_reason"] is None
    # 指示2章「reset時」: updated_at/byもNULLへ戻す。
    assert reset_body["quantity_updated_at"] is None
    assert reset_body["quantity_updated_by"] is None


def test_quantity_override_allows_explicit_zero(client, monkeypatch, tmp_path, db_path):
    """指示3章: 明示的な0は許可する。"""
    _setup_product_and_rule(client, monkeypatch, tmp_path, db_path)
    evaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    result_id = evaluated["results"][0]["id"]

    res = client.patch(
        f"/api/products/A1GV2421/estimate-results/{result_id}/quantity",
        json={"current_quantity": 0, "reason": "在庫充当"},
    )
    assert res.status_code == 200
    assert res.json()["current_quantity"] == 0
    assert res.json()["quantity_overridden"] is True
    # 要件1「updated_by未指定ならNULL可」(PR #46レビュー指摘対応)。
    assert res.json()["quantity_updated_by"] is None
    assert res.json()["quantity_updated_at"] is not None


def test_quantity_override_rejects_negative_value(client, monkeypatch, tmp_path, db_path):
    _setup_product_and_rule(client, monkeypatch, tmp_path, db_path)
    evaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    result_id = evaluated["results"][0]["id"]

    res = client.patch(
        f"/api/products/A1GV2421/estimate-results/{result_id}/quantity",
        json={"current_quantity": -1, "reason": "test"},
    )
    assert res.status_code == 422


def test_quantity_override_rejects_nan_and_infinity(client, monkeypatch, tmp_path, db_path):
    _setup_product_and_rule(client, monkeypatch, tmp_path, db_path)
    evaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    result_id = evaluated["results"][0]["id"]

    for bad_value in ("NaN", "Infinity", "-Infinity"):
        res = client.patch(
            f"/api/products/A1GV2421/estimate-results/{result_id}/quantity",
            json={"current_quantity": bad_value, "reason": "test"},
        )
        assert res.status_code == 422, bad_value


def test_quantity_override_requires_non_empty_reason(client, monkeypatch, tmp_path, db_path):
    """指示4章: 数量変更時は理由入力を必須とする。"""
    _setup_product_and_rule(client, monkeypatch, tmp_path, db_path)
    evaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    result_id = evaluated["results"][0]["id"]

    res = client.patch(
        f"/api/products/A1GV2421/estimate-results/{result_id}/quantity",
        json={"current_quantity": 5, "reason": ""},
    )
    assert res.status_code == 422


def test_override_unknown_result_quantity_returns_404(client, monkeypatch, tmp_path, db_path):
    _setup_product_and_rule(client, monkeypatch, tmp_path, db_path)
    res = client.patch(
        "/api/products/A1GV2421/estimate-results/999999/quantity",
        json={"current_quantity": 5, "reason": "test"},
    )
    assert res.status_code == 404


def test_quantity_and_factor_overrides_both_survive_independently(client, monkeypatch, tmp_path, db_path):
    """指示7章の前提: 係数・数量それぞれを独立して手修正できる(両方修正も可)。"""
    _setup_product_and_rule(client, monkeypatch, tmp_path, db_path)
    evaluated = client.post("/api/products/A1GV2421/estimate-results/evaluate").json()
    result_id = evaluated["results"][0]["id"]

    client.patch(
        f"/api/products/A1GV2421/estimate-results/{result_id}/quantity",
        json={"current_quantity": 3, "reason": "数量変更"},
    )
    both_res = client.patch(
        f"/api/products/A1GV2421/estimate-results/{result_id}",
        json={"current_factor": 0.5, "reason": "係数変更"},
    )
    assert both_res.status_code == 200
    both = both_res.json()
    assert both["quantity_overridden"] is True
    assert both["factor_overridden"] is True
    assert both["current_quantity"] == 3
    assert both["current_factor"] == 0.5
