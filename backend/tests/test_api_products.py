"""/api/products/* のテスト。

実共有フォルダには依存せず、tmp_path 配下に製番ディレクトリを模したダミー構造を
用意し、管理者パスワードで一時的にデータ参照ルートを差し替えてテストする。
"""
import pytest

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


# --- detected_df.csv 検出BBoxプレビュー (Phase 1.12) ---

_PRODUCT_DF_HEADER = (
    "BAN_MENNO,BAN_NO,PAGE,ZUMEI,BAN_MEISYOU,BAN_TYPE,BAN_H1,BAN_H2,BAN_W,BAN_D,"
    "KITEN_X,KITEN_Y,DETECT_AREA_X,DETECT_AREA_Y,FRAME_ORG_X,FRAME_ORG_Y,"
    "FRAME_MINI_X,FRAME_MINI_Y,SCALE_X,SCALE_Y"
)
_DETECTED_DF_HEADER = (
    "PAGE,YOLO_INDEX,SCORE,DEVICE,LEFT_TOP_X,LEFT_TOP_Y,RIGHT_TOP_X,RIGHT_TOP_Y,"
    "LEFT_BOTTOM_X,LEFT_BOTTOM_Y,RIGHT_BOTTOM_X,RIGHT_BOTTOM_Y,CENTER_X,CENTER_Y"
)
# 実データ (A1GV2421 page16) のSCALE/FRAME_MINIそのもの。
_PAGE16_PRODUCT_DF_ROW = (
    "1,1.0,16,外形図,盤A,正面図,2300.0,2300.0,900.0,2200.0,"
    "4650.0,2250.0,900.0,2300.0,15990.0,11430.0,2077.0,1485.0,"
    "7.698603755416466,7.696969696969697"
)
# 実データ (A1GV2421 page16, 1行目=roof_fan) そのもの。
_PAGE16_DETECTED_ROW = (
    "16,0,0.970870316028595,roof_fan,9519,9699,10023,9699,9519,9444,10023,9444,9771,9571"
)


def _write_cp932_csv(path, header: str, rows: list[str]):
    content = "\n".join([header, *rows]) + "\n"
    path.write_bytes(content.encode("cp932"))


def test_read_detected_preview_real_data_row(client, monkeypatch, tmp_path):
    """指示書25章: ページ単位でdetected_df.csvの検出結果を取得できる。
    実データ(A1GV2421 page16, roof_fan)そのものを使い、Pillow合成で目視確認済みの
    正規化座標と一致することを確認する。"""
    product = tmp_path / "A1TEST01"
    product.mkdir()
    _write_cp932_csv(product / "product_df.csv", _PRODUCT_DF_HEADER, [_PAGE16_PRODUCT_DF_ROW])
    _write_cp932_csv(product / "detected_df.csv", _DETECTED_DF_HEADER, [_PAGE16_DETECTED_ROW])
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/drawings/16/detected-preview")
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 1
    item = items[0]
    assert item["class_name"] == "roof_fan"
    assert item["confidence"] == pytest.approx(0.970870316028595)
    assert item["source"] == "detected_csv"
    rect = item["normalized_rect"]
    assert rect["x"] == pytest.approx(0.5953, abs=1e-3)
    assert rect["y"] == pytest.approx(0.1514, abs=1e-3)


def test_read_detected_preview_returns_all_rows_for_the_page(client, monkeypatch, tmp_path):
    """指示書10章: 同一PAGEに複数Detectionがある場合、全件返す。"""
    product = tmp_path / "A1TEST01"
    product.mkdir()
    _write_cp932_csv(product / "product_df.csv", _PRODUCT_DF_HEADER, [_PAGE16_PRODUCT_DF_ROW])
    rows = [
        f"16,{i},0.9,device_{i},{100 + i * 10},9699,{140 + i * 10},9699,"
        f"{100 + i * 10},9444,{140 + i * 10},9444,120,9571"
        for i in range(4)
    ]
    _write_cp932_csv(product / "detected_df.csv", _DETECTED_DF_HEADER, rows)
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/drawings/16/detected-preview")
    assert res.status_code == 200
    assert len(res.json()) == 4


def test_read_detected_preview_page_not_in_csv_returns_empty_not_error(client, monkeypatch, tmp_path):
    """指示書26章: 検出データが無いページはエラーではなく空配列。"""
    product = tmp_path / "A1TEST01"
    product.mkdir()
    _write_cp932_csv(product / "product_df.csv", _PRODUCT_DF_HEADER, [_PAGE16_PRODUCT_DF_ROW])
    _write_cp932_csv(product / "detected_df.csv", _DETECTED_DF_HEADER, [_PAGE16_DETECTED_ROW])
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/drawings/999/detected-preview")
    assert res.status_code == 200
    assert res.json() == []


def test_read_detected_preview_missing_detected_df_returns_empty_not_error(client, monkeypatch, tmp_path):
    """指示書27章: detected_df.csv自体が製番フォルダに無くても図面Viewerは使用可能
    (エラーにせず空配列を返す)。"""
    product = tmp_path / "A1TEST01"
    product.mkdir()
    _write_cp932_csv(product / "product_df.csv", _PRODUCT_DF_HEADER, [_PAGE16_PRODUCT_DF_ROW])
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/drawings/16/detected-preview")
    assert res.status_code == 200
    assert res.json() == []


def test_read_detected_preview_missing_product_returns_404(client, monkeypatch, tmp_path):
    _configure_root(client, monkeypatch, tmp_path)
    res = client.get("/api/products/A1MISSING/drawings/16/detected-preview")
    assert res.status_code == 404


def test_read_detected_preview_rejects_path_traversal(client, monkeypatch, tmp_path):
    """指示書25章: Frontendへ任意ファイルパスを渡させない (product_noのpath traversal対策)。"""
    _configure_root(client, monkeypatch, tmp_path)
    res = client.get("/api/products/..%2F..%2Fetc/drawings/16/detected-preview")
    assert res.status_code in (400, 404)


# --- estcode_df.csv 盤情報 (Phase 1.14) ---

_ESTCODE_DF_HEADER = (
    "MODEL,BAN_MENNO,BAN_NO,BAN_MEISYOU,BAN_H,BAN_W,BAN_D,BAN_CONNECT,PANEL,TRANS,"
    "IN_PANEL,SHIELD,DOOR_FRONT,DOOR_BACK,DOOR_STACK,DOOR_SIDE,DOOR_SMALL,FAN_ROOF,"
    "FAN_DOOR,MAIN_LINE,WIRE_MESH,STACK_PLATE,DRAWER_DEVICE,VCT_STAND,BUS_DUCT,"
    "PASSAGE,INPUT_CU_COEFF,SORT_ORDER"
)
# 実データ (A1GV2421/estcode_df.csv) そのもの。
_ESTCODE_ROW_5 = (
    "IS2,5,5.0,No.2-1低圧動力盤,2300,1700,2200,箱･左右(L),1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0,1"
)
_ESTCODE_ROW_1 = (
    "IS2,1,1.0,高圧受電盤,2300,900,2200,箱･左右(R),0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0,5"
)


def test_read_estimate_panels_real_data_row(client, monkeypatch, tmp_path):
    """指示書25章/29章: 製番単位で盤情報を取得できる。実データ(A1GV2421,
    BAN_MENNO=5)そのものを使い、期待される正規化結果と一致することを確認する。"""
    product = tmp_path / "A1TEST01"
    product.mkdir()
    _write_cp932_csv(product / "estcode_df.csv", _ESTCODE_DF_HEADER, [_ESTCODE_ROW_5])
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/estimate-panels")
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 1
    item = items[0]
    assert item["model"] == "IS2"
    assert item["ban_menno"] == 5
    assert item["ban_no"] == 5
    assert item["ban_meisyou"] == "No.2-1低圧動力盤"
    assert item["ban_h"] == pytest.approx(2300)
    assert item["ban_w"] == pytest.approx(1700)
    assert item["ban_d"] == pytest.approx(2200)
    assert item["ban_connect"] == "箱･左右(L)"
    assert item["sort_order"] == 1


def test_read_estimate_panels_returns_all_panels_for_the_product_not_page_scoped(client, monkeypatch, tmp_path):
    """指示書1章: estcode_df.csvはPAGE列を持たない製番単位のデータのため、
    ページに関係なく製番配下の全盤を返す。"""
    product = tmp_path / "A1TEST01"
    product.mkdir()
    _write_cp932_csv(product / "estcode_df.csv", _ESTCODE_DF_HEADER, [_ESTCODE_ROW_5, _ESTCODE_ROW_1])
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/estimate-panels")
    assert res.status_code == 200
    assert len(res.json()) == 2


def test_read_estimate_panels_missing_file_returns_empty_not_error(client, monkeypatch, tmp_path):
    """指示書14章相当: estcode_df.csv自体が無くてもエラーにせず空配列。"""
    product = tmp_path / "A1TEST01"
    product.mkdir()
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/estimate-panels")
    assert res.status_code == 200
    assert res.json() == []


def test_read_estimate_panels_missing_product_returns_404(client, monkeypatch, tmp_path):
    _configure_root(client, monkeypatch, tmp_path)
    res = client.get("/api/products/A1MISSING/estimate-panels")
    assert res.status_code == 404


def test_read_estimate_panels_rejects_path_traversal(client, monkeypatch, tmp_path):
    """指示書25章: Frontendへ任意ファイルパスを渡させない (product_noのpath traversal対策)。"""
    _configure_root(client, monkeypatch, tmp_path)
    res = client.get("/api/products/..%2F..%2Fetc/estimate-panels")
    assert res.status_code in (400, 404)
