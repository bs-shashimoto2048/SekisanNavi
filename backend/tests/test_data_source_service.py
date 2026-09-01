"""app.services.data_source の単体テスト。

実際の共有フォルダ (\\\\beans-f1\\...) には依存せず、pytest の tmp_path 配下に
製番ディレクトリを模したダミー構造を作成してテストする (要件20: テストは
fixture/ダミーデータを使用する)。
"""
import pytest

from app.services.data_source import (
    InvalidProductNo,
    PageNotFound,
    ProductNotFound,
    RootUnavailable,
    list_page_numbers,
    resolve_page_file,
    resolve_product_dir,
    check_root_access,
    search_product_dirs,
)


@pytest.fixture()
def fake_root(tmp_path):
    root = tmp_path / "output"
    root.mkdir()
    product = root / "A1TEST01"
    product.mkdir()
    (product / "16.pdf").write_bytes(b"%PDF-1.4 dummy")
    (product / "18.pdf").write_bytes(b"%PDF-1.4 dummy")
    (product / "not_a_page.txt").write_text("ignore me")
    return root


def test_resolve_product_dir_success(fake_root):
    resolution = resolve_product_dir(str(fake_root), "A1TEST01")
    assert resolution.product_dir == (fake_root / "A1TEST01").resolve()
    assert resolution.ccv_resolved is False  # CCVサブフォルダなし -> 製番直下へフォールバック


def test_resolve_product_dir_uses_ccv_subdir_when_present(fake_root):
    ccv = fake_root / "A1TEST01" / "CCV"
    ccv.mkdir()
    (ccv / "20.pdf").write_bytes(b"%PDF-1.4 dummy")

    resolution = resolve_product_dir(str(fake_root), "A1TEST01")
    assert resolution.ccv_resolved is True
    assert resolution.ccv_dir == ccv.resolve()


def test_resolve_product_dir_rejects_unknown_product(fake_root):
    with pytest.raises(ProductNotFound):
        resolve_product_dir(str(fake_root), "A1NOPE99")


@pytest.mark.parametrize(
    "malicious",
    ["../etc", "..\\..\\windows", "a/../../b", "", "!!invalid!!"],
)
def test_resolve_product_dir_rejects_path_traversal(fake_root, malicious):
    with pytest.raises(InvalidProductNo):
        resolve_product_dir(str(fake_root), malicious)


def test_resolve_product_dir_rejects_missing_root():
    with pytest.raises(RootUnavailable):
        resolve_product_dir("", "A1TEST01")


def test_list_page_numbers_only_returns_numeric_pdf_files(fake_root):
    resolution = resolve_product_dir(str(fake_root), "A1TEST01")
    pages = list_page_numbers(resolution.ccv_dir)
    assert pages == [16, 18]


def test_resolve_page_file_success(fake_root):
    resolution = resolve_product_dir(str(fake_root), "A1TEST01")
    path = resolve_page_file(resolution.ccv_dir, 16)
    assert path.name == "16.pdf"


def test_resolve_page_file_missing_raises(fake_root):
    resolution = resolve_product_dir(str(fake_root), "A1TEST01")
    with pytest.raises(PageNotFound):
        resolve_page_file(resolution.ccv_dir, 999)


def test_root_access_reports_success(fake_root):
    success, message = check_root_access(str(fake_root))
    assert success is True
    assert message == "接続成功"


def test_root_access_reports_failure_for_missing_path(tmp_path):
    missing = tmp_path / "does_not_exist"
    success, message = check_root_access(str(missing))
    assert success is False
    assert "存在しません" in message


def test_resolve_page_file_accepts_png_extension(fake_root):
    resolution = resolve_product_dir(str(fake_root), "A1TEST01")
    (resolution.product_dir / "16.png").write_bytes(b"\x89PNG dummy")
    path = resolve_page_file(resolution.ccv_dir, 16, extension="png")
    assert path.name == "16.png"


def test_resolve_page_file_rejects_unknown_extension(fake_root):
    resolution = resolve_product_dir(str(fake_root), "A1TEST01")
    with pytest.raises(InvalidProductNo):
        resolve_page_file(resolution.ccv_dir, 16, extension="exe")


# --- search_product_dirs (Phase 1.8, 製番の前方一致検索) ---


@pytest.fixture()
def multi_product_root(tmp_path):
    root = tmp_path / "output"
    root.mkdir()
    for name in ["A1GV2421", "A1GV2422", "A1GV2428", "A1AA0379", "B2XX0001"]:
        (root / name).mkdir()
    # ディレクトリではないファイルは製番候補に含めない
    (root / "server.yaml").write_text("dummy")
    return root


def test_search_product_dirs_prefix_match(multi_product_root):
    matches, truncated = search_product_dirs(str(multi_product_root), "A1GV24")
    assert matches == ["A1GV2421", "A1GV2422", "A1GV2428"]
    assert truncated is False


def test_search_product_dirs_is_case_insensitive(multi_product_root):
    matches, _ = search_product_dirs(str(multi_product_root), "a1gv24")
    assert matches == ["A1GV2421", "A1GV2422", "A1GV2428"]


def test_search_product_dirs_no_match_returns_empty(multi_product_root):
    matches, truncated = search_product_dirs(str(multi_product_root), "ZZZZ")
    assert matches == []
    assert truncated is False


def test_search_product_dirs_ignores_non_directories(multi_product_root):
    matches, _ = search_product_dirs(str(multi_product_root), "server")
    assert matches == []


def test_search_product_dirs_respects_limit_and_reports_truncated(multi_product_root):
    matches, truncated = search_product_dirs(str(multi_product_root), "A1", limit=2)
    assert len(matches) == 2
    assert truncated is True


def test_search_product_dirs_rejects_invalid_query(multi_product_root):
    with pytest.raises(InvalidProductNo):
        search_product_dirs(str(multi_product_root), "../etc")


def test_search_product_dirs_rejects_empty_query(multi_product_root):
    with pytest.raises(InvalidProductNo):
        search_product_dirs(str(multi_product_root), "")
