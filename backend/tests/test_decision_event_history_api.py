"""`GET /api/products/{product_no}/decision-events` (Issue #4 Phase A-2) のテスト。

書き込み側(`record_event()`)自体のテストは`test_decision_events.py`を参照。
ここでは読み出し専用の1エンドポイント(`list_events_for_product`)の挙動のみを
確認する。

`test_estimate_confirmation_history_api.py`と同じ手法(DBの`drawing_pages`は
製番`A1GV2421`向けにseedで既に投入済み(`db/seed.py`の`DEMO_PRODUCT_NO`)のため、
そのままproduct_no="A1GV2421"としてAPIを呼べる)を使う。
"""
import sqlite3


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


# --- 履歴0件 ---


def test_list_decision_events_empty_for_product_with_no_events(client, db_path):
    """既存のManual BBox(seed済み15件)には触れず、それとは無関係な確認のため、
    このテスト自身は新たなDetectionを作成しない。ただし製番A1GV2421には
    既存のseed起因のイベントは無い(seedはdetectionsを直接INSERTし、
    decision_eventsへは記録しない)ため、0件になることを確認する。"""
    res = client.get("/api/products/A1GV2421/decision-events")
    assert res.status_code == 200
    assert res.json() == []


def test_list_decision_events_for_never_configured_product_also_returns_empty(client):
    res = client.get("/api/products/A1NOTHING/decision-events")
    assert res.status_code == 200
    assert res.json() == []


# --- create / delete / bbox_edit混在、発生順(古い順)で返る ---


def test_list_decision_events_returns_create_bbox_edit_delete_in_chronological_order(client):
    created = _create_manual_detection(client)
    detection_id = created["id"]

    patch_res = client.patch(
        f"/api/detections/{detection_id}",
        json={"bbox_x": 0.2, "bbox_y": 0.2, "bbox_w": 0.05, "bbox_h": 0.05},
    )
    assert patch_res.status_code == 200

    del_res = client.delete(f"/api/detections/{detection_id}")
    assert del_res.status_code == 204

    res = client.get("/api/products/A1GV2421/decision-events")
    assert res.status_code == 200
    events = [e for e in res.json() if e["detection_id"] == detection_id]
    assert [e["event_type"] for e in events] == ["create", "bbox_edit", "delete"]
    # idが発生順に単調増加していること(occurred_atの秒精度に依存しない順序保証)
    ids = [e["id"] for e in events]
    assert ids == sorted(ids)


# --- occurred_at / id の順序保証 ---


def test_list_decision_events_orders_by_id_even_within_the_same_second(client, db_path, monkeypatch):
    """occurred_at(秒精度)が同一でも、idの昇順(=発生順)で返ることを確認する。"""
    created = _create_manual_detection(client)
    detection_id = created["id"]
    for _ in range(3):
        res = client.patch(
            f"/api/detections/{detection_id}",
            json={"bbox_x": 0.15, "bbox_y": 0.15, "bbox_w": 0.05, "bbox_h": 0.05},
        )
        assert res.status_code == 200
        res = client.patch(
            f"/api/detections/{detection_id}",
            json={"bbox_x": 0.1, "bbox_y": 0.1, "bbox_w": 0.05, "bbox_h": 0.05},
        )
        assert res.status_code == 200

    # occurred_atを全て同一の値へ直接書き換え、id順で正しくソートされるかを検証する
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE decision_events SET occurred_at = '2026-01-01 00:00:00' WHERE detection_id = ?", (detection_id,))
    conn.commit()
    conn.close()

    res = client.get("/api/products/A1GV2421/decision-events")
    assert res.status_code == 200
    ids = [e["id"] for e in res.json() if e["detection_id"] == detection_id]
    assert ids == sorted(ids)
    assert len(ids) == 7  # create 1 + bbox_edit 6


# --- 削除済みDetectionのeventも取得可能 ---


def test_list_decision_events_includes_events_for_a_deleted_detection(client):
    created = _create_manual_detection(client)
    detection_id = created["id"]
    assert client.delete(f"/api/detections/{detection_id}").status_code == 204

    res = client.get("/api/products/A1GV2421/decision-events")
    assert res.status_code == 200
    events = [e for e in res.json() if e["detection_id"] == detection_id]
    assert [e["event_type"] for e in events] == ["create", "delete"]
    # 削除済みでも情報源・図面ページ・積算コードIDはevent側の非正規化コピーで読める
    assert events[0]["source_type"] == "manual"
    assert events[0]["page_no"] == 16
    assert events[0]["master_item_id"] == created["master_item_id"]


# --- BBox編集のbefore/afterがそのまま返る ---


def test_list_decision_events_bbox_edit_shows_before_and_after(client):
    created = _create_manual_detection(client, bbox_x=0.1, bbox_y=0.1, bbox_w=0.05, bbox_h=0.05)
    detection_id = created["id"]
    res = client.patch(
        f"/api/detections/{detection_id}",
        json={"bbox_x": 0.3, "bbox_y": 0.3, "bbox_w": 0.06, "bbox_h": 0.06},
    )
    assert res.status_code == 200

    events = client.get("/api/products/A1GV2421/decision-events").json()
    edit_event = next(e for e in events if e["detection_id"] == detection_id and e["event_type"] == "bbox_edit")
    assert edit_event["before_bbox_x"] == 0.1
    assert edit_event["before_bbox_y"] == 0.1
    assert edit_event["before_bbox_w"] == 0.05
    assert edit_event["before_bbox_h"] == 0.05
    assert edit_event["after_bbox_x"] == 0.3
    assert edit_event["after_bbox_y"] == 0.3
    assert edit_event["after_bbox_w"] == 0.06
    assert edit_event["after_bbox_h"] == 0.06


# --- 製番の分離 ---


def test_list_decision_events_only_includes_events_for_the_requested_product(client, monkeypatch, tmp_path):
    """A1GV2421向けに作成したeventは、別製番からは見えないこと。"""
    from app import config

    monkeypatch.setattr(config, "ADMIN_PASSWORD", "test-admin-pass")
    other_product = tmp_path / "A1OTHER99"
    other_product.mkdir()
    res = client.put(
        "/api/settings/data-source",
        json={"root": str(tmp_path), "admin_password": "test-admin-pass"},
    )
    assert res.status_code == 200

    created = _create_manual_detection(client)  # page16 = A1GV2421向け

    events_for_a1gv2421 = client.get("/api/products/A1GV2421/decision-events").json()
    assert any(e["detection_id"] == created["id"] for e in events_for_a1gv2421)

    events_for_other = client.get("/api/products/A1OTHER99/decision-events").json()
    assert all(e["detection_id"] != created["id"] for e in events_for_other)
    assert events_for_other == []


# --- DB読み出しのみであること(append-only方針を壊さない) ---


def test_list_decision_events_does_not_modify_stored_rows(client, db_path):
    created = _create_manual_detection(client)

    def _snapshot():
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        rows = [dict(r) for r in conn.execute("SELECT * FROM decision_events ORDER BY id").fetchall()]
        conn.close()
        return rows

    before = _snapshot()
    res = client.get("/api/products/A1GV2421/decision-events")
    assert res.status_code == 200
    after = _snapshot()
    assert before == after
    assert len(after) >= 1
