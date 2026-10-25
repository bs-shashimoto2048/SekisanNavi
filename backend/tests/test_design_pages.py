"""design.csv基準の図面一覧(/design-pages, /design-pages/{key}/image)のテスト。実共有フォルダには依存しない。"""
from pathlib import Path

from app import config
from app.api.routers import products as products_router
from app.services.design_pages import load_design_pages, page_sort_key, tidy_drawing_name

HEADER = "blank,整理番号,製番,ページ番号,blank,図名,図面尺度１,図面尺度２,承認設計,年,月,日,承認照査,年,月,日,製作設計,年,月,日,製作照査,年,月,日"
PNG_INFER = b"\x89PNG\r\n\x1a\n" + b"INFER"
PNG_PREVIEW = b"\x89PNG\r\n\x1a\n" + b"PREVIEW"


def _row(page, name):
    return f",S001,A1TEST01,{page},,{name}," + "," * 17


def _design(d: Path, rows, header=HEADER):
    d.joinpath("design.csv").write_bytes(("\r\n".join([header] + [_row(p, n) for p, n in rows]) + "\r\n").encode("cp932"))


def _pdfs(d: Path, *stems):
    for s in stems:
        d.joinpath(f"{s}.pdf").write_bytes(b"%PDF-1.4\n")


def _setup(tmp_path, monkeypatch, rows, pdfs, png=(), previews=()):
    root = tmp_path / "root"
    prod = root / "A1TEST01"
    prod.mkdir(parents=True)
    _design(prod, rows)
    _pdfs(prod, *pdfs)
    for n in png:
        prod.joinpath(f"{n}.png").write_bytes(PNG_INFER)
    prev = tmp_path / "preview"
    (prev / "A1TEST01").mkdir(parents=True)
    for k in previews:
        (prev / "A1TEST01" / f"{k}__preview.png").write_bytes(PNG_PREVIEW)
    monkeypatch.setattr(products_router, "PREVIEW_ROOT", prev)
    return root, prod


def _configure_root(client, monkeypatch, root):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "test-admin-pass")
    res = client.put("/api/settings/data-source", json={"root": str(root), "admin_password": "test-admin-pass"})
    assert res.status_code == 200


def test_tidy_drawing_name_joins_spaced_cjk_but_keeps_ascii_words():
    assert tidy_drawing_name("外    形    図") == "外形図"
    assert tidy_drawing_name("単 線 系 統 図_2026") == "単線系統図_2026"
    assert tidy_drawing_name("内部機器配置図(1-1)") == "内部機器配置図(1-1)"
    assert tidy_drawing_name("Foo   Bar") == "Foo Bar"


def test_leading_zero_and_case_are_distinct_keys_and_matched_case_insensitively(tmp_path):
    prod = tmp_path / "p"
    prod.mkdir()
    _design(prod, [("1", "単線"), ("01", "質量"), ("MK01", "金具"), ("mb011", "銅帯"), ("2", "外形")])
    _pdfs(prod, "1", "01", "mk01", "MB011")          # 2 の PDF は無い
    res = load_design_pages(prod, "A1TEST01", lambda k: False)
    assert res.status == "ok"
    # design.csvのページ番号の昇順: 先頭ゼロの数字 → 先頭ゼロ無しの数字 → 英字(大文字小文字を区別しない)
    assert [(p.page_label, p.key) for p in res.pages] == [("01", "01"), ("1", "1"), ("mb011", "MB011"), ("MK01", "mk01")]
    assert res.skipped_rows == 1


def test_only_rows_with_a_pdf_are_listed_and_duplicates_and_blank_ids_are_skipped(tmp_path):
    prod = tmp_path / "p"
    prod.mkdir()
    _design(prod, [("A", "a"), ("a", "dup"), ("", "blank"), ("屋外キュービクル", "bad"), ("B", "b")])
    _pdfs(prod, "A", "B")
    res = load_design_pages(prod, "A1TEST01", lambda k: False)
    assert [p.page_label for p in res.pages] == ["A", "B"]
    assert res.skipped_rows == 3


def test_mode_inference_preview_unavailable(tmp_path):
    prod = tmp_path / "p"
    prod.mkdir()
    _design(prod, [("2", "a"), ("3", "b"), ("01", "c"), ("MK01", "d")])
    _pdfs(prod, "2", "3", "01", "MK01")
    (prod / "2.png").write_bytes(PNG_INFER)
    (prod / "2_detected.png").write_bytes(PNG_INFER)
    res = load_design_pages(prod, "A1TEST01", lambda k: k in ("3", "01"))
    assert {p.key: (p.mode, p.inference_page_no) for p in res.pages} == {
        "2": ("inference", 2), "3": ("preview", None), "01": ("preview", None), "MK01": ("unavailable", None)}


def test_png_with_leading_zero_is_not_treated_as_an_inference_page(tmp_path):
    prod = tmp_path / "p"
    prod.mkdir()
    _design(prod, [("01", "a")])
    _pdfs(prod, "01")
    (prod / "01.png").write_bytes(PNG_INFER)
    res = load_design_pages(prod, "A1TEST01", lambda k: False)
    assert res.pages[0].mode == "unavailable"


def test_missing_empty_and_invalid_design_csv_return_a_status(tmp_path):
    prod = tmp_path / "p"
    prod.mkdir()
    assert load_design_pages(prod, "A1TEST01", lambda k: False).status == "missing"
    prod.joinpath("design.csv").write_bytes((HEADER + "\r\n").encode("cp932"))
    assert load_design_pages(prod, "A1TEST01", lambda k: False).status == "empty"
    prod.joinpath("design.csv").write_bytes(b"\x81\x20broken")
    assert load_design_pages(prod, "A1TEST01", lambda k: False).status == "invalid"
    prod.joinpath("design.csv").write_bytes("blank,整理番号\r\n1,2\r\n".encode("cp932"))
    assert load_design_pages(prod, "A1TEST01", lambda k: False).status == "invalid"
    _design(prod, [("1", "a")])
    assert load_design_pages(prod, "A1TEST01", lambda k: False).status == "empty"   # 対応するPDFが1つも無い


def test_api_lists_items_in_design_order(client, monkeypatch, tmp_path):
    root, _ = _setup(tmp_path, monkeypatch, [("0", "チェック"), ("1", "単 線"), ("01", "質量"), ("MK01", "金具")], ["0", "1", "01", "mk01"],
                     png=["1"], previews=["0", "01"])
    _configure_root(client, monkeypatch, root)
    body = client.get("/api/products/A1TEST01/design-pages").json()
    assert body["status"] == "ok"
    assert [(i["page_label"], i["key"], i["mode"], i["inference_page_no"]) for i in body["items"]] == [
        ("0", "0", "preview", None), ("01", "01", "preview", None), ("1", "1", "inference", 1), ("MK01", "mk01", "unavailable", None)]
    assert {i["key"]: i["drawing_name"] for i in body["items"]}["1"] == "単線"


def test_api_image_serves_inference_png_or_preview_by_key_and_never_mixes_them(client, monkeypatch, tmp_path):
    root, _ = _setup(tmp_path, monkeypatch, [("1", "a"), ("01", "b"), ("MK01", "c"), ("X9", "d")], ["1", "01", "mk01", "X9"],
                     png=["1"], previews=["1", "01"])      # 1 には推論PNGもプレビューもある: 推論PNGが優先
    _configure_root(client, monkeypatch, root)
    r1 = client.get("/api/products/A1TEST01/design-pages/1/image")
    assert (r1.status_code, r1.content) == (200, PNG_INFER)
    r01 = client.get("/api/products/A1TEST01/design-pages/01/image")
    assert (r01.status_code, r01.content) == (200, PNG_PREVIEW)
    na = client.get("/api/products/A1TEST01/design-pages/mk01/image")
    assert na.status_code == 404 and na.json()["detail"] == "この図面の表示用画像は作成されていません。"
    # キーの大文字小文字違い・一覧に無いキー・パス区切りは受け付けない
    assert client.get("/api/products/A1TEST01/design-pages/MK01/image").status_code == 404
    assert client.get("/api/products/A1TEST01/design-pages/nokey/image").status_code == 404
    assert client.get("/api/products/A1TEST01/design-pages/..%2F1/image").status_code == 404


def _symlink_or_skip(link: Path, target: Path):
    import os
    import pytest
    try:
        os.symlink(target, link)
    except (OSError, NotImplementedError):
        pytest.skip("シンボリックリンクを作れない環境")


def test_api_image_never_serves_inference_png_that_links_outside_the_product_dir(client, monkeypatch, tmp_path):
    root, prod = _setup(tmp_path, monkeypatch, [("1", "a"), ("2", "b")], ["1", "2"], png=["2"], previews=["1"])
    outside = tmp_path / "outside_secret.png"
    outside.write_bytes(PNG_INFER + b"SECRET")
    _symlink_or_skip(prod / "1.png", outside)         # 外部を指す推論PNG
    _configure_root(client, monkeypatch, root)
    res = client.get("/api/products/A1TEST01/design-pages/1/image")
    assert res.status_code == 404 and b"SECRET" not in res.content
    assert res.json()["detail"] == "この図面の表示用画像は作成されていません。"
    assert str(tmp_path) not in res.text
    ok = client.get("/api/products/A1TEST01/design-pages/2/image")      # 通常の推論PNGは従来どおり
    assert (ok.status_code, ok.content) == (200, PNG_INFER)
    assert outside.read_bytes().endswith(b"SECRET")                      # 読み取り専用: 外部ファイルは無変更


def test_api_image_rejects_even_a_link_to_a_file_inside_the_product_dir(client, monkeypatch, tmp_path):
    root, prod = _setup(tmp_path, monkeypatch, [("1", "a"), ("2", "b")], ["1", "2"], png=["2"])
    _symlink_or_skip(prod / "1.png", prod / "2.png")
    _configure_root(client, monkeypatch, root)
    assert client.get("/api/products/A1TEST01/design-pages/1/image").status_code == 404


def test_api_errors_use_fixed_text_and_hide_paths(client, monkeypatch, tmp_path):
    root, prod = _setup(tmp_path, monkeypatch, [("1", "a")], ["1"])
    prod.joinpath("design.csv").write_bytes(b"\xff\xfe\x00broken")
    _configure_root(client, monkeypatch, root)
    res = client.get("/api/products/A1TEST01/design-pages")
    assert res.status_code == 200 and res.json() == {"status": "invalid", "items": [], "skipped_rows": 0}
    assert str(tmp_path) not in res.text and "codec" not in res.text and "Traceback" not in res.text
    miss = client.get("/api/products/A1TEST01/design-pages/1/image")
    assert miss.status_code == 404 and str(tmp_path) not in miss.text
    prod.joinpath("design.csv").unlink()
    assert client.get("/api/products/A1TEST01/design-pages").json()["status"] == "missing"
    assert client.get("/api/products/A1MISSING/design-pages").status_code == 404


def test_existing_endpoints_are_unaffected_when_design_csv_is_broken(client, monkeypatch, tmp_path):
    root, prod = _setup(tmp_path, monkeypatch, [("1", "a")], ["1"], png=["1"])
    prod.joinpath("design.csv").write_bytes(b"\xff\xfe\x00broken")
    _configure_root(client, monkeypatch, root)
    assert [d["page_no"] for d in client.get("/api/products/A1TEST01/drawings").json()] == [1]
    assert client.get("/api/products/A1TEST01/drawings/1/thumbnail").content == PNG_INFER
    assert client.get("/api/products/A1TEST01/materials").status_code == 200

def _product_df(d: Path, rows):
    """rows: (PAGE, BAN_MENNO, BAN_NO, ZUMEI)。座標は妥当な固定値。BAN_NOは実データと同じ"1.0"表記も使う。"""
    head = "BAN_MENNO,BAN_NO,PAGE,ZUMEI,BAN_MEISYOU,BAN_TYPE,KITEN_X,KITEN_Y,DETECT_AREA_X,DETECT_AREA_Y,SCALE_X,SCALE_Y,FRAME_MINI_X,FRAME_MINI_Y"
    lines = [head] + [f"{m},{n},{p},{z},盤,正面図,100,100,500,800,1,1,2000,1400" for p, m, n, z in rows]
    d.joinpath("product_df.csv").write_bytes(("\r\n".join(lines) + "\r\n").encode("cp932"))


def test_ban_labels_come_from_product_df_as_is_without_renumbering_or_zero_changes(client, monkeypatch, tmp_path):
    root, prod = _setup(
        tmp_path, monkeypatch,
        [("9", "外形図(1)"), ("09", "別の図"), ("01", "書類"), ("mk01", "金具")],
        ["9", "09", "01", "mk01"], png=["9"],
    )
    _product_df(prod, [("9", "1", "1.0", "外形図(1)"), ("9", "1", "1.0", "外形図(1)"), ("9", "2", "2.0", "外形図(1)"), ("9", "3", "3.0", "外形図(1)")])
    _configure_root(client, monkeypatch, root)
    items = {i["key"]: i for i in client.get("/api/products/A1TEST01/design-pages").json()["items"]}
    assert items["9"]["ban_labels"] == ["1/1", "2/2", "3/3"]      # 重複を除き出現順。"1.0"は1と読む(既存の一覧と同じ)
    assert items["09"]["ban_labels"] == []                       # 先頭ゼロの別ページには、整数9の面/盤を付けない
    assert items["01"]["ban_labels"] == [] and items["mk01"]["ban_labels"] == []   # 元データに無いページは空(推測しない)


def test_ban_labels_are_empty_when_product_df_is_missing_or_broken(client, monkeypatch, tmp_path):
    root, prod = _setup(tmp_path, monkeypatch, [("1", "a")], ["1"], png=["1"])
    _configure_root(client, monkeypatch, root)
    assert client.get("/api/products/A1TEST01/design-pages").json()["items"][0]["ban_labels"] == []
    prod.joinpath("product_df.csv").write_bytes(b"\xff\xfe\x00broken")
    res = client.get("/api/products/A1TEST01/design-pages")
    assert res.status_code == 200 and res.json()["items"][0]["ban_labels"] == []
    assert str(tmp_path) not in res.text

def _order(labels):
    return sorted(labels, key=page_sort_key)


def test_sort_order_digits_leading_zero_first_then_plain_numbers_then_letters():
    # 受け入れ例: 0, 01, 02, 03, 04, 1, 2, 3, 4, 5, 6 の後に a1, b1, b2, b3, c, d
    shuffled = ["6", "1", "03", "a1", "0", "d", "b2", "01", "c", "04", "b1", "2", "b3", "02", "5", "3", "4"]
    assert _order(shuffled) == ["0", "01", "02", "03", "04", "1", "2", "3", "4", "5", "6", "a1", "b1", "b2", "b3", "c", "d"]


def test_sort_order_is_numeric_not_lexicographic_and_never_merges_01_with_1():
    assert _order(["10", "9", "2", "1", "11"]) == ["1", "2", "9", "10", "11"]
    assert _order(["08", "8", "010", "10", "07"]) == ["07", "08", "010", "8", "10"]     # 先頭ゼロ付きは1グループ(数値の昇順)、続いて先頭ゼロ無し
    assert _order(["1", "01"]) == ["01", "1"] and "01" != "1"                          # 別の番号のまま(値も綴りも保持される)
    assert page_sort_key("01") != page_sort_key("1")


def test_sort_order_same_value_puts_more_leading_zeros_first():
    assert _order(["0", "00", "000"]) == ["000", "00", "0"]
    assert _order(["01", "001"]) == ["001", "01"]


def test_sort_order_boundary_between_numbers_and_letters_and_other_leading_characters():
    assert _order(["a", "9", "A1", "0", "1"]) == ["0", "1", "9", "a", "A1"]    # "a" は "a1" より前(前方一致は短い方が先)
    # 数字始まりの英数字混在(3A)や記号・日本語始まりは、英字始まりの後ろ
    assert _order(["3A", "屋外", "b1", "#sk", "9", "a1"]) == ["9", "a1", "b1", "#sk", "3A", "屋外"]


def test_sort_order_alphabetical_ignores_case_and_ties_are_deterministic():
    assert _order(["B2", "a1", "b1", "A2", "C", "d"]) == ["a1", "A2", "b1", "B2", "C", "d"]
    # 大文字小文字を除いて同じキーなら、元の表記の文字列順(入力順に依存しない)
    assert _order(["c", "C"]) == ["C", "c"] == _order(["C", "c"])
    assert _order(["mb01", "MB01", "Mb01"]) == _order(["Mb01", "mb01", "MB01"]) == ["MB01", "Mb01", "mb01"]


def test_pages_are_sorted_regardless_of_design_csv_row_order(tmp_path):
    prod = tmp_path / "p"
    prod.mkdir()
    labels = ["b2", "2", "01", "a1", "1", "0", "C", "b1", "10", "02"]
    _design(prod, [(x, f"図{x}") for x in labels])
    _pdfs(prod, *labels)
    expected = ["0", "01", "02", "1", "2", "10", "a1", "b1", "b2", "C"]
    assert [p.page_label for p in load_design_pages(prod, "A1TEST01", lambda k: False).pages] == expected
    _design(prod, [(x, f"図{x}") for x in reversed(labels)])
    assert [p.page_label for p in load_design_pages(prod, "A1TEST01", lambda k: False).pages] == expected
