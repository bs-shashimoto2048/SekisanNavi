"""`GET /api/products/{product_no}/decision-analysis/*` (Issue #17 Phase C-1) のテスト。

decision_events/estimate_confirmationsの書き込み側自体のテストはそれぞれ
`test_decision_events.py`/`test_estimate_confirmations.py`を参照。ここでは
読み出し専用の3エンドポイント(summary/detections/confirmations、
`repositories/decision_analysis.py`)の挙動のみを確認する。

`test_estimate_confirmation_history_api.py`/`test_decision_event_history_api.py`
と同じ手法(DBの`drawing_pages`は製番`A1GV2421`向けにseedで既に投入済み
(`db/seed.py`の`DEMO_PRODUCT_NO`)のため、そのままproduct_no="A1GV2421"として
APIを呼べる)を使う。
"""
import sqlite3

from app import config


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


def _move_detection(client, detection_id: int, **overrides) -> dict:
    body = {"bbox_x": 0.2, "bbox_y": 0.2, "bbox_w": 0.05, "bbox_h": 0.05, **overrides}
    res = client.patch(f"/api/detections/{detection_id}", json=body)
    assert res.status_code == 200
    return res.json()


def _configure_root(client, monkeypatch, root):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "test-admin-pass")
    res = client.put(
        "/api/settings/data-source",
        json={"root": str(root), "admin_password": "test-admin-pass"},
    )
    assert res.status_code == 200


def _confirm(client, product_no: str) -> dict:
    res = client.post(f"/api/products/{product_no}/estimate-confirmations")
    assert res.status_code == 201
    return res.json()


def _db_snapshot(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    snapshot = {
        "detections": [dict(r) for r in conn.execute("SELECT * FROM detections ORDER BY id")],
        "decision_events": [dict(r) for r in conn.execute("SELECT * FROM decision_events ORDER BY id")],
        "estimate_confirmations": [
            dict(r) for r in conn.execute("SELECT * FROM estimate_confirmations ORDER BY id")
        ],
        "estimate_confirmation_items": [
            dict(r) for r in conn.execute("SELECT * FROM estimate_confirmation_items ORDER BY id")
        ],
    }
    conn.close()
    return snapshot


# --- summary: 0件時も正常 ---


def test_summary_empty_for_product_with_no_events(client):
    res = client.get("/api/products/A1GV2421/decision-analysis/summary")
    assert res.status_code == 200
    body = res.json()
    assert body["product_no"] == "A1GV2421"
    assert body["event_counts"] == {}
    assert body["total_events"] == 0
    assert body["bbox_edit_count_by_page_no"] == {}
    assert body["bbox_edit_count_by_master_item"] == []


def test_summary_for_never_configured_product_also_returns_empty(client):
    res = client.get("/api/products/A1NOTHING/decision-analysis/summary")
    assert res.status_code == 200
    body = res.json()
    assert body["total_events"] == 0


# --- summary: event_type別件数が正しい ---


def test_summary_counts_event_types_correctly(client):
    created = _create_manual_detection(client)
    detection_id = created["id"]
    _move_detection(client, detection_id, bbox_x=0.15, bbox_y=0.15)
    _move_detection(client, detection_id, bbox_x=0.1, bbox_y=0.1)
    assert client.delete(f"/api/detections/{detection_id}").status_code == 204

    res = client.get("/api/products/A1GV2421/decision-analysis/summary")
    assert res.status_code == 200
    body = res.json()
    assert body["event_counts"] == {"create": 1, "bbox_edit": 2, "delete": 1}
    assert body["total_events"] == 4


# --- summary: ページ別・積算コード別のbbox_edit集計 ---


def test_summary_bbox_edit_count_by_page_no_and_master_item(client):
    master_item = _first_master_item(client)
    created = _create_manual_detection(client, master_item_id=master_item["id"])
    _move_detection(client, created["id"], bbox_x=0.2, bbox_y=0.2)

    res = client.get("/api/products/A1GV2421/decision-analysis/summary")
    assert res.status_code == 200
    body = res.json()
    assert body["bbox_edit_count_by_page_no"] == {"16": 1}
    assert len(body["bbox_edit_count_by_master_item"]) == 1
    breakdown = body["bbox_edit_count_by_master_item"][0]
    assert breakdown["master_item_id"] == master_item["id"]
    assert breakdown["current_code"] == master_item["code"]
    assert breakdown["bbox_edit_count"] == 1


# --- detections: 0件時も正常 ---


def test_detections_empty_for_product_with_no_events(client):
    res = client.get("/api/products/A1GV2421/decision-analysis/detections")
    assert res.status_code == 200
    assert res.json() == []


# --- detections: event_count / bbox_edit_countが正しい ---


def test_detections_lists_event_count_and_bbox_edit_count_per_detection(client):
    master_item = _first_master_item(client)
    created = _create_manual_detection(client, master_item_id=master_item["id"])
    detection_id = created["id"]
    _move_detection(client, detection_id, bbox_x=0.15, bbox_y=0.15)
    _move_detection(client, detection_id, bbox_x=0.2, bbox_y=0.2)

    res = client.get("/api/products/A1GV2421/decision-analysis/detections")
    assert res.status_code == 200
    body = res.json()
    row = next(r for r in body if r["detection_id"] == detection_id)
    assert row["event_count"] == 3  # create + 2 bbox_edit
    assert row["bbox_edit_count"] == 2
    assert row["source_type"] == "manual"
    assert row["master_item_id"] == master_item["id"]
    assert row["page_no"] == 16
    assert row["first_event_id"] < row["last_event_id"]


def test_detections_survives_deleted_detection(client):
    """Detectionが削除されても、decision_eventsに記録済みの情報からevent系列を
    引き続き参照できる(FK制約が無い設計のため)。"""
    created = _create_manual_detection(client)
    detection_id = created["id"]
    assert client.delete(f"/api/detections/{detection_id}").status_code == 204

    res = client.get("/api/products/A1GV2421/decision-analysis/detections")
    assert res.status_code == 200
    row = next(r for r in res.json() if r["detection_id"] == detection_id)
    assert row["event_count"] == 2  # create + delete
    assert row["bbox_edit_count"] == 0
    assert row["source_type"] == "manual"


# --- confirmations: 0件時も正常 ---


def test_confirmations_empty_for_product_with_no_confirmations(client, monkeypatch, tmp_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1GV2421/decision-analysis/confirmations")
    assert res.status_code == 200
    assert res.json() == []


def test_confirmations_for_never_configured_product_also_returns_empty(client):
    res = client.get("/api/products/A1NOTHING/decision-analysis/confirmations")
    assert res.status_code == 200
    assert res.json() == []


# --- confirmations: confirmation_idごとの突合が正しい(確定時点以前のみ数える) ---


def test_confirmations_counts_only_events_before_confirmation(client, monkeypatch, tmp_path, db_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    created = _create_manual_detection(client)
    detection_id = created["id"]
    _move_detection(client, detection_id, bbox_x=0.15, bbox_y=0.15)  # 確定前のbbox_edit 1件目

    confirmed = _confirm(client, "A1GV2421")

    # 確定後にもう1回編集する(この分は「確定時点以前」に含まれてはならない)。
    # occurred_at/confirmed_atは秒精度のため、テスト実行速度によっては同一秒に
    # なりうる(既知の制約。モジュールdocstring参照)。カットオフ判定自体を
    # 確定的に検証するため、この直後のイベントのoccurred_atを直接1秒後へ
    # ずらしてから比較する(test_decision_event_history_api.pyの
    # test_list_decision_events_orders_by_id_even_within_the_same_secondと
    # 同じ手法)。
    _move_detection(client, detection_id, bbox_x=0.2, bbox_y=0.2)
    conn = sqlite3.connect(db_path)
    conn.execute(
        "UPDATE decision_events SET occurred_at = '2099-01-01 00:00:00' "
        "WHERE detection_id = ? AND id NOT IN "
        "(SELECT id FROM decision_events WHERE detection_id = ? ORDER BY id LIMIT 2)",
        (detection_id, detection_id),
    )
    conn.commit()
    conn.close()

    res = client.get("/api/products/A1GV2421/decision-analysis/confirmations")
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    conf = body[0]
    assert conf["confirmation_id"] == confirmed["id"]
    assert conf["confirmed_at"] == confirmed["confirmed_at"]
    item = next(i for i in conf["items"] if i["detection_id"] == detection_id)
    # create 1件 + 確定前のbbox_edit 1件 = 2件(確定後のbbox_editは含まない)
    assert item["event_count_before_confirmation"] == 2
    assert item["bbox_edit_count_before_confirmation"] == 1
    assert item["code"] == created["master_item_code"]


def test_confirmations_distinguishes_confirmation_ids_on_reconfirmation(client, monkeypatch, tmp_path, db_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    created = _create_manual_detection(client)
    detection_id = created["id"]

    first = _confirm(client, "A1GV2421")  # create 1件のみ確定前に存在させたい
    _move_detection(client, detection_id, bbox_x=0.2, bbox_y=0.2)
    second = _confirm(client, "A1GV2421")  # create + bbox_edit 1件が確定前に存在させたい

    # occurred_at/confirmed_atは秒精度のため、テスト実行速度によっては
    # create/確定1回目/編集/確定2回目が同一秒になりうる(既知の制約。モジュール
    # docstring参照)。カットオフ判定自体を確定的に検証するため、実際に生じた
    # 順序(create < first確定 < move < second確定)を、直接SQLで明確に離れた
    # 時刻へ割り当て直す(test_decision_event_history_api.pyの
    # test_list_decision_events_orders_by_id_even_within_the_same_secondと
    # 同じ手法)。
    conn = sqlite3.connect(db_path)
    conn.execute(
        "UPDATE decision_events SET occurred_at = '2001-01-01 00:00:00' "
        "WHERE id = (SELECT MIN(id) FROM decision_events WHERE detection_id = ?)",
        (detection_id,),
    )
    conn.execute(
        "UPDATE estimate_confirmations SET confirmed_at = '2001-01-02 00:00:00' WHERE id = ?",
        (first["id"],),
    )
    conn.execute(
        "UPDATE decision_events SET occurred_at = '2001-01-03 00:00:00' "
        "WHERE id = (SELECT MAX(id) FROM decision_events WHERE detection_id = ?)",
        (detection_id,),
    )
    conn.execute(
        "UPDATE estimate_confirmations SET confirmed_at = '2001-01-04 00:00:00' WHERE id = ?",
        (second["id"],),
    )
    conn.commit()
    conn.close()

    res = client.get("/api/products/A1GV2421/decision-analysis/confirmations")
    assert res.status_code == 200
    body = {c["confirmation_id"]: c for c in res.json()}
    assert set(body.keys()) == {first["id"], second["id"]}

    first_item = next(i for i in body[first["id"]]["items"] if i["detection_id"] == detection_id)
    assert first_item["event_count_before_confirmation"] == 1
    assert first_item["bbox_edit_count_before_confirmation"] == 0

    second_item = next(i for i in body[second["id"]]["items"] if i["detection_id"] == detection_id)
    assert second_item["event_count_before_confirmation"] == 2
    assert second_item["bbox_edit_count_before_confirmation"] == 1


# --- confirmations: eventが無いconfirmation itemでも壊れない ---


def test_confirmations_item_with_no_matching_events_returns_zero(client, monkeypatch, tmp_path, db_path):
    """detection_idがdecision_eventsに1件も存在しない明細(仕様上あり得るケース)
    でも、event件数を0として扱いエラーにしない。"""
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    confirmed = _confirm(client, "A1GV2421")  # 積算コードに紐づくDetectionが無いため0件のconfirmation

    # 0件のconfirmationへ、decision_eventsに存在しないdetection_idを持つ明細を
    # 直接SQLで追加する(detection_id=NULLの明細も仕様上あり得るため、あわせて確認)。
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        INSERT INTO estimate_confirmation_items (
            confirmation_id, detection_id, target_id, target_type, code, source_type, status
        ) VALUES
            (?, 999999, 'product', 'product', '99999', 'manual', 'reviewed'),
            (?, NULL,   'product', 'product', '88888', 'manual', 'reviewed')
        """,
        (confirmed["id"], confirmed["id"]),
    )
    conn.commit()
    conn.close()

    res = client.get("/api/products/A1GV2421/decision-analysis/confirmations")
    assert res.status_code == 200
    body = res.json()
    conf = next(c for c in body if c["confirmation_id"] == confirmed["id"])
    assert len(conf["items"]) == 2
    for item in conf["items"]:
        assert item["event_count_before_confirmation"] == 0
        assert item["bbox_edit_count_before_confirmation"] == 0


# --- 製番の分離 ---


def test_all_endpoints_only_include_the_requested_product(client, monkeypatch, tmp_path):
    (tmp_path / "A1GV2421").mkdir()
    (tmp_path / "A1OTHER99").mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    created = _create_manual_detection(client)  # page16 = A1GV2421向け
    detection_id = created["id"]
    _confirm(client, "A1GV2421")

    for path in (
        "/api/products/A1OTHER99/decision-analysis/summary",
        "/api/products/A1OTHER99/decision-analysis/detections",
        "/api/products/A1OTHER99/decision-analysis/confirmations",
    ):
        res = client.get(path)
        assert res.status_code == 200
        body = res.json()
        if isinstance(body, list):
            assert body == []
        else:
            assert body["total_events"] == 0

    detections_res = client.get("/api/products/A1GV2421/decision-analysis/detections")
    assert any(r["detection_id"] == detection_id for r in detections_res.json())


# --- read-only であること ---


def test_analysis_endpoints_do_not_modify_any_data(client, monkeypatch, tmp_path, db_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    created = _create_manual_detection(client)
    _move_detection(client, created["id"], bbox_x=0.2, bbox_y=0.2)
    _confirm(client, "A1GV2421")

    before = _db_snapshot(db_path)

    for path in (
        "/api/products/A1GV2421/decision-analysis/summary",
        "/api/products/A1GV2421/decision-analysis/detections",
        "/api/products/A1GV2421/decision-analysis/confirmations",
    ):
        res = client.get(path)
        assert res.status_code == 200

    after = _db_snapshot(db_path)
    assert before == after
