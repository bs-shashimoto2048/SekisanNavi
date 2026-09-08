"""`GET /api/products/{product_no}/estimate-confirmations`(一覧)と
`GET /api/products/{product_no}/estimate-confirmations/{confirmation_id}`(詳細)
(Issue #4 Phase B-4) のテスト。

確定操作自体(POST)のテストは`test_estimate_confirmation_api.py`を、
repository層(`save_confirmation`)のテストは`test_estimate_confirmations.py`を
参照。ここでは読み出し専用の2エンドポイント(`list_confirmations`/
`get_confirmation`)の挙動のみを確認する。

`test_api_products.py`/`test_estimate_confirmation_api.py`と同じ手法
(tmp_path配下に製番ディレクトリを模したダミー構造を用意し、管理者パスワードで
一時的にデータ参照ルートを差し替える)を使う。DBの`drawing_pages`は製番
`A1GV2421`向けにseedで既に投入済み(`db/seed.py`の`DEMO_PRODUCT_NO`)のため、
そのままproduct_no="A1GV2421"としてAPIを呼べる。
"""
import sqlite3

from app import config


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


def _confirm(client, product_no: str) -> dict:
    res = client.post(f"/api/products/{product_no}/estimate-confirmations")
    assert res.status_code == 201
    return res.json()


# --- 一覧: 確定履歴0件 ---


def test_list_confirmations_empty_for_product_with_no_confirmations(client, monkeypatch, tmp_path):
    """まだ一度も確定していない製番は、404ではなく空配列を返す
    (「確定履歴0件」は正常系)。"""
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1GV2421/estimate-confirmations")
    assert res.status_code == 200
    assert res.json() == []


def test_list_confirmations_for_never_configured_product_no_also_returns_empty(client, monkeypatch, tmp_path):
    """データソースルートを一切設定しなくても(製番自体の実在確認をしないため)、
    一覧APIはエラーにならず空配列を返す。"""
    res = client.get("/api/products/A1NOTHING/estimate-confirmations")
    assert res.status_code == 200
    assert res.json() == []


# --- 一覧: 1件確定後に表示される ---


def test_list_confirmations_shows_confirmation_after_creating_one(client, monkeypatch, tmp_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)
    _create_manual_detection(client)
    confirmed = _confirm(client, "A1GV2421")

    res = client.get("/api/products/A1GV2421/estimate-confirmations")
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    assert body[0]["id"] == confirmed["id"]
    assert body[0]["product_no"] == "A1GV2421"
    assert body[0]["confirmed_at"] == confirmed["confirmed_at"]
    assert body[0]["item_count"] == 1


# --- 一覧: 複数回確定した場合、新しい順(id降順)で並ぶ ---


def test_list_confirmations_orders_newest_first_across_multiple_confirmations(client, monkeypatch, tmp_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)
    _create_manual_detection(client)

    first = _confirm(client, "A1GV2421")
    second = _confirm(client, "A1GV2421")
    third = _confirm(client, "A1GV2421")

    res = client.get("/api/products/A1GV2421/estimate-confirmations")
    assert res.status_code == 200
    ids = [row["id"] for row in res.json()]
    assert ids == [third["id"], second["id"], first["id"]]


# --- 一覧: total_amountは単価不明(None)の明細を除いた合計 ---


def test_list_confirmations_total_amount_sums_known_amounts_and_ignores_unknown(client, monkeypatch, tmp_path, db_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)
    created = _create_manual_detection(client)
    confirmed = _confirm(client, "A1GV2421")
    known_amount = confirmed["items"][0]["amount"]
    assert known_amount is not None  # seed済みMasterは単価を持つ前提

    # 2件目の明細を、単価不明(amount=NULL)として直接DBへ追加する
    # (Backend組み立てロジックを経由せず、集計ロジック自体を確認するための直接操作)。
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        INSERT INTO estimate_confirmation_items (
            confirmation_id, target_id, target_type, code, source_type, status,
            unit_price, amount
        ) VALUES (?, 'product', 'product', '99999', 'manual', 'reviewed', NULL, NULL)
        """,
        (confirmed["id"],),
    )
    conn.commit()
    conn.close()

    res = client.get("/api/products/A1GV2421/estimate-confirmations")
    assert res.status_code == 200
    row = res.json()[0]
    assert row["item_count"] == 2
    assert row["total_amount"] == known_amount


# --- 詳細: 保存時の内容を表示する ---


def test_get_confirmation_detail_returns_saved_items(client, monkeypatch, tmp_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)
    created = _create_manual_detection(client)
    confirmed = _confirm(client, "A1GV2421")

    res = client.get(f"/api/products/A1GV2421/estimate-confirmations/{confirmed['id']}")
    assert res.status_code == 200
    body = res.json()
    assert body["id"] == confirmed["id"]
    assert body["product_no"] == "A1GV2421"
    assert body["item_count"] == 1
    assert body["total_amount"] == confirmed["items"][0]["amount"]
    assert len(body["items"]) == 1
    assert body["items"][0]["detection_id"] == created["id"]
    assert body["items"][0]["code"] == created["master_item_code"]


# --- 詳細: 0件確定も閲覧可能 ---


def test_get_confirmation_detail_of_zero_item_confirmation_succeeds(client, monkeypatch, tmp_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)
    confirmed = _confirm(client, "A1GV2421")  # 積算コードに紐づくDetectionが無いため0件

    res = client.get(f"/api/products/A1GV2421/estimate-confirmations/{confirmed['id']}")
    assert res.status_code == 200
    body = res.json()
    assert body["item_count"] == 0
    assert body["total_amount"] == 0
    assert body["items"] == []


# --- 詳細: 存在しないconfirmation_idは404 ---


def test_get_confirmation_detail_for_nonexistent_id_returns_404(client, monkeypatch, tmp_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1GV2421/estimate-confirmations/999999")
    assert res.status_code == 404


# --- 詳細: 別製番のconfirmation idへはアクセスできない ---


def test_get_confirmation_detail_for_mismatched_product_no_returns_404(client, monkeypatch, tmp_path):
    product_a = tmp_path / "A1GV2421"
    product_a.mkdir()
    product_b = tmp_path / "A1OTHER99"
    product_b.mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    confirmed = _confirm(client, "A1GV2421")

    # 実在するconfirmation idだが、所属製番が異なる
    res = client.get(f"/api/products/A1OTHER99/estimate-confirmations/{confirmed['id']}")
    assert res.status_code == 404

    # 正しい製番からは引き続き参照できる(idそのものは壊れていないことの確認)
    res_ok = client.get(f"/api/products/A1GV2421/estimate-confirmations/{confirmed['id']}")
    assert res_ok.status_code == 200


# --- 再現性: Master再UPSERT後も詳細表示の値は変化しない ---


def test_get_confirmation_detail_values_are_frozen_after_master_price_change(client, monkeypatch, tmp_path, db_path):
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)
    created = _create_manual_detection(client)
    confirmed = _confirm(client, "A1GV2421")
    original_unit_price = confirmed["items"][0]["unit_price"]

    conn = sqlite3.connect(db_path)
    conn.execute(
        "UPDATE estimate_master_items SET total_price_a = ? WHERE id = ?",
        ((original_unit_price or 0) + 999999, created["master_item_id"]),
    )
    conn.commit()
    conn.close()

    res = client.get(f"/api/products/A1GV2421/estimate-confirmations/{confirmed['id']}")
    assert res.status_code == 200
    assert res.json()["items"][0]["unit_price"] == original_unit_price


# --- データソースルートの現在状態から独立していること ---


def test_history_endpoints_remain_readable_after_data_source_root_changes(client, monkeypatch, tmp_path):
    """確定snapshotの読み出しは、確定時に使ったデータソースルート/製番ディレクトリの
    現在の実在確認に依存しない(decision_events/estimate_confirmation_itemsの
    detection_id/drawing_page_idと同じ「歴史的参照」の考え方を、製番ディレクトリの
    実在性にも適用する)。"""
    product_dir_1 = tmp_path / "root1"
    product_dir_1.mkdir()
    (product_dir_1 / "A1GV2421").mkdir()
    _configure_root(client, monkeypatch, product_dir_1)
    _create_manual_detection(client)
    confirmed = _confirm(client, "A1GV2421")

    # 別のルートへ差し替える(元の製番ディレクトリはもう存在しない状態を模す)
    product_dir_2 = tmp_path / "root2"
    product_dir_2.mkdir()
    _configure_root(client, monkeypatch, product_dir_2)

    list_res = client.get("/api/products/A1GV2421/estimate-confirmations")
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1

    detail_res = client.get(f"/api/products/A1GV2421/estimate-confirmations/{confirmed['id']}")
    assert detail_res.status_code == 200
    assert detail_res.json()["item_count"] == 1
