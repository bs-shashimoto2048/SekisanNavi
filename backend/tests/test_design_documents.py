"""図面一覧の最上段に固定表示する書類(0_S0.pdf=共通製作仕様書、0_A1.pdf=設計作図完了シート)のテスト。
実共有フォルダ・実データには依存しない(一時フォルダのみ)。"""
import os
from pathlib import Path

import pytest

from app.services.data_source import list_page_numbers
from app.services.design_pages import (
    DESIGN_DOCUMENTS,
    design_document_path,
    list_design_documents,
    load_design_pages,
)
from tests.test_design_pages import _configure_root, _design, _setup

SPEC = b"%PDF-1.4\nspec sheet\n%%EOF\n"
CHECK = b"%PDF-1.4\ncheck sheet\n%%EOF\n"
PAGE1 = b"%PDF-1.4\npage 1\n%%EOF\n"
ZERO = b"%PDF-1.4\nplain zero\n%%EOF\n"


def _put(d: Path, name: str, data: bytes):
    d.joinpath(name).write_bytes(data)


def _no_preview(_key):
    return False


# ---------------- サービス ----------------
def test_the_two_documents_are_fixed_and_ordered_spec_then_check_sheet():
    assert [(k, kind, label) for k, kind, label in DESIGN_DOCUMENTS] == [
        ("0_S0", "spec_sheet", "共通製作仕様書"),
        ("0_A1", "check_sheet", "設計作図完了シート"),
    ]


def test_documents_are_listed_in_fixed_order_regardless_of_creation_order(tmp_path):
    _put(tmp_path, "0_A1.pdf", CHECK)           # 先に作っても、順序は固定
    _put(tmp_path, "0_S0.pdf", SPEC)
    assert [d.key for d in list_design_documents(tmp_path)] == ["0_S0", "0_A1"]
    assert [d.label for d in list_design_documents(tmp_path)] == ["共通製作仕様書", "設計作図完了シート"]


def test_a_missing_document_is_simply_not_listed(tmp_path):
    assert list_design_documents(tmp_path) == []
    _put(tmp_path, "0_A1.pdf", CHECK)
    assert [d.key for d in list_design_documents(tmp_path)] == ["0_A1"]                  # 仕様書が無くても、完了シートは出る
    (tmp_path / "0_A1.pdf").unlink()
    _put(tmp_path, "0_S0.pdf", SPEC)
    assert [d.key for d in list_design_documents(tmp_path)] == ["0_S0"]
    assert design_document_path(tmp_path, "0_A1") is None                                  # 別のファイルで代用しない


def test_a_plain_0_pdf_is_never_taken_as_a_document(tmp_path):
    _put(tmp_path, "0.pdf", ZERO)
    assert list_design_documents(tmp_path) == []
    assert design_document_path(tmp_path, "0") is None
    assert design_document_path(tmp_path, "0_S0") is None


def test_only_the_fixed_keys_are_accepted(tmp_path):
    _put(tmp_path, "0_S0.pdf", SPEC)
    _put(tmp_path, "other.pdf", PAGE1)
    for bad in ["other", "0", "../0_S0", "0_S0.pdf", "0_s0", "0_S0/", "", "0_S0\\", "..\\0_S0"]:
        assert design_document_path(tmp_path, bad) is None, bad
    assert design_document_path(tmp_path, "0_S0") == (tmp_path / "0_S0.pdf").resolve()


def test_empty_files_and_case_variants_and_links_are_not_documents(tmp_path):
    _put(tmp_path, "0_S0.pdf", b"")                                                        # 空
    assert list_design_documents(tmp_path) == []
    (tmp_path / "0_S0.pdf").unlink()
    _put(tmp_path, "0_s0.PDF", SPEC)                                                       # 綴りが違う(別のファイル)
    assert list_design_documents(tmp_path) == []
    outside = tmp_path.parent / "outside_target.pdf"
    outside.write_bytes(SPEC)
    try:
        os.symlink(outside, tmp_path / "0_A1.pdf")
    except (OSError, NotImplementedError):
        pytest.skip("symlink を作れない環境")
    assert list_design_documents(tmp_path) == []                                           # リンクは配信しない


def test_documents_are_not_page_numbers(tmp_path):
    for name, data in (("0_S0.pdf", SPEC), ("0_A1.pdf", CHECK), ("1.pdf", PAGE1), ("0.pdf", ZERO)):
        _put(tmp_path, name, data)
    assert list_page_numbers(tmp_path) == [1]                      # 0_S0/0_A1 は数値化されない。通常の 0.pdf(ページ 0)も一覧に出ない


def test_documents_never_become_design_rows(tmp_path):
    _put(tmp_path, "0_S0.pdf", SPEC)
    _put(tmp_path, "0_A1.pdf", CHECK)
    _put(tmp_path, "1.pdf", PAGE1)
    _design(tmp_path, [("0_S0", "仕様書の行"), ("0_A1", "完了シートの行"), ("1", "単線結線図")])
    result = load_design_pages(tmp_path, "A1TEST01", _no_preview)
    assert [p.key for p in result.pages] == ["1"]                  # design.csv に同名の行があっても、図面ページの行にしない
    assert result.skipped_rows == 2


def test_a_plain_0_pdf_stays_a_normal_design_row_and_is_not_a_document(tmp_path):
    _put(tmp_path, "0.pdf", ZERO)
    _put(tmp_path, "0_A1.pdf", CHECK)
    _design(tmp_path, [("0", "設計作図完了チェックシート(従来の出力)"), ("1", "単線結線図")])
    _put(tmp_path, "1.pdf", PAGE1)
    result = load_design_pages(tmp_path, "A1TEST01", _no_preview)
    assert [p.key for p in result.pages] == ["0", "1"]             # 通常の 0.pdf は、従来どおり design.csv の行
    assert [d.key for d in list_design_documents(tmp_path)] == ["0_A1"]


# ---------------- API ----------------
def _api_setup(tmp_path, monkeypatch, client, files):
    root, prod = _setup(tmp_path, monkeypatch, [("1", "単線結線図"), ("2", "配置図")], ["1", "2"])
    for name, data in files.items():
        _put(prod, name, data)
    _configure_root(client, monkeypatch, root)
    return prod


def test_design_pages_returns_documents_first_in_fixed_order(client, monkeypatch, tmp_path):
    _api_setup(tmp_path, monkeypatch, client, {"0_A1.pdf": CHECK, "0_S0.pdf": SPEC})
    body = client.get("/api/products/A1TEST01/design-pages").json()
    assert body["status"] == "ok"
    assert [(d["key"], d["kind"], d["label"]) for d in body["documents"]] == [
        ("0_S0", "spec_sheet", "共通製作仕様書"),
        ("0_A1", "check_sheet", "設計作図完了シート"),
    ]
    assert [i["key"] for i in body["items"]] == ["1", "2"]         # 通常の図面は、その後(書類は items に混ぜない)


def test_design_pages_without_documents_is_unchanged(client, monkeypatch, tmp_path):
    _api_setup(tmp_path, monkeypatch, client, {})
    body = client.get("/api/products/A1TEST01/design-pages").json()
    assert body["documents"] == []
    assert [i["key"] for i in body["items"]] == ["1", "2"]


def test_documents_are_returned_even_when_design_csv_is_missing(client, monkeypatch, tmp_path):
    prod = _api_setup(tmp_path, monkeypatch, client, {"0_S0.pdf": SPEC})
    (prod / "design.csv").unlink()
    body = client.get("/api/products/A1TEST01/design-pages").json()
    assert body["status"] == "missing" and body["items"] == []
    assert [d["key"] for d in body["documents"]] == ["0_S0"]


def test_document_file_is_delivered_as_pdf_only_for_the_fixed_keys(client, monkeypatch, tmp_path):
    prod = _api_setup(tmp_path, monkeypatch, client, {"0_S0.pdf": SPEC, "0_A1.pdf": CHECK, "0.pdf": ZERO})
    r = client.get("/api/products/A1TEST01/design-documents/0_S0/file")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content == SPEC
    r = client.get("/api/products/A1TEST01/design-documents/0_A1/file")
    assert r.status_code == 200 and r.content == CHECK
    # 通常の 0.pdf・通常ページ・任意のキーは、この経路では配信しない
    for key in ("0", "1", "other", "0_s0", "0_S0.pdf", "..%2F0_S0"):
        assert client.get(f"/api/products/A1TEST01/design-documents/{key}/file").status_code == 404, key
    assert (prod / "0.pdf").read_bytes() == ZERO and (prod / "0_S0.pdf").read_bytes() == SPEC      # 読み取りのみ(ファイルを変えない)


def test_missing_document_file_is_a_fixed_404_not_an_error(client, monkeypatch, tmp_path):
    _api_setup(tmp_path, monkeypatch, client, {"0_A1.pdf": CHECK})
    r = client.get("/api/products/A1TEST01/design-documents/0_S0/file")
    assert r.status_code == 404
    assert r.json()["detail"] == "書類が見つかりません。"
    assert "A1TEST01" not in r.text and str(tmp_path) not in r.text


def test_document_file_for_an_unknown_product_is_an_error_without_paths(client, monkeypatch, tmp_path):
    _api_setup(tmp_path, monkeypatch, client, {"0_S0.pdf": SPEC})
    r = client.get("/api/products/A1NOPE99/design-documents/0_S0/file")
    assert r.status_code in (400, 404) and str(tmp_path) not in r.text


def test_documents_do_not_leak_into_the_page_number_routes(client, monkeypatch, tmp_path):
    _api_setup(tmp_path, monkeypatch, client, {"0_S0.pdf": SPEC, "0_A1.pdf": CHECK, "0.pdf": ZERO})
    pages = [p["page_no"] for p in client.get("/api/products/A1TEST01/drawings").json()]
    assert pages == [1, 2]                                         # 0_S0/0_A1/0.pdf は、ページ番号の一覧に出ない
    assert client.get("/api/products/A1TEST01/drawings/0/file").status_code != 200        # ページ 0 は従来どおり開けない(書類は別の経路)
    assert client.get("/api/products/A1TEST01/drawings/1/file").content == b"%PDF-1.4\n"   # 通常ページの PDF 配信は従来どおり


def test_inference_zero_copy_and_check_sheet_are_separate_files_with_separate_routes(client, monkeypatch, tmp_path):
    """SekisanNaviData は、ページ「0」が推論対象のとき、推論用の 0.pdf を 0_A1.pdf のコピーとして用意する(内容は同じ図面)。
    書類(0_S0・0_A1)は書類の経路で、通常の 0.pdf は design.csv の行(「0」)として扱い、混同しない。"""
    root, prod = _setup(tmp_path, monkeypatch, [("0", "設計作図完了チェックシート"), ("1", "単線結線図")], ["0", "1"])
    _put(prod, "0_S0.pdf", SPEC)
    _put(prod, "0_A1.pdf", CHECK)
    _put(prod, "0.pdf", CHECK)                                     # 推論用のコピー(0_A1.pdf と同じ内容)
    _configure_root(client, monkeypatch, root)
    body = client.get("/api/products/A1TEST01/design-pages").json()
    assert [d["key"] for d in body["documents"]] == ["0_S0", "0_A1"]                       # 書類の順序は固定
    assert [i["key"] for i in body["items"]] == ["0", "1"]                                 # 通常の 0 は図面の行のまま(書類は混ざらない)
    assert client.get("/api/products/A1TEST01/design-documents/0_S0/file").content == SPEC
    assert client.get("/api/products/A1TEST01/design-documents/0_A1/file").content == CHECK
    assert client.get("/api/products/A1TEST01/design-documents/0/file").status_code == 404   # 通常の 0.pdf は書類の経路では配信しない
    assert [p["page_no"] for p in client.get("/api/products/A1TEST01/drawings").json()] == [1]   # ページ番号の一覧に 0.pdf・書類は出ない
