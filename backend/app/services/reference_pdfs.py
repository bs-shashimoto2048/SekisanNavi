"""「資料」ポップアップ(複数PDF参照)機能のファイル走査・検証ロジック。

`app.config.REFERENCE_PDF_DIR`配下のPDFだけを対象にする読み取り専用の
一覧化・ファイル名検証を行う。DBへは一切接続しない。

**セキュリティ上の境界**: 配信APIはこのモジュールの`resolve_reference_pdf_path`
経由でのみファイルパスを解決する。リクエストから受け取ったファイル名を
そのまま`REFERENCE_PDF_DIR`と結合しただけでは、`../../etc/passwd`のような
パストラバーサルや絶対パス・サブディレクトリ指定を防げないため、
「`Path(filename).name`が元の文字列と完全一致する(=区切り文字を含まない)」
「実在するファイルである」の両方を確認してから返す。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ReferencePdfItem:
    filename: str
    code: str | None
    target: str | None
    valid: bool


@dataclass(frozen=True)
class ReferencePdfList:
    folder_exists: bool
    items: list[ReferencePdfItem]


def parse_reference_pdf_filename(filename: str) -> tuple[str | None, str | None]:
    """ファイル名(拡張子込み)を「コード」「積算対象」へ分割する。

    - 拡張子`.pdf`(大文字小文字を区別しない)を取り除いた上で、最初の
      アンダーバーで分割する。
    - アンダーバーが無い、またはコード/積算対象のどちらかが空文字になる
      場合は`(None, None)`を返す(形式不正。呼び出し側がファイル名のみの
      表示へフォールバックする)。
    - 積算対象側に含まれる2つ目以降のアンダーバーはそのまま保持する
      (例: `44249_主回路銅帯_入力.pdf` → コード`44249`、積算対象
      `主回路銅帯_入力`)。
    """
    if len(filename) < 4 or filename[-4:].lower() != ".pdf":
        return None, None
    stem = filename[:-4]
    if "_" not in stem:
        return None, None
    code, _, target = stem.partition("_")
    if code == "" or target == "":
        return None, None
    return code, target


def _sort_key(item: ReferencePdfItem) -> tuple[int, str, str]:
    # 指示: 一覧はコード・積算対象の順で並べる。形式不正(valid=False)の行は
    # コード/積算対象を持たないため、正常な行の後ろへファイル名順で並べる
    # (架空のコードを割り当てて無理にソート基準へ含めない)。
    if item.valid:
        return (0, item.code or "", item.target or "")
    return (1, item.filename, "")


def list_reference_pdfs(directory: Path) -> ReferencePdfList:
    """`directory`直下の`*.pdf`(大文字小文字を区別しない)を一覧化する。

    サブディレクトリは対象外(直下のみ)。フォルダ自体が存在しない場合は
    例外を投げず`folder_exists=False, items=[]`を返す(呼び出し側[API]が
    500で落ちないようにするための、このモジュール自身の責務)。
    """
    if not directory.is_dir():
        return ReferencePdfList(folder_exists=False, items=[])

    items: list[ReferencePdfItem] = []
    for entry in directory.iterdir():
        if not entry.is_file():
            continue
        if entry.suffix.lower() != ".pdf":
            continue
        code, target = parse_reference_pdf_filename(entry.name)
        items.append(
            ReferencePdfItem(filename=entry.name, code=code, target=target, valid=code is not None)
        )

    items.sort(key=_sort_key)
    return ReferencePdfList(folder_exists=True, items=items)


def resolve_reference_pdf_path(directory: Path, filename: str) -> Path | None:
    """リクエストされた`filename`を`directory`配下の実ファイルへ安全に解決する。

    以下のいずれかに該当する場合は`None`を返す(呼び出し側[API]は404とする。
    任意パスの読み出しを許さない):
      - `filename`が空、またはパス区切り文字("/"、"\\")や".."を含む
        (`Path(filename).name`が元の文字列と完全一致しない場合、区切り文字や
        親ディレクトリ参照が含まれていたとみなす)
      - 拡張子が`.pdf`(大文字小文字を区別しない)でない
      - `directory`配下に実在するファイルでない
    """
    if filename == "" or Path(filename).name != filename:
        return None
    if len(filename) < 4 or filename[-4:].lower() != ".pdf":
        return None
    candidate = directory / filename
    if not candidate.is_file():
        return None
    return candidate
