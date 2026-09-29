"""設計データcontext (Issue #40 Phase 2、3章「設計データの自動反映」)。

作業者に再入力させず、BBox/図面情報の所属盤から判定に必要な設計データを
自動参照するための、盤単位の集約view。既存の`product_df.py`
(`PanelAreaFromDf`)/`estcode_df.py`(`EstimatePanelInfo`)をそのまま
データ源とし、CSVを都度読み込む既存の設計を踏襲する(キャッシュ・固定化は
行わない。Issue #40 Phase 1報告コメント6章の通り、この方針は現行の
読み込み方式と自然に整合する)。

**注意 (Issue #40 Phase 1報告コメント6章/Phase 2指示3)**: `ban_h1`=正面/
`ban_h2`=背面という意味付けは、Issue #38時点から継続してUI仕様上の前提で
あり、product_df.csv側のデータ定義として確定した事実ではない。このモジュール
も同じ前提を踏襲するが、断定はしない(`docs/data-source.md`参照)。
"""
from __future__ import annotations

from dataclasses import dataclass

from app.services.estcode_df import EstimatePanelInfo
from app.services.panel_assignment import physical_panel_key
from app.services.product_df import PanelAreaFromDf


@dataclass
class DesignDataContext:
    """1つの物理盤(面番号+盤番号)について、判定に使える設計データを
    1つにまとめたもの。ルール評価時にBBoxへ値をコピーせず、都度この関数で
    現在の設計データを取得する(Issue #40 3章「盤寸法等をBBoxへコピーして
    固定するのではなく、原則として現在の設計データを判定時に参照する」)。

    フィールドは可能な範囲でIssue #40 3章が例示する項目に対応させている。
    「箱体型式」は`EstimatePanelInfo.model`(estcode_df.csv由来)を暫定的に
    採用しているが、これが「箱体そのものの型式」であるか、それとも別概念
    かはPhase 1時点で確認できていない(Issue #40 Phase 1報告コメント6章、
    不明点として引き続き未確定のまま)。「単独/左右/中盤区分」は
    `ban_connect`の自由記述文字列をそのまま保持する(構造化された区分値への
    変換はPhase 2では行わない。業務側確認後にPhase 3以降で対応する)。
    """

    ban_menno: int
    ban_no: int
    ban_meisyou: str | None
    # 「箱体型式」相当(暫定。上記docstring参照)。
    model: str | None
    # 正面/背面高さ (product_df.csv由来。前提未確定、上記docstring参照)。
    ban_h1: float | None
    ban_h2: float | None
    ban_w: float | None
    ban_d: float | None
    # 単独/左右/中盤区分に相当しうる自由記述 (estcode_df.csv由来)。
    ban_connect: str | None


def _resolve_name(panel: PanelAreaFromDf, estimate_panel: EstimatePanelInfo | None) -> str | None:
    """`PanelInfo.tsx`/`estimate_confirmation_builder.py::_resolve_panel_name`と
    同じ優先順位(estcode_df.csv優先、product_df.csvをfallback)。"""
    name = (estimate_panel.ban_meisyou if estimate_panel else None) or panel.ban_meisyou
    return name if name and name.strip() != "" else None


def build_design_data_context(
    panels: list[PanelAreaFromDf], estimate_panels: list[EstimatePanelInfo]
) -> dict[str, DesignDataContext]:
    """1ページ分(または製番全体)の`PanelAreaFromDf`一覧から、物理盤キー
    (`面番号:盤番号`)ごとの`DesignDataContext`を組み立てる。

    同一物理盤が複数ページ(矢視違い)にまたがって存在する場合、最初に
    見つかった代表行の寸法を採用する(`PanelInfo.tsx`の代表行選択と同じ
    考え方。`utils/panel.ts::banGroupKey`のBackend版に相当)。
    """
    estimate_by_key = {f"{e.ban_menno}:{e.ban_no}": e for e in estimate_panels}

    contexts: dict[str, DesignDataContext] = {}
    for panel in panels:
        key = physical_panel_key(panel)
        if key in contexts:
            continue
        estimate_panel = estimate_by_key.get(key)
        contexts[key] = DesignDataContext(
            ban_menno=panel.ban_menno,
            ban_no=panel.ban_no,
            ban_meisyou=_resolve_name(panel, estimate_panel),
            model=estimate_panel.model if estimate_panel else None,
            ban_h1=panel.ban_h1,
            ban_h2=panel.ban_h2,
            ban_w=(estimate_panel.ban_w if estimate_panel and estimate_panel.ban_w is not None else panel.ban_w),
            ban_d=(estimate_panel.ban_d if estimate_panel and estimate_panel.ban_d is not None else panel.ban_d),
            ban_connect=estimate_panel.ban_connect if estimate_panel else None,
        )
    return contexts


__all__ = ["DesignDataContext", "build_design_data_context"]
