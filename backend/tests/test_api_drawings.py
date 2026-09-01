def test_list_drawing_pages_grouped_by_type(client):
    res = client.get("/api/drawing-pages")
    assert res.status_code == 200
    pages = res.json()
    assert len(pages) == 11
    types = {p["drawing_type"] for p in pages}
    assert types == {"外形図", "基礎図", "内部機器配置図"}


def test_drawing_pages_reference_real_product_file(client):
    res = client.get("/api/drawing-pages")
    pages = res.json()
    page16 = next(p for p in pages if p["page_no"] == 16 and p["drawing_type"] == "外形図")
    assert page16["source_type"] == "product_file"
    assert page16["product_no"] == "A1GV2421"
    assert page16["source_page_no"] == 16


def test_get_drawing_page_detail(client):
    res = client.get("/api/drawing-pages")
    first_id = res.json()[0]["id"]

    detail = client.get(f"/api/drawing-pages/{first_id}")
    assert detail.status_code == 200
    assert detail.json()["id"] == first_id


def test_get_drawing_page_not_found(client):
    res = client.get("/api/drawing-pages/99999")
    assert res.status_code == 404


def test_detections_filtered_by_page(client):
    pages = client.get("/api/drawing-pages").json()
    page16 = next(p for p in pages if p["drawing_name"] == "外形図")

    res = client.get("/api/detections", params={"drawing_page_id": page16["id"]})
    assert res.status_code == 200
    detections = res.json()
    assert len(detections) == 4
    class_names = {d["class_name"] for d in detections}
    assert class_names == {"sidedoor_l", "roof_fan", "roof_fan_r"}


def test_detection_bbox_is_normalized_0_to_1(client):
    """Overlay座標系 (Phase 1.5): bbox は 0.0〜1.0 の正規化座標であること。"""
    res = client.get("/api/detections")
    detections = res.json()
    assert len(detections) > 0
    for d in detections:
        assert 0.0 <= d["bbox_x"] <= 1.0
        assert 0.0 <= d["bbox_y"] <= 1.0
        assert 0.0 <= d["bbox_w"] <= 1.0
        assert 0.0 <= d["bbox_h"] <= 1.0


def test_detection_statuses_cover_required_visual_states(client):
    res = client.get("/api/detections")
    statuses = {d["status"] for d in res.json()}
    # 通常(pending) / 確認済み(reviewed) / 要確認(needs_review) / 除外(excluded)
    assert {"pending", "reviewed", "needs_review", "excluded"}.issubset(statuses)


def test_panel_areas_for_page_are_independent_of_detections(client):
    pages = client.get("/api/drawing-pages").json()
    page16 = next(p for p in pages if p["drawing_name"] == "外形図")

    res = client.get("/api/panel-areas", params={"drawing_page_id": page16["id"]})
    assert res.status_code == 200
    areas = res.json()
    assert len(areas) == 3
    labels = {a["label"] for a in areas}
    assert labels == {"背面図", "正面図", "右側面図"}
    for a in areas:
        assert 0.0 <= a["area_x"] <= 1.0
        assert 0.0 <= a["area_y"] <= 1.0


def test_drawing_page_file_not_found_for_placeholder_source(client, db_path):
    """source_type='product_file' 以外 (placeholder) は実ファイルを持たない。"""
    import sqlite3

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    (page_id,) = conn.execute(
        """
        INSERT INTO drawing_pages
            (drawing_file_id, page_no, drawing_type, drawing_name, page_width, page_height,
             display_order, source_type)
        VALUES (1, 999, 'テスト', 'プレースホルダーページ', 100, 100, 0, 'placeholder')
        RETURNING id
        """
    ).fetchone()
    conn.commit()
    conn.close()

    res = client.get(f"/api/drawing-pages/{page_id}/file")
    assert res.status_code == 404
