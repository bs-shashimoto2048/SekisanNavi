"""`detected_df.csv` (YOLO検出結果、実行済み推論の出力) の読み込みとページ単位での
プレビュー用正規化 (Phase 1.12)。

新規YOLO推論は行わず、製番フォルダに既に出力済みのCSVを参照するだけである
(指示書冒頭)。

実データ調査で確認した列構成 (`A1GV2421/detected_df.csv` 等で確認済み。
product_df.csvと同じcp932エンコード):

    PAGE, YOLO_INDEX, SCORE, DEVICE,
    LEFT_TOP_X, LEFT_TOP_Y, RIGHT_TOP_X, RIGHT_TOP_Y,
    LEFT_BOTTOM_X, LEFT_BOTTOM_Y, RIGHT_BOTTOM_X, RIGHT_BOTTOM_Y,
    CENTER_X, CENTER_Y

  - PAGE: ページ番号。
  - YOLO_INDEX: 同一PAGE内の検出通し番号 (0始まり)。内部識別専用で表示には使わない。
  - SCORE: 検出信頼度 (confidence, 0.0〜1.0)。
  - DEVICE: 検出クラス名 (例: "roof_fan", "panel", "transformer", "sidedoor_l")。
  - LEFT_TOP_X/Y, RIGHT_TOP_X/Y, LEFT_BOTTOM_X/Y, RIGHT_BOTTOM_X/Y: BBoxの4隅の
    CAD実座標。実データでLEFT_TOP_Y == RIGHT_TOP_Y、LEFT_BOTTOM_Y == RIGHT_BOTTOM_Y
    (誤差の範囲内で一致) であることを確認済みで、軸並行の矩形として扱ってよい。
  - CENTER_X/Y: 中心点 (4隅の単純な平均と一致することを確認済み)。座標計算には
    使わない (LEFT_TOP/RIGHT_BOTTOMの4隅から直接矩形を組み立てる)。

座標系・補正式 (指示書5章〜8章。product_df.pyのKITEN_X/Y変換と同じ考え方を踏襲):
  - 実データを比較した結果、TOP側のY値(例: LEFT_TOP_Y)がBOTTOM側(LEFT_BOTTOM_Y)
    より常に大きい。PNG/DOMは「上に行くほどYが小さい」原点左上系のため、これは
    raw座標系が原点左下・Y上向き (product_df.csvのKITEN_Y等と同じCAD座標系) で
    あることを意味する。したがってPNG/DOMへ変換する際はY軸反転が必要
    (`FRAME_MINI_Y - (raw_y / SCALE_Y)`)。
  - X系・Y系それぞれ独立したSCALEを使う (指示書5章の指定通り):
        px_x = raw_x / SCALE_X
        px_y (CAD系, 反転前) = raw_y / SCALE_Y
        dom_y (PNG/DOM系, 反転後) = FRAME_MINI_Y - px_y
  - SCALE_X/SCALE_Y/FRAME_MINI_X/FRAME_MINI_Yは`product_df.csv`の同一PAGE行から取得する
    (`product_df.load_page_scales()`。同一PAGE内で全行が同じ値を持つことを実データで
    確認済み)。
  - 正規化 (0.0〜1.0): px座標をFRAME_MINI_X/FRAME_MINI_Yで割る。FRAME_MINI_X/Yは
    `{page}.png`の実px原寸と一致することをproduct_df.py側で確認済みであり、今回も
    Pillowによる実画像との合成で追加確認済み (docs/implementation-plan.md参照)。

実データでのPillow合成による目視確認: A1GV2421のpage16 (roof_fan×7、sidedoor_l×1、
roof_fan_r×1の計9件) およびpage23 (panel×2、transformer×1) の両方で、実際の
検出対象物(換気扇・サイドドア・パネル・トランス)とBBoxの位置が視覚的に一致することを
確認済み。
"""
from __future__ import annotations

import csv
import logging
from dataclasses import dataclass, field
from pathlib import Path

from app.services.product_df import PageScale

logger = logging.getLogger(__name__)

# product_df.csvと同じくcp932(Shift_JIS系)で保存されていることを実データで確認済み。
_ENCODING = "cp932"
_FILENAME = "detected_df.csv"


@dataclass
class NormalizedRect:
    x: float
    y: float
    w: float
    h: float


@dataclass
class DetectedItem:
    """detected_df.csv 1行から得られる、表示用に正規化済みの検出結果
    (指示書11章の`DetectedPreviewItem`相当)。"""

    page_no: int
    yolo_index: int
    device: str
    score: float
    normalized_rect: NormalizedRect


@dataclass
class DetectedDfResult:
    items_by_page: dict[int, list[DetectedItem]] = field(default_factory=dict)
    # detected_df.csv自体が製番フォルダに存在したかどうか (指示書27章:
    # 存在しない場合は「検出結果なし」として扱い、アプリを止めない)。
    file_present: bool = False
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


def _parse_int_via_float(row: dict[str, str], key: str) -> int:
    # PAGE/YOLO_INDEXはCSV上「16」のような整数表記だが、product_df.csvと
    # 同じ変換経路 (float経由でintへ丸め) にして万一の"16.0"表記にも耐える。
    return int(_parse_float(row, key))


def _parse_row(row: dict[str, str], page_scales: dict[int, PageScale]) -> DetectedItem:
    page_no = _parse_int_via_float(row, "PAGE")

    scale = page_scales.get(page_no)
    if scale is None:
        raise _SkipRow(f"PAGE={page_no}のSCALE情報がproduct_df.csvに見つかりません")
    # load_page_scales()側で既にSCALE_X/SCALE_Y==0やFRAME_MINI<=0は除外済みだが、
    # 呼び出し元の前提が変わっても安全なようにここでも防御する (指示書20章)。
    if scale.scale_x == 0 or scale.scale_y == 0:
        raise _SkipRow("SCALE_X/SCALE_Yが0です (ゼロ除算回避のためスキップ)")

    yolo_index = _parse_int_via_float(row, "YOLO_INDEX")
    score = _parse_float(row, "SCORE")
    device = (row.get("DEVICE") or "").strip()
    if not device:
        raise _SkipRow("DEVICEが空です")

    left_x_raw = _parse_float(row, "LEFT_TOP_X")
    right_x_raw = _parse_float(row, "RIGHT_TOP_X")
    top_y_raw = _parse_float(row, "LEFT_TOP_Y")
    bottom_y_raw = _parse_float(row, "LEFT_BOTTOM_Y")

    left_px = left_x_raw / scale.scale_x
    right_px = right_x_raw / scale.scale_x
    top_raw_px = top_y_raw / scale.scale_y
    bottom_raw_px = bottom_y_raw / scale.scale_y

    # Y軸反転: CAD原点左下 -> PNG/DOM原点左上 (product_df.pyと同じ考え方)。
    dom_top_px = scale.frame_mini_y - top_raw_px
    dom_bottom_px = scale.frame_mini_y - bottom_raw_px

    nx0 = left_px / scale.frame_mini_x
    nx1 = right_px / scale.frame_mini_x
    ny0 = dom_top_px / scale.frame_mini_y
    ny1 = dom_bottom_px / scale.frame_mini_y

    # 指示書21章: 明らかな数値誤差(浮動小数点演算・実データの僅かなズレ)のみ
    # 丸める。実データ検証では全件0.0〜1.0の範囲に収まっていたため、大きく
    # 外れる値をここで無理に押し込めることはしない (=scale変換の誤りを隠さない)。
    x = max(0.0, min(1.0, nx0))
    y = max(0.0, min(1.0, ny0))
    w = max(0.0, nx1 - nx0)
    h = max(0.0, ny1 - ny0)

    return DetectedItem(
        page_no=page_no,
        yolo_index=yolo_index,
        device=device,
        score=score,
        normalized_rect=NormalizedRect(x=x, y=y, w=w, h=h),
    )


def load_detected_df(
    product_dir: Path, product_no: str, page_scales: dict[int, PageScale]
) -> DetectedDfResult:
    """製番ディレクトリの`detected_df.csv`を読み込み、ページごとに正規化した
    検出結果を返す。

    ファイルが存在しない場合はエラーにせず、`file_present=False`の空結果を返す
    (指示書27章: 製番フォルダにdetected_df.csvが無くても図面Viewer自体は使用可能)。
    `page_scales`は呼び出し側が`product_df.load_page_scales()`で取得済みのものを
    渡す想定 (毎回product_df.csvを重複して読み直さないため)。
    """
    path = product_dir / _FILENAME
    result = DetectedDfResult()

    if not path.is_file():
        return result

    result.file_present = True
    try:
        with path.open(encoding=_ENCODING, newline="") as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader):
                try:
                    item = _parse_row(row, page_scales)
                except _SkipRow as e:
                    result.warnings.append(f"行{i + 2}: スキップ ({e.reason})")
                    logger.warning(
                        "detected_df.csv row skipped (product_no=%s, row=%d): %s",
                        product_no,
                        i + 2,
                        e.reason,
                    )
                    continue
                result.items_by_page.setdefault(item.page_no, []).append(item)
    except OSError as e:
        msg = f"detected_df.csvの読み込みに失敗しました: {e}"
        result.warnings.append(msg)
        logger.warning(msg)

    return result
