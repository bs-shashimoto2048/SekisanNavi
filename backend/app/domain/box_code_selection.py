"""盤ごとの箱コード自動選定 (部品台帳「箱･単独」「箱･左右」「箱･中」)。

純粋関数のみ(DB・ファイルへ触れない)。業務ルールは次のとおり。

1. 接続情報(BAN_CONNECT)→品名カテゴリ
   - `箱･単独` → 箱･単独 / `箱･左右(L)`・`箱･左右(R)` → 箱･左右 / `箱･中央` → 箱･中
   - NFKC・空白除去・括弧の全半角など「意味が同じ表記ゆれ」だけを正規化する。
     未知・空欄は別カテゴリへ推測変換せず要確認。
2. 型式
   - 製番の箱体型式から解決した第1記号(例: `OS2`)と、マスタ型式を照合する。
   - マスタ型式にハイフンがあれば最初のハイフンより前だけを第1記号とし、後ろは無視する
     (`OS2- 816` → `OS2`)。ハイフンが無ければ型式全体(`OA`)と完全一致。NFKC正規化済み。
3. 定格(マスタ実データ確認済みの4形)。単位は形ごとに異なる点に注意。
   - `H*W*D`(例 `2.3*0.9*2.0`): **m単位**。盤寸法(mm)へ ×1000 して照合する。
   - `H*W*D:両開` など末尾の `:...` は寸法照合から除外する。
   - `H*W*D1～D2`(例 `2.3*0.5*0.7～0.9`): 奥行は範囲(両端を含む)。
   - `H+W+D=N`(例 `H+W+D=4500`): **mm単位**。BAN_H1 + BAN_W + BAN_D がちょうど N のときだけ一致。
   - 上記以外の定格は「解釈できない」とし、自動確定しない。
4. 寸法の一致規則
   - 使う寸法は BAN_H1(正面高さ)・BAN_W・BAN_D。BAN_H2(背面高さ)は使わない。
   - 高さ: 定格 2.3m は 2300 以上 2400 未満(2300〜2399mm)を一致とする。
   - 奥行: 定格どおり(単値はちょうど、範囲は両端を含む)。
   - 幅: 実幅と同じ定格幅があればそれ、無ければ実幅を含む次の定格幅
     (実幅 1.3m → 1.4m)。「次の定格幅」は、型式・高さ・奥行で絞った候補が持つ定格幅の中で、
     実幅以上の最小のもの。実幅がその最大を超える場合は該当なし。
5. 一意に決まれば選定、0件・複数件・解釈不能は要確認(適当なコードを選ばない)。
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from enum import Enum

from app.domain.models import EstimateMasterItem

CATEGORY_SINGLE = "箱･単独"
CATEGORY_LEFT_RIGHT = "箱･左右"
CATEGORY_MIDDLE = "箱･中"
BOX_CATEGORIES: tuple[str, ...] = (CATEGORY_SINGLE, CATEGORY_LEFT_RIGHT, CATEGORY_MIDDLE)

_MM_PER_M = Decimal(1000)
# 高さ定格 2.3m → 2300〜2399mm を一致扱い(2300以上2400未満)。
_HEIGHT_BAND_MM = Decimal(100)


def _nfkc(text: str) -> str:
    return unicodedata.normalize("NFKC", text)


def _compact(text: str) -> str:
    return re.sub(r"\s+", "", _nfkc(text))


def box_category_for_connect(raw: str | None) -> str | None:
    """BAN_CONNECT → 品名カテゴリ。未知・空欄は None(推測しない)。"""
    if raw is None:
        return None
    text = _compact(raw)
    if text == "":
        return None
    # NFKCで `･`(半角中点)・`・` 等は U+30FB(・)へ寄る場合があるため、中点類を統一する。
    text = re.sub(r"[・･·•]", "･", text)
    if text == "箱･単独":
        return CATEGORY_SINGLE
    if text in ("箱･左右(L)", "箱･左右(R)"):
        return CATEGORY_LEFT_RIGHT
    if text == "箱･中央":
        return CATEGORY_MIDDLE
    return None


def master_first_symbol(model: str | None) -> str | None:
    """マスタ型式から第1記号を取り出す。解釈できなければ None。"""
    if model is None:
        return None
    text = _compact(model)
    if text == "":
        return None
    head = text.split("-", 1)[0]
    return head or None


class RatingKind(str, Enum):
    DIMENSIONS = "dimensions"  # H*W*D
    SUM = "sum"                # H+W+D=N


@dataclass(frozen=True)
class Rating:
    kind: RatingKind
    # DIMENSIONS: 定格の寸法(mm)。奥行は [depth_min, depth_max](単値は同値)。
    height_mm: Decimal | None = None
    width_mm: Decimal | None = None
    depth_min_mm: Decimal | None = None
    depth_max_mm: Decimal | None = None
    # SUM: 合計(mm)。
    total_mm: Decimal | None = None


_NUM = r"\d+(?:\.\d+)?"
_DIM_RE = re.compile(rf"^({_NUM})\*({_NUM})\*({_NUM})(?:~({_NUM}))?$")
_SUM_RE = re.compile(rf"^H\+W\+D=({_NUM})$", re.IGNORECASE)


def parse_rating(raw: str | None) -> Rating | None:
    """定格表記を解釈する。解釈できない表記は None(自動確定しない)。"""
    if raw is None:
        return None
    text = _compact(raw).replace("〜", "~").replace("∼", "~")
    # 末尾の `:両開` など(寸法照合に使わない付記)を除外する。
    text = text.split(":", 1)[0]
    if text == "":
        return None
    try:
        m = _SUM_RE.match(text)
        if m:
            return Rating(kind=RatingKind.SUM, total_mm=Decimal(m.group(1)))
        m = _DIM_RE.match(text)
        if m:
            h, w, d1, d2 = m.group(1), m.group(2), m.group(3), m.group(4)
            lo = Decimal(d1) * _MM_PER_M
            hi = Decimal(d2) * _MM_PER_M if d2 is not None else lo
            if hi < lo:
                return None
            return Rating(
                kind=RatingKind.DIMENSIONS,
                height_mm=Decimal(h) * _MM_PER_M,
                width_mm=Decimal(w) * _MM_PER_M,
                depth_min_mm=lo,
                depth_max_mm=hi,
            )
    except InvalidOperation:
        return None
    return None


@dataclass(frozen=True)
class PanelDimensionsMm:
    """選定に使う盤寸法(mm)。BAN_H2(背面高さ)は含めない。"""

    height: float | None  # BAN_H1(正面高さ)
    width: float | None  # BAN_W
    depth: float | None  # BAN_D


def _positive_decimal(value: float | None) -> Decimal | None:
    if value is None:
        return None
    try:
        d = Decimal(str(value))
    except InvalidOperation:
        return None
    if not d.is_finite() or d <= 0:
        return None
    return d


class SelectionStatus(str, Enum):
    SELECTED = "selected"
    NEEDS_REVIEW = "needs_review"


@dataclass
class BoxSelection:
    status: SelectionStatus
    category: str | None
    item: EstimateMasterItem | None = None
    reason: str = ""
    candidates: list[EstimateMasterItem] = field(default_factory=list)


def _needs_review(category: str | None, reason: str, candidates: list[EstimateMasterItem] | None = None) -> BoxSelection:
    return BoxSelection(SelectionStatus.NEEDS_REVIEW, category, None, reason, candidates or [])


def select_box_code(
    *,
    connect: str | None,
    primary_symbol: str | None,
    dimensions: PanelDimensionsMm,
    master_items: list[EstimateMasterItem],
) -> BoxSelection:
    """1盤分の箱コードを選ぶ。`master_items`は箱3カテゴリの全件(他カテゴリは無視される)。"""
    category = box_category_for_connect(connect)
    if category is None:
        shown = "空欄" if connect is None or connect.strip() == "" else f"「{connect}」"
        return _needs_review(None, f"接続情報が{shown}のため、箱の品名カテゴリを決められません")

    symbol = _compact(primary_symbol) if primary_symbol else ""
    if symbol == "":
        return _needs_review(category, "製番の箱体型式から第1記号を解決できません")

    h = _positive_decimal(dimensions.height)
    w = _positive_decimal(dimensions.width)
    d = _positive_decimal(dimensions.depth)
    if h is None or w is None or d is None:
        missing = [n for n, v in (("正面高さ(BAN_H1)", h), ("幅(BAN_W)", w), ("奥行(BAN_D)", d)) if v is None]
        return _needs_review(category, f"盤寸法が未設定のため照合できません: {'・'.join(missing)}")

    in_category = [it for it in master_items if it.category == category]
    same_type: list[EstimateMasterItem] = []
    for it in in_category:
        head = master_first_symbol(it.model)
        if head is not None and head == symbol:
            same_type.append(it)
    if not same_type:
        return _needs_review(category, f"{category}に第1記号「{symbol}」の型式がありません")

    parsed: list[tuple[EstimateMasterItem, Rating]] = []
    unparsed: list[EstimateMasterItem] = []
    for it in same_type:
        rating = parse_rating(it.rating)
        if rating is None:
            unparsed.append(it)
        else:
            parsed.append((it, rating))
    if unparsed:
        sample = "、".join(f"{u.code}「{u.rating}」" for u in unparsed[:3])
        return _needs_review(category, f"解釈できない定格表記があるため自動確定しません: {sample}", [u for u in unparsed])

    total = h + w + d
    matched: list[EstimateMasterItem] = []

    # H+W+D=N: 合計がちょうど一致するものだけ。
    for it, r in parsed:
        if r.kind is RatingKind.SUM and r.total_mm == total:
            matched.append(it)

    # H*W*D: 高さ・奥行で絞り、幅は「同じ、無ければ次の定格幅」。
    dim_candidates = [
        (it, r)
        for it, r in parsed
        if r.kind is RatingKind.DIMENSIONS
        and r.height_mm is not None
        and r.height_mm <= h < r.height_mm + _HEIGHT_BAND_MM
        and r.depth_min_mm is not None
        and r.depth_max_mm is not None
        and r.depth_min_mm <= d <= r.depth_max_mm
    ]
    widths = sorted({r.width_mm for _, r in dim_candidates if r.width_mm is not None and r.width_mm >= w})
    if widths:
        chosen_width = widths[0]
        matched.extend(it for it, r in dim_candidates if r.width_mm == chosen_width)

    if not matched:
        return _needs_review(
            category,
            f"{category}・第1記号「{symbol}」で盤寸法(高さ{h:f}・幅{w:f}・奥行{d:f}mm)に一致する定格がありません",
        )
    if len(matched) > 1:
        codes = "、".join(it.code for it in matched[:6])
        return _needs_review(category, f"候補が複数あり一意に決められません: {codes}", matched)

    item = matched[0]
    return BoxSelection(
        SelectionStatus.SELECTED,
        category,
        item,
        f"接続「{connect}」→{category}、第1記号「{symbol}」、高さ{h:f}・幅{w:f}・奥行{d:f}mm → {item.code}({item.model} / {item.rating})",
        matched,
    )


__all__ = [
    "BOX_CATEGORIES",
    "CATEGORY_SINGLE",
    "CATEGORY_LEFT_RIGHT",
    "CATEGORY_MIDDLE",
    "BoxSelection",
    "PanelDimensionsMm",
    "Rating",
    "RatingKind",
    "SelectionStatus",
    "box_category_for_connect",
    "master_first_symbol",
    "parse_rating",
    "select_box_code",
]
