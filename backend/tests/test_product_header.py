"""ヘッダー用の製番別データ(GET /api/products/{product_no}/header)のテスト。実共有フォルダ・本番DBには依存しない。"""
from pathlib import Path

from app import config
from app.services.product_header import load_product_header

HEADER = "blank,整理番号,製番,ページ番号,blank,図名,図面尺度１,図面尺度２,承認設計,年,月,日,承認照査,年,月,日,製作設計,年,月,日,製作照査,年,月,日"


def _row(seiri, seiban, page="1", name="外形図"):
    return f"0,{seiri},{seiban},{page},,{name}," + "," * 17


def _write(d: Path, rows, header=HEADER):
    d.joinpath("design.csv").write_bytes(("\r\n".join([header] + rows) + "\r\n").encode("cp932"))


def _root(tmp_path, product="A1TEST01"):
    root = tmp_path / "root"
    prod = root / product
    prod.mkdir(parents=True)
    return root, prod


def _configure_root(client, monkeypatch, root):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "test-admin-pass")
    res = client.put("/api/settings/data-source", json={"root": str(root), "admin_password": "test-admin-pass"})
    assert res.status_code == 200


def test_seiri_no_comes_from_design_csv_rows_of_the_same_product(tmp_path):
    _, prod = _root(tmp_path)
    # 整理番号は製番から機械的には作れない(lw0089 / a1lw0626)。値は元データのまま、英字だけ大文字にする
    _write(prod, [_row("lw0089", "a1test01", "0"), _row("lw0089", "a1test01", "1")])
    h = load_product_header(prod, "A1TEST01")
    assert (h.status, h.seiri_no, h.panel_name) == ("ok", "LW0089", None)


def test_most_common_value_is_used_and_rows_of_other_products_or_blank_seiban_are_ignored(tmp_path):
    _, prod = _root(tmp_path)
    _write(
        prod,
        [
            _row("ad0176", "a1test01", "1"),
            _row("ad0176", "a1test01", "2"),
            _row("zz9999", "a1test01", "3"),
            _row("xx0001", "a1other99", "4"),   # 別の製番の行
            _row("a1test01", "", "5"),           # 製番が空の行(整理番号欄に製番が入っている行)
        ],
    )
    assert load_product_header(prod, "A1TEST01").seiri_no == "AD0176"


def test_status_missing_invalid_and_empty_never_raise_and_hide_details(tmp_path):
    _, prod = _root(tmp_path)
    assert load_product_header(prod, "A1TEST01").status == "missing"
    prod.joinpath("design.csv").write_bytes("整理番号,製番\r\nx,y\r\n".encode("utf-8") + b"\xff\xfe")
    assert load_product_header(prod, "A1TEST01").status == "invalid"        # CP932でない
    _write(prod, [_row("a", "b")], header="foo,bar,baz")
    assert load_product_header(prod, "A1TEST01").status == "invalid"        # 必要な列が無い
    _write(prod, [_row("lw0089", "a1other99")])
    h = load_product_header(prod, "A1TEST01")
    assert (h.status, h.seiri_no) == ("empty", None)                         # 該当行が無い
    _write(prod, [])
    assert load_product_header(prod, "A1TEST01").status == "empty"


def test_api_returns_header_per_product_and_does_not_use_project_info(client, monkeypatch, tmp_path):
    root, prod = _root(tmp_path, "A1TEST01")
    _write(prod, [_row("lw0089", "a1test01")])
    other = root / "A1TEST02"
    other.mkdir()
    _write(other, [_row("gv0001", "a1test02")])
    _configure_root(client, monkeypatch, root)
    a = client.get("/api/products/A1TEST01/header").json()
    b = client.get("/api/products/A1TEST02/header").json()
    assert a == {"product_no": "A1TEST01", "seiri_no": "LW0089", "panel_name": None, "status": "ok"}
    assert b["seiri_no"] == "GV0001" and b["product_no"] == "A1TEST02"
    # デモ用project_infoの値が混ざらない
    demo = client.get("/api/project").json()
    assert a["seiri_no"] != demo["seiri_no"]


def test_api_missing_design_csv_returns_nulls_and_errors_hide_paths(client, monkeypatch, tmp_path):
    root, _ = _root(tmp_path, "A1TEST01")
    _configure_root(client, monkeypatch, root)
    res = client.get("/api/products/A1TEST01/header")
    assert res.status_code == 200
    assert res.json() == {"product_no": "A1TEST01", "seiri_no": None, "panel_name": None, "status": "missing"}
    nf = client.get("/api/products/A1MISSING/header")
    assert nf.status_code == 404
    assert str(tmp_path) not in nf.text
    assert client.get("/api/products/a/header").status_code == 400
