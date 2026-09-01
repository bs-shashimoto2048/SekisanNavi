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
    """
    try:
        names = os.listdir(ccv_dir)
    except OSError as e:
        raise RootUnavailable(_friendly_os_error(e)) from e

    pages: list[int] = []
    for name in names:
        m = _PAGE_FILE_RE.match(name)
        if m:
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


_PRODUCT_QUERY_RE = re.compile(r"^[A-Za-z0-9]{1,20}$")
DEFAULT_PRODUCT_SEARCH_LIMIT = 20


def search_product_dirs(
    root_str: str, query: str, limit: int = DEFAULT_PRODUCT_SEARCH_LIMIT
) -> tuple[list[str], bool]:
    """製番の前方一致候補検索 (Phase 1.8、要件2/3)。

    ルート直下には製番ディレクトリが900件超存在しうるため (docs/data-source.md)、
    全件をFrontendへ送らない。前方一致した製番ディレクトリ名のうち、最大 `limit` 件のみ
    返す。戻り値の2番目の要素は「実際の一致件数がlimitを超えて打ち切られたか」を示す
    (Frontend側で「もっと絞り込んでください」等の案内に使える)。

    製番の完全一致確認 (検索候補に出ない場合でも直接開けるようにする、要件3) は、
    この関数ではなく既存の `resolve_product_dir()` を呼び出し側が別途使う。
    """
    query = (query or "").strip()
    if not query or not _PRODUCT_QUERY_RE.match(query):
        raise InvalidProductNo("検索文字列の形式が不正です (英数字のみ)。")
    if limit <= 0:
        limit = DEFAULT_PRODUCT_SEARCH_LIMIT

    root = _resolve_root(root_str)
    try:
        names = os.listdir(root)
    except OSError as e:
        raise RootUnavailable(_friendly_os_error(e)) from e

    query_upper = query.upper()
    matches: list[str] = []
    truncated = False
    for name in sorted(names):
        candidate = (root / name).resolve(strict=False)
        if not _is_relative_to(candidate, root):
            continue  # シンボリックリンク等でルート外を指す名前は無視する
        if not name.upper().startswith(query_upper):
            continue
        if not _safe_is_dir(candidate):
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
