"""app.services.estcode_df の単体テスト (Phase 1.14)。

実共有フォルダのestcode_df.csvには依存せず、tmp_path配下に同じ列構成を持つ
ダミーCSV (cp932) を作成してテストする。列構成は実データ調査
(A1GV2421/estcode_df.csv、全5行)で確定したもの (docs/implementation-plan.md参照)。
"""
import pytest

from app.services.estcode_df import load_estcode_df

_HEADER = (
    "MODEL,BAN_MENNO,BAN_NO,BAN_MEISYOU,BAN_H,BAN_W,BAN_D,BAN_CONNECT,PANEL,TRANS,"
    "IN_PANEL,SHIELD,DOOR_FRONT,DOOR_BACK,DOOR_STACK,DOOR_SIDE,DOOR_SMALL,FAN_ROOF,"
    "FAN_DOOR,MAIN_LINE,WIRE_MESH,STACK_PLATE,DRAWER_DEVICE,VCT_STAND,BUS_DUCT,"
    "PASSAGE,INPUT_CU_COEFF,SORT_ORDER"
)

# 実データ (A1GV2421/estcode_df.csv、1行目) そのもの。
_ROW_5 = "IS2,5,5.0,No.2-1低圧動力盤,2300,1700,2200,箱･左右(L),1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0,1"
_ROW_1 = "IS2,1,1.0,高圧受電盤,2300,900,2200,箱･左右(R),0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0,5"


def _write_csv(path, rows: list[str]):
    content = "\n".join([_HEADER, *rows]) + "\n"
    path.write_bytes(content.encode("cp932"))


@pytest.fixture()
def product_dir(tmp_path):
    d = tmp_path / "A1TEST01"
    d.mkdir()
    return d


def test_load_estcode_df_missing_file_is_not_an_error(product_dir):
    """指示書14章相当: estcode_df.csv自体が無い場合もエラー扱いにしない。"""
    result = load_estcode_df(product_dir, "A1TEST01")
    assert result.file_present is False
    assert result.panels == []
    assert result.warnings == []


def test_load_estcode_df_real_data_row(product_dir):
    """実データ(BAN_MENNO=5, roof_fanの盤)の1行を使い、正しく正規化されることを確認する。"""
    _write_csv(product_dir / "estcode_df.csv", [_ROW_5])
    result = load_estcode_df(product_dir, "A1TEST01")

    assert result.file_present is True
    assert len(result.panels) == 1
    panel = result.panels[0]
    assert panel.model == "IS2"
    assert panel.ban_menno == 5
    assert panel.ban_no == 5
    assert panel.ban_meisyou == "No.2-1低圧動力盤"
    assert panel.ban_h == pytest.approx(2300)
    assert panel.ban_w == pytest.approx(1700)
    assert panel.ban_d == pytest.approx(2200)
    assert panel.ban_connect == "箱･左右(L)"
    assert panel.sort_order == 1


def test_load_estcode_df_returns_all_rows_for_the_product(product_dir):
    """指示書1章/25章: 製番配下の全盤ぶんを返す(ページ単位ではない)。"""
    _write_csv(product_dir / "estcode_df.csv", [_ROW_5, _ROW_1])
    result = load_estcode_df(product_dir, "A1TEST01")
    assert len(result.panels) == 2
    assert {p.ban_menno for p in result.panels} == {5, 1}


def test_load_estcode_df_missing_dimension_is_none_not_the_whole_row(product_dir):
    """指示書8章: 寸法の一部だけ欠けている場合も行全体はスキップせず、
    その項目だけNone(表示側で"-")にする。"""
    row = "IS2,5,5.0,No.2-1低圧動力盤,,1700,2200,箱･左右(L),1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0,1"
    _write_csv(product_dir / "estcode_df.csv", [row])
    result = load_estcode_df(product_dir, "A1TEST01")
    panel = result.panels[0]
    assert panel.ban_h is None
    assert panel.ban_w == pytest.approx(1700)
    assert panel.ban_d == pytest.approx(2200)


def test_load_estcode_df_missing_meisyou_and_connect_is_none(product_dir):
    row = "IS2,5,5.0,,2300,1700,2200,,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0,1"
    _write_csv(product_dir / "estcode_df.csv", [row])
    panel = load_estcode_df(product_dir, "A1TEST01").panels[0]
    assert panel.ban_meisyou is None
    assert panel.ban_connect is None


def test_load_estcode_df_skips_row_with_missing_ban_menno(product_dir):
    """紐付けキー(BAN_MENNO/BAN_NO)が欠損している行は、誤った紐付けを避けるため
    スキップする。"""
    row = "IS2,,5.0,No.2-1低圧動力盤,2300,1700,2200,箱･左右(L),1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0,1"
    _write_csv(product_dir / "estcode_df.csv", [row])
    result = load_estcode_df(product_dir, "A1TEST01")
    assert result.panels == []
    assert len(result.warnings) == 1


def test_load_estcode_df_keeps_sort_order_when_missing_as_none(product_dir):
    row = "IS2,5,5.0,No.2-1低圧動力盤,2300,1700,2200,箱･左右(L),1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0,"
    _write_csv(product_dir / "estcode_df.csv", [row])
    panel = load_estcode_df(product_dir, "A1TEST01").panels[0]
    assert panel.sort_order is None
