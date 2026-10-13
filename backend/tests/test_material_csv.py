"""app.services.material_csv と GET /api/products/{no}/materials のテスト。

実共有フォルダ・実データには依存せず、tmp_path配下に架空値の material.csv (cp932) を作って確認する。
列構成は SekisanNaviData が出力する material.csv の契約
(PAGE, SOURCE_FILE, SYMBOL_NAME, CABTYPE, COMPONENT_CODE, COMPONENT_NAME, MATERIAL_SPEC)。
"""
import pytest

from app import config
from app.services.material_csv import load_material_csv

_HEADER = "PAGE,SOURCE_FILE,SYMBOL_NAME,CABTYPE,COMPONENT_CODE,COMPONENT_NAME,MATERIAL_SPEC"
_ROWS = [
    "301,301.boxspec,BSP-STEELA-H,TYPE-X,STEEL-BASE,基礎ベース,TEST-MAT-A 10x20",
    "301,301.boxspec,BSP-STEELA-H,TYPE-X,STEEL-SIDE,側板,無し",
    "301,301.boxspec,BSP-STEELA-H,TYPE-X,STEEL-ROOF,屋根・天井板,未記載",
    "302,302.boxspec,BSP-STEELA-L,,STEEL-NEWPART,,NEW-MAT",
]


def _write(path, rows, header=_HEADER, encoding="cp932"):
    path.write_bytes(("\r\n".join([header, *rows]) + "\r\n").encode(encoding))


@pytest.fixture()
def product_dir(tmp_path):
    d = tmp_path / "A1TEST01"
    d.mkdir()
    return d


def test_missing_file_is_not_an_error(product_dir):
    result = load_material_csv(product_dir, "A1TEST01")
    assert result.file_present is False
    assert result.rows == []
    assert result.warnings == []


def test_reads_rows_in_csv_order_keeping_values(product_dir):
    _write(product_dir / "material.csv", _ROWS)
    result = load_material_csv(product_dir, "A1TEST01")
    assert result.file_present is True
    assert result.warnings == []
    assert [(r.page, r.symbol_name, r.cabtype, r.component_code) for r in result.rows] == [
        ("301", "BSP-STEELA-H", "TYPE-X", "STEEL-BASE"),
        ("301", "BSP-STEELA-H", "TYPE-X", "STEEL-SIDE"),
        ("301", "BSP-STEELA-H", "TYPE-X", "STEEL-ROOF"),
        ("302", "BSP-STEELA-L", "", "STEEL-NEWPART"),
    ]
    assert result.rows[0].material_spec == "TEST-MAT-A 10x20"      # 値は加工しない
    assert result.rows[0].component_name == "基礎ベース"           # cp932 の日本語


def test_nothing_and_not_described_are_kept_distinct(product_dir):
    _write(product_dir / "material.csv", _ROWS)
    specs = {r.component_code: r.material_spec for r in load_material_csv(product_dir, "A1TEST01").rows}
    assert specs["STEEL-SIDE"] == "無し"
    assert specs["STEEL-ROOF"] == "未記載"
    assert specs["STEEL-SIDE"] != specs["STEEL-ROOF"]


def test_header_only_means_no_rows(product_dir):
    _write(product_dir / "material.csv", [])
    result = load_material_csv(product_dir, "A1TEST01")
    assert result.file_present is True and result.rows == []


def test_missing_required_columns_returns_no_rows_with_warning(product_dir):
    _write(product_dir / "material.csv", ["301,x"], header="PAGE,SOURCE_FILE")
    result = load_material_csv(product_dir, "A1TEST01")
    assert result.rows == []
    assert any("必須列" in w for w in result.warnings)


def test_rows_without_page_or_code_are_skipped_with_warning(product_dir):
    _write(product_dir / "material.csv", [",a.boxspec,S,,STEEL-BASE,基礎ベース,X", "301,a.boxspec,S,,,基礎ベース,X", _ROWS[0]])
    result = load_material_csv(product_dir, "A1TEST01")
    assert len(result.rows) == 1
    assert len(result.warnings) == 2


def test_not_cp932_gives_no_partial_rows(product_dir):
    (product_dir / "material.csv").write_bytes(_HEADER.encode("ascii") + b"\r\n" + _ROWS[0].encode("cp932") + b"\r\n301,\x81\r\n")
    result = load_material_csv(product_dir, "A1TEST01")
    assert result.rows == []                      # 一部だけ読めた行を完全な一覧として出さない
    assert any("読み込みに失敗" in w for w in result.warnings)


def test_old_product_without_material_csv_keeps_other_csvs_readable(product_dir):
    """旧データ互換: material.csv が無い製番でも他CSVの読み込みに影響しない。"""
    from app.services.estcode_df import load_estcode_df
    assert load_material_csv(product_dir, "A1TEST01").file_present is False
    assert load_estcode_df(product_dir, "A1TEST01").file_present is False


# --- API ---

def _configure_root(client, monkeypatch, root):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "test-admin-pass")
    res = client.put("/api/settings/data-source", json={"root": str(root), "admin_password": "test-admin-pass"})
    assert res.status_code == 200


def test_api_returns_rows(client, monkeypatch, tmp_path):
    product = tmp_path / "A1TEST01"
    product.mkdir()
    _write(product / "material.csv", _ROWS)
    _configure_root(client, monkeypatch, tmp_path)

    res = client.get("/api/products/A1TEST01/materials")
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 4
    assert items[0] == {
        "page": "301", "source_file": "301.boxspec", "symbol_name": "BSP-STEELA-H", "cabtype": "TYPE-X",
        "component_code": "STEEL-BASE", "component_name": "基礎ベース", "material_spec": "TEST-MAT-A 10x20",
    }
    assert [i["material_spec"] for i in items[1:3]] == ["無し", "未記載"]


def test_api_missing_file_returns_empty_not_error(client, monkeypatch, tmp_path):
    (tmp_path / "A1TEST01").mkdir()
    _configure_root(client, monkeypatch, tmp_path)
    res = client.get("/api/products/A1TEST01/materials")
    assert res.status_code == 200 and res.json() == []


def test_api_header_only_returns_empty(client, monkeypatch, tmp_path):
    product = tmp_path / "A1TEST01"
    product.mkdir()
    _write(product / "material.csv", [])
    _configure_root(client, monkeypatch, tmp_path)
    assert client.get("/api/products/A1TEST01/materials").json() == []


def test_api_missing_product_is_404(client, monkeypatch, tmp_path):
    _configure_root(client, monkeypatch, tmp_path)
    assert client.get("/api/products/A1MISSING/materials").status_code == 404


def test_api_rejects_path_traversal(client, monkeypatch, tmp_path):
    _configure_root(client, monkeypatch, tmp_path)
    assert client.get("/api/products/..%2F..%2Fetc/materials").status_code in (400, 404)


def test_api_does_not_write_to_the_product_folder(client, monkeypatch, tmp_path):
    product = tmp_path / "A1TEST01"
    product.mkdir()
    _write(product / "material.csv", _ROWS)
    before = {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in product.iterdir()}
    _configure_root(client, monkeypatch, tmp_path)
    client.get("/api/products/A1TEST01/materials")
    assert {p.name: (p.read_bytes(), p.stat().st_mtime_ns) for p in product.iterdir()} == before
