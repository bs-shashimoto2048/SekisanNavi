"""/api/products/* のテスト。

実共有フォルダには依存せず、tmp_path 配下に製番ディレクトリを模したダミー構造を
用意し、管理者パスワードで一時的にデータ参照ルートを差し替えてテストする。
"""
from app import config


def _configure_root(client, monkeypatch, root):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "test-admin-pass")
    res = client.put(
        "/api/settings/data-source",
        json={"root": str(root), "admin_password": "test-admin-pass"},
    )
    assert res.status_code == 200


def test_read_product_success(client, monkeypatch, tmp_path):
    product = tmp_path / "A1TEST01"
    product.mkdir()
    (product / "16.pdf").write_bytes(b"%PDF-1.4 dummy")
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01")
    assert res.status_code == 200
    body = res.json()
    assert body["exists"] is True
    assert body["ccv_resolved"] is False


def test_read_product_not_found(client, monkeypatch, tmp_path):
    _configure_root(client, monkeypatch, tmp_path)
    res = client.get("/api/products/A1MISSING")
    assert res.status_code == 404


def test_read_product_rejects_path_traversal(client, monkeypatch, tmp_path):
    _configure_root(client, monkeypatch, tmp_path)
    res = client.get("/api/products/..%2F..%2Fetc")
    assert res.status_code in (400, 404)


def test_list_product_drawings(client, monkeypatch, tmp_path):
    product = tmp_path / "A1TEST01"
    product.mkdir()
    (product / "16.pdf").write_bytes(b"%PDF-1.4 dummy")
    (product / "18.pdf").write_bytes(b"%PDF-1.4 dummy")
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/drawings")
    assert res.status_code == 200
    pages = [p["page_no"] for p in res.json()]
    assert pages == [16, 18]


def test_download_product_drawing_file(client, monkeypatch, tmp_path):
    product = tmp_path / "A1TEST01"
    product.mkdir()
    (product / "16.pdf").write_bytes(b"%PDF-1.4 dummy-content")
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/drawings/16/file")
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content == b"%PDF-1.4 dummy-content"


def test_download_product_drawing_file_missing_page(client, monkeypatch, tmp_path):
    product = tmp_path / "A1TEST01"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/drawings/999/file")
    assert res.status_code == 404


# --- 製番検索 (Phase 1.8, 要件2/3) ---


def test_search_products_prefix_match(client, monkeypatch, tmp_path):
    for name in ["A1GV2421", "A1GV2422", "A1AA0379"]:
        (tmp_path / name).mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/search", params={"q": "A1GV24"})
    assert res.status_code == 200
    body = res.json()
    assert body["matches"] == ["A1GV2421", "A1GV2422"]
    assert body["truncated"] is False


def test_search_products_no_match(client, monkeypatch, tmp_path):
    (tmp_path / "A1GV2421").mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/search", params={"q": "ZZZZ"})
    assert res.status_code == 200
    assert res.json()["matches"] == []


def test_search_products_respects_limit_param(client, monkeypatch, tmp_path):
    for i in range(5):
        (tmp_path / f"A1GV242{i}").mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/search", params={"q": "A1GV242", "limit": 2})
    assert res.status_code == 200
    body = res.json()
    assert len(body["matches"]) == 2
    assert body["truncated"] is True


def test_search_products_rejects_path_traversal_query(client, monkeypatch, tmp_path):
    _configure_root(client, monkeypatch, tmp_path)
    res = client.get("/api/products/search", params={"q": "../etc"})
    assert res.status_code == 400


# --- サムネイル配信 (Phase 1.8, 要件8) ---


def test_download_product_thumbnail_success(client, monkeypatch, tmp_path):
    product = tmp_path / "A1TEST01"
    product.mkdir()
    (product / "16.png").write_bytes(b"\x89PNG dummy content")
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/drawings/16/thumbnail")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    assert res.content == b"\x89PNG dummy content"


def test_download_product_thumbnail_missing_returns_404(client, monkeypatch, tmp_path):
    product = tmp_path / "A1TEST01"
    product.mkdir()
    (product / "16.pdf").write_bytes(b"%PDF-1.4 dummy")  # PDFはあるがPNGはない
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/drawings/16/thumbnail")
    assert res.status_code == 404


def test_download_product_thumbnail_cannot_request_arbitrary_file(client, monkeypatch, tmp_path):
    """page_noは整数パスパラメータのみで、任意ファイルパスをクエリでは渡せない。"""
    product = tmp_path / "A1TEST01"
    product.mkdir()
    (tmp_path / "secret.txt").write_text("do not leak")
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/drawings/not-a-number/thumbnail")
    assert res.status_code == 422  # FastAPIのint変換エラー (パストラバーサル文字列も同様に拒否される)


# --- 図面一覧のサムネイル/盤領域整形 (Phase 1.8, 要件28) ---


def test_list_product_drawings_includes_thumbnail_and_panels(client, monkeypatch, tmp_path):
    product = tmp_path / "A1TEST01"
    product.mkdir()
    (product / "16.pdf").write_bytes(b"%PDF-1.4 dummy")
    (product / "16.png").write_bytes(b"\x89PNG dummy")
    (product / "product_df.csv").write_bytes((
        "BAN_MENNO,BAN_NO,PAGE,ZUMEI,BAN_MEISYOU,BAN_TYPE,BAN_H1,BAN_H2,BAN_W,BAN_D,"
        "KITEN_X,KITEN_Y,DETECT_AREA_X,DETECT_AREA_Y,FRAME_ORG_X,FRAME_ORG_Y,"
        "FRAME_MINI_X,FRAME_MINI_Y,SCALE_X,SCALE_Y\n"
        "1,1.0,16,外形図,盤A,正面図,2300,2300,900,2200,100,100,900,2300,15990,11430,100,100,10,10\n"
        "2,1.0,16,外形図,盤B,正面図,2300,2300,900,2200,200,200,900,2300,15990,11430,100,100,10,10\n"
    ).encode("cp932"))
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/drawings")
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    page = body[0]
    assert page["page_no"] == 16
    assert page["thumbnail_url"] == "/api/products/A1TEST01/drawings/16/thumbnail"
    assert page["drawing_type"] == "外形図"
    assert page["drawing_name"] == "外形図"
    assert len(page["panels"]) == 2  # 同一ページの複数盤を1件に潰していない (要件7)
    ban_pairs = {(p["ban_menno"], p["ban_no"]) for p in page["panels"]}
    assert ban_pairs == {(1, 1), (2, 1)}
    for p in page["panels"]:
        rect = p["normalized_rect"]
        assert 0.0 <= rect["x"] <= 1.0
        assert 0.0 <= rect["w"] <= 1.0
    # 盤領域Overlay内ラベル用の項目が、盤ごとに個別の値で入っていること
    # (代表値の使い回しではない。盤領域内表示の追加指示)
    by_ban_menno = {p["ban_menno"]: p for p in page["panels"]}
    assert by_ban_menno[1]["ban_meisyou"] == "盤A"
    assert by_ban_menno[1]["ban_type"] == "正面図"
    assert by_ban_menno[2]["ban_meisyou"] == "盤B"
    assert by_ban_menno[2]["ban_type"] == "正面図"
    # 右ペイン「盤パラメータ」表示用のpage_no/BAN_H1/H2/W/Dも返ること (Phase 1.9)
    assert by_ban_menno[1]["page_no"] == 16
    assert by_ban_menno[1]["ban_h1"] == 2300
    assert by_ban_menno[1]["ban_h2"] == 2300
    assert by_ban_menno[1]["ban_w"] == 900
    assert by_ban_menno[1]["ban_d"] == 2200


def test_list_product_drawings_without_product_df_returns_empty_panels(client, monkeypatch, tmp_path):
    """product_df.csvが無くてもFrontend全体をエラーにせず、panelsが空になるだけ。"""
    product = tmp_path / "A1TEST01"
    product.mkdir()
    (product / "16.pdf").write_bytes(b"%PDF-1.4 dummy")
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/drawings")
    assert res.status_code == 200
    page = res.json()[0]
    assert page["panels"] == []
    assert page["drawing_type"] is None
