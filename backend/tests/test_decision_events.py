"""判断・修正データの最小event記録 (Issue #4 Phase A-1) のテスト。

設計は `docs/decision-event-design.md` を参照。Phase A-1では読み出しAPIを
追加しないため、記録内容の検証は`decision_events`テーブルへの直接SQLで行う
(既存の`test_master_importer.py`と同じ、db_path fixtureを使う手法)。
"""
import sqlite3

import pytest

from app.db.connection import get_connection
from app.db.migrate import run_migrations
from app.db.seed import seed


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


def _events_for(db_path, detection_id: int) -> list[sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM decision_events WHERE detection_id = ? ORDER BY id", (detection_id,)
    ).fetchall()
    conn.close()
    return rows


def _all_events(db_path) -> list[sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM decision_events ORDER BY id").fetchall()
    conn.close()
    return rows


# --- create event ---


def test_create_manual_detection_records_a_create_event(client, db_path):
    created = _create_manual_detection(client)

    events = _events_for(db_path, created["id"])
    assert len(events) == 1
    event = events[0]
    assert event["event_type"] == "create"
    assert event["detection_id"] == created["id"]
    assert event["drawing_page_id"] == created["drawing_page_id"]
    assert event["source_type"] == "manual"
    assert event["master_item_id"] == created["master_item_id"]
    # createなので変更前は無い
    assert event["before_bbox_x"] is None
    assert event["before_bbox_y"] is None
    assert event["before_bbox_w"] is None
    assert event["before_bbox_h"] is None
    # 変更後は作成時のbboxそのもの
    assert event["after_bbox_x"] == created["bbox_x"]
    assert event["after_bbox_y"] == created["bbox_y"]
    assert event["after_bbox_w"] == created["bbox_w"]
    assert event["after_bbox_h"] == created["bbox_h"]
    # occurred_atは何らかの値が自動で入ること(created_at列が無いdetections側の
    # 代わりに、このイベントが事実上のcreated_atとして機能する。設計11章)。
    assert event["occurred_at"]


# --- delete event ---


def test_delete_manual_detection_records_a_delete_event_that_survives_the_deletion(client, db_path):
    created = _create_manual_detection(client)

    res = client.delete(f"/api/detections/{created['id']}")
    assert res.status_code == 204

    # Detection本体は消えている
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    remaining = conn.execute("SELECT * FROM detections WHERE id = ?", (created["id"],)).fetchone()
    conn.close()
    assert remaining is None

    # decision_eventsは delete イベントを含めて残っている(FK制約が無いため
    # 本体削除後も参照が壊れない。docs/decision-event-design.md 6章)。
    events = _events_for(db_path, created["id"])
    assert [e["event_type"] for e in events] == ["create", "delete"]
    delete_event = events[1]
    assert delete_event["drawing_page_id"] == created["drawing_page_id"]
    assert delete_event["source_type"] == "manual"
    assert delete_event["master_item_id"] == created["master_item_id"]
    # deleteの「変更前」は削除直前のbbox
    assert delete_event["before_bbox_x"] == created["bbox_x"]
    assert delete_event["before_bbox_y"] == created["bbox_y"]
    assert delete_event["before_bbox_w"] == created["bbox_w"]
    assert delete_event["before_bbox_h"] == created["bbox_h"]
    # deleteなので変更後は無い
    assert delete_event["after_bbox_x"] is None
    assert delete_event["after_bbox_y"] is None
    assert delete_event["after_bbox_w"] is None
    assert delete_event["after_bbox_h"] is None


def test_deleting_ai_detection_records_source_type_ai_on_the_delete_event(client, db_path):
    """AI Detection(source_type='ai')を削除した場合、eventにもai由来である
    ことが残る(source_typeは不変のため、事後もその区別が付く)。"""
    page_id = _page16_id(client)
    ai_detection = next(
        d for d in client.get("/api/detections", params={"drawing_page_id": page_id}).json()
        if d["source_type"] == "ai"
    )

    res = client.delete(f"/api/detections/{ai_detection['id']}")
    assert res.status_code == 204

    events = _events_for(db_path, ai_detection["id"])
    # このAI Detectionはseedデータのため作成イベントは無く、delete のみ記録される
    assert [e["event_type"] for e in events] == ["delete"]
    assert events[0]["source_type"] == "ai"
    assert events[0]["master_item_id"] is None


def test_deleting_unknown_detection_records_no_event(client, db_path):
    before_count = len(_all_events(db_path))
    res = client.delete("/api/detections/999999")
    assert res.status_code == 404
    assert len(_all_events(db_path)) == before_count


# --- bbox_edit event (move/resize) ---


def test_bbox_move_records_a_bbox_edit_event_with_before_and_after(client, db_path):
    created = _create_manual_detection(client)

    res = client.patch(
        f"/api/detections/{created['id']}",
        json={"bbox_x": 0.2, "bbox_y": 0.25, "bbox_w": 0.05, "bbox_h": 0.05},
    )
    assert res.status_code == 200

    events = _events_for(db_path, created["id"])
    assert [e["event_type"] for e in events] == ["create", "bbox_edit"]
    edit_event = events[1]
    assert edit_event["before_bbox_x"] == created["bbox_x"]
    assert edit_event["before_bbox_y"] == created["bbox_y"]
    assert edit_event["before_bbox_w"] == created["bbox_w"]
    assert edit_event["before_bbox_h"] == created["bbox_h"]
    assert edit_event["after_bbox_x"] == 0.2
    assert edit_event["after_bbox_y"] == 0.25
    assert edit_event["after_bbox_w"] == 0.05
    assert edit_event["after_bbox_h"] == 0.05


def test_bbox_resize_records_a_bbox_edit_event_indistinguishable_by_type_from_move(client, db_path):
    """move/resizeは記録時に区別せず同じ'bbox_edit'として記録する
    (設計4.1章)。w/hが変化していることから、後で分析時にresizeと判別できる。"""
    created = _create_manual_detection(client)

    client.patch(
        f"/api/detections/{created['id']}",
        json={"bbox_x": created["bbox_x"], "bbox_y": created["bbox_y"], "bbox_w": 0.2, "bbox_h": 0.3},
    )

    events = _events_for(db_path, created["id"])
    edit_event = events[-1]
    assert edit_event["event_type"] == "bbox_edit"
    assert edit_event["before_bbox_w"] == created["bbox_w"]
    assert edit_event["after_bbox_w"] == 0.2
    assert edit_event["before_bbox_h"] == created["bbox_h"]
    assert edit_event["after_bbox_h"] == 0.3


def test_multiple_bbox_edits_chain_before_after_sequentially(client, db_path):
    created = _create_manual_detection(client)

    client.patch(
        f"/api/detections/{created['id']}",
        json={"bbox_x": 0.2, "bbox_y": 0.2, "bbox_w": 0.05, "bbox_h": 0.05},
    )
    client.patch(
        f"/api/detections/{created['id']}",
        json={"bbox_x": 0.3, "bbox_y": 0.3, "bbox_w": 0.05, "bbox_h": 0.05},
    )

    events = _events_for(db_path, created["id"])
    assert [e["event_type"] for e in events] == ["create", "bbox_edit", "bbox_edit"]
    first_edit, second_edit = events[1], events[2]
    assert first_edit["before_bbox_x"] == created["bbox_x"]
    assert first_edit["after_bbox_x"] == 0.2
    # 2回目の「変更前」は1回目の「変更後」と一致する(連続した時系列)
    assert second_edit["before_bbox_x"] == first_edit["after_bbox_x"]
    assert second_edit["after_bbox_x"] == 0.3


def test_leader_label_only_update_does_not_record_a_spurious_bbox_edit_event(client, db_path):
    """bbox_x/y/w/hが更新前と同一のまま(leader_label_x/yのみ変更)の場合、
    before==afterの無意味なbbox_editイベントは記録しない(設計4.4章)。"""
    created = _create_manual_detection(client)

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
    assert res.json()["leader_label_x"] == 0.4

    events = _events_for(db_path, created["id"])
    # createイベントのみで、bbox_editは記録されない
    assert [e["event_type"] for e in events] == ["create"]


def test_resizing_unknown_detection_records_no_event(client, db_path):
    before_count = len(_all_events(db_path))
    res = client.patch(
        "/api/detections/999999",
        json={"bbox_x": 0.1, "bbox_y": 0.1, "bbox_w": 0.1, "bbox_h": 0.1},
    )
    assert res.status_code == 404
    assert len(_all_events(db_path)) == before_count


# --- Undo/Redoは通常のAPI呼び出しとしてそのまま記録される ---


def test_undo_of_a_move_is_recorded_as_an_ordinary_bbox_edit_event_with_no_special_flag(client, db_path):
    """Undo/Redoは特別扱いしない(設計8章)。Frontendの実装同様、Undoは
    「beforeの値へ戻すPATCH」を送るだけなので、通常のbbox_editイベントとして
    記録される。"""
    created = _create_manual_detection(client)
    original = (created["bbox_x"], created["bbox_y"], created["bbox_w"], created["bbox_h"])

    # 移動 (通常の編集)
    client.patch(
        f"/api/detections/{created['id']}",
        json={"bbox_x": 0.5, "bbox_y": 0.5, "bbox_w": 0.05, "bbox_h": 0.05},
    )
    # Undo相当: 元の位置へ戻すPATCHを送るだけ (Frontend App.tsxのUndoハンドラと同じ実装方針)
    client.patch(
        f"/api/detections/{created['id']}",
        json={"bbox_x": original[0], "bbox_y": original[1], "bbox_w": original[2], "bbox_h": original[3]},
    )

    events = _events_for(db_path, created["id"])
    assert [e["event_type"] for e in events] == ["create", "bbox_edit", "bbox_edit"]
    undo_event = events[2]
    # Undoの結果、beforeは移動後の値、afterは元の値に戻る(往復がそのまま2つの
    # 独立したbbox_editイベントとして残る。「これはUndoだった」という専用の
    # フラグ・識別子は付与されない)。
    assert undo_event["before_bbox_x"] == 0.5
    assert undo_event["after_bbox_x"] == original[0]


def test_undo_of_a_delete_recreates_with_a_new_detection_id_splitting_the_event_history(client, db_path):
    """Undo of deleteはcreate APIをもう一度呼ぶだけなので、SQLiteの
    AUTOINCREMENTにより新しいdetection_idが払い出される。同じ物理的なBBoxの
    event履歴が旧id(delete で終わる)と新id(createから始まる)に分断される
    既知の制約を確認する(設計8章、editHistory.tsの既存の制約と同根)。"""
    created = _create_manual_detection(client)
    original_id = created["id"]

    client.delete(f"/api/detections/{original_id}")

    # Undo of delete: 同じ内容でcreateをもう一度呼ぶ (Frontend側の実装方針と同じ)
    recreated = _create_manual_detection(
        client,
        bbox_x=created["bbox_x"],
        bbox_y=created["bbox_y"],
        bbox_w=created["bbox_w"],
        bbox_h=created["bbox_h"],
    )
    assert recreated["id"] != original_id  # 新しいidが払い出される

    original_events = _events_for(db_path, original_id)
    assert [e["event_type"] for e in original_events] == ["create", "delete"]
    new_events = _events_for(db_path, recreated["id"])
    assert [e["event_type"] for e in new_events] == ["create"]


# --- transaction: current state更新とevent insertが同一トランザクションであること ---


def test_state_change_and_event_share_a_transaction_and_roll_back_together(tmp_path):
    """Repository層を直接呼び、途中で例外が発生した場合に状態変更とevent記録の
    両方がロールバックされることを確認する(API層を経由すると正常系しか
    再現できないため、get_connection()を直接使う。設計7章、
    test_master_importer.py同様の手法)。"""
    from app.db.master_importer import import_master_excel
    from app.repositories.detections import create_manual_detection

    db_path = tmp_path / "rollback_test.db"
    run_migrations(db_path)
    with get_connection(db_path) as conn:
        seed(conn)
        import_master_excel(conn)

    page_id: int
    master_item_id: int
    with get_connection(db_path) as conn:
        page_id = conn.execute("SELECT id FROM drawing_pages WHERE page_no = 16").fetchone()[0]
        master_item_id = conn.execute("SELECT id FROM estimate_master_items LIMIT 1").fetchone()[0]

    class _DeliberateFailure(Exception):
        """テスト用に、状態変更+event記録の後でわざと例外を起こすためだけの例外。"""

    created_id_holder: dict[str, int] = {}

    with pytest.raises(_DeliberateFailure):
        with get_connection(db_path) as conn:
            detection = create_manual_detection(
                conn,
                drawing_page_id=page_id,
                master_item_id=master_item_id,
                class_name="TEST",
                bbox_x=0.1,
                bbox_y=0.1,
                bbox_w=0.05,
                bbox_h=0.05,
            )
            created_id_holder["id"] = detection.id
            # get_connection()の`with`ブロックを異常終了させ、commitではなく
            # rollbackが起きることを強制する。
            raise _DeliberateFailure()

    detection_id = created_id_holder["id"]
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    state_row = conn.execute("SELECT * FROM detections WHERE id = ?", (detection_id,)).fetchone()
    event_rows = conn.execute(
        "SELECT * FROM decision_events WHERE detection_id = ?", (detection_id,)
    ).fetchall()
    conn.close()

    # 状態変更(detections行)もevent記録(decision_events行)も、どちらも
    # ロールバックされて残っていないこと。
    assert state_row is None
    assert event_rows == []
