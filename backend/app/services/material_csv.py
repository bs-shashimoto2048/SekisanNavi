"""`material.csv` (製番の材料一覧) の読み込み。

SekisanNaviData が設計データの `*.boxspec` から作る製番直下の CSV。列(順序固定):

    PAGE, SOURCE_FILE, SYMBOL_NAME, CABTYPE, COMPONENT_CODE, COMPONENT_NAME, MATERIAL_SPEC

1行 = ページ × 材料シンボル(`BSP-STEELA-*`) × 構成部。cp932(BOMなし)で保存される
(product_df.csv/detected_df.csv/estcode_df.csvと同じ)。値は加工せずそのまま保持する。

`MATERIAL_SPEC` の `未記載`(.boxspec に記載が無い) と `無し`(明示値) は意味が違うため、
どちらも元の文字列のまま保持し、画面側で区別して表示する(ここで正規化・統合しない)。
`CABTYPE` は空のことがある(.boxspec に無い、または対応が決められない場合)。

他のCSV(product_df/detected_df/estcode_df)と同様、ファイルが無い・列が不足・読めない場合も
アプリ全体は止めない(`file_present=False`の空結果、または理由を`warnings`へ記録してその行を
スキップする)。旧データ(material.csvが存在しない製番)の読み込みに影響しない。
"""

from __future__ import annotations

import csv
import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

_ENCODING = "cp932"
_FILENAME = "material.csv"

_REQUIRED_COLUMNS = ("PAGE", "SYMBOL_NAME", "COMPONENT_CODE", "MATERIAL_SPEC")


@dataclass
class MaterialRow:
    page: str
    source_file: str
    symbol_name: str
    cabtype: str
    component_code: str
    component_name: str
    material_spec: str


@dataclass
class MaterialCsvResult:
    rows: list[MaterialRow] = field(default_factory=list)
    file_present: bool = False
    warnings: list[str] = field(default_factory=list)


def _cell(row: dict[str, str | None], key: str) -> str:
    # 値は加工しない(前後の空白も含めて保持)。列が無い/空は空文字列にする。
    value = row.get(key)
    return "" if value is None else value


def load_material_csv(product_dir: Path, product_no: str) -> MaterialCsvResult:
    """製番ディレクトリ直下の`material.csv`を読み込む。CSV順(=ページ順・シンボル順・構成部順)を保つ。

    ファイルが存在しない場合はエラーにせず、`file_present=False`の空結果を返す。
    必須列(PAGE/SYMBOL_NAME/COMPONENT_CODE/MATERIAL_SPEC)が無い場合は、列不足の
    警告を記録して空の行を返す(壊れたCSVを部分的に表示して誤解させないため)。
    """
    path = product_dir / _FILENAME
    result = MaterialCsvResult()

    if not path.is_file():
        return result

    result.file_present = True
    try:
        with path.open(encoding=_ENCODING, newline="") as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames or []
            missing = [c for c in _REQUIRED_COLUMNS if c not in fieldnames]
            if missing:
                msg = f"material.csvに必須列がありません: {', '.join(missing)}"
                result.warnings.append(msg)
                logger.warning("%s (product_no=%s)", msg, product_no)
                return result
            for i, row in enumerate(reader):
                page = _cell(row, "PAGE").strip()
                code = _cell(row, "COMPONENT_CODE").strip()
                if not page or not code:
                    reason = "PAGEまたはCOMPONENT_CODEが空"
                    result.warnings.append(f"行{i + 2}: スキップ ({reason})")
                    logger.warning(
                        "material.csv row skipped (product_no=%s, row=%d): %s", product_no, i + 2, reason
                    )
                    continue
                result.rows.append(
                    MaterialRow(
                        page=page,
                        source_file=_cell(row, "SOURCE_FILE"),
                        symbol_name=_cell(row, "SYMBOL_NAME"),
                        cabtype=_cell(row, "CABTYPE"),
                        component_code=code,
                        component_name=_cell(row, "COMPONENT_NAME"),
                        material_spec=_cell(row, "MATERIAL_SPEC"),
                    )
                )
    except (OSError, UnicodeDecodeError, csv.Error) as e:
        msg = f"material.csvの読み込みに失敗しました: {type(e).__name__}"
        # 一部だけ読めた行を完全な一覧として出さない
        result.rows.clear()
        result.warnings.append(msg)
        logger.warning("%s (product_no=%s)", msg, product_no)

    return result
