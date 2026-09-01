"""Detection削除API (Phase 1.7, 要件12-15) のテスト。"""


def _page16_id(client) -> int:
    pages = client.get("/api/drawing-pages").json()
    return next(p["id"] for p in pages if p["page_no"] == 16)


def _create_manual_detection(client) -> dict:
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
    return res.json()


def test_delete_manual_detection(client):
    created = _create_manual_detection(client)

    res = client.delete(f"/api/detections/{created['id']}")
    assert res.status_code == 204

    remaining = client.get("/api/detections", params={"drawing_page_id": created["drawing_page_id"]}).json()
    assert all(d["id"] != created["id"] for d in remaining)


def test_delete_ai_detection(client):
    """AI Detectionもsource_typeによる制限なく削除できること (要件8/13)。"""
    page_id = _page16_id(client)
    detections = client.get("/api/detections", params={"drawing_page_id": page_id}).json()
    ai_detection = next(d for d in detections if d["source_type"] == "ai")

    res = client.delete(f"/api/detections/{ai_detection['id']}")
    assert res.status_code == 204

    remaining = client.get("/api/detections", params={"drawing_page_id": page_id}).json()
    assert all(d["id"] != ai_detection["id"] for d in remaining)


def test_delete_unknown_detection_returns_404(client):
    res = client.delete("/api/detections/999999")
    assert res.status_code == 404


def test_delete_detection_referenced_by_estimate_reference_clears_reference_not_the_item(client):
    """指示書15章: 参照解除のみ行い、EstimateItem/EstimateReference行自体は残す。"""
    items_before = client.get("/api/estimate-items").json()
    fan_item = next(i for i in items_before if i["code"] == "18311")
    ref = next(r for r in fan_item["references"] if r["detection_id"] is not None)
    detection_id = ref["detection_id"]

    res = client.delete(f"/api/detections/{detection_id}")
    assert res.status_code == 204

    items_after = client.get("/api/estimate-items").json()
    fan_item_after = next(i for i in items_after if i["code"] == "18311")
    # EstimateItem自体・EstimateReference行自体は削除されていない
    assert fan_item_after["id"] == fan_item["id"]
    matching_ref = next(r for r in fan_item_after["references"] if r["id"] == ref["id"])
    # ただしdetection_idはNULLへ解除され、存在しないDetectionへのリンクは残らない
    assert matching_ref["detection_id"] is None
