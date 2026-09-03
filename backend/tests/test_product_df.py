"""app.services.product_df の単体テスト (Phase 1.8)。

実共有フォルダのproduct_df.csvには依存せず、tmp_path配下に同じ列構成を持つ
ダミーCSV (cp932) を作成してテストする。列構成・座標変換式は実データ調査で
確定したもの (data-source.md参照)。
"""
import pytest

from app.services.product_df import load_page_scales, load_product_df

_HEADER = (
    "BAN_MENNO,BAN_NO,PAGE,ZUMEI,BAN_MEISYOU,BAN_TYPE,BAN_H1,BAN_H2,BAN_W,BAN_D,"
    "KITEN_X,KITEN_Y,DETECT_AREA_X,DETECT_AREA_Y,FRAME_ORG_X,FRAME_ORG_Y,"
    "FRAME_MINI_X,FRAME_MINI_Y,SCALE_X,SCALE_Y"
)


def _write_csv(path, rows: list[str]):
    content = "\n".join([_HEADER, *rows]) + "\n"
    path.write_bytes(content.encode("cp932"))


@pytest.fixture()
def product_dir(tmp_path):
    d = tmp_path / "A1TEST01"
    d.mkdir()
    return d


def test_load_product_df_missing_file_returns_empty_with_warning(product_dir):
    result = load_product_df(product_dir, "A1TEST01")
    assert result.panels_by_page == {}
    assert result.drawing_type_by_page == {}
    assert len(result.warnings) == 1
    assert "見つかりません" in result.warnings[0]


def test_load_product_df_single_row(product_dir):
    _write_csv(product_dir / "product_df.csv", [
        "1,1.0,16,外形図,盤A,正面図,2300.0,2300.0,900.0,2200.0,"
        "4650.0,2250.0,900.0,2300.0,15990.0,11430.0,2077.0,1485.0,"
        "7.698603755416466,7.696969696969697",
    ])
    result = load_product_df(product_dir, "A1TEST01")
    assert list(result.panels_by_page.keys()) == [16]
    panels = result.panels_by_page[16]
    assert len(panels) == 1
    assert panels[0].ban_menno == 1
    assert panels[0].ban_no == 1
    assert result.drawing_type_by_page[16] == "外形図"


def test_load_product_df_captures_ban_meisyou_and_ban_type_for_overlay_label(product_dir):
    """盤領域Overlay内ラベル用のBAN_MEISYOU/BAN_TYPEが個別に保持されること。"""
    _write_csv(product_dir / "product_df.csv", [
        "1,1.0,16,外形図,高圧受電盤,背面図,2300.0,2300.0,900.0,2200.0,"
        "4650.0,2250.0,900.0,2300.0,15990.0,11430.0,2077.0,1485.0,"
        "7.698603755416466,7.696969696969697",
        "2,2.0,16,外形図,低圧動力盤,正面図,2300.0,2300.0,1000.0,2200.0,"
        "5550.0,2250.0,1000.0,2300.0,15990.0,11430.0,2077.0,1485.0,"
        "7.698603755416466,7.696969696969697",
    ])
    result = load_product_df(product_dir, "A1TEST01")
    panels = result.panels_by_page[16]
    assert panels[0].ban_meisyou == "高圧受電盤"
    assert panels[0].ban_type == "背面図"
    # 複数盤それぞれに個別の値が割り当てられていること (代表値の使い回しではない)
    assert panels[1].ban_meisyou == "低圧動力盤"
    assert panels[1].ban_type == "正面図"


def test_load_product_df_captures_page_no_and_physical_dimensions_for_right_pane(product_dir):
    """右ペイン「盤パラメータ」表示用のpage_no/BAN_H1/H2/W/Dが保持されること (Phase 1.9)。"""
    _write_csv(product_dir / "product_df.csv", [
        "1,1.0,16,外形図,高圧受電盤,背面図,2300.0,2350.0,900.0,2200.0,"
        "4650.0,2250.0,900.0,2300.0,15990.0,11430.0,2077.0,1485.0,"
        "7.698603755416466,7.696969696969697",
    ])
    result = load_product_df(product_dir, "A1TEST01")
    panel = result.panels_by_page[16][0]
    assert panel.page_no == 16
    assert panel.ban_h1 == 2300.0
    assert panel.ban_h2 == 2350.0
    assert panel.ban_w == 900.0
    assert panel.ban_d == 2200.0


def test_load_product_df_keeps_physical_dimensions_none_when_missing(product_dir):
    """基礎図行等でBAN_H1/H2/W/Dが空欄の場合、Noneのまま保持し行はスキップしない
    (座標計算には使わないため。要件12/14)。"""
    _write_csv(product_dir / "product_df.csv", [
        "1,1.0,18,基礎図,高圧受電盤,基礎図,,,,,"
        "4650.0,2250.0,900.0,2300.0,15990.0,11430.0,2077.0,1485.0,"
        "7.698603755416466,7.696969696969697",
    ])
    result = load_product_df(product_dir, "A1TEST01")
    panel = result.panels_by_page[18][0]
    assert panel.ban_h1 is None
    assert panel.ban_h2 is None
    assert panel.ban_w is None
    assert panel.ban_d is None


def test_load_product_df_keeps_ban_meisyou_ban_type_empty_when_missing(product_dir):
    """座標計算に使わない項目のため、欠損していても行全体はスキップしない。"""
    _write_csv(product_dir / "product_df.csv", [
        "1,1.0,16,外形図,,,2300.0,2300.0,900.0,2200.0,"
        "4650.0,2250.0,900.0,2300.0,15990.0,11430.0,2077.0,1485.0,"
        "7.698603755416466,7.696969696969697",
    ])
    result = load_product_df(product_dir, "A1TEST01")
    panels = result.panels_by_page[16]
    assert len(panels) == 1
    assert panels[0].ban_meisyou == ""
    assert panels[0].ban_type == ""


def test_load_product_df_same_page_multiple_rows_all_retained(product_dir):
    """指示書11章: 同一ページに複数行ある場合、先頭1件だけを使ってはいけない。"""
    _write_csv(product_dir / "product_df.csv", [
        "1,1.0,25,内部機器配置図(3-1),盤A,正面図,2300,2300,900,2200,100,100,900,2300,15990,11430,2077,1485,7.7,7.7",
        "1,1.0,25,内部機器配置図(3-1),盤A,背面図,2300,2300,900,2200,200,200,900,2300,15990,11430,2077,1485,7.7,7.7",
        "2,1.0,25,内部機器配置図(3-1),盤B,正面図,2300,2300,900,2200,300,300,900,2300,15990,11430,2077,1485,7.7,7.7",
    ])
    result = load_product_df(product_dir, "A1TEST01")
    panels = result.panels_by_page[25]
    assert len(panels) == 3
    assert [(p.ban_menno, p.ban_no) for p in panels] == [(1, 1), (1, 1), (2, 1)]
    # グループ名は連番接尾辞を除いたものになる (db/seed.pyの命名規則と一致させる)
    assert result.drawing_type_by_page[25] == "内部機器配置図"
    # 表示名(drawing_name)はZUMEIそのもの (接尾辞を保持する)
    assert result.drawing_name_by_page[25] == "内部機器配置図(3-1)"


def test_load_product_df_computes_left_bottom_from_kiten_and_scale(product_dir):
    _write_csv(product_dir / "product_df.csv", [
        # KITEN_X=100, SCALE_X=10 -> left_px=10 ; FRAME_MINI_X=100 -> nx=0.1
        # KITEN_Y=200, SCALE_Y=20 -> bottom_px=10 ; FRAME_MINI_Y=100 -> ny(cad)=0.1
        "1,1.0,1,外形図,盤A,正面図,,,,,100.0,200.0,50.0,50.0,,,"
        "100.0,100.0,10.0,20.0",
    ])
    result = load_product_df(product_dir, "A1TEST01")
    rect = result.panels_by_page[1][0].normalized_rect
    assert rect.x == pytest.approx(0.1)
    # 幅: DETECT_AREA_X(50)/SCALE_X(10)/FRAME_MINI_X(100) = 0.05
    assert rect.w == pytest.approx(0.05)


def test_load_product_df_flips_y_axis_cad_bottom_origin_to_dom_top_origin(product_dir):
    """CAD原点(左下)からDOM/PNG原点(左上)への変換 (指示書18章)。"""
    _write_csv(product_dir / "product_df.csv", [
        # bottom_px=10, top_px=10+50=60 ; FRAME_MINI_Y=100
        # ny_cad_bottom=0.1, ny_cad_top=0.6
        # dom_top = 1-0.6=0.4, dom_bottom=1-0.1=0.9 -> y=0.4, h=0.5
        "1,1.0,1,外形図,盤A,正面図,,,,,0.0,100.0,10.0,500.0,,,"
        "100.0,100.0,10.0,10.0",
    ])
    result = load_product_df(product_dir, "A1TEST01")
    rect = result.panels_by_page[1][0].normalized_rect
    assert rect.y == pytest.approx(0.4)
    assert rect.h == pytest.approx(0.5)


def test_load_product_df_skips_row_with_scale_x_zero(product_dir):
    _write_csv(product_dir / "product_df.csv", [
        "1,1.0,1,外形図,盤A,正面図,,,,,100.0,100.0,50.0,50.0,,,100.0,100.0,0.0,10.0",
    ])
    result = load_product_df(product_dir, "A1TEST01")
    assert result.panels_by_page.get(1, []) == []
    assert any("SCALE_X" in w for w in result.warnings)


def test_load_product_df_skips_row_with_scale_y_zero(product_dir):
    _write_csv(product_dir / "product_df.csv", [
        "1,1.0,1,外形図,盤A,正面図,,,,,100.0,100.0,50.0,50.0,,,100.0,100.0,10.0,0.0",
    ])
    result = load_product_df(product_dir, "A1TEST01")
    assert result.panels_by_page.get(1, []) == []
    assert any("SCALE_Y" in w for w in result.warnings)


def test_load_product_df_skips_row_with_missing_required_value(product_dir):
    _write_csv(product_dir / "product_df.csv", [
        # KITEN_X欠損
        "1,1.0,1,外形図,盤A,正面図,,,,,,100.0,50.0,50.0,,,100.0,100.0,10.0,10.0",
    ])
    result = load_product_df(product_dir, "A1TEST01")
    assert result.panels_by_page.get(1, []) == []
    assert len(result.warnings) == 1


def test_load_product_df_still_classifies_drawing_type_when_panel_row_invalid(product_dir):
    """盤座標が壊れていても、PAGE/ZUMEIさえ読めればページ分類は成立させる。"""
    _write_csv(product_dir / "product_df.csv", [
        "1,1.0,1,外形図,盤A,正面図,,,,,100.0,100.0,50.0,50.0,,,100.0,100.0,0.0,10.0",
    ])
    result = load_product_df(product_dir, "A1TEST01")
    assert result.drawing_type_by_page[1] == "外形図"
    assert result.panels_by_page.get(1, []) == []


# --- load_page_scales (Phase 1.12指示書3章/4章: detected_df.csvの座標補正用) ---


def test_load_page_scales_missing_file_returns_empty_dict(product_dir):
    assert load_page_scales(product_dir) == {}


def test_load_page_scales_returns_scale_per_page(product_dir):
    _write_csv(product_dir / "product_df.csv", [
        "1,1.0,16,外形図,盤A,正面図,2300.0,2300.0,900.0,2200.0,"
        "4650.0,2250.0,900.0,2300.0,15990.0,11430.0,2077.0,1485.0,"
        "7.698603755416466,7.696969696969697",
    ])
    scales = load_page_scales(product_dir)
    assert list(scales.keys()) == [16]
    scale = scales[16]
    assert scale.scale_x == pytest.approx(7.698603755416466)
    assert scale.scale_y == pytest.approx(7.696969696969697)
    assert scale.frame_mini_x == pytest.approx(2077.0)
    assert scale.frame_mini_y == pytest.approx(1485.0)


def test_load_page_scales_uses_first_row_when_all_rows_of_a_page_agree(product_dir):
    """指示書4章: 同一PAGE内でSCALE_X/SCALE_Yが全行一致するケース (実データで確認済み。
    A1GV2421/product_df.csv全32行で不一致は0件) では、先頭行の値をそのまま採用してよい。"""
    _write_csv(product_dir / "product_df.csv", [
        "1,1.0,16,外形図,盤A,背面図,2300.0,2300.0,900.0,2200.0,"
        "4650.0,2250.0,900.0,2300.0,15990.0,11430.0,2077.0,1485.0,7.5,7.5",
        "2,2.0,16,外形図,盤B,正面図,2300.0,2300.0,900.0,2200.0,"
        "5550.0,2250.0,900.0,2300.0,15990.0,11430.0,2077.0,1485.0,7.5,7.5",
    ])
    scales = load_page_scales(product_dir)
    assert scales[16].scale_x == pytest.approx(7.5)


def test_load_page_scales_skips_zero_scale(product_dir):
    """指示書20章相当: SCALE_X/SCALE_Yが0のPAGEは除外する (ゼロ除算回避)。"""
    _write_csv(product_dir / "product_df.csv", [
        "1,1.0,16,外形図,盤A,正面図,2300.0,2300.0,900.0,2200.0,"
        "4650.0,2250.0,900.0,2300.0,15990.0,11430.0,2077.0,1485.0,0.0,7.5",
    ])
    assert load_page_scales(product_dir) == {}
