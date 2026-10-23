"""`material.csv` から、図面情報の「鋼材」欄に出す「外形図」1ページぶんの行を選ぶ。

選択中の図面ページには連動しない。製番の外形図(`product_df.csv` の ZUMEI から連番を除いた図面種別が
「外形図」と完全一致するページ)のうち、情報量が最大のページを1つ選ぶ。

情報量(辞書順で比較。大きいほど情報が多い):
  1. 材料仕様が実際に記載された行数(空・`未記載`・`無し` を除く)
  2. CABTYPE のある行数(箱体型式との突き合わせができる行)
  3. 構成部名のある行数
  4. 総行数
同点のときは、ページ番号(整数として)が小さい方。入力順・実行環境に依存しない決定的な選び方にするため。

ページ番号は文字列のまま扱う(`material.csv` の PAGE の表記を変えない)。ただし `product_df.csv` のページは整数なので、
外形図かどうかの判定には「先頭ゼロの無い正の整数表記」(`16` など)のページだけを対応づける。`01` や `x1` のような
表記は対応づけない(`01` と `1` は別のページであり、推測で同一視しない)。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.services.material_csv import MaterialRow

OUTLINE_DRAWING_TYPE = "外形図"

# 材料仕様として情報を持たない値(表示はするが、情報量には数えない)
_NO_INFO_SPECS = frozenset({"", "未記載", "無し"})


def canonical_page_no(page: str) -> int | None:
    """`16` のような先頭ゼロの無い正の整数表記なら整数を返す。それ以外(`01`・`x1`・空)は None。"""
    if not (page.isascii() and page.isdigit()):
        return None
    n = int(page)
    return n if n > 0 and str(n) == page else None


def information_score(rows: list[MaterialRow]) -> tuple[int, int, int, int]:
    return (
        sum(1 for r in rows if r.material_spec.strip() not in _NO_INFO_SPECS),
        sum(1 for r in rows if r.cabtype.strip()),
        sum(1 for r in rows if r.component_name.strip()),
        len(rows),
    )


@dataclass
class SteelSelection:
    page: str | None = None
    page_no: int | None = None
    rows: list[MaterialRow] = field(default_factory=list)


def select_outline_steel(rows: list[MaterialRow], drawing_type_by_page: dict[int, str]) -> SteelSelection:
    """外形図のページのうち、情報量が最大のページの行(CSV順)を返す。外形図のページに行が無ければ何も選ばない。"""
    by_page: dict[int, list[MaterialRow]] = {}
    for r in rows:
        n = canonical_page_no(r.page)
        if n is not None and drawing_type_by_page.get(n) == OUTLINE_DRAWING_TYPE:
            by_page.setdefault(n, []).append(r)
    if not by_page:
        return SteelSelection()
    best = min(by_page, key=lambda n: (tuple(-v for v in information_score(by_page[n])), n))
    return SteelSelection(page=str(best), page_no=best, rows=by_page[best])
