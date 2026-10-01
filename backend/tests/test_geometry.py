"""`app.domain.geometry` の単体テスト (Issue #40 Phase 6-E指示3-E)。

座標系は0.0〜1.0正規化・原点左上・Y軸下向き(`product_df.py`のdocstring参照)。
これらの関数はまだどの実ルールにも接続していない、純粋な部品。
"""
from app.domain.geometry import Rect, is_above, is_below, is_left_of, is_right_of, overlaps


def test_is_above_and_is_below_are_consistent_with_y_axis_down():
    # yが小さい方が画面上で上(VCTが下寄り、CHが上寄りの例)。
    ch = Rect(x=0.1, y=0.1, w=0.05, h=0.05)  # center_y = 0.125
    vct = Rect(x=0.1, y=0.3, w=0.05, h=0.05)  # center_y = 0.325
    assert is_above(ch, vct) is True
    assert is_below(ch, vct) is False
    assert is_above(vct, ch) is False
    assert is_below(vct, ch) is True


def test_is_above_false_when_same_center_y():
    a = Rect(x=0.0, y=0.1, w=0.1, h=0.1)
    b = Rect(x=0.5, y=0.1, w=0.1, h=0.1)
    assert is_above(a, b) is False
    assert is_below(a, b) is False


def test_tolerance_absorbs_small_differences():
    a = Rect(x=0.0, y=0.100, w=0.1, h=0.1)
    b = Rect(x=0.0, y=0.105, w=0.1, h=0.1)
    assert is_above(a, b, tolerance=0.0) is True
    assert is_above(a, b, tolerance=0.01) is False


def test_is_left_of_and_is_right_of():
    left = Rect(x=0.0, y=0.0, w=0.1, h=0.1)
    right = Rect(x=0.5, y=0.0, w=0.1, h=0.1)
    assert is_left_of(left, right) is True
    assert is_right_of(left, right) is False
    assert is_right_of(right, left) is True
    assert is_left_of(right, left) is False


def test_overlaps_true_when_rects_intersect():
    a = Rect(x=0.0, y=0.0, w=0.2, h=0.2)
    b = Rect(x=0.1, y=0.1, w=0.2, h=0.2)
    assert overlaps(a, b) is True
    assert overlaps(b, a) is True


def test_overlaps_false_when_rects_are_disjoint():
    a = Rect(x=0.0, y=0.0, w=0.1, h=0.1)
    b = Rect(x=0.5, y=0.5, w=0.1, h=0.1)
    assert overlaps(a, b) is False


def test_overlaps_false_when_rects_only_touch_at_edge():
    a = Rect(x=0.0, y=0.0, w=0.1, h=0.1)
    b = Rect(x=0.1, y=0.0, w=0.1, h=0.1)
    assert overlaps(a, b) is False
