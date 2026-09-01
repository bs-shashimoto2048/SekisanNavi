"""`product_df.csv` (ページ・盤ごとの図面座標・縮尺情報) の読み込み (Phase 1.8)。

Frontendへは生のCSV行をそのまま渡さず、ページ番号ごとに正規化した盤領域情報
(`PanelAreaFromDf`) へ変換してから返す (指示書28章)。CSVパース自体はこのモジュールに
閉じ込め、既存Parserの重複実装を避ける (指示書29章: 本Backendには他にproduct_df読込
処理がなかったため、本モジュールを新規追加した)。

実データ調査で確認した列構成 (`A1GV2421/product_df.csv` 等で確認済み。cp932エンコード):
    BAN_MENNO, BAN_NO, PAGE, ZUMEI, BAN_MEISYOU, BAN_TYPE, BAN_H1, BAN_H2,
    BAN_W, BAN_D, KITEN_X, KITEN_Y, DETECT_AREA_X, DETECT_AREA_Y,
    FRAME_ORG_X, FRAME_ORG_Y, FRAME_MINI_X, FRAME_MINI_Y, SCALE_X, SCALE_Y

盤領域の座標変換 (指示書14-18章。実データ検算により確定。詳細はdocs/data-source.md):
  - KITEN_X/KITEN_Y: 盤領域の基点(左下)のCAD実座標 (mm, 原点=左下)。
  - DETECT_AREA_X/DETECT_AREA_Y: 同じ基点から見た盤領域の幅・高さ (mm)。
    実データ検算により、BAN_W/BAN_H1/BAN_H2/BAN_D (盤の物理寸法) と一致することを
    複数製番・複数BAN_TYPE (正面図/背面図/側面図/基礎図) で確認済み — 正面/背面は
    BAN_W×BAN_H、側面はBAN_D×BAN_H相当になる。したがって右上座標は
    (KITEN_X+DETECT_AREA_X, KITEN_Y+DETECT_AREA_Y) で求まる
    (指示書36章で「推測禁止」とされた右上座標の式は、当初例示された
    「FRAME_MINI_XをFRAME_MINI_Xで割る」ような自己参照ではなく、この
    DETECT_AREA_X/Yを用いた式であることを実データで確認して確定した)。
  - SCALE_X/SCALE_Y: CAD実座標(mm)を`{page}.png`のpx座標へ変換する係数(mm/px)。
    列として直接与えられている (FRAME_ORG_X/Y ÷ FRAME_MINI_X/Y と一致することも確認済み)。
  - FRAME_MINI_X/FRAME_MINI_Y: `{page}.png`のpx原寸。実ファイル(PIL)で実測し、
    値が完全一致することを確認済み (例: A1GV2421 page16 → 2077×1485px)。
  - Y軸: CAD実座標は原点が左下 (Y上向き)、PNG/DOMは原点が左上 (Y下向き) のため、
    正規化後に `1 - y` でY軸を反転する。
"""
from __future__ import annotations

import csv
import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

# 実データがcp932(Shift_JIS系)で保存されていることを確認済み。
_ENCODING = "cp932"
_FILENAME_SUFFIX = "product_df.csv"


@dataclass
class NormalizedRect:
    x: float
    y: float
    w: float
    h: float


@dataclass
class PanelAreaFromDf:
    """product_df.csv 1行から得られる盤領域情報 (指示書21章の保持項目)。"""

    page_no: int
    ban_menno: int
    ban_no: int
    # 盤領域Overlay内ラベル表示用 (盤領域内表示の追加指示)。
    ban_meisyou: str
    ban_type: str
    # 右ペイン「盤パラメータ」表示用の物理寸法 (Phase 1.9)。座標計算には使わないため、
    # 欠損・非数値でも行全体はスキップせず None として保持する (要件12/14)。
    ban_h1: float | None
    ban_h2: float | None
    ban_w: float | None
    ban_d: float | None
    normalized_rect: NormalizedRect
    # 将来のクリック選択・診断用に元の値も保持する (指示書21章)。
    kiten_x: float
    kiten_y: float
    scale_x: float
    scale_y: float
    detect_area_x: float
    detect_area_y: float


@dataclass
class ProductDfResult:
    panels_by_page: dict[int, list[PanelAreaFromDf]] = field(default_factory=dict)
    # ページごとの図面種別 (ZUMEI)。括弧の連番部分を除いたグループ名
    # (例: "内部機器配置図(1-1)" -> "内部機器配置図") で、既存のDrawingNavigatorの
    # グループ分けと同じ粒度にする (db/seed.pyの命名規則を踏襲)。
    drawing_type_by_page: dict[int, str] = field(default_factory=dict)
    # ページごとの図面表示名 (ZUMEIそのもの。連番接尾辞を除去しない)。
    # 例: "内部機器配置図(1-1)"。中央Viewerの見出し表示に使う。
    drawing_name_by_page: dict[int, str] = field(default_factory=dict)
    # スキップした行の理由等 (Backendログへ残す診断情報。指示書32章)。
    warnings: list[str] = field(default_factory=list)


class _SkipRow(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _parse_float(row: dict[str, str], key: str) -> float:
    raw = row.get(key)
    if raw is None or raw.strip() == "":
        raise _SkipRow(f"{key}が空です")
    try:
        return float(raw)
    except ValueError:
        raise _SkipRow(f"{key}の値が数値ではありません: {raw!r}") from None


def _parse_optional_float(row: dict[str, str], key: str) -> float | None:
    """表示専用の数値項目 (BAN_H1/H2/W/D等) 用。座標計算とは異なり、
    欠損・非数値の場合も行全体をスキップせず None (表示上は「-」) として扱う
    (Phase 1.9, 右ペイン表示。要件12/14)。"""
    raw = row.get(key)
    if raw is None or raw.strip() == "":
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _parse_int_via_float(row: dict[str, str], key: str) -> int:
    # BAN_NO等、CSV上は "1.0" のようにfloat表記の列がある一方、
    # PAGE/BAN_MENNOは "1" の整数表記のため、共通してfloat経由でintへ丸める。
    return int(_parse_float(row, key))


def _strip_zumei_suffix(zumei: str) -> str:
    """"内部機器配置図(1-1)" のような連番接尾辞を除いたグループ名を返す。

    `db/seed.py` が実データのZUMEIから同じ方式でdrawing_typeを組み立てているため、
    ここでも同じ規則 (末尾の "(...)" を除去) にして表示上の分類が一致するようにする。
    """
    idx = zumei.find("(")
    return zumei[:idx].strip() if idx != -1 else zumei.strip()


def _parse_panel_row(row: dict[str, str]) -> PanelAreaFromDf:
    page_no = _parse_int_via_float(row, "PAGE")
    ban_menno = _parse_int_via_float(row, "BAN_MENNO")
    ban_no = _parse_int_via_float(row, "BAN_NO")
    # 盤領域Overlay内ラベル用 (盤領域内表示の追加指示)。座標計算には使わないため、
    # 欠損していても行全体はスキップしない (空文字列で保持する)。
    ban_meisyou = (row.get("BAN_MEISYOU") or "").strip()
    ban_type = (row.get("BAN_TYPE") or "").strip()
    # 右ペイン表示用の物理寸法 (Phase 1.9)。同上の理由で欠損してもスキップしない。
    ban_h1 = _parse_optional_float(row, "BAN_H1")
    ban_h2 = _parse_optional_float(row, "BAN_H2")
    ban_w = _parse_optional_float(row, "BAN_W")
    ban_d = _parse_optional_float(row, "BAN_D")
    kiten_x = _parse_float(row, "KITEN_X")
    kiten_y = _parse_float(row, "KITEN_Y")
    detect_area_x = _parse_float(row, "DETECT_AREA_X")
    detect_area_y = _parse_float(row, "DETECT_AREA_Y")
    scale_x = _parse_float(row, "SCALE_X")
    scale_y = _parse_float(row, "SCALE_Y")
    frame_mini_x = _parse_float(row, "FRAME_MINI_X")
    frame_mini_y = _parse_float(row, "FRAME_MINI_Y")

    # ゼロ除算の回避 (指示書14章)。不正データとして扱いこの行はスキップする。
    if scale_x == 0:
        raise _SkipRow("SCALE_Xが0です (ゼロ除算回避のためスキップ)")
    if scale_y == 0:
        raise _SkipRow("SCALE_Yが0です (ゼロ除算回避のためスキップ)")
    if frame_mini_x <= 0 or frame_mini_y <= 0:
        raise _SkipRow("FRAME_MINI_X/FRAME_MINI_Yが不正です (0以下)")

    # mm -> {page}.png のpx座標 (CAD原点=左下のまま)。
    left_px = kiten_x / scale_x
    bottom_px = kiten_y / scale_y
    width_px = detect_area_x / scale_x
    height_px = detect_area_y / scale_y
    right_px = left_px + width_px
    top_px = bottom_px + height_px

    # 0.0〜1.0 正規化 (まだCAD座標系 = 原点左下・Y上向き)。
    nx0 = left_px / frame_mini_x
    nx1 = right_px / frame_mini_x
    ny_bottom_cad = bottom_px / frame_mini_y
    ny_top_cad = top_px / frame_mini_y

    # Y軸反転: CAD(原点左下) -> DOM/PNG(原点左上) (指示書18章)。
    dom_top = 1 - ny_top_cad
    dom_bottom = 1 - ny_bottom_cad

    rect = NormalizedRect(x=nx0, y=dom_top, w=nx1 - nx0, h=dom_bottom - dom_top)

    return PanelAreaFromDf(
        page_no=page_no,
        ban_menno=ban_menno,
        ban_no=ban_no,
        ban_meisyou=ban_meisyou,
        ban_type=ban_type,
        ban_h1=ban_h1,
        ban_h2=ban_h2,
        ban_w=ban_w,
        ban_d=ban_d,
        normalized_rect=rect,
        kiten_x=kiten_x,
        kiten_y=kiten_y,
        scale_x=scale_x,
        scale_y=scale_y,
        detect_area_x=detect_area_x,
        detect_area_y=detect_area_y,
    )


def load_product_df(product_dir: Path, product_no: str) -> ProductDfResult:
    """製番ディレクトリ直下の `{product_no}_df.csv` ... ではなく `product_df.csv` を読む。

    実データ調査の結果、ファイル名は製番に依存しない固定名 `product_df.csv` である
    ことを確認済み (`{product_no}_df.csv` は別ファイルで、baninfから読み取った
    盤情報一覧という別データ)。ファイルが存在しない/読み込めない場合は空の結果を返し、
    Frontend全体をエラーにはしない (指示書7章/32章)。理由は `warnings` へ記録し、
    Backendログにも出力する。
    """
    path = product_dir / _FILENAME_SUFFIX
    result = ProductDfResult()

    if not path.is_file():
        msg = f"product_df.csvが見つかりません: {path}"
        result.warnings.append(msg)
        logger.warning(msg)
        return result

    try:
        with path.open(encoding=_ENCODING, newline="") as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader):
                # ZUMEI/drawing_typeは、他の列 (盤座標系) が壊れていても
                # ページ分類だけは可能な限り成立させたいため、別途独立して処理する。
                try:
                    page_no = _parse_int_via_float(row, "PAGE")
                except _SkipRow as e:
                    result.warnings.append(f"行{i + 2}: PAGE列が不正のためスキップ ({e.reason})")
                    logger.warning(
                        "product_df.csv row skipped (product_no=%s, row=%d): %s",
                        product_no,
                        i + 2,
                        e.reason,
                    )
                    continue

                zumei = (row.get("ZUMEI") or "").strip()
                if zumei and page_no not in result.drawing_type_by_page:
                    result.drawing_type_by_page[page_no] = _strip_zumei_suffix(zumei)
                    result.drawing_name_by_page[page_no] = zumei

                try:
                    panel = _parse_panel_row(row)
                except _SkipRow as e:
                    result.warnings.append(
                        f"行{i + 2} (PAGE={page_no}): 盤領域計算をスキップ ({e.reason})"
                    )
                    logger.warning(
                        "product_df.csv panel area skipped (product_no=%s, row=%d, page=%d): %s",
                        product_no,
                        i + 2,
                        page_no,
                        e.reason,
                    )
                    continue

                result.panels_by_page.setdefault(page_no, []).append(panel)
    except OSError as e:
        msg = f"product_df.csvの読み込みに失敗しました: {e}"
        result.warnings.append(msg)
        logger.warning(msg)

    return result
