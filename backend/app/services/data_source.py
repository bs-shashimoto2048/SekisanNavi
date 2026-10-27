"""データ参照ルート・製番ディレクトリの安全な解決 (Phase 1.5)。

重要な前提 (要件19):
  共有データ (`\\\\beans-f1\\ShareData\\estimatic\\a_product\\output\\` 配下) は
  本アプリから read-only として扱う。このモジュールはファイルの読み取り・存在確認
  のみを行い、書き込み・削除・移動・リネームは一切行わない。

このモジュールが担う責務 (要件10, 17):
  - データ参照ルートは呼び出し側 (repositories/system_settings 経由の設定値) から
    受け取り、ここでハードコードしない。
  - 製番文字列を検証し、パストラバーサル等によりルート外へアクセスできないようにする。
  - 解決後のパスが必ずルート配下であることを確認する。

CCVについて (要件9, 未確認事項):
  指示では「製番ディレクトリ内のCCVを見る」とされているが、実データ調査の結果、
  `CCV` という名称のディレクトリ/ファイルは確認できなかった
  (docs/data-source.md 参照)。そのため本モジュールでは:
    1. config.CCV_SUBDIR_CANDIDATES に該当するサブディレクトリがあればそれを使用する
    2. なければ製番ディレクトリ直下を暫定的な参照先とする
  という暫定ロジックとし、どちらが使われたかをAPIレスポンスに含めて可視化する。
"""
from __future__ import annotations

import os
import re
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from app.config import CCV_SUBDIR_CANDIDATES, PRODUCT_NO_PATTERN

_PRODUCT_NO_RE = re.compile(PRODUCT_NO_PATTERN)
_PAGE_FILE_RE = re.compile(r"^(\d{1,6})\.pdf$", re.IGNORECASE)


class DataSourceError(Exception):
    """データ参照関連エラーの基底クラス。ユーザー向けメッセージのみを保持する。

    内部例外のスタックトレースや、それ以上のパス詳細をAPIへそのまま
    露出しないようにするため、呼び出し側 (router) はこの例外の `message` のみを
    クライアントへ返すこと (要件15)。
    """

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class InvalidProductNo(DataSourceError):
    pass


class RootUnavailable(DataSourceError):
    pass


class ProductNotFound(DataSourceError):
    pass


class PageNotFound(DataSourceError):
    pass


@dataclass
class ProductResolution:
    product_no: str
    product_dir: Path
    ccv_dir: Path
    ccv_resolved: bool  # True: CCVという名前のサブディレクトリが実在した / False: 製番直下へフォールバックした


def validate_product_no(product_no: str) -> str:
    if not product_no or not _PRODUCT_NO_RE.match(product_no):
        raise InvalidProductNo("製番の形式が不正です。")
    return product_no


def _resolve_root(root_str: str) -> Path:
    if not root_str or not root_str.strip():
        raise RootUnavailable("データ参照ルートが設定されていません。")
    try:
        root = Path(root_str)
        # UNCパス等、存在しない場合でも例外にならないようresolve(strict=False)
        return root.resolve(strict=False)
    except OSError as e:
        raise RootUnavailable(f"データ参照ルートのパス解釈に失敗しました: {e}") from e


def resolve_product_dir(root_str: str, product_no: str) -> ProductResolution:
    """ルート + 製番から、製番ディレクトリとCCV参照先を安全に解決する。"""
    validate_product_no(product_no)
    root = _resolve_root(root_str)

    candidate = (root / product_no).resolve(strict=False)

    # パストラバーサル対策: 解決後のパスが必ずルート配下であることを確認する。
    if not _is_relative_to(candidate, root):
        raise InvalidProductNo("製番から解決したパスがデータ参照ルート外です。")

    try:
        exists = candidate.is_dir()
    except OSError as e:
        raise RootUnavailable(_friendly_os_error(e)) from e

    if not exists:
        raise ProductNotFound(f"製番 '{product_no}' のディレクトリが見つかりません。")

    ccv_dir = candidate
    ccv_resolved = False
    for name in CCV_SUBDIR_CANDIDATES:
        sub = (candidate / name).resolve(strict=False)
        if _is_relative_to(sub, candidate) and _safe_is_dir(sub):
            ccv_dir = sub
            ccv_resolved = True
            break

    return ProductResolution(
        product_no=product_no,
        product_dir=candidate,
        ccv_dir=ccv_dir,
        ccv_resolved=ccv_resolved,
    )


def list_page_numbers(ccv_dir: Path) -> list[int]:
    """CCV参照先直下にある `{page}.pdf` ファイルのページ番号一覧を返す (数値昇順)。

    ディレクトリ全件を無条件で返すのではなく、あくまでページ番号(int)のみを返す。

    ページ番号 0(`0.pdf`・`00.pdf` など)は一覧に含めない。`resolve_page_file` がページ番号 0 以下を
    拒否する(ページ PDF・サムネイルを開けない)のと揃える。SekisanNaviData は共通製作仕様書を
    `0.pdf` に出力するため(ページ名「0」の図面が無い製番のとき)、一覧に出すと、開けない「ページ 0」になる。
    """
    try:
        names = os.listdir(ccv_dir)
    except OSError as e:
        raise RootUnavailable(_friendly_os_error(e)) from e

    pages: list[int] = []
    for name in names:
        m = _PAGE_FILE_RE.match(name)
        if m and int(m.group(1)) > 0:
            pages.append(int(m.group(1)))
    return sorted(pages)


_ALLOWED_PAGE_EXTENSIONS = ("pdf", "png")


def resolve_page_file(ccv_dir: Path, page_no: int, extension: str = "pdf") -> Path:
    """ページ番号からページファイルパスを安全に解決する (Phase 1.5でPDF専用として導入、
    Phase 1.8でPNGサムネイル配信のため拡張子を選べるよう一般化)。

    page_no は呼び出し側 (FastAPIのint型パスパラメータ) で既に整数であることが
    保証されている前提。ここでは念のため正の整数であることのみ再確認し、
    ファイル名を `{page_no}.{extension}` に組み立てる (クライアントからの任意文字列を
    そのままパス連結には使わない。extensionもクライアント入力ではなく呼び出し元の
    router実装が固定値で渡す想定であり、`_ALLOWED_PAGE_EXTENSIONS` で更に検証する)。
    """
    if page_no <= 0:
        raise InvalidProductNo("ページ番号が不正です。")
    if extension not in _ALLOWED_PAGE_EXTENSIONS:
        raise InvalidProductNo("不正なファイル種別です。")

    file_path = (ccv_dir / f"{page_no}.{extension}").resolve(strict=False)
    if not _is_relative_to(file_path, ccv_dir):
        raise InvalidProductNo("ページ番号から解決したパスが不正です。")

    try:
        if not file_path.is_file():
            raise PageNotFound(f"ページ {page_no} の{extension.upper()}ファイルが見つかりません。")
    except OSError as e:
        raise RootUnavailable(_friendly_os_error(e)) from e

    return file_path


_PRODUCT_QUERY_RE = re.compile(r"^[A-Za-z0-9]{0,20}$")
DEFAULT_PRODUCT_SEARCH_LIMIT = 500

# [製番選択の検索高速化] ルート直下には製番ディレクトリが900件超存在しうるが
# (docs/data-source.md)、実測の結果 `os.listdir()` 自体は高速(約15ms/900件)で、
# 遅かったのは各エントリに対する `Path.resolve()` + `is_dir()` (パストラバーサル
# 対策のルート内確認・実在確認) で、UNC共有越しに1件あたり数msかかり、900件超
# では検索1回あたり約5.7〜7.6秒(8回計測の中央値6.3秒、最大7.6秒)かかって
# いた。この検証済み一覧を `_DIR_CACHE_TTL_SECONDS`秒キャッシュし、入力の
# たびの絞り込みはキャッシュ済み一覧への文字列比較のみで行う(文字列比較自体は
# マイクロ秒オーダー)。
#
# [追加修正: 初回走査・TTL失効直後の走査そのものの高速化] 上記キャッシュだけでは
# 「TTL失効後の最初の1回」は依然として数秒かかっていた。実測の結果、
# `os.listdir()`で遅いのではなく、「名前一覧を取った後に1件ずつ個別へ
# `Path.resolve()`→別途`is_dir()`と2回ネットワーク往復していたこと」が原因と
# 判明したため、`os.scandir()`に置き換えた。`scandir()`が返す`DirEntry`は
# ディレクトリ列挙(Windows上はFindFirstFile/FindNextFile)の結果として
# ファイル属性を既に保持しており、`entry.stat(follow_symlinks=False)`は
# その場で取得済みの属性を返すだけで追加のネットワーク往復を発生させない
# (実測: 914件に対し scandir一覧+属性ベースの判定で約15〜36ms、8回計測の
# 中央値15.7ms・最大18.2ms。旧方式(中央値6.3秒)比で約400倍)。
#
# 安全性(ルート外パスを返さない): 単純に「`is_symlink()`がFalseなら安全」とは
# 判定していない。検証の結果、Windowsの`DirEntry.is_symlink()`は通常の
# シンボリックリンクは検出するが **NTFSジャンクション(mklink /J)は検出しない**
# ことを実機で確認した(ジャンクションもルート外の実体を指しうるため、これを
# 見逃すと安全性が退行する)。そのため、`is_symlink()`ではなく
# `st_file_attributes`の`FILE_ATTRIBUTE_REPARSE_POINT`ビット(シンボリック
# リンク・ジャンクションを含む「reparse point」全般を示す、scandir結果に
# 含まれる属性でこちらも追加往復なし)で判定する。reparse pointだった場合に
# 限り、従来どおり`Path.resolve()`+`_is_relative_to()`+`_safe_is_dir()`で
# 個別に実体を解決してルート内かどうかを確認する(実データでは0件だったため
# 通常はこの低速経路に入らない。シンボリックリンク/ジャンクションでない
# 通常の子ディレクトリは、`os.scandir(root)`が返す直接の子要素名であり
# パス区切り文字や`..`を含み得ないため、そもそも`root / name`がルート外に
# 解決されることはない)。
#
# 削除・変更中の扱い: `entry.stat()`がエントリ列挙後に対象が削除される等で
# 失敗した場合は、既存の`_safe_is_dir`と同じ方針でそのエントリを除外する
# (例外を外へ伝播させない)。
#
# 鮮度: TTLを超えたら次の呼び出しで必ず再走査する(フォルダ一覧が更新されても
# 古い候補がTTL以上残り続けることはない)。60秒は「検索モーダルを開いて
# 数文字入力する間は同じ一覧を使い回したいが、運用中の製番フォルダ追加/削除を
# 長時間反映しないのも避けたい」というバランスで選んだ値(今回変更していない)。
_DIR_CACHE_TTL_SECONDS = 60.0

# 同時アクセス: キャッシュ期限切れ直後に複数リクエストが同時に来ると、何も
# しなければ全リクエストが同時に高コストな再走査(thundering herd)を行って
# しまう。`threading.Lock`で再走査を直列化し、ロック取得後に再度キャッシュを
# 確認して、既に別スレッドが更新済みならその結果をそのまま使う(二重走査防止)。
# (今回の変更後も、走査自体が約15〜36msまで短縮されたため、仮に複数リクエストが
# 直列化されて待たされても体感できるほどの遅延にはならない。)
_dir_cache_lock = threading.Lock()
_dir_cache: dict[str, tuple[float, list[str]]] = {}

_FILE_ATTRIBUTE_REPARSE_POINT = 0x400  # Windows: stat.FILE_ATTRIBUTE_REPARSE_POINTと同値


def _is_reparse_point(entry: "os.DirEntry[str]") -> bool:
    """このエントリがシンボリックリンク/NTFSジャンクション等のreparse pointか。

    `entry.is_symlink()`はジャンクションを検出しないため使わない(上記コメント
    参照)。`entry.stat(follow_symlinks=False)`はWindows上ではscandir時に
    取得済みの属性を返すのみで追加のネットワーク往復を発生させない。
    """
    try:
        attrs = entry.stat(follow_symlinks=False).st_file_attributes
    except (AttributeError, OSError):
        # 非Windows環境(`st_file_attributes`が存在しない)、またはstat取得に
        # 失敗した場合は、`is_symlink()`(ジャンクションは検出できないポータブルな
        # 代替手段)にフォールバックする。判定自体に失敗した場合は安全側
        # (=個別解決の低速経路)に倒す。
        try:
            return entry.is_symlink()
        except OSError:
            return True
    return bool(attrs & _FILE_ATTRIBUTE_REPARSE_POINT)


def _list_cached_valid_product_dirs(root: Path) -> list[str]:
    """ルート直下の「検証済み(`_`始まりを除く・ルート内にresolve・実在する
    ディレクトリ)」製番フォルダ名一覧 (昇順ソート済み) を、TTLの間キャッシュして返す。
    """
    root_key = str(root)
    now = time.monotonic()
    cached = _dir_cache.get(root_key)
    if cached is not None and now - cached[0] < _DIR_CACHE_TTL_SECONDS:
        return cached[1]

    with _dir_cache_lock:
        # ロック待ちの間に別スレッドが既に再走査済みかもしれないため再確認する。
        cached = _dir_cache.get(root_key)
        now = time.monotonic()
        if cached is not None and now - cached[0] < _DIR_CACHE_TTL_SECONDS:
            return cached[1]

        try:
            with os.scandir(root) as it:
                entries = list(it)
        except OSError as e:
            raise RootUnavailable(_friendly_os_error(e)) from e

        valid: list[str] = []
        for entry in entries:
            name = entry.name
            if name.startswith("_"):
                continue  # 「_」始まりの製番フォルダは常に除外する
            if _is_reparse_point(entry):
                # シンボリックリンク/ジャンクション等: 実体がルート外を指す
                # 可能性があるため、個別に解決してルート内か・実在する
                # ディレクトリかを確認する(実データでは0件、低頻度想定の経路)。
                candidate = (root / name).resolve(strict=False)
                if not _is_relative_to(candidate, root):
                    continue
                if not _safe_is_dir(candidate):
                    continue
            else:
                try:
                    is_dir = entry.is_dir(follow_symlinks=False)
                except OSError:
                    continue  # 列挙後に削除された等は既存の_safe_is_dirと同じ方針で除外する
                if not is_dir:
                    continue
            valid.append(name)

        valid.sort()
        _dir_cache[root_key] = (time.monotonic(), valid)
        return valid


def search_product_dirs(
    root_str: str, query: str, limit: int = DEFAULT_PRODUCT_SEARCH_LIMIT
) -> tuple[list[str], bool]:
    """製番の部分一致候補検索 (Phase 1.8、要件2/3。[追加修正: 製番選択の一覧表示]
    前方一致→部分一致へ、空文字列クエリは「絞り込みなし」として全件返すよう変更)。

    `limit` 件を超える場合は打ち切る。戻り値の2番目の要素は「実際の一致件数が
    limitを超えて打ち切られたか」を示す(Frontend側で「もっと絞り込んでください」
    等の案内に使える)。打ち切られても、絞り込みはキャッシュ済みの全件一覧に対して
    毎回行うため、クエリをさらに絞り込めば打ち切られた分の候補にも到達できる
    (黙って除外されたままにはならない)。

    [追加修正: 製番選択の一覧表示] `query`が空文字列の場合は絞り込みを行わず、
    ルート直下の製番フォルダ名一覧を返す(入力欄の下に一覧表示するための挙動)。
    1文字以上の`query`は、大文字小文字を区別しない部分一致(contains)で絞り込む
    (以前の前方一致から変更)。名前の先頭が`_`のフォルダは、絞り込みの有無に
    関わらず常に除外する。

    製番の完全一致確認 (検索候補に出ない場合でも直接開けるようにする、要件3) は、
    この関数ではなく既存の `resolve_product_dir()` を呼び出し側が別途使う。
    """
    query = (query or "").strip()
    if query and not _PRODUCT_QUERY_RE.match(query):
        raise InvalidProductNo("検索文字列の形式が不正です (英数字のみ)。")
    if limit <= 0:
        limit = DEFAULT_PRODUCT_SEARCH_LIMIT

    root = _resolve_root(root_str)
    valid_names = _list_cached_valid_product_dirs(root)

    query_upper = query.upper()
    matches: list[str] = []
    truncated = False
    for name in valid_names:
        if query_upper and query_upper not in name.upper():
            continue
        if len(matches) >= limit:
            truncated = True
            break
        matches.append(name)

    return matches, truncated


def check_root_access(root_str: str) -> tuple[bool, str]:
    """データ参照ルートへのアクセス可否を確認する (要件15)。

    内部例外の詳細はそのまま返さず、日本語の分かりやすいメッセージへ変換する。
    """
    if not root_str or not root_str.strip():
        return False, "データ参照ルートが指定されていません。"
    try:
        root = Path(root_str)
        if not root.exists():
            return False, "パスが存在しません。UNCパスの記述や共有への接続を確認してください。"
        if not root.is_dir():
            return False, "指定されたパスはディレクトリではありません。"
        # 読み取り可能か: ディレクトリ一覧の取得を試みる。
        os.listdir(root)
        return True, "接続成功"
    except PermissionError:
        return False, "アクセス権限がありません。"
    except OSError as e:
        return False, _friendly_os_error(e)


def _friendly_os_error(e: OSError) -> str:
    """OSErrorをユーザー向けの日本語メッセージへ変換する (内部詳細は露出しない)。"""
    winerror = getattr(e, "winerror", None)
    if isinstance(e, PermissionError):
        return "アクセス権限がありません。"
    if isinstance(e, FileNotFoundError) or winerror in (53, 67):
        return "パスが見つかりません。ネットワーク共有が利用できない可能性があります。"
    if isinstance(e, NotADirectoryError):
        return "指定されたパスはディレクトリではありません。"
    if isinstance(e, TimeoutError):
        return "接続がタイムアウトしました。"
    return "データ参照ルートへのアクセスに失敗しました。"


def _is_relative_to(path: Path, base: Path) -> bool:
    try:
        return path.is_relative_to(base)
    except AttributeError:  # pragma: no cover - Python 3.9以前向けフォールバック
        try:
            path.relative_to(base)
            return True
        except ValueError:
            return False


def _safe_is_dir(path: Path) -> bool:
    try:
        return path.is_dir()
    except OSError:
        return False
