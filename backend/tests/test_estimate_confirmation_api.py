"""`POST /api/products/{product_no}/estimate-confirmations` (Issue #4 Phase B-2) のテスト。

Phase B-1のrepository層自体のテストは`test_estimate_confirmations.py`を参照。
ここではAPI層(`build_confirmation_items()`によるBackend側での現在状態からの
組み立て + `save_confirmation()`)の結合テストを行う。

`test_api_products.py`と同じ手法(tmp_path配下に製番ディレクトリを模した
ダミー構造を用意し、管理者パスワードで一時的にデータ参照ルートを差し替える)を使う。
DBの`drawing_pages`は製番`A1GV2421`向けにseedで既に投入済み(`db/seed.py`の
`DEMO_PRODUCT_NO`)のため、そのままproduct_no="A1GV2421"としてAPIを呼べる。
"""
import sqlite3

import pytest

from app import config

_PRODUCT_DF_HEADER = (
    "BAN_MENNO,BAN_NO,PAGE,ZUMEI,BAN_MEISYOU,BAN_TYPE,BAN_H1,BAN_H2,BAN_W,BAN_D,"
    "KITEN_X,KITEN_Y,DETECT_AREA_X,DETECT_AREA_Y,FRAME_ORG_X,FRAME_ORG_Y,"
    "FRAME_MINI_X,FRAME_MINI_Y,SCALE_X,SCALE_Y"
)
# 面番号1/盤番号1。正規化後、x=[0.1, 1.0] × y=[-1.4, 0.9] の広い矩形になり、
# page16のManual BBox(x=0.1〜0.15, y=0.1〜0.15付近)と必ず交差する
# (test_api_products.py::test_list_product_drawings_includes_thumbnail_and_panels
# と同じ合成行。座標の実物理的な妥当性ではなく、構造テスト用の値)。
_PANEL_1_1_ROW = "1,1.0,16,外形図,盤A,正面図,2300,2300,900,2200,100,100,900,2300,15990,11430,100,100,10,10"

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


def _confirmations(db_path) -> list[sqlite3.Row]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM estimate_confirmations ORDER BY id").fetchall()
    conn.close()
    return rows


# --- 正常系: header/itemsが1回の確定として保存される ---


def test_create_confirmation_saves_manual_detection_with_panel_assignment(client, monkeypatch, tmp_path, db_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _write_cp932_csv(product / "product_df.csv", _PRODUCT_DF_HEADER, [_PANEL_1_1_ROW])
    _write_cp932_csv(product / "estcode_df.csv", _ESTCODE_DF_HEADER, [_ESTCODE_ROW_1_1])
    _configure_root(client, monkeypatch, tmp_path)

    created = _create_manual_detection(client)

    res = client.post("/api/products/A1GV2421/estimate-confirmations")
    assert res.status_code == 201
    body = res.json()
    assert body["product_no"] == "A1GV2421"
    assert body["confirmed_at"]
    assert body["item_count"] == 1
    assert len(body["items"]) == 1

    item = body["items"][0]
    assert item["detection_id"] == created["id"]
    assert item["drawing_page_id"] == created["drawing_page_id"]
    # product_df.csvの盤1/1と交差するBBoxのため、対象は個別盤に解決される
    assert item["target_id"] == "panel:1:1"
    assert item["target_type"] == "panel"
    assert item["ban_menno"] == 1
    assert item["ban_no"] == 1
    # estcode_df.csvの盤名称が非正規化コピーされる
    assert item["panel_name"] == "高圧受電盤"
    assert item["master_item_id"] == created["master_item_id"]
    assert item["code"] == created["master_item_code"]
    assert item["source_type"] == "manual"
    assert item["status"] == "reviewed"
    assert item["quantity"] == 1
    assert item["bbox_x"] == created["bbox_x"]
    assert item["bbox_y"] == created["bbox_y"]
    assert item["page_no"] == 16

    # DB側にも同じ内容がappend-onlyで保存されている
    headers = _confirmations(db_path)
    assert len(headers) == 1
    assert headers[0]["id"] == body["id"]


def test_create_confirmation_without_product_df_assigns_product_target(client, monkeypatch, tmp_path):
    """product_df.csv自体が無い(盤領域が1件も無い)場合、全て製品全体扱いになる。"""
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    _create_manual_detection(client)

    res = client.post("/api/products/A1GV2421/estimate-confirmations")
    assert res.status_code == 201
    item = res.json()["items"][0]
    assert item["target_id"] == "product"
    assert item["target_type"] == "product"
    assert item["ban_menno"] is None
    assert item["ban_no"] is None
    assert item["panel_name"] is None


def test_create_confirmation_excludes_ai_detections_without_master_item(client, monkeypatch, tmp_path):
    """積算コード(master_item_id)に紐づいていないseed済みAI Detection(page16に
    4件存在する)は確定snapshotに含めない(Frontend側の同じ判定と揃える)。"""
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    res = client.post("/api/products/A1GV2421/estimate-confirmations")
    assert res.status_code == 201
    assert res.json()["item_count"] == 0


# --- 0件確定を業務APIとして許可する ---


def test_create_confirmation_for_product_with_no_matching_drawing_pages_returns_empty_confirmation(
    client, monkeypatch, tmp_path
):
    """対応するダミーDrawingPage行が無い実製番でも、明細0件のconfirmationとして
    保存できる(エラーにしない。0件確定を許容する方針)。"""
    product = tmp_path / "A1OTHER99"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    res = client.post("/api/products/A1OTHER99/estimate-confirmations")
    assert res.status_code == 201
    body = res.json()
    assert body["product_no"] == "A1OTHER99"
    assert body["item_count"] == 0
    assert body["items"] == []


def test_create_confirmation_for_nonexistent_product_returns_404(client, monkeypatch, tmp_path):
    _configure_root(client, monkeypatch, tmp_path)
    res = client.post("/api/products/A1MISSING/estimate-confirmations")
    assert res.status_code == 404


# --- append-only: 再確定は上書きせず新規confirmationを追加する ---


def test_reconfirming_creates_a_new_confirmation_without_overwriting(client, monkeypatch, tmp_path, db_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)
    _create_manual_detection(client)

    first = client.post("/api/products/A1GV2421/estimate-confirmations").json()
    second = client.post("/api/products/A1GV2421/estimate-confirmations").json()

    assert first["id"] != second["id"]
    headers = _confirmations(db_path)
    assert len(headers) == 2
    assert {h["id"] for h in headers} == {first["id"], second["id"]}


# --- 再現性: Master再UPSERT後もsnapshotの値自体は変化しない ---


def test_confirmation_values_are_frozen_even_after_master_item_price_changes_afterward(
    client, monkeypatch, tmp_path, db_path
):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)
    created = _create_manual_detection(client)

    confirmed = client.post("/api/products/A1GV2421/estimate-confirmations").json()
    original_unit_price = confirmed["items"][0]["unit_price"]

    # Master Excel再インポート相当: 既存コードの価格が事後的に上書きされる状況を再現する
    conn = sqlite3.connect(db_path)
    conn.execute(
        "UPDATE estimate_master_items SET total_price_a = ? WHERE id = ?",
        ((original_unit_price or 0) + 999999, created["master_item_id"]),
    )
    conn.commit()
    conn.close()

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    stored = conn.execute(
        "SELECT * FROM estimate_confirmation_items WHERE confirmation_id = ?", (confirmed["id"],)
    ).fetchone()
    conn.close()
    assert stored["unit_price"] == original_unit_price


# --- 異常系: 保存後に失敗した場合、header/itemsとも残らないこと ---


def test_failure_after_save_rolls_back_the_whole_confirmation(client, monkeypatch, tmp_path, db_path):
    """`save_confirmation()`自体は成功した後に何らかの理由でリクエストが
    異常終了した場合でも、`get_db`依存関係の「1リクエスト=1トランザクション」に
    より、header/items双方がロールバックされ、DBに一切残らないことを確認する
    (新しいtransaction管理コードを追加していないことの裏付け)。"""
    from app.api.routers import products as products_router

    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)
    _create_manual_detection(client)

    real_save = products_router.save_confirmation

    def _save_then_fail(conn, *, product_no, items):
        real_save(conn, product_no=product_no, items=items)
        raise RuntimeError("deliberate failure after save for rollback test")

    monkeypatch.setattr(products_router, "save_confirmation", _save_then_fail)

    with pytest.raises(RuntimeError):
        client.post("/api/products/A1GV2421/estimate-confirmations")

    assert _confirmations(db_path) == []
    conn = sqlite3.connect(db_path)
    remaining_items = conn.execute("SELECT * FROM estimate_confirmation_items").fetchall()
    conn.close()
    assert remaining_items == []
