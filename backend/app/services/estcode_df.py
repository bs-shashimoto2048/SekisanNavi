"""`estcode_df.csv` (盤ごとの積算コード基本情報) の読み込み (Phase 1.14)。

実データ調査で確認した列構成 (`A1GV2421/estcode_df.csv`。cp932エンコード、
product_df.csv/detected_df.csvと同じ):

    MODEL, BAN_MENNO, BAN_NO, BAN_MEISYOU, BAN_H, BAN_W, BAN_D, BAN_CONNECT,
    PANEL, TRANS, IN_PANEL, SHIELD, DOOR_FRONT, DOOR_BACK, DOOR_STACK,
    DOOR_SIDE, DOOR_SMALL, FAN_ROOF, FAN_DOOR, MAIN_LINE, WIRE_MESH,
    STACK_PLATE, DRAWER_DEVICE, VCT_STAND, BUS_DUCT, PASSAGE,
    INPUT_CU_COEFF, SORT_ORDER

今回このモジュールが使用するのは冒頭の
`MODEL/BAN_MENNO/BAN_NO/BAN_MEISYOU/BAN_H/BAN_W/BAN_D/BAN_CONNECT/SORT_ORDER`
の9列のみ (指示書2章)。それ以外(PANEL/TRANS/...INPUT_CU_COEFF)は将来の積算集約
ロジック向けの内訳フラグ・係数と見られるが、今回はロジックを作り込まないため未使用。

**重要 (指示書10章〜12章での実データ検証結果)**: 指示書は紐付けキーの候補として
`X_No`列を例示していたが、実ファイルにその列名は存在しない。実際は
`product_df.csv`と全く同じ列名 `BAN_MENNO`(面番号)が使われている。
`A1GV2421/product_df.csv`のPAGE=16に属する全12行(盤5件×矢視違い)と、
`estcode_df.csv`の5行を突き合わせた結果、`BAN_MENNO`が一致する行同士で
`BAN_MEISYOU`(盤名称)の値も完全に一致することを確認した
(例: BAN_MENNO=5 → 両ファイルとも "No.2-1低圧動力盤")。したがって
`product_df.csv`の`BAN_MENNO`と`estcode_df.csv`の`BAN_MENNO`は名称・値とも
完全に同じ概念であり、変換・マッピングは不要と判断した。

**紐付けキーの一意性 (指示書11章)**: `A1GV2421/estcode_df.csv`(全5行)で
`BAN_MENNO + BAN_NO`の組み合わせに重複は無い(5行とも一意)。同じ製番内であれば
盤(BAN_MENNO/BAN_NO)ごとに1行のみ存在する構造であり、`SORT_ORDER`等の追加キーは
不要と判断した。

**product_dfとの違い**: `estcode_df.csv`は`PAGE`列を持たない = ページ単位ではなく
**製番単位**のデータ (1つの盤は複数ページ(矢視違い)に登場しうるが、estcode_df上の
盤情報行は1つだけ)。そのためこのモジュールの読み込み結果はページ番号を引数に取らず、
製番ディレクトリ全体で1回読み込めば足りる (`load_estcode_df(product_dir)`)。
"""
from __future__ import annotations

import csv
import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

# product_df.csv/detected_df.csvと同じくcp932(Shift_JIS系)で保存されていることを
# 実データで確認済み。
_ENCODING = "cp932"
_FILENAME = "estcode_df.csv"


@dataclass
class EstimatePanelInfo:
    """estcode_df.csv 1行から得られる、表示用に正規化済みの盤情報
    (指示書26章の`EstimatePanelInfo`相当)。"""

    model: str | None
    ban_menno: int
    ban_no: int
    ban_meisyou: str | None
    ban_h: float | None
    ban_w: float | None
    ban_d: float | None
    ban_connect: str | None
    sort_order: int | None


@dataclass
class EstcodeDfResult:
    panels: list[EstimatePanelInfo] = field(default_factory=list)
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
    # BAN_NOはCSV上"5.0"のようなfloat表記のため、product_df.py/detected_df.pyと
    # 同じくfloat経由でintへ丸める。
    return int(_parse_float(row, key))


def _parse_optional_float(row: dict[str, str], key: str) -> float | None:
    """盤寸法(BAN_H/W/D)用。座標計算とは異なる表示専用の数値項目のため、
    欠損・非数値でも行全体はスキップせずNone(表示上は"-")として扱う
    (指示書8章: 寸法の一部だけ欠けている場合も項目単位で表示する)。"""
    raw = row.get(key)
    if raw is None or raw.strip() == "":
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _parse_optional_int(row: dict[str, str], key: str) -> int | None:
    raw = row.get(key)
    if raw is None or raw.strip() == "":
        return None
    try:
        return int(float(raw))
    except ValueError:
        return None


def _parse_optional_str(row: dict[str, str], key: str) -> str | None:
    raw = row.get(key)
    if raw is None:
        return None
    stripped = raw.strip()
    return stripped if stripped else None


def _parse_row(row: dict[str, str]) -> EstimatePanelInfo:
    # BAN_MENNO/BAN_NOは盤の識別キー(指示書10章/11章)のため必須とし、
    # 欠損・非数値の行はスキップする(誤った盤情報として紐付かないようにする)。
    ban_menno = _parse_int_via_float(row, "BAN_MENNO")
    ban_no = _parse_int_via_float(row, "BAN_NO")

    return EstimatePanelInfo(
        model=_parse_optional_str(row, "MODEL"),
        ban_menno=ban_menno,
        ban_no=ban_no,
        ban_meisyou=_parse_optional_str(row, "BAN_MEISYOU"),
        ban_h=_parse_optional_float(row, "BAN_H"),
        ban_w=_parse_optional_float(row, "BAN_W"),
        ban_d=_parse_optional_float(row, "BAN_D"),
        ban_connect=_parse_optional_str(row, "BAN_CONNECT"),
        sort_order=_parse_optional_int(row, "SORT_ORDER"),
    )


def load_estcode_df(product_dir: Path, product_no: str) -> EstcodeDfResult:
    """製番ディレクトリの`estcode_df.csv`を読み込み、盤ごとの積算コード基本情報を
    返す。PAGE列を持たない製番単位のデータのため、ページ番号は引数に取らない。

    ファイルが存在しない場合はエラーにせず、`file_present=False`の空結果を返す
    (指示書14章相当: 対応データが無くてもアプリ全体を止めない)。
    """
    path = product_dir / _FILENAME
    result = EstcodeDfResult()

    if not path.is_file():
        return result

    result.file_present = True
    try:
        with path.open(encoding=_ENCODING, newline="") as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader):
                try:
                    panel = _parse_row(row)
                except _SkipRow as e:
                    result.warnings.append(f"行{i + 2}: スキップ ({e.reason})")
                    logger.warning(
                        "estcode_df.csv row skipped (product_no=%s, row=%d): %s",
                        product_no,
                        i + 2,
                        e.reason,
                    )
                    continue
                result.panels.append(panel)
    except OSError as e:
        msg = f"estcode_df.csvの読み込みに失敗しました: {e}"
        result.warnings.append(msg)
        logger.warning(msg)

    return result
