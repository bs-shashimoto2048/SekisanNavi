"""ヘッダー(整理番号・製番・盤名称)の製番別データ。

ヘッダーは従来、`project_info`の1行(デモ用の固定値)をそのまま表示していたため、別の製番を開いても
デモ製番の整理番号・盤名称が出ていた。ここでは**選択中の製番の出力フォルダにあるデータだけ**から値を作る。

- 整理番号: `design.csv`(CP932)の「整理番号」列。「製番」列が、いま開いている製番(大文字小文字を区別しない)と
  一致する行だけを対象にし、その中で最も多く現れる値を使う(整理番号は製番から機械的に作れない: 例
  `lw0089` / `a1lw0626`)。値は元データのまま(英字は表示用に大文字化する)。
- 製番: 呼び出し側が検証済みの製番(フォルダ名)をそのまま使う。
- 盤名称: 製番単位の盤名称にあたる列は出力データに無い(`product_df.csv`/`estcode_df.csv`の`BAN_MEISYOU`は
  **盤ごと**の名称で、1製番に複数ある)。製番を代表する1つを推測で決めないため、常に`None`(画面は「—」)。

ファイルが無い・CP932でない・列が無い・該当行が無い場合も例外にせず`status`で返す。例外文言・実パスは含めない。
"""
from __future__ import annotations

import csv
import io
import logging
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

logger = logging.getLogger(__name__)

_FILENAME = "design.csv"
_ENCODING = "cp932"
_MAX_BYTES = 5 * 1024 * 1024
_SEIRI_COLUMN = "整理番号"
_SEIBAN_COLUMN = "製番"

HeaderStatus = Literal["ok", "missing", "invalid", "empty"]


@dataclass
class ProductHeader:
    status: HeaderStatus = "missing"
    seiri_no: str | None = None
    panel_name: str | None = None


def load_product_header(product_dir: Path, product_no: str) -> ProductHeader:
    """製番ディレクトリの`design.csv`から整理番号を読む。常に例外を投げず結果を返す。"""
    path = product_dir / _FILENAME
    try:
        if not path.is_file():
            return ProductHeader(status="missing")
        if path.stat().st_size > _MAX_BYTES:
            logger.warning("design.csv is too large (product_no=%s)", product_no)
            return ProductHeader(status="invalid")
        raw = path.read_bytes()
    except OSError as e:
        logger.warning("design.csv read failed (product_no=%s): %s", product_no, type(e).__name__)
        return ProductHeader(status="invalid")
    try:
        rows = list(csv.reader(io.StringIO(raw.decode(_ENCODING), newline="")))
    except (UnicodeDecodeError, csv.Error) as e:
        logger.warning("design.csv parse failed (product_no=%s): %s", product_no, type(e).__name__)
        return ProductHeader(status="invalid")
    if not rows or _SEIRI_COLUMN not in rows[0] or _SEIBAN_COLUMN not in rows[0]:
        return ProductHeader(status="invalid")
    seiri_idx, seiban_idx = rows[0].index(_SEIRI_COLUMN), rows[0].index(_SEIBAN_COLUMN)
    wanted = product_no.strip().lower()
    counts: Counter[str] = Counter()
    for r in rows[1:]:
        if len(r) <= max(seiri_idx, seiban_idx):
            continue
        seiri, seiban = r[seiri_idx].strip(), r[seiban_idx].strip()
        if seiri and seiban.lower() == wanted:
            counts[seiri] += 1
    if not counts:
        return ProductHeader(status="empty")
    # 同数なら先に現れた値(Counterは挿入順を保つ。most_commonは同数で先着を優先する)
    return ProductHeader(status="ok", seiri_no=counts.most_common(1)[0][0].upper())
