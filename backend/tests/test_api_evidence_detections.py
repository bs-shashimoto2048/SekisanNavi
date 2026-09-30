"""`POST /api/detections/by-evidence-type` (Issue #40 Phase 3) のAPIテスト。

既存の`POST /api/detections`(master_item_id経由)は`test_api_manual_detections.py`
で回帰確認済み。ここでは「図面情報(evidence_type_key)付きBBox作成」という
新しい経路のみを対象にする。
"""
from app.db.connection import get_connection
from app.domain.estimate_rules import EvidenceUsage, JudgmentScope
from app.repositories.drawing_evidence_types import create_evidence_type


def _page16_id(client) -> int:
    pages = client.get("/api/drawing-pages").json()
    return next(p["id"] for p in pages if p["page_no"] == 16)


def _seed_evidence_type(db_path, key: str = "vct") -> None:
    with get_connection(db_path) as conn:
        create_evidence_type(
            conn,
            key=key,
            display_name="VCT",
            category=None,
            usage=EvidenceUsage.BOTH,
            default_judgment_scope=JudgmentScope.PANEL,
            description="真空遮断器(テスト用)",
        )


def test_create_detection_by_evidence_type_success(client, db_path):
    _seed_evidence_type(db_path, "vct")
    page_id = _page16_id(client)

    res = client.post(
        "/api/detections/by-evidence-type",
        json={
            "drawing_page_id": page_id,
            "evidence_type_key": "vct",
            "bbox_x": 0.1,
            "bbox_y": 0.2,
            "bbox_w": 0.05,
            "bbox_h": 0.03,
        },
    )

    assert res.status_code == 201
    body = res.json()
    assert body["source_type"] == "manual"
    assert body["status"] == "reviewed"
    assert body["master_item_id"] is None
    assert body["evidence_type_key"] == "vct"
    assert body["class_name"] == "vct"
    assert body["confidence"] is None


def test_create_detection_by_evidence_type_persists_and_is_listed(client, db_path):
    _seed_evidence_type(db_path, "ch")
    page_id = _page16_id(client)

    created = client.post(
        "/api/detections/by-evidence-type",
        json={
            "drawing_page_id": page_id,
            "evidence_type_key": "ch",
            "bbox_x": 0.3,
            "bbox_y": 0.3,
            "bbox_w": 0.02,
            "bbox_h": 0.02,
        },
    ).json()

    listed = client.get(f"/api/detections?drawing_page_id={page_id}").json()
    match = next(d for d in listed if d["id"] == created["id"])
    assert match["evidence_type_key"] == "ch"
    assert match["master_item_id"] is None


def test_create_detection_by_evidence_type_records_decision_event(client, db_path):
    """既存のMaster BBoxと同じく、decision_eventsへcreateイベントが記録される
    (Issue #4 Phase A-1の既存event logging方針をevidence_type_key経由の
    作成にも適用する)。"""
    _seed_evidence_type(db_path, "vct")
    page_id = _page16_id(client)

    created = client.post(
        "/api/detections/by-evidence-type",
        json={
            "drawing_page_id": page_id,
            "evidence_type_key": "vct",
            "bbox_x": 0.1,
            "bbox_y": 0.1,
            "bbox_w": 0.05,
            "bbox_h": 0.05,
        },
    ).json()

    events_res = client.get("/api/products/A1GV2421/decision-events")
    assert events_res.status_code == 200
    matching = [e for e in events_res.json() if e["detection_id"] == created["id"]]
    assert len(matching) == 1
    assert matching[0]["event_type"] == "create"
    assert matching[0]["master_item_id"] is None


def test_create_detection_by_evidence_type_unknown_page_returns_404(client, db_path):
    _seed_evidence_type(db_path, "vct")
    res = client.post(
        "/api/detections/by-evidence-type",
        json={
            "drawing_page_id": 999999,
            "evidence_type_key": "vct",
            "bbox_x": 0.1,
            "bbox_y": 0.1,
            "bbox_w": 0.05,
            "bbox_h": 0.05,
        },
    )
    assert res.status_code == 404


def test_create_detection_by_evidence_type_unknown_evidence_type_returns_404(client, db_path):
    page_id = _page16_id(client)
    res = client.post(
        "/api/detections/by-evidence-type",
        json={
            "drawing_page_id": page_id,
            "evidence_type_key": "does_not_exist",
            "bbox_x": 0.1,
            "bbox_y": 0.1,
            "bbox_w": 0.05,
            "bbox_h": 0.05,
        },
    )
    assert res.status_code == 404


def test_create_detection_by_evidence_type_rejects_out_of_range_bbox(client, db_path):
    """既存のManual BBoxと同じBBox範囲バリデーション(`_NormalizedBBoxIn`)が
    このエンドポイントにも適用されることを確認する(共通基底クラスの再利用)。"""
    _seed_evidence_type(db_path, "vct")
    page_id = _page16_id(client)
    res = client.post(
        "/api/detections/by-evidence-type",
        json={
            "drawing_page_id": page_id,
            "evidence_type_key": "vct",
            "bbox_x": 0.9,
            "bbox_y": 0.1,
            "bbox_w": 0.5,  # 0.9+0.5 > 1.0
            "bbox_h": 0.05,
        },
    )
    assert res.status_code == 422


def test_existing_manual_detection_endpoint_is_unaffected(client):
    """既存のmaster_item_id経由の作成は無変更のまま動作する(回帰確認)。"""
    page_id = _page16_id(client)
    master_item = client.get("/api/master-items").json()[0]

    res = client.post(
        "/api/detections",
        json={
            "drawing_page_id": page_id,
            "master_item_id": master_item["id"],
            "bbox_x": 0.1,
            "bbox_y": 0.1,
            "bbox_w": 0.05,
            "bbox_h": 0.05,
        },
    )
    assert res.status_code == 201
    body = res.json()
    assert body["master_item_id"] == master_item["id"]
    assert body["evidence_type_key"] is None
