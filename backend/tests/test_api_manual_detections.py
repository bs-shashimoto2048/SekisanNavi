"""Manual BBox (Detection) 登録APIのテスト (Phase 1.6)。"""


def _page16_id(client) -> int:
    pages = client.get("/api/drawing-pages").json()
    return next(p["id"] for p in pages if p["page_no"] == 16)


def _first_master_item(client) -> dict:
    items = client.get("/api/master-items").json()
    return items[0]


def test_master_items_include_pricing_columns(client):
    res = client.get("/api/master-items", params={"q": "11001"})
    assert res.status_code == 200
    item = res.json()[0]
    assert item["total_price_a"] == 315300
    assert item["box_parts_price"] == 61600
    assert item["painting_price"] == 89100
    assert item["setup_a"] == 216
    assert item["sheet_metal_price"] == 1096
    assert item["assembly_price"] == 351
    assert item["inspection_price"] == 15


def test_master_items_missing_pricing_stays_null_not_fabricated(client):
    # コード18101 (底板) は元Excelで 設A/板金/組立/検査 が空欄になっている実データ。
    res = client.get("/api/master-items", params={"q": "18101"})
    item = res.json()[0]
    assert item["total_price_a"] == -1500  # 総合価格Aは実在するのでNoneにしない
    assert item["setup_a"] is None
    assert item["sheet_metal_price"] is None
    assert item["assembly_price"] is None
    assert item["inspection_price"] is None


def test_create_manual_detection_success(client):
    page_id = _page16_id(client)
    master_item = _first_master_item(client)

    res = client.post(
        "/api/detections",
        json={
            "drawing_page_id": page_id,
            "master_item_id": master_item["id"],
            "bbox_x": 0.1,
            "bbox_y": 0.2,
            "bbox_w": 0.05,
            "bbox_h": 0.03,
        },
    )
    assert res.status_code == 201
    body = res.json()
    assert body["source_type"] == "manual"
    assert body["master_item_id"] == master_item["id"]
    assert body["drawing_page_id"] == page_id
    assert body["class_name"] == master_item["code"]
    assert body["status"] == "reviewed"
    assert body["confidence"] is None

    # 一覧にも反映されること (AI検出結果を書き換えていないことも確認)
    detections = client.get("/api/detections", params={"drawing_page_id": page_id}).json()
    manual_ones = [d for d in detections if d["source_type"] == "manual"]
    assert len(manual_ones) == 1
    ai_ones = [d for d in detections if d["source_type"] == "ai"]
    assert len(ai_ones) == 4  # Phase 1.5のダミーAI Detection 4件は変化しない


def test_create_manual_detection_rejects_unknown_drawing_page(client):
    master_item = _first_master_item(client)
    res = client.post(
        "/api/detections",
        json={
            "drawing_page_id": 999999,
            "master_item_id": master_item["id"],
            "bbox_x": 0.1,
            "bbox_y": 0.1,
            "bbox_w": 0.05,
            "bbox_h": 0.05,
        },
    )
    assert res.status_code == 404


def test_create_manual_detection_rejects_unknown_master_item(client):
    page_id = _page16_id(client)
    res = client.post(
        "/api/detections",
        json={
            "drawing_page_id": page_id,
            "master_item_id": 999999,
            "bbox_x": 0.1,
            "bbox_y": 0.1,
            "bbox_w": 0.05,
            "bbox_h": 0.05,
        },
    )
    assert res.status_code == 404


def test_create_manual_detection_rejects_out_of_range_bbox(client):
    page_id = _page16_id(client)
    master_item = _first_master_item(client)
    res = client.post(
        "/api/detections",
        json={
            "drawing_page_id": page_id,
            "master_item_id": master_item["id"],
            "bbox_x": 0.9,
            "bbox_y": 0.1,
            "bbox_w": 0.5,  # 0.9 + 0.5 > 1.0
            "bbox_h": 0.05,
        },
    )
    assert res.status_code == 422


def test_create_manual_detection_rejects_degenerate_bbox(client):
    page_id = _page16_id(client)
    master_item = _first_master_item(client)
    res = client.post(
        "/api/detections",
        json={
            "drawing_page_id": page_id,
            "master_item_id": master_item["id"],
            "bbox_x": 0.1,
            "bbox_y": 0.1,
            "bbox_w": 0.0,
            "bbox_h": 0.0,
        },
    )
    assert res.status_code == 422
