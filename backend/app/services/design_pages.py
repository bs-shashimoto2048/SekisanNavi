"""`design.csv` (製番単位の設計情報。SekisanNaviDataが出力、CP932・BOMなし)を基準にした図面一覧。

`design.csv`の「ページ番号」「図名」を、製番フォルダの`{ページ番号}.pdf`と照合して一覧にする。

- ページ番号は**文字列のキー**として扱う(`01`と`1`は別のページ。数値化・先頭ゼロの除去はしない)。
- PDFとの照合は大文字小文字を区別しない。キーは実在するPDFのファイル名(拡張子を除く)の綴り。
- 対応するPDFがある行だけを返す(PDFの無い行・ページ番号が空・重複する行は数だけ`skipped_rows`に数える)。
- 各行の表示方法(`mode`):
  - `inference`: 推論用PNG(`{数値}.png`)がある。正のページ番号は従来どおり元PNG・推論結果・オーバーレイを使う。ページ0は専用キー画像経路で表示する。
  - `preview`: 推論用PNGは無いが、隔離領域の表示用プレビューPNGがある(オーバーレイは出さない)。
    ページ「0」(キーがちょうど`0`)だけは、`0.png`・`0__preview.png`が無いとき`0_A1__preview.png`(0.pdfは0_A1.pdfの複製)を使う。
  - `unavailable`: どちらも無い(表示用の画像が未作成)。
- **書類(`0_S0.pdf`=共通製作仕様書、`0_A1.pdf`=設計作図完了シート。SekisanNaviDataが出力)**は、design.csvの行ではなく、
  固定の2つのファイル名だけを`documents`として、図面一覧の最上段(この順)に出す。ページ番号(数値)ではなく、通常の`0.pdf`とも
  別のファイル。ファイルが無い書類は項目を出さない(別のファイルで代用しない)。リンク・空のファイル・別名(大文字小文字違い)は対象外。
- ファイルが無い・CP932でない・見出しが想定と違う・データ行が無い場合は、例外にせず`status`で返す
  (`missing`/`invalid`/`empty`)。例外文言・実パスは結果にもログにも含めない(製番とエラーの型だけを記録する)。
"""
from __future__ import annotations

import csv
import io
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal

logger = logging.getLogger(__name__)

_ENCODING = "cp932"
_FILENAME = "design.csv"
_MAX_BYTES = 5 * 1024 * 1024
_PAGE_COLUMN = "ページ番号"
_NAME_COLUMN = "図名"

# 図面一覧の最上段に固定表示する書類(順序もこのとおり)。(ファイル名の語幹, 種類, 表示名)。ユーザー入力から名前を作らない。
DESIGN_DOCUMENTS: tuple[tuple[str, str, str], ...] = (
    ("0_S0", "spec_sheet", "共通製作仕様書"),
    ("0_A1", "check_sheet", "設計作図完了シート"),
)
_DOCUMENT_STEMS_LOWER = {stem.lower() for stem, _kind, _label in DESIGN_DOCUMENTS}

DesignStatus = Literal["ok", "empty", "missing", "invalid"]
DesignMode = Literal["inference", "preview", "unavailable"]

# 「外    形    図」のように字間に空白が入った図名を読みやすくする(表示専用。ページ番号の値は加工しない)
_CJK_GAP_RE = re.compile(r"(?<=[^\x00-\x7f])\s+(?=[^\x00-\x7f])")


# ページ「0」の行(キーがちょうど`0`。`00`・`01`等は対象外)に、推論用PNGが無いときに代わりに使う書類(設計作図完了シート)の
# 表示用プレビュー。0.pdfは0_A1.pdfの複製なので内容は同じ。書類の行・書類用の経路は変えない。
_PAGE_ZERO_KEY = "0"
_PAGE_ZERO_FALLBACK_PREVIEW_KEY = "0_A1"


def preview_source_keys(key: str) -> tuple[str, ...]:
    """行のキーに対して、表示用プレビューPNG(`{キー}__preview.png`)を探すキー(優先順)。"""
    return (key, _PAGE_ZERO_FALLBACK_PREVIEW_KEY) if key == _PAGE_ZERO_KEY else (key,)


def tidy_drawing_name(name: str) -> str:
    return _CJK_GAP_RE.sub("", " ".join(name.split()))


def page_sort_key(label: str) -> tuple:
    """design.csvのページ番号(文字列)の並び順。数値化して同一視せず、先頭ゼロも保持する。
    1. 数字だけの番号: 先頭が0のもの(0, 00, 01, 02, ...)を先に、その後に先頭ゼロの無いもの(1, 2, 3, ..., 10)。
       どちらのグループも数値の昇順。同じ数値なら先頭ゼロが多い表記(長い方)を先にする(00 → 0)。
    2. 英字(ASCII)で始まる番号: 大文字小文字を区別しないアルファベット順(a1, b1, b2, b3, c, d)。
    3. それ以外(3Aのような数字始まりの混在、記号・日本語始まり等): 最後に、同じく大文字小文字を区別しない順。
    大文字小文字を除いて同じキーになる場合は、元の表記の文字列順(決定的)。"""
    if label.isascii() and label.isdigit():
        return (0 if label.startswith("0") else 1, int(label), -len(label), label)
    if label[:1].isascii() and label[:1].isalpha():
        return (2, label.casefold(), label)
    return (3, label.casefold(), label)


@dataclass
class DesignPage:
    key: str                       # 実在するPDFのファイル名(拡張子を除く)の綴り。一意
    page_label: str                # design.csvの「ページ番号」(加工しない)
    drawing_name: str              # 図名(空白を整えたもの)
    mode: DesignMode
    inference_page_no: int | None = None
    # 元データ(product_df.csvのBAN_MENNO/BAN_NO)の「面番号/盤番号」。`1/1`の形で、重複を除き出現順。
    # 再採番・先頭ゼロの付与/除去はしない。product_dfにそのページが無い(書類ページ等)ときは空。
    ban_labels: list[str] = field(default_factory=list)


@dataclass
class DesignDocument:
    key: str
    kind: str
    label: str


def design_document_path(ccv_dir: Path, key: str) -> Path | None:
    """書類のPDF(`{key}.pdf`)。`key`は固定の2つのどちらかだけ。製番ディレクトリ直下の、綴りが完全に一致する
    通常ファイル(リンク・空のファイルは対象外)のときだけ返す。無ければNone(例外にしない)。"""
    if key not in {stem for stem, _kind, _label in DESIGN_DOCUMENTS}:
        return None
    try:
        filename = f"{key}.pdf"
        if filename not in set(os.listdir(ccv_dir)):          # 大文字小文字違い(別のファイル)を拾わない
            return None
        raw = ccv_dir / filename
        if raw.is_symlink():
            return None
        root = ccv_dir.resolve(strict=False)
        path = raw.resolve(strict=False)
        if path.parent != root or not path.is_file() or path.stat().st_size <= 0:
            return None
    except (OSError, ValueError):
        return None
    return path


def list_design_documents(ccv_dir: Path) -> list[DesignDocument]:
    """図面一覧の最上段に出す書類(実在するものだけ、固定の順序)。"""
    return [
        DesignDocument(key=stem, kind=kind, label=label)
        for stem, kind, label in DESIGN_DOCUMENTS
        if design_document_path(ccv_dir, stem) is not None
    ]


@dataclass
class DesignPagesResult:
    status: DesignStatus = "missing"
    pages: list[DesignPage] = field(default_factory=list)
    skipped_rows: int = 0


def _canonical_page_no(stem: str) -> int | None:
    """`{n}.png`(推論用)のnを、先頭ゼロの無い非負整数のときだけ返す(`01`などは別ページ)。"""
    if stem == "0":
        return 0
    if stem.isascii() and stem.isdigit() and stem == str(int(stem)) and int(stem) > 0:
        return int(stem)
    return None


def load_design_pages(
    product_dir: Path,
    product_no: str,
    preview_exists: Callable[[str], bool],
    ban_labels_by_page: dict[int, list[str]] | None = None,
) -> DesignPagesResult:
    """製番ディレクトリの`design.csv`と`*.pdf`から図面一覧を作る。常に例外を投げず結果を返す。
    `preview_exists(key)`は、そのキーの表示用プレビューPNGが実在するかを返す(保存先は呼び出し側が持つ)。
    `ban_labels_by_page`は、product_df.csvのページ(整数)ごとの「面番号/盤番号」。ページ番号が先頭ゼロの無い
    整数と同じ綴り(`9`など)の行にだけ付ける(`09`などは別のページなので付けない)。"""
    path = product_dir / _FILENAME
    try:
        if not path.is_file():
            return DesignPagesResult(status="missing")
        if path.stat().st_size > _MAX_BYTES:
            logger.warning("design.csv is too large (product_no=%s)", product_no)
            return DesignPagesResult(status="invalid")
        raw = path.read_bytes()
        names = [p.name for p in product_dir.iterdir() if p.is_file()]
    except OSError as e:
        logger.warning("design.csv read failed (product_no=%s): %s", product_no, type(e).__name__)
        return DesignPagesResult(status="invalid")

    try:
        text = raw.decode(_ENCODING)
    except UnicodeDecodeError:
        logger.warning("design.csv is not cp932 (product_no=%s)", product_no)
        return DesignPagesResult(status="invalid")

    try:
        rows = list(csv.reader(io.StringIO(text, newline="")))
    except csv.Error as e:
        logger.warning("design.csv parse failed (product_no=%s): %s", product_no, type(e).__name__)
        return DesignPagesResult(status="invalid")
    if not rows or _PAGE_COLUMN not in rows[0] or _NAME_COLUMN not in rows[0]:
        logger.warning("design.csv has no required columns (product_no=%s)", product_no)
        return DesignPagesResult(status="invalid")
    page_idx, name_idx = rows[0].index(_PAGE_COLUMN), rows[0].index(_NAME_COLUMN)
    body = [r for r in rows[1:] if r]
    if not body:
        return DesignPagesResult(status="empty")

    pdf_by_lower: dict[str, str | None] = {}
    png_by_lower: dict[str, str] = {}
    for n in names:
        stem, dot, ext = n.rpartition(".")
        if not dot:
            continue
        ext = ext.lower()
        if ext == "pdf":
            # 大文字小文字だけが違うPDFが複数ある場合は、どれか判別できないので対象外にする
            pdf_by_lower[stem.lower()] = None if stem.lower() in pdf_by_lower else stem
        elif ext == "png" and not stem.endswith("_detected"):
            png_by_lower[stem.lower()] = stem

    result = DesignPagesResult(status="ok")
    seen: set[str] = set()
    for r in body:
        label = r[page_idx].strip() if len(r) > page_idx else ""
        low = label.lower()
        key = pdf_by_lower.get(low)
        if not label or key is None or low in seen or low in _DOCUMENT_STEMS_LOWER:    # 書類の名前は、図面ページの行にしない
            result.skipped_rows += 1
            continue
        seen.add(low)
        drawing_name = tidy_drawing_name(r[name_idx]) if len(r) > name_idx else ""
        png_stem = png_by_lower.get(low)
        page_no = _canonical_page_no(png_stem) if png_stem is not None else None
        mode: DesignMode
        inference: int | None = None
        if page_no is not None and png_stem == key:
            mode, inference = "inference", page_no
        elif any(preview_exists(k) for k in preview_source_keys(key)):
            mode = "preview"
        else:
            mode = "unavailable"
        key_page_no = _canonical_page_no(key)
        ban_labels = list((ban_labels_by_page or {}).get(key_page_no, [])) if key_page_no is not None else []
        result.pages.append(
            DesignPage(
                key=key,
                page_label=label,
                drawing_name=drawing_name,
                mode=mode,
                inference_page_no=inference,
                ban_labels=ban_labels,
            )
        )
    if not result.pages:
        result.status = "empty"
    # design.csvのページ番号の昇順(`page_sort_key`)。入力(design.csv)の行順には依存しない。
    result.pages.sort(key=lambda p: page_sort_key(p.page_label))
    return result
