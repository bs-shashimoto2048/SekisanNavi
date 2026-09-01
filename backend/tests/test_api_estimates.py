def test_list_estimate_items_with_references(client):
    res = client.get("/api/estimate-items")
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 3

    box_item = next(i for i in items if i["code"] == "11001")
    assert box_item["category"] == "箱・単独"
    assert len(box_item["references"]) == 2
    assert box_item["source_type"] == "program"


def test_estimate_item_reference_links_to_detection(client):
    """積算結果→根拠図面→BBox の連動に必要な detection_id が張られていること。"""
    res = client.get("/api/estimate-items")
    items = res.json()
    fan_item = next(i for i in items if i["code"] == "18311")
    refs_with_detection = [r for r in fan_item["references"] if r["detection_id"] is not None]
    assert len(refs_with_detection) == 1


def test_master_items_search_by_code(client):
    res = client.get("/api/master-items", params={"q": "18311"})
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 1
    assert items[0]["category"] == "附属品加算価格"
    assert items[0]["model"] == "換気扇"
    assert items[0]["rating"] == "上部取付"


def test_panel_attributes_are_returned(client):
    panels = client.get("/api/panels").json()
    assert len(panels) == 1
    attrs = {a["key"]: a["value"] for a in panels[0]["attributes"]}
    assert attrs["W"] == "900"
    assert attrs["BAN_NO"] == "1"
    assert attrs["PRODUCT_NO"] == "A1GV2421"


def test_project_info(client):
    res = client.get("/api/project")
    assert res.status_code == 200
    body = res.json()
    assert body["analysis_status"] == "needs_review"
