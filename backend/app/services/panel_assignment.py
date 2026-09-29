"""BBox(Detection)の盤所属判定 (交差面積ベース)。

`app.services.estimate_confirmation_builder`が元々持っていた
`_assign_detection_to_panel`をこのモジュールへ切り出した(Issue #40 Phase 2
指示5: 「panel groupingについて、Frontend/Backendに存在する盤所属判定の
二重実装を確認し、今回のルール評価で判定結果が食い違わない構成にしてください」
への対応)。

Backend側は元々`estimate_confirmation_builder.py`が独自に持っていたコピーを
このモジュールへ集約し、新設の`estimate_rule_evaluator.py`も同じ関数を使う
ことで、Backend内での二重実装は解消した。Frontend側
(`estimateAggregationReal.ts::assignDetectionToPanel`)は本Phaseで変更しない
(既存Viewer挙動を壊さないことを優先する。Issue #40 Phase 2指示5)。判定順・
判定式(交差面積、tie判定含む)はFrontend実装と完全に同一のロジックのまま
であり、挙動そのものが乖離する変更は行っていない。
"""
from __future__ import annotations

from dataclasses import dataclass

from app.services.product_df import PanelAreaFromDf

PRODUCT_TARGET_ID = "product"
TIE_TARGET_ID = "__tie__"


def physical_panel_key(panel: PanelAreaFromDf) -> str:
    """物理盤の識別キー (面番号:盤番号のみ)。Frontend
    `estimateAggregationReal.ts::physicalPanelKey`と同じ考え方。"""
    return f"{panel.ban_menno}:{panel.ban_no}"


def panel_target_id(panel: PanelAreaFromDf) -> str:
    return f"panel:{physical_panel_key(panel)}"


def intersection_area(
    ax: float, ay: float, aw: float, ah: float, bx: float, by: float, bw: float, bh: float
) -> float:
    """Frontend `utils/bbox.ts::intersectionArea` と同じ計算式の移植。"""
    ix = max(ax, bx)
    iy = max(ay, by)
    iw = min(ax + aw, bx + bw) - ix
    ih = min(ay + ah, by + bh) - iy
    if iw > 0 and ih > 0:
        return iw * ih
    return 0.0


@dataclass
class PanelHit:
    panel: PanelAreaFromDf
    area: float


@dataclass
class ProductAssignment:
    kind: str = "product"


@dataclass
class PanelAssignment:
    panel: PanelAreaFromDf
    area: float
    kind: str = "panel"


@dataclass
class TieAssignment:
    candidates: list[PanelHit]
    kind: str = "tie"


Assignment = ProductAssignment | PanelAssignment | TieAssignment


def assign_detection_to_panel(
    bbox: tuple[float, float, float, float], panels: list[PanelAreaFromDf]
) -> Assignment:
    """Frontend `estimateAggregationReal.ts::assignDetectionToPanel`と同じ判定順の移植。

    判定順:
      1. 各盤BBoxとの交差面積を求める。
      2. 交差する盤が0件 -> 製品全体。
      3. 交差する盤が1件 -> その盤。
      4. 交差する盤が2件以上 -> 交差面積が最大の盤。
      5. 最大交差面積が複数の"異なる盤"で完全同値 -> tie(要確認)。
    """
    bx, by, bw, bh = bbox
    hits: list[PanelHit] = []
    for panel in panels:
        area = intersection_area(
            bx, by, bw, bh,
            panel.normalized_rect.x, panel.normalized_rect.y,
            panel.normalized_rect.w, panel.normalized_rect.h,
        )
        if area > 0:
            hits.append(PanelHit(panel=panel, area=area))

    if not hits:
        return ProductAssignment()

    max_area = max(h.area for h in hits)
    winners = [h for h in hits if h.area == max_area]
    winner_groups = {physical_panel_key(w.panel) for w in winners}
    if len(winner_groups) > 1:
        return TieAssignment(candidates=winners)
    return PanelAssignment(panel=winners[0].panel, area=winners[0].area)


__all__ = [
    "PRODUCT_TARGET_ID",
    "TIE_TARGET_ID",
    "physical_panel_key",
    "panel_target_id",
    "intersection_area",
    "PanelHit",
    "ProductAssignment",
    "PanelAssignment",
    "TieAssignment",
    "Assignment",
    "assign_detection_to_panel",
]
