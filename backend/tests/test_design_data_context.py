"""`app.services.design_data_context` のテスト (Issue #40 Phase 2)。"""
from app.services.design_data_context import build_design_data_context
from app.services.estcode_df import EstimatePanelInfo
from app.services.product_df import NormalizedRect, PanelAreaFromDf


def _panel(**overrides) -> PanelAreaFromDf:
    base = dict(
        page_no=16,
        ban_menno=1,
        ban_no=1,
        ban_meisyou="盤A",
        ban_type="正面図",
        ban_h1=2300.0,
        ban_h2=2000.0,
        ban_w=900.0,
        ban_d=2200.0,
        normalized_rect=NormalizedRect(x=0.1, y=0.1, w=0.1, h=0.1),
        kiten_x=0.0,
        kiten_y=0.0,
        scale_x=1.0,
        scale_y=1.0,
        detect_area_x=0.0,
        detect_area_y=0.0,
    )
    base.update(overrides)
    return PanelAreaFromDf(**base)


def _estimate_panel(**overrides) -> EstimatePanelInfo:
    base = dict(
        model="IS2",
        ban_menno=1,
        ban_no=1,
        ban_meisyou="盤A(estcode)",
        ban_h=2300.0,
        ban_w=1700.0,
        ban_d=2200.0,
        ban_connect="箱･左右(R)",
        sort_order=1,
    )
    base.update(overrides)
    return EstimatePanelInfo(**base)


def test_build_context_prefers_estcode_name_and_width_depth():
    contexts = build_design_data_context([_panel()], [_estimate_panel()])
    ctx = contexts["1:1"]
    assert ctx.ban_menno == 1
    assert ctx.ban_no == 1
    assert ctx.ban_meisyou == "盤A(estcode)"  # estcode_df優先 (Issue #38と同じ優先順位)
    assert ctx.model == "IS2"
    assert ctx.ban_h1 == 2300.0
    assert ctx.ban_h2 == 2000.0
    assert ctx.ban_w == 1700.0  # estcode_df優先(Issue #40 Phase 2指示4)
    assert ctx.ban_d == 2200.0
    assert ctx.ban_connect == "箱･左右(R)"


def test_build_context_falls_back_to_product_df_when_estcode_missing():
    contexts = build_design_data_context([_panel()], [])
    ctx = contexts["1:1"]
    assert ctx.ban_meisyou == "盤A"  # product_df由来へfallback
    assert ctx.model is None
    assert ctx.ban_w == 900.0  # product_df由来へfallback
    assert ctx.ban_d == 2200.0
    assert ctx.ban_connect is None


def test_build_context_uses_first_seen_panel_across_multiple_views():
    panels = [
        _panel(ban_type="正面図", ban_w=900.0),
        _panel(ban_type="背面図", ban_w=999.0),
    ]
    contexts = build_design_data_context(panels, [])
    assert len(contexts) == 1
    assert contexts["1:1"].ban_w == 900.0  # 最初に見つかった代表行を採用
