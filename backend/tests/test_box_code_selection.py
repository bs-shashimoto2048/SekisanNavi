"""箱コード自動選定(`app.domain.box_code_selection`)の業務ルールの回帰テスト。

マスタ実データ(data/master/estimate_master_a.xlsx)の表記を模した最小の合成マスタで検証する
(単位: H*W*D は m、H+W+D=N は mm)。
"""
from decimal import Decimal

from app.domain.box_code_selection import (
    CATEGORY_LEFT_RIGHT,
    CATEGORY_MIDDLE,
    CATEGORY_SINGLE,
    PanelDimensionsMm,
    RatingKind,
    SelectionStatus,
    box_category_for_connect,
    master_first_symbol,
    parse_rating,
    select_box_code,
)
from app.domain.models import EstimateMasterItem


def _item(id_: int, category: str, model: str, rating: str, price: float | None = 1000.0) -> EstimateMasterItem:
    return EstimateMasterItem(
        id=id_, code=str(10000 + id_), category=category, model=model, rating=rating, note=None, total_price_a=price
    )


def _dims(h=2365.0, w=900.0, d=2000.0) -> PanelDimensionsMm:
    return PanelDimensionsMm(height=h, width=w, depth=d)


def _select(items, *, connect="箱･単独", symbol="OS2", dims=None):
    return select_box_code(connect=connect, primary_symbol=symbol, dimensions=dims or _dims(), master_items=items)


# --- 接続情報 → カテゴリ -------------------------------------------------


def test_connect_maps_to_three_categories():
    assert box_category_for_connect("箱･単独") == CATEGORY_SINGLE
    assert box_category_for_connect("箱･左右(L)") == CATEGORY_LEFT_RIGHT
    assert box_category_for_connect("箱･左右(R)") == CATEGORY_LEFT_RIGHT
    assert box_category_for_connect("箱･中央") == CATEGORY_MIDDLE


def test_connect_notation_variants_are_normalized():
    assert box_category_for_connect("箱・単独") == CATEGORY_SINGLE  # 全角中点
    assert box_category_for_connect(" 箱･左右（Ｌ） ") == CATEGORY_LEFT_RIGHT  # 全角括弧・Ｌ・空白
    assert box_category_for_connect("箱 ･ 中央") == CATEGORY_MIDDLE


def test_unknown_or_blank_connect_is_not_guessed():
    for raw in (None, "", "  ", "箱･右", "単独", "箱･左右", "箱･左右(X)", "箱･中"):
        assert box_category_for_connect(raw) is None


def test_unknown_connect_needs_review_with_no_category():
    r = _select([_item(1, CATEGORY_SINGLE, "OS2- 920", "2.3*0.9*2.0")], connect="箱･右")
    assert r.status is SelectionStatus.NEEDS_REVIEW and r.category is None and r.item is None


# --- 型式(第1記号) -------------------------------------------------------


def test_master_first_symbol_uses_text_before_first_hyphen_only():
    assert master_first_symbol("OS2- 816") == "OS2"
    assert master_first_symbol("OS2-1216") == "OS2"
    assert master_first_symbol("ＯＳ２－９２０") == "OS2"  # NFKC(全角ハイフンも)
    assert master_first_symbol("OA") == "OA"  # ハイフンなし → 全体
    assert master_first_symbol("") is None and master_first_symbol(None) is None and master_first_symbol("  ") is None
    assert master_first_symbol("-920") is None  # ハイフン前が空 → 解釈不能


def test_hyphen_suffix_is_ignored_and_other_symbols_do_not_match():
    items = [
        _item(1, CATEGORY_SINGLE, "OS2-1920", "2.3*0.9*2.0"),  # 後ろは無視 → OS2
        _item(2, CATEGORY_SINGLE, "IS2- 920", "2.3*0.9*2.0"),
        _item(3, CATEGORY_SINGLE, "OS2X-920", "2.3*0.9*2.0"),  # 記号が違う
    ]
    r = _select(items, symbol="OS2")
    assert r.status is SelectionStatus.SELECTED and r.item.id == 1


def test_no_hyphen_model_requires_exact_symbol_match():
    items = [_item(1, CATEGORY_SINGLE, "OA", "H+W+D=5265"), _item(2, CATEGORY_SINGLE, "OAB", "H+W+D=5265")]
    assert _select(items, symbol="OA").item.id == 1
    assert _select(items, symbol="OB").status is SelectionStatus.NEEDS_REVIEW


def test_blank_primary_symbol_needs_review():
    r = _select([_item(1, CATEGORY_SINGLE, "OS2- 920", "2.3*0.9*2.0")], symbol=None)
    assert r.status is SelectionStatus.NEEDS_REVIEW


# --- 定格の解析 -----------------------------------------------------------


def test_parse_rating_forms_and_units():
    r = parse_rating("2.3*0.9*2.0")
    assert r.kind is RatingKind.DIMENSIONS
    assert (r.height_mm, r.width_mm, r.depth_min_mm, r.depth_max_mm) == (
        Decimal(2300), Decimal(900), Decimal(2000), Decimal(2000),
    )  # m → mm
    r = parse_rating("2.3*0.5*0.7～0.9")  # 全角チルダ
    assert (r.depth_min_mm, r.depth_max_mm) == (Decimal(700), Decimal(900))
    r = parse_rating("H+W+D=4500")
    assert r.kind is RatingKind.SUM and r.total_mm == Decimal(4500)  # mm のまま
    assert parse_rating("２.３＊０.９＊２.０").width_mm == Decimal(900)  # NFKC


def test_parse_rating_ignores_trailing_ryobiraki_suffix():
    a, b = parse_rating("2.3*1.2*1.6:両開"), parse_rating("2.3*1.2*1.6")
    assert a == b and a is not None
    assert parse_rating("H+W+D=3500:両開").total_mm == Decimal(3500)


def test_parse_rating_unsupported_forms_return_none():
    for raw in (None, "", "2.3*0.9", "2.3x0.9x2.0", "H+W=4500", "abc", "2.3*0.9*2.0*1", "2.3*0.9*0.9～0.7", ":両開"):
        assert parse_rating(raw) is None, raw


# --- 高さ・奥行・幅 -------------------------------------------------------


def _grid():
    widths = ["0.8", "0.9", "1.0", "1.1", "1.2", "1.4"]
    return [_item(i, CATEGORY_SINGLE, f"OS2-{i}", f"2.3*{w}*2.0") for i, w in enumerate(widths, 1)]


def test_height_band_2300_to_2399_matches_and_boundaries():
    for h in (2300.0, 2365.0, 2399.0, 2399.9):
        assert _select(_grid(), dims=_dims(h=h)).status is SelectionStatus.SELECTED, h
    for h in (2299.0, 2400.0, 2500.0):
        assert _select(_grid(), dims=_dims(h=h)).status is SelectionStatus.NEEDS_REVIEW, h


def test_exact_width_is_used_when_rated_width_exists():
    r = _select(_grid(), dims=_dims(w=900))
    assert r.status is SelectionStatus.SELECTED and r.item.rating == "2.3*0.9*2.0"


def test_next_rated_width_when_actual_width_is_not_rated():
    # 1.3m → 1.4m(1.3は定格に無い)
    assert _select(_grid(), dims=_dims(w=1300)).item.rating == "2.3*1.4*2.0"
    # 0.85m → 0.9m、実幅が定格を少し超える 901 → 1.0m
    assert _select(_grid(), dims=_dims(w=850)).item.rating == "2.3*0.9*2.0"
    assert _select(_grid(), dims=_dims(w=901)).item.rating == "2.3*1.0*2.0"
    # 最大の定格幅(1.4)を超える実幅は該当なし
    assert _select(_grid(), dims=_dims(w=1401)).status is SelectionStatus.NEEDS_REVIEW


def test_skipped_rated_widths_follow_the_available_grid_1_5_to_1_6():
    items = [_item(1, CATEGORY_SINGLE, "OS2-1", "2.3*1.4*2.0"), _item(2, CATEGORY_SINGLE, "OS2-2", "2.3*1.6*2.0")]
    assert _select(items, dims=_dims(w=1500)).item.id == 2


def test_depth_must_match_single_value_exactly():
    assert _select(_grid(), dims=_dims(d=2000)).status is SelectionStatus.SELECTED
    assert _select(_grid(), dims=_dims(d=2001)).status is SelectionStatus.NEEDS_REVIEW
    assert _select(_grid(), dims=_dims(d=1999)).status is SelectionStatus.NEEDS_REVIEW


def test_depth_range_includes_both_ends():
    items = [_item(1, CATEGORY_SINGLE, "SS-0909", "2.3*0.9*0.7～0.9")]
    for d in (700, 800, 900):
        assert _select(items, symbol="SS", dims=_dims(d=d)).status is SelectionStatus.SELECTED, d
    for d in (699, 901):
        assert _select(items, symbol="SS", dims=_dims(d=d)).status is SelectionStatus.NEEDS_REVIEW, d


def test_uses_front_height_h1_and_never_back_height_h2():
    # PanelDimensionsMm は BAN_H2 を持たない。高さは正面高さだけで照合される(背面高さを渡す経路が無い)。
    assert not hasattr(PanelDimensionsMm(height=1.0, width=1.0, depth=1.0), "back_height")
    assert _select(_grid(), dims=_dims(h=2365)).status is SelectionStatus.SELECTED
    assert _select(_grid(), dims=_dims(h=2000)).status is SelectionStatus.NEEDS_REVIEW


def test_missing_dimensions_need_review_and_name_the_missing_item():
    for dims, label in ((_dims(h=None), "BAN_H1"), (_dims(w=None), "BAN_W"), (_dims(d=0.0), "BAN_D")):
        r = _select(_grid(), dims=dims)
        assert r.status is SelectionStatus.NEEDS_REVIEW and label in r.reason


# --- H+W+D=N --------------------------------------------------------------


def test_sum_rating_matches_only_exact_total():
    items = [_item(1, CATEGORY_SINGLE, "OA", "H+W+D=5265"), _item(2, CATEGORY_SINGLE, "OA", "H+W+D=5300")]
    r = _select(items, symbol="OA", dims=_dims(h=2365, w=900, d=2000))
    assert r.status is SelectionStatus.SELECTED and r.item.id == 1
    r = _select(items, symbol="OA", dims=_dims(h=2365, w=900, d=2001))  # 5266 → どれにも一致しない
    assert r.status is SelectionStatus.NEEDS_REVIEW


def test_sum_uses_h1_plus_w_plus_d():
    items = [_item(1, CATEGORY_SINGLE, "OA", "H+W+D=4500")]
    assert _select(items, symbol="OA", dims=_dims(h=2300, w=1200, d=1000)).status is SelectionStatus.SELECTED
    assert _select(items, symbol="OA", dims=_dims(h=2300, w=1200, d=1001)).status is SelectionStatus.NEEDS_REVIEW


# --- 両開などの付記 --------------------------------------------------------


def test_trailing_ryobiraki_does_not_block_dimension_match():
    items = [_item(1, CATEGORY_SINGLE, "OS2-1216", "2.3*1.2*1.6:両開")]
    r = _select(items, dims=_dims(w=1200, d=1600))
    assert r.status is SelectionStatus.SELECTED and r.item.id == 1


# --- 0件・複数・未対応 ------------------------------------------------------


def test_zero_candidates_need_review():
    r = _select([_item(1, CATEGORY_SINGLE, "IS2-1", "2.3*0.9*2.0")], symbol="OS2")
    assert r.status is SelectionStatus.NEEDS_REVIEW and r.item is None


def test_multiple_candidates_need_review_and_are_listed():
    items = [_item(1, CATEGORY_SINGLE, "OS2-1", "2.3*0.9*2.0"), _item(2, CATEGORY_SINGLE, "OS2-2", "2.3*0.9*2.0")]
    r = _select(items)
    assert r.status is SelectionStatus.NEEDS_REVIEW and r.item is None
    assert {c.id for c in r.candidates} == {1, 2}


def test_dimension_and_sum_rated_items_matching_together_need_review():
    items = [_item(1, CATEGORY_SINGLE, "OA", "H+W+D=5265"), _item(2, CATEGORY_SINGLE, "OA-920", "2.3*0.9*2.0")]
    assert _select(items, symbol="OA").status is SelectionStatus.NEEDS_REVIEW


def test_unsupported_rating_of_same_type_blocks_auto_selection():
    items = [_item(1, CATEGORY_SINGLE, "OS2-1", "2.3*0.9*2.0"), _item(2, CATEGORY_SINGLE, "OS2-2", "特注")]
    r = _select(items)
    assert r.status is SelectionStatus.NEEDS_REVIEW and "特注" in r.reason


def test_other_categories_are_not_candidates():
    items = [_item(1, CATEGORY_LEFT_RIGHT, "OS2-1", "2.3*0.9*2.0")]
    assert _select(items, connect="箱･単独").status is SelectionStatus.NEEDS_REVIEW
    assert _select(items, connect="箱･左右(L)").item.id == 1
