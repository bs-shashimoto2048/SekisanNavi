"""app.services.data_source の単体テスト。

実際の共有フォルダ (\\\\beans-f1\\...) には依存せず、pytest の tmp_path 配下に
製番ディレクトリを模したダミー構造を作成してテストする (要件20: テストは
fixture/ダミーデータを使用する)。
"""
import subprocess
import sys
import threading
import time

import pytest

from app.services import data_source as _data_source_module
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


@pytest.fixture(autouse=True)
def _clear_product_dir_cache():
    # [製番選択の検索高速化] `search_product_dirs`はルート直下の検証済み一覧を
    # プロセス全体でキャッシュするため、各テストを他テストの残存キャッシュから
    # 独立させる(tmp_pathは既にテストごとに別パスだが、念のため明示的に揃える)。
    _data_source_module._dir_cache.clear()
    yield
    _data_source_module._dir_cache.clear()


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


def test_list_page_numbers_excludes_page_zero(fake_root):
    """`0.pdf`(SekisanNaviData の共通製作仕様書。ページ名「0」の図面でもある)は、開けない「ページ 0」になるので一覧に出さない。"""
    product = fake_root / "A1TEST01"
    for name in ("0.pdf", "00.pdf", "000000.pdf"):
        (product / name).write_bytes(b"%PDF-1.4 dummy")
    resolution = resolve_product_dir(str(fake_root), "A1TEST01")
    assert list_page_numbers(resolution.ccv_dir) == [16, 18]


def test_resolve_page_file_rejects_page_zero(fake_root):
    """ページ番号 0 は開けない(従来どおり)。0.pdf が仕様書でもページ「0」の図面でも、読み出しの対象にならない。"""
    (fake_root / "A1TEST01" / "0.pdf").write_bytes(b"%PDF-1.4 dummy")
    resolution = resolve_product_dir(str(fake_root), "A1TEST01")
    with pytest.raises(InvalidProductNo):
        resolve_page_file(resolution.ccv_dir, 0)
    assert (fake_root / "A1TEST01" / "0.pdf").read_bytes() == b"%PDF-1.4 dummy"


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


# --- search_product_dirs (Phase 1.8, 製番の部分一致検索。
#     [追加修正: 製番選択の一覧表示] 前方一致→部分一致、空文字列=全件、
#     「_」始まり除外へ変更) ---


@pytest.fixture()
def multi_product_root(tmp_path):
    root = tmp_path / "output"
    root.mkdir()
    for name in ["A1GV2421", "A1GV2422", "A1GV2428", "A1AA0379", "B2XX0001", "_ARCHIVE2420"]:
        (root / name).mkdir()
    # ディレクトリではないファイルは製番候補に含めない
    (root / "server.yaml").write_text("dummy")
    return root


def test_search_product_dirs_prefix_match(multi_product_root):
    matches, truncated = search_product_dirs(str(multi_product_root), "A1GV24")
    assert matches == ["A1GV2421", "A1GV2422", "A1GV2428"]
    assert truncated is False


def test_search_product_dirs_substring_match_not_limited_to_prefix(multi_product_root):
    # [追加修正] 前方一致ではなく部分一致(contains)。先頭以外に出現する文字列でも一致する。
    matches, truncated = search_product_dirs(str(multi_product_root), "GV24")
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


def test_search_product_dirs_empty_query_returns_full_list(multi_product_root):
    # [追加修正: 製番選択の一覧表示] 空文字列クエリは絞り込みなし(全件)を返す
    # (以前は不正なクエリとしてエラーにしていたが、入力欄の下に一覧表示するために変更)。
    matches, truncated = search_product_dirs(str(multi_product_root), "")
    assert matches == ["A1AA0379", "A1GV2421", "A1GV2422", "A1GV2428", "B2XX0001"]
    assert truncated is False


def test_search_product_dirs_excludes_underscore_prefixed_dirs(multi_product_root):
    # [追加修正: 製番選択の一覧表示] 「_」始まりの製番フォルダは、絞り込みなし・
    # 絞り込みありのいずれでも候補に出さない。
    matches, _ = search_product_dirs(str(multi_product_root), "")
    assert "_ARCHIVE2420" not in matches

    matches_filtered, _ = search_product_dirs(str(multi_product_root), "ARCHIVE")
    assert matches_filtered == []


# --- [製番選択の検索高速化] 検証済み一覧のTTLキャッシュ ---
#
# 実測(docs記載なし、本対応で計測): 実共有フォルダ(900件超)に対する
# `os.listdir()`自体は約15msだが、各エントリの`Path.resolve()`+`is_dir()`
# (パストラバーサル対策・実在確認)がUNC共有越しに1件あたり数msかかり、
# 検索1回あたり約5〜6秒かかっていた。これをキャッシュして、入力のたびの
# 絞り込みをキャッシュ済み一覧への文字列比較のみで行うよう変更した。


def test_search_product_dirs_only_scans_filesystem_once_within_ttl(multi_product_root, monkeypatch):
    call_count = {"n": 0}
    real_scandir = _data_source_module.os.scandir

    def counting_scandir(path):
        call_count["n"] += 1
        return real_scandir(path)

    # [製番選択の検索高速化・初回走査] 実走査は`os.listdir`ではなく`os.scandir`で
    # 行うよう変更したため、ここも`os.scandir`呼び出し回数をカウントする。
    monkeypatch.setattr(_data_source_module.os, "scandir", counting_scandir)

    search_product_dirs(str(multi_product_root), "A1GV24")
    search_product_dirs(str(multi_product_root), "")
    search_product_dirs(str(multi_product_root), "B2")

    # 3回検索しても、実ファイルシステム走査(os.scandir)は初回の1回のみ。
    assert call_count["n"] == 1


def test_search_product_dirs_cached_results_still_match_narrowed_queries(multi_product_root):
    # キャッシュ済み一覧に対してであっても、絞り込みは毎回行われる
    # (キャッシュされるのは「ルート直下の検証済み全件一覧」であって、
    # 以前のクエリの絞り込み結果ではない)。
    search_product_dirs(str(multi_product_root), "")  # キャッシュを温める
    matches, truncated = search_product_dirs(str(multi_product_root), "A1GV24")
    assert matches == ["A1GV2421", "A1GV2422", "A1GV2428"]
    assert truncated is False


def test_search_product_dirs_rescans_after_cache_ttl_expires(multi_product_root):
    search_product_dirs(str(multi_product_root), "")  # キャッシュを温める

    # 運用中に製番フォルダが追加された状況を再現する。
    (multi_product_root / "A1NEW999").mkdir()

    # TTL未経過の間は、新しいフォルダはまだ候補に出ない(キャッシュ済み一覧を使う)。
    matches, _ = search_product_dirs(str(multi_product_root), "A1NEW999")
    assert matches == []

    # TTL経過をシミュレートする(実際に60秒待つ代わりに、キャッシュの記録時刻を
    # 過去へ書き換える)。
    root_key = str(_data_source_module._resolve_root(str(multi_product_root)))
    recorded_at, cached_names = _data_source_module._dir_cache[root_key]
    _data_source_module._dir_cache[root_key] = (
        recorded_at - _data_source_module._DIR_CACHE_TTL_SECONDS - 1,
        cached_names,
    )

    # TTL経過後は必ず再走査され、新しいフォルダも候補に出る
    # (フォルダ一覧の更新が長時間反映されないことはない)。
    matches, _ = search_product_dirs(str(multi_product_root), "A1NEW999")
    assert matches == ["A1NEW999"]


def test_search_product_dirs_concurrent_cold_calls_scan_filesystem_only_once(multi_product_root, monkeypatch):
    call_count = {"n": 0}
    first_call_entered = threading.Event()
    release_first_call = threading.Event()
    real_scandir = _data_source_module.os.scandir

    def slow_scandir(path):
        call_count["n"] += 1
        first_call_entered.set()
        release_first_call.wait(timeout=2)
        return real_scandir(path)

    # [製番選択の検索高速化・初回走査] 実走査は`os.scandir`で行うため、
    # 「同時アクセス時に実走査が1回に直列化されること」もここで検証する。
    monkeypatch.setattr(_data_source_module.os, "scandir", slow_scandir)

    results: list[tuple[list[str], bool]] = []
    results_lock = threading.Lock()

    def worker():
        result = search_product_dirs(str(multi_product_root), "A1GV24")
        with results_lock:
            results.append(result)

    threads = [threading.Thread(target=worker) for _ in range(5)]
    for t in threads:
        t.start()

    # 1つ目のスレッドが走査(スキャン)に入り、他4つがロック待ちになるのを待つ。
    assert first_call_entered.wait(timeout=2)
    time.sleep(0.05)
    release_first_call.set()

    for t in threads:
        t.join(timeout=2)

    # 5スレッド同時アクセスでも、実ファイルシステム走査は1回のみ
    # (thundering herdにならない)。
    assert call_count["n"] == 1
    assert len(results) == 5
    for matches, truncated in results:
        assert matches == ["A1GV2421", "A1GV2422", "A1GV2428"]
        assert truncated is False


def _make_junction(link_path, target_path) -> bool:
    """`mklink /J`でNTFSジャンクションを作成する。失敗時はFalseを返す
    (権限/環境都合で作成できない場合にテストをskipするため)。"""
    result = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(link_path), str(target_path)],
        capture_output=True,
    )
    return result.returncode == 0


# --- [製番選択の検索高速化・初回走査] os.scandir化に伴う安全性の回帰確認 ---
#
# 実機検証の結果、Windowsの`DirEntry.is_symlink()`は通常のシンボリックリンクは
# 検出するが、**NTFSジャンクション(`mklink /J`)は検出しない**ことを確認した。
# もし高速化の実装で誤って`is_symlink()`を安全性判定に使っていた場合、ルート外を
# 指すジャンクションが検索候補に紛れ込む退行になるため、この2点を明示的に
# テストで固定する。


@pytest.mark.skipif(sys.platform != "win32", reason="NTFSジャンクションはWindows専用の機能")
def test_search_product_dirs_excludes_junction_pointing_outside_root(multi_product_root, tmp_path):
    outside = tmp_path / "outside_target"
    outside.mkdir()
    junction = multi_product_root / "A1ESCAPE"
    if not _make_junction(junction, outside):
        pytest.skip("このテスト環境ではジャンクションを作成できませんでした")

    matches, _ = search_product_dirs(str(multi_product_root), "A1ESCAPE")
    assert matches == []  # ルート外を指すジャンクションは候補に出ない

    matches_all, _ = search_product_dirs(str(multi_product_root), "")
    assert "A1ESCAPE" not in matches_all


@pytest.mark.skipif(sys.platform != "win32", reason="NTFSジャンクションはWindows専用の機能")
def test_search_product_dirs_includes_junction_pointing_inside_root(multi_product_root):
    # ルート内の実在ディレクトリを指す(=安全な)ジャンクションは、通常の
    # ディレクトリと同様に候補に含まれる(reparse point全般を一律除外は
    # していないことの確認)。
    target = multi_product_root / "A1GV2421"
    junction = multi_product_root / "A1ALIAS1"
    if not _make_junction(junction, target):
        pytest.skip("このテスト環境ではジャンクションを作成できませんでした")

    matches, _ = search_product_dirs(str(multi_product_root), "A1ALIAS1")
    assert matches == ["A1ALIAS1"]
