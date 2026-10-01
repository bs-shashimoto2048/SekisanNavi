"""BBox同士の相対位置関係を判定する純粋な幾何predicate
(Issue #40 Phase 6-E指示3-E: POSITION/RANGE調査)。

**重要(スコープの限定)**: ここで定義する関数は「2つのBBoxの中心点の
上下・左右関係」「矩形としての重なり」という純粋に幾何学的な判定のみを
提供する。「18323(VCT架台)はCHがVCTの上にあれば社内作業としてコードが
必要」といった**業務的な意味づけ**は一切含まない。Issue #40 Phase 1報告
コメント5章の通り、この種の相対位置判定の具体的な成立条件(どの組合せで
成立/不成立になるか)は資料から確定できていないため、これらの関数を実ルール
(`estimate_rule_masters`)へ接続することはPhase 6-Eでは行わない。あくまで
「将来、業務ルールが確定した時に使える部品」として提供するに留める。

**座標系の前提**(`app.services.product_df`のdocstring、
`docs/architecture.md`「Overlay座標系」章参照):
  - `Detection.bbox_x/y/w/h`、`PanelAreaFromDf.normalized_rect`はいずれも
    0.0〜1.0正規化座標で、原点は左上・Y軸は下向き(DOM/PNG座標系)。
    CAD原点(左下・Y上向き)からの変換は`product_df.py`側で既に完了している。
  - この座標系はzoom/pan/fit操作から独立している。
  - そのため「above(画面上で物理的に上にある)」は「Y座標が小さい」と対応する。

`tolerance`(許容誤差)は呼び出し側が明示的に指定するパラメータとして持たせて
いるが、実務上どの値が適切かは資料から確認できていないため、既定値は0.0
(厳密な中心点比較)とする。「同一盤内か」の判定は既存の
`app.services.panel_assignment.assign_detection_to_panel`(交差面積ベース)を
引き続き使う想定で、ここでは扱わない。
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Rect:
    """正規化座標(0.0〜1.0、原点左上・Y軸下向き)の矩形。
    `Detection.bbox_x/y/w/h`等、既存の4つ組フィールドをそのまま包める形。"""

    x: float
    y: float
    w: float
    h: float

    @property
    def center_x(self) -> float:
        return self.x + self.w / 2

    @property
    def center_y(self) -> float:
        return self.y + self.h / 2

    @property
    def top(self) -> float:
        return self.y

    @property
    def bottom(self) -> float:
        return self.y + self.h

    @property
    def left(self) -> float:
        return self.x

    @property
    def right(self) -> float:
        return self.x + self.w


def is_above(a: Rect, b: Rect, tolerance: float = 0.0) -> bool:
    """aの中心がbの中心より画面上で上(Y座標が小さい)かどうか。"""
    return a.center_y < b.center_y - tolerance


def is_below(a: Rect, b: Rect, tolerance: float = 0.0) -> bool:
    """aの中心がbの中心より画面上で下(Y座標が大きい)かどうか。"""
    return a.center_y > b.center_y + tolerance


def is_left_of(a: Rect, b: Rect, tolerance: float = 0.0) -> bool:
    return a.center_x < b.center_x - tolerance


def is_right_of(a: Rect, b: Rect, tolerance: float = 0.0) -> bool:
    return a.center_x > b.center_x + tolerance


def overlaps(a: Rect, b: Rect) -> bool:
    """矩形同士が交差するか。
    `app.services.panel_assignment.intersection_area`と同じ計算式(面積>0なら
    交差とみなす)の、座標を直接比較するだけの素朴な実装。"""
    ix = max(a.x, b.x)
    iy = max(a.y, b.y)
    iw = min(a.right, b.right) - ix
    ih = min(a.bottom, b.bottom) - iy
    return iw > 0 and ih > 0


__all__ = ["Rect", "is_above", "is_below", "is_left_of", "is_right_of", "overlaps"]
