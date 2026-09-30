"""`app.services.legacy_detection_adapter` のテスト (Issue #40 Phase 5)。

`test_estimate_rule_evaluator.py`と同じ手法(tmp_path配下に製番ディレクトリを
模したダミー構造を用意し、データ参照ルートを差し替える)を使う。
"""
import sqlite3

from app import config
from app.db.connection import get_connection
from app.domain.estimate_rules import (
    ApplicableUnit,
    EstimateResultStatus,
    JudgmentMethod,
    JudgmentScope,
    QuantityMethod,
    StandardCondition,
)
from app.domain.estimate_rules import EvidenceUsage
from app.repositories.drawing_evidence_types import create_evidence_type
from app.repositories.estimate_rule_masters import create_rule_master
from app.services.legacy_detection_adapter import build_legacy_candidates

_PRODUCT_DF_HEADER = (
    "BAN_MENNO,BAN_NO,PAGE,ZUMEI,BAN_MEISYOU,BAN_TYPE,BAN_H1,BAN_H2,BAN_W,BAN_D,"
    "KITEN_X,KITEN_Y,DETECT_AREA_X,DETECT_AREA_Y,FRAME_ORG_X,FRAME_ORG_Y,"
    "FRAME_MINI_X,FRAME_MINI_Y,SCALE_X,SCALE_Y"
)
# 面番号1/盤番号1。x=[0.1,1.0] y=[-1.4,0.9]の広い矩形になり、下記のManual BBox
# (x=0.1〜0.15, y=0.1〜0.15付近)と必ず交差する(既存テストと同じ合成行)。
_PANEL_1_1_ROW = "1,1.0,16,外形図,盤A,正面図,2300,2000,900,2200,100,100,900,2300,15990,11430,100,100,10,10"
# 面番号2/盤番号2。面1/盤1と全く同じ矩形になるよう、同一のKITEN/FRAME値を使う
# (tie判定のテスト用: 同じ場所に2枚の盤矩形を重ねて交差面積を完全同値にする)。
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


def _set_detection_status(db_path, detection_id: int, status: str) -> None:
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE detections SET status = ? WHERE id = ?", (status, detection_id))
    conn.commit()
    conn.close()


def _setup_product_dir(tmp_path, panel_rows=None):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _write_cp932_csv(product / "product_df.csv", _PRODUCT_DF_HEADER, panel_rows or [_PANEL_1_1_ROW])
    _write_cp932_csv(product / "estcode_df.csv", _ESTCODE_DF_HEADER, [_ESTCODE_ROW_1_1])
    return product


def test_reviewed_manual_detection_becomes_drawing_judgment_candidate(client, monkeypatch, tmp_path, db_path):
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)
    detection = _create_manual_detection(client)  # 既定status='reviewed'

    with get_connection(db_path) as conn:
        candidates = build_legacy_candidates(conn, str(tmp_path), "A1GV2421")

    assert len(candidates) == 1
    c = candidates[0]
    assert c.judgment_method == JudgmentMethod.DRAWING_JUDGMENT
    assert c.judgment_scope == JudgmentScope.PANEL
    assert c.target_panel_ban_menno == 1
    assert c.target_panel_ban_no == 1
    assert c.status == EstimateResultStatus.AUTO
    assert c.source_rule_id is None
    assert c.quantity == 1
    assert c.evidence[0].detection_id == detection["id"]
    assert c.result_key == f"{c.code}:legacy:{detection['id']}"


def test_pending_and_needs_review_detections_become_needs_confirmation(client, monkeypatch, tmp_path, db_path):
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)
    pending = _create_manual_detection(client, bbox_x=0.11, bbox_y=0.1)
    needs_review = _create_manual_detection(client, bbox_x=0.12, bbox_y=0.1)
    _set_detection_status(db_path, pending["id"], "pending")
    _set_detection_status(db_path, needs_review["id"], "needs_review")

    with get_connection(db_path) as conn:
        candidates = build_legacy_candidates(conn, str(tmp_path), "A1GV2421")

    by_detection_id = {c.evidence[0].detection_id: c for c in candidates}
    assert by_detection_id[pending["id"]].judgment_method == JudgmentMethod.NEEDS_CONFIRMATION
    assert by_detection_id[needs_review["id"]].judgment_method == JudgmentMethod.NEEDS_CONFIRMATION


def test_excluded_detection_produces_no_candidate(client, monkeypatch, tmp_path, db_path):
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)
    detection = _create_manual_detection(client)
    _set_detection_status(db_path, detection["id"], "excluded")

    with get_connection(db_path) as conn:
        candidates = build_legacy_candidates(conn, str(tmp_path), "A1GV2421")

    assert candidates == []


def test_detection_with_evidence_type_key_is_not_converted(client, monkeypatch, tmp_path, db_path):
    """新方式(evidence_type_key)経由のDetectionは、旧方式互換レイヤの対象外
    (二重計上防止。実運用では起こらない組合せだが念のためガードする)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)
    detection = _create_manual_detection(client)

    conn0 = sqlite3.connect(db_path)
    conn0.execute("UPDATE detections SET evidence_type_key = 'side_door' WHERE id = ?", (detection["id"],))
    conn0.commit()
    conn0.close()

    with get_connection(db_path) as conn:
        candidates = build_legacy_candidates(conn, str(tmp_path), "A1GV2421")

    assert candidates == []


def test_pure_evidence_detection_is_not_converted(client, monkeypatch, tmp_path, db_path):
    """`create_evidence_detection`経由(master_item_id=NULL)のDetectionは、
    そもそも旧方式互換レイヤの対象外(master_item_id is Noneのため)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)
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
    _create_evidence_detection(client, "side_door")

    with get_connection(db_path) as conn:
        candidates = build_legacy_candidates(conn, str(tmp_path), "A1GV2421")

    assert candidates == []


def test_tie_assignment_is_flagged_needs_review_without_a_panel_target(client, monkeypatch, tmp_path, db_path):
    """複数盤の交差面積が同値の場合、`target_panel_*`を設定せず、
    `status=NEEDS_REVIEW`で「要確認」として残す(Phase 5指示13章)。"""
    _setup_product_dir(tmp_path, panel_rows=[_PANEL_1_1_ROW, _PANEL_2_2_ROW])
    _configure_root(client, monkeypatch, tmp_path)
    detection = _create_manual_detection(client)

    with get_connection(db_path) as conn:
        candidates = build_legacy_candidates(conn, str(tmp_path), "A1GV2421")

    assert len(candidates) == 1
    c = candidates[0]
    assert c.status == EstimateResultStatus.NEEDS_REVIEW
    assert c.target_panel_ban_menno is None
    assert c.target_panel_ban_no is None
    assert c.judgment_scope == JudgmentScope.PRODUCT


def test_borrows_applicable_unit_and_initial_factor_from_an_existing_rule_master(
    client, monkeypatch, tmp_path, db_path
):
    """同じmaster_item_idに既にestimate_rule_masters行が存在する場合(Phase 2/3で
    設定済みのコードに、たまたま旧方式のBBoxも付いているケース)、その
    applicable_unit/initial_factorを実データとして借用する(捏造ではなく
    既存の実設定を読むだけ)。"""
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)
    detection = _create_manual_detection(client)
    master_item_id = detection["master_item_id"]

    with get_connection(db_path) as conn:
        create_rule_master(
            conn,
            master_item_id=master_item_id,
            judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
            judgment_scope=JudgmentScope.PANEL,
            quantity_method=QuantityMethod.PER_EVIDENCE,
            judgment_condition=StandardCondition(required_evidence_types=["side_door"]),
            applicable_unit=ApplicableUnit.UNIT,
            initial_factor=0.8,
        )
        candidates = build_legacy_candidates(conn, str(tmp_path), "A1GV2421")

    assert len(candidates) == 1
    assert candidates[0].applicable_unit == ApplicableUnit.UNIT
    assert candidates[0].initial_factor == 0.8


def test_applicable_unit_is_none_when_no_rule_master_configured(client, monkeypatch, tmp_path, db_path):
    _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)
    _create_manual_detection(client)

    with get_connection(db_path) as conn:
        candidates = build_legacy_candidates(conn, str(tmp_path), "A1GV2421")

    assert len(candidates) == 1
    assert candidates[0].applicable_unit is None
    assert candidates[0].initial_factor == 1.0
