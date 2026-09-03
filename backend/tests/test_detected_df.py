"""app.services.detected_df の単体テスト (Phase 1.12)。

実共有フォルダのdetected_df.csvには依存せず、tmp_path配下に同じ列構成を持つ
ダミーCSV (cp932) を作成してテストする。列構成・座標変換式は実データ調査
(A1GV2421/detected_df.csv、page16=roof_fan等9件、page23=panel/transformer等3件)
で確定したもの (docs/implementation-plan.md参照)。
"""
import pytest

from app.services.detected_df import load_detected_df
from app.services.product_df import PageScale

_HEADER = (
    "PAGE,YOLO_INDEX,SCORE,DEVICE,LEFT_TOP_X,LEFT_TOP_Y,RIGHT_TOP_X,RIGHT_TOP_Y,"
    "LEFT_BOTTOM_X,LEFT_BOTTOM_Y,RIGHT_BOTTOM_X,RIGHT_BOTTOM_Y,CENTER_X,CENTER_Y"
)

# 実データ (A1GV2421 page16, 1行目) そのもの。
_ROOF_FAN_ROW = "16,0,0.970870316028595,roof_fan,9519,9699,10023,9699,9519,9444,10023,9444,9771,9571"

# 実データ (A1GV2421 page16) の実SCALE/FRAME_MINI。
_PAGE16_SCALE = PageScale(
    scale_x=7.698603755416466, scale_y=7.696969696969697,
    frame_mini_x=2077.0, frame_mini_y=1485.0,
)


def _write_csv(path, rows: list[str]):
    content = "\n".join([_HEADER, *rows]) + "\n"
    path.write_bytes(content.encode("cp932"))


@pytest.fixture()
def product_dir(tmp_path):
    d = tmp_path / "A1TEST01"
    d.mkdir()
    return d


def test_load_detected_df_missing_file_is_not_an_error(product_dir):
    """指示書27章: detected_df.csv自体が無い場合もエラー扱いにしない。"""
    result = load_detected_df(product_dir, "A1TEST01", page_scales={})
    assert result.file_present is False
    assert result.items_by_page == {}
    assert result.warnings == []


def test_load_detected_df_real_data_row_matches_pillow_verified_position(product_dir):
    """実データ(page16, id=0, roof_fan)の1行を使い、実PNG上での目視確認済みの
    正規化座標 (x≈0.5953, y≈0.1514, w≈0.0315, h≈0.0223) と一致することを確認する。"""
    _write_csv(product_dir / "detected_df.csv", [_ROOF_FAN_ROW])
    result = load_detected_df(product_dir, "A1TEST01", page_scales={16: _PAGE16_SCALE})

    assert result.file_present is True
    assert list(result.items_by_page.keys()) == [16]
    items = result.items_by_page[16]
    assert len(items) == 1
    item = items[0]
    assert item.page_no == 16
    assert item.yolo_index == 0
    assert item.device == "roof_fan"
    assert item.score == pytest.approx(0.970870316028595)
    rect = item.normalized_rect
    assert rect.x == pytest.approx(0.5953, abs=1e-3)
    assert rect.y == pytest.approx(0.1514, abs=1e-3)
    assert rect.w == pytest.approx(0.0315, abs=1e-3)
    assert rect.h == pytest.approx(0.0223, abs=1e-3)


def test_load_detected_df_y_axis_is_flipped_from_cad_bottom_left_to_dom_top_left(product_dir):
    """指示書7章: raw座標は原点左下(Y上向き)。TOPのY値がBOTTOMより大きい実データの
    まま(反転せず)DOMへ渡すと上下が逆になるため、必ず反転されていることを確認する。

    自明なケースで検算する: FRAME_MINI_Y=100, SCALE_Y=1として、
    TOP_Y=80 (raw, CAD系で「かなり上」寄り), BOTTOM_Y=60 のBBoxは、
    DOM系では画像の上から20%〜40%の位置に来るはず (100-80=20, 100-60=40)。
    """
    scale = PageScale(scale_x=1.0, scale_y=1.0, frame_mini_x=100.0, frame_mini_y=100.0)
    row = "1,0,0.9,test_device,10,80,50,80,10,60,50,60,30,70"
    _write_csv(product_dir / "detected_df.csv", [row])
    result = load_detected_df(product_dir, "A1TEST01", page_scales={1: scale})

    rect = result.items_by_page[1][0].normalized_rect
    assert rect.y == pytest.approx(0.20)  # dom_top = 100-80 = 20 -> 0.20
    assert rect.h == pytest.approx(0.20)  # dom_bottom(40) - dom_top(20) = 20 -> 0.20
    assert rect.x == pytest.approx(0.10)  # 10/1/100
    assert rect.w == pytest.approx(0.40)  # (50-10)/100


def test_load_detected_df_returns_all_detections_for_the_same_page_not_just_the_first(product_dir):
    """指示書10章: 同一PAGEに複数Detectionがある場合、全件返す (先頭1件のみにしない)。"""
    scale = PageScale(scale_x=1.0, scale_y=1.0, frame_mini_x=1000.0, frame_mini_y=1000.0)
    rows = [
        f"16,{i},0.9,device_{i},{10 + i * 10},900,{50 + i * 10},900,{10 + i * 10},800,{50 + i * 10},800,30,850"
        for i in range(5)
    ]
    _write_csv(product_dir / "detected_df.csv", rows)
    result = load_detected_df(product_dir, "A1TEST01", page_scales={16: scale})

    assert len(result.items_by_page[16]) == 5
    assert [item.yolo_index for item in result.items_by_page[16]] == [0, 1, 2, 3, 4]


def test_load_detected_df_page_with_no_rows_is_absent_not_an_error(product_dir):
    """指示書26章: detected_dfに該当PAGEが無い場合はエラー扱いにしない (単に存在しない)。"""
    _write_csv(product_dir / "detected_df.csv", [_ROOF_FAN_ROW])
    result = load_detected_df(product_dir, "A1TEST01", page_scales={16: _PAGE16_SCALE})
    assert result.items_by_page.get(999, []) == []


def test_load_detected_df_skips_row_when_scale_is_zero(product_dir):
    """指示書20章: SCALE_X==0またはSCALE_Y==0のPAGEは描画しない (診断情報を残す)。"""
    bad_scale = PageScale(scale_x=0.0, scale_y=1.0, frame_mini_x=1000.0, frame_mini_y=1000.0)
    _write_csv(product_dir / "detected_df.csv", [_ROOF_FAN_ROW])
    result = load_detected_df(product_dir, "A1TEST01", page_scales={16: bad_scale})

    assert result.items_by_page == {}
    assert len(result.warnings) == 1
    assert "SCALE_X/SCALE_Y" in result.warnings[0] or "SCALE" in result.warnings[0]


def test_load_detected_df_skips_row_when_page_has_no_matching_product_df_scale(product_dir):
    """product_df.csv側にそのPAGEのSCALE情報が無い場合もスキップし、
    Backendログ(warnings)へ残す (指示書3章/20章相当)。"""
    _write_csv(product_dir / "detected_df.csv", [_ROOF_FAN_ROW])
    result = load_detected_df(product_dir, "A1TEST01", page_scales={})  # page16のscaleが無い

    assert result.items_by_page == {}
    assert len(result.warnings) == 1
    assert "SCALE情報" in result.warnings[0]


def test_load_detected_df_confidence_and_class_name_are_preserved(product_dir):
    """指示書17章: confidence(SCORE)・class_name(DEVICE)がそのまま表示用モデルへ渡ること。"""
    row = "23,0,0.9908252358436584,panel,743,2481,1658,2481,743,1069,1658,1069,1200,1775"
    scale = PageScale(scale_x=2.7279340446168767, scale_y=2.721207865168539, frame_mini_x=2062.0, frame_mini_y=1424.0)
    _write_csv(product_dir / "detected_df.csv", [row])
    result = load_detected_df(product_dir, "A1TEST01", page_scales={23: scale})

    item = result.items_by_page[23][0]
    assert item.device == "panel"
    assert item.score == pytest.approx(0.9908252358436584)
