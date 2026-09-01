"""Detection BBoxリサイズ保存API (Phase 1.7, 要件23/24) のテスト。"""


def _page16_id(client) -> int:
    pages = client.get("/api/drawing-pages").json()
    return next(p["id"] for p in pages if p["page_no"] == 16)


def test_resize_manual_detection(client):
    page_id = _page16_id(client)
    master_item = client.get("/api/master-items").json()[0]
    created = client.post(
        "/api/detections",
        json={
            "drawing_page_id": page_id,
            "master_item_id": master_item["id"],
            "bbox_x": 0.1,
            "bbox_y": 0.1,
            "bbox_w": 0.05,
            "bbox_h": 0.05,
        },
    ).json()

    res = client.patch(
        f"/api/detections/{created['id']}",
        json={"bbox_x": 0.2, "bbox_y": 0.25, "bbox_w": 0.1, "bbox_h": 0.08},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["bbox_x"] == 0.2
    assert body["bbox_y"] == 0.25
    assert body["bbox_w"] == 0.1
    assert body["bbox_h"] == 0.08
    # source_type/master_item_id等、bbox以外は変わらない
    assert body["source_type"] == "manual"
    assert body["master_item_id"] == master_item["id"]


def test_resize_ai_detection_does_not_touch_original_model_or_class(client):
    """AI Detectionもリサイズ対象。class_name/confidence/status等は変わらない。"""
    page_id = _page16_id(client)
    ai_detection = next(
        d for d in client.get("/api/detections", params={"drawing_page_id": page_id}).json()
        if d["source_type"] == "ai"
    )

    res = client.patch(
        f"/api/detections/{ai_detection['id']}",
        json={"bbox_x": 0.05, "bbox_y": 0.05, "bbox_w": 0.2, "bbox_h": 0.2},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["bbox_x"] == 0.05
    assert body["source_type"] == "ai"
    assert body["class_name"] == ai_detection["class_name"]
    assert body["status"] == ai_detection["status"]
    assert body["confidence"] == ai_detection["confidence"]


def test_resize_unknown_detection_returns_404(client):
    res = client.patch(
        "/api/detections/999999",
        json={"bbox_x": 0.1, "bbox_y": 0.1, "bbox_w": 0.1, "bbox_h": 0.1},
    )
    assert res.status_code == 404


def test_resize_rejects_out_of_range_bbox(client):
    page_id = _page16_id(client)
    ai_detection = next(
        d for d in client.get("/api/detections", params={"drawing_page_id": page_id}).json()
        if d["source_type"] == "ai"
    )
    res = client.patch(
        f"/api/detections/{ai_detection['id']}",
        json={"bbox_x": 0.9, "bbox_y": 0.1, "bbox_w": 0.5, "bbox_h": 0.1},
    )
    assert res.status_code == 422


def test_resize_rejects_degenerate_bbox(client):
    page_id = _page16_id(client)
    ai_detection = next(
        d for d in client.get("/api/detections", params={"drawing_page_id": page_id}).json()
        if d["source_type"] == "ai"
    )
    res = client.patch(
        f"/api/detections/{ai_detection['id']}",
        json={"bbox_x": 0.1, "bbox_y": 0.1, "bbox_w": 0.0, "bbox_h": 0.0},
    )
    assert res.status_code == 422


# --- Phase 1.11: 引出線ラベル位置 (leader_label_x/y) + master_item_category ---


def test_manual_detection_exposes_master_item_category_via_join(client):
    """Detectionはmaster_item_idからJOINしたcategoryを返す (色はcategoryから
    Frontend側で解決するため、Detectionへ色そのものを固定値として持たない。要件2)。"""
    page_id = _page16_id(client)
    master_item = next(
        m for m in client.get("/api/master-items").json() if m["category"] is not None
    )
    created = client.post(
        "/api/detections",
        json={
            "drawing_page_id": page_id,
            "master_item_id": master_item["id"],
            "bbox_x": 0.1,
            "bbox_y": 0.1,
            "bbox_w": 0.05,
            "bbox_h": 0.05,
        },
    ).json()
    assert created["master_item_category"] == master_item["category"]
    assert created["master_item_model"] == master_item["model"]
    # Phase 1.11 追加修正: 引出線の「コード」表示はclass_name(登録時点のコピー)より
    # master_item_codeのライブJOIN結果を優先して使う (指示書12章/14章)。
    assert created["master_item_code"] == master_item["code"]
    # 新規作成直後は引出線ラベル位置は未設定 (Frontend側で自動計算する)。
    assert created["leader_label_x"] is None
    assert created["leader_label_y"] is None


def test_ai_detection_without_master_item_has_no_category(client):
    page_id = _page16_id(client)
    ai_detection = next(
        d for d in client.get("/api/detections", params={"drawing_page_id": page_id}).json()
        if d["source_type"] == "ai"
    )
    assert ai_detection["master_item_id"] is None
    assert ai_detection["master_item_category"] is None
    assert ai_detection["master_item_code"] is None


def test_updating_leader_label_position_does_not_change_bbox(client):
    page_id = _page16_id(client)
    master_item = client.get("/api/master-items").json()[0]
    created = client.post(
        "/api/detections",
        json={
            "drawing_page_id": page_id,
            "master_item_id": master_item["id"],
            "bbox_x": 0.1,
            "bbox_y": 0.1,
            "bbox_w": 0.05,
            "bbox_h": 0.05,
        },
    ).json()

    res = client.patch(
        f"/api/detections/{created['id']}",
        json={
            "bbox_x": created["bbox_x"],
            "bbox_y": created["bbox_y"],
            "bbox_w": created["bbox_w"],
            "bbox_h": created["bbox_h"],
            "leader_label_x": 0.4,
            "leader_label_y": 0.05,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["leader_label_x"] == 0.4
    assert body["leader_label_y"] == 0.05
    # BBox本体(アンカーの計算元)は変化しない (指示書10章: BBox位置≠ラベル位置)。
    assert body["bbox_x"] == created["bbox_x"]
    assert body["bbox_y"] == created["bbox_y"]
    assert body["bbox_w"] == created["bbox_w"]
    assert body["bbox_h"] == created["bbox_h"]


def test_resizing_bbox_without_leader_label_fields_keeps_existing_label_position(client):
    """Move/Resize時にleader_label_x/yを省略した場合、既存のラベル位置を保持する
    (指示書11章: BBoxをmove/resizeしても、ユーザーが設定したラベル位置自体は
    勝手にリセットされない。矢印先端の追従自体はFrontend側でBBox右上角から
    都度再計算する)。"""
    page_id = _page16_id(client)
    master_item = client.get("/api/master-items").json()[0]
    created = client.post(
        "/api/detections",
        json={
            "drawing_page_id": page_id,
            "master_item_id": master_item["id"],
            "bbox_x": 0.1,
            "bbox_y": 0.1,
            "bbox_w": 0.05,
            "bbox_h": 0.05,
        },
    ).json()
    client.patch(
        f"/api/detections/{created['id']}",
        json={
            "bbox_x": 0.1,
            "bbox_y": 0.1,
            "bbox_w": 0.05,
            "bbox_h": 0.05,
            "leader_label_x": 0.4,
            "leader_label_y": 0.05,
        },
    )

    res = client.patch(
        f"/api/detections/{created['id']}",
        json={"bbox_x": 0.3, "bbox_y": 0.3, "bbox_w": 0.05, "bbox_h": 0.05},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["bbox_x"] == 0.3
    assert body["leader_label_x"] == 0.4
    assert body["leader_label_y"] == 0.05
