"""app.services.steel_outline と GET /api/products/{no}/steel のテスト。

実データには依存せず、tmp_path 配下に架空値の material.csv / product_df.csv (cp932, BOMなし) を作って確認する。
"""
import pytest

from app import config
from app.services.material_csv import MaterialRow
from app.services.steel_outline import canonical_page_no, information_score, select_outline_steel

_MAT_HEADER = "PAGE,SOURCE_FILE,SYMBOL_NAME,CABTYPE,COMPONENT_CODE,COMPONENT_NAME,MATERIAL_SPEC"
_PDF_HEADER = (
    "BAN_MENNO,BAN_NO,PAGE,ZUMEI,BAN_MEISYOU,BAN_TYPE,BAN_H1,BAN_H2,BAN_W,BAN_D,"
    "KITEN_X,KITEN_Y,DETECT_AREA_X,DETECT_AREA_Y,FRAME_ORG_X,FRAME_ORG_Y,"
    "FRAME_MINI_X,FRAME_MINI_Y,SCALE_X,SCALE_Y"
)


def _row(page, cab="", name="", spec="", sym="BSP-STEELA-X", code="C"):
    return MaterialRow(page=page, source_file="", symbol_name=sym, cabtype=cab,
                       component_code=code, component_name=name, material_spec=spec)


OUTLINE = {2: "外形図", 5: "外形図", 7: "外形図", 9: "単線結線図", 1: "外形図"}


def test_canonical_page_no_keeps_leading_zero_pages_unmapped():
    assert canonical_page_no("16") == 16
    for bad in ("01", "0", "x1", "", " 1", "1.0", "１", "-1"):
        assert canonical_page_no(bad) is None


def test_selects_page_with_most_described_specs():
    rows = [_row("2", "A", "n", "MAT"), _row("5", "A", "n", "MAT"), _row("5", "A", "n", "MAT2")]
    sel = select_outline_steel(rows, OUTLINE)
    assert sel.page == "5" and len(sel.rows) == 2


def test_no_info_specs_do_not_count_as_information():
    # ページ2は行数が多いが、材料仕様は「未記載」「無し」だけ → ページ5(記載1行)が勝つ
    rows = [_row("2", "A", "n", "未記載"), _row("2", "A", "n", "無し"), _row("2", "A", "n", ""), _row("5", "", "", "MAT")]
    assert select_outline_steel(rows, OUTLINE).page == "5"


def test_tiebreak_cabtype_then_component_name_then_row_count_then_smaller_page():
    base = {"2": [_row("2", "", "", "M")], "5": [_row("5", "", "", "M")]}
    # 完全同点 → ページ番号が小さい方(入力順に依存しない)
    for order in (("2", "5"), ("5", "2")):
        rows = [r for p in order for r in base[p]]
        assert select_outline_steel(rows, OUTLINE).page == "2"
    # CABTYPE のある行数が多い方
    rows = [_row("2", "", "n", "M"), _row("5", "A", "n", "M")]
    assert select_outline_steel(rows, OUTLINE).page == "5"
    # 構成部名のある行数が多い方
    rows = [_row("2", "A", "", "M"), _row("5", "A", "n", "M")]
    assert select_outline_steel(rows, OUTLINE).page == "5"
    # 総行数が多い方(材料仕様・CABTYPE・構成部名の数が同じ)
    rows = [_row("2", "A", "n", "M"), _row("5", "A", "n", "M"), _row("5", "", "", "")]
    assert select_outline_steel(rows, OUTLINE).page == "5"
    assert information_score([_row("5", "A", "n", "M"), _row("5", "", "", "")]) == (1, 1, 1, 2)


def test_ignores_non_outline_and_unmapped_pages():
    rows = [_row("9", "A", "n", "MAT"), _row("01", "A", "n", "MAT"), _row("x1", "A", "n", "MAT"), _row("3", "A", "n", "MAT")]
    assert select_outline_steel(rows, OUTLINE).page is None
    assert select_outline_steel([], OUTLINE).page is None


def test_leading_zero_page_is_not_merged_with_plain_page():
    # 「01」と「1」は別ページ。「01」は対応づけず、「1」だけが外形図として選ばれる
    rows = [_row("01", "A", "n", "M1"), _row("01", "A", "n", "M2"), _row("1", "A", "n", "M")]
    sel = select_outline_steel(rows, OUTLINE)
    assert sel.page == "1" and len(sel.rows) == 1


def test_rows_keep_csv_order_within_the_selected_page():
    rows = [_row("5", "A", "b", "M", code="2"), _row("2", "A", "z", "M"), _row("5", "A", "a", "M", code="1")]
    assert [r.component_name for r in select_outline_steel(rows, OUTLINE).rows] == ["b", "a"]


# ---- API ----


def _configure_root(client, monkeypatch, root):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "test-admin-pass")
    res = client.put("/api/settings/data-source", json={"root": str(root), "admin_password": "test-admin-pass"})
    assert res.status_code == 200


def _write_material(d, rows, encoding="cp932", header=_MAT_HEADER):
    (d / "material.csv").write_bytes(("\r\n".join([header, *rows]) + "\r\n").encode(encoding))


def _write_product_df(d, pages):
    lines = [
        f"1,1.0,{p},{zumei},盤A,正面図,2300.0,2300.0,900.0,2200.0,4650.0,2250.0,900.0,2300.0,"
        "15990.0,11430.0,2077.0,1485.0,7.69,7.69"
        for p, zumei in pages
    ]
    (d / "product_df.csv").write_bytes(("\n".join([_PDF_HEADER, *lines]) + "\n").encode("cp932"))


@pytest.fixture()
def pdir(tmp_path):
    d = tmp_path / "A1TEST01"
    d.mkdir()
    # ページのファイル(一覧に出る PDF/PNG は不要。material/steel API は参照しない)
    return d


def _get(client, monkeypatch, tmp_path):
    _configure_root(client, monkeypatch, tmp_path)
    return client.get("/api/products/A1TEST01/steel")


def test_api_returns_outline_page_with_cp932_names(client, monkeypatch, tmp_path, pdir):
    _write_product_df(pdir, [(2, "外形図(1)"), (5, "外形図(2)"), (9, "単線結線図")])
    _write_material(pdir, [
        "2,2.boxspec,BSP-STEELA-H,TYPE-X,STEEL-BASE,基礎ベース,未記載",
        "5,5.boxspec,BSP-STEELA-H,TYPE-X,STEEL-BASE,基礎ベース,TEST-MAT-A 10x20",
        "5,5.boxspec,BSP-STEELA-H,TYPE-X,STEEL-SIDE,側板,無し",
        "9,9.boxspec,BSP-STEELA-H,TYPE-Y,STEEL-BASE,屋根,MAT-9",
    ])
    res = _get(client, monkeypatch, tmp_path)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["source_page"] == "5"
    assert body["source_drawing_name"] == "外形図(2)"
    assert [i["component_name"] for i in body["items"]] == ["基礎ベース", "側板"]
    assert [i["material_spec"] for i in body["items"]] == ["TEST-MAT-A 10x20", "無し"]  # 「無し」「未記載」は元の文字列のまま
    assert set(body["items"][0]) == {"symbol_name", "cabtype", "component_name", "material_spec"}
    assert "A1TEST01" not in res.text and str(tmp_path) not in res.text and "boxspec" not in res.text


@pytest.mark.parametrize(
    "setup, status",
    [
        ("missing", "missing"),
        ("header_only", "empty"),
        ("no_column", "invalid"),
        ("not_cp932", "invalid"),
        ("no_outline", "no_outline"),
        ("no_product_df", "no_outline"),
    ],
)
def test_api_failure_modes_return_fixed_status(client, monkeypatch, tmp_path, pdir, setup, status):
    _write_product_df(pdir, [(2, "外形図"), (9, "単線結線図")])
    if setup == "header_only":
        _write_material(pdir, [])
    elif setup == "no_column":
        _write_material(pdir, ["1,2,3"], header="PAGE,FOO,BAR")
    elif setup == "not_cp932":
        (pdir / "material.csv").write_bytes(b"PAGE,SOURCE_FILE\r\n\x81\xff\xfe,\x80\r\n")
    elif setup == "no_outline":
        _write_material(pdir, ["9,9.boxspec,S,T,C,n,MAT"])
    elif setup == "no_product_df":
        (pdir / "product_df.csv").unlink()
        _write_material(pdir, ["2,2.boxspec,S,T,C,n,MAT"])
    res = _get(client, monkeypatch, tmp_path)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == status
    assert body["items"] == [] and body["source_page"] is None
    assert str(tmp_path) not in res.text and "A1TEST01" not in res.text and "Error" not in res.text


def test_api_leading_zero_pages_are_not_mapped(client, monkeypatch, tmp_path, pdir):
    _write_product_df(pdir, [(1, "外形図")])
    _write_material(pdir, [
        "01,1.boxspec,S,T,C1,n1,MAT-ZERO",
        "1,1.boxspec,S,T,C2,n2,MAT-ONE",
    ])
    body = _get(client, monkeypatch, tmp_path).json()
    assert body["source_page"] == "1"
    assert [i["material_spec"] for i in body["items"]] == ["MAT-ONE"]


def test_api_missing_product_is_404_and_traversal_rejected(client, monkeypatch, tmp_path):
    _configure_root(client, monkeypatch, tmp_path)
    assert client.get("/api/products/A1MISSING/steel").status_code == 404
    assert client.get("/api/products/..%2F..%2Fetc/steel").status_code in (400, 404)


def test_api_does_not_write_to_the_product_folder(client, monkeypatch, tmp_path, pdir):
    _write_product_df(pdir, [(2, "外形図")])
    _write_material(pdir, ["2,2.boxspec,S,T,C,n,MAT"])
    before = sorted((p.name, p.stat().st_mtime_ns, p.stat().st_size) for p in pdir.iterdir())
    _get(client, monkeypatch, tmp_path)
    assert sorted((p.name, p.stat().st_mtime_ns, p.stat().st_size) for p in pdir.iterdir()) == before
