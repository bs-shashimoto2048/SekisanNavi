"""箱コード自動選定の統合テスト(評価パイプライン → estimate_results → API)。

実マスタ(data/master/estimate_master_a.xlsx)と、A1GE4568を模した合成CSV(隔離した一時フォルダ)を使う。
本番DB・実製番・/predict・出力へは触れない。
"""
from app import config
from app.db.connection import get_connection
from app.domain.estimate_rules import EstimateResultStatus
from app.repositories.estimate_box_overrides import list_box_overrides
from app.services.box_code_candidates import resolve_panel_dimensions
from app.services.estcode_df import EstimatePanelInfo
from app.services.estimate_result_pipeline import build_all_candidates

# 図面ページ(drawing_pages)が既にシードされている製番名を使う(寸法・盤構成はA1GE4568を模した合成CSV)。
PRODUCT = "A1GV2421"

_PRODUCT_DF_HEADER = (
    "BAN_MENNO,BAN_NO,PAGE,ZUMEI,BAN_MEISYOU,BAN_TYPE,BAN_H1,BAN_H2,BAN_W,BAN_D,"
    "KITEN_X,KITEN_Y,DETECT_AREA_X,DETECT_AREA_Y,FRAME_ORG_X,FRAME_ORG_Y,"
    "FRAME_MINI_X,FRAME_MINI_Y,SCALE_X,SCALE_Y"
)
_ESTCODE_DF_HEADER = (
    "MODEL,BAN_MENNO,BAN_NO,BAN_MEISYOU,BAN_H,BAN_W,BAN_D,BAN_CONNECT,PANEL,TRANS,"
    "IN_PANEL,SHIELD,DOOR_FRONT,DOOR_BACK,DOOR_STACK,DOOR_SIDE,DOOR_SMALL,FAN_ROOF,"
    "FAN_DOOR,MAIN_LINE,WIRE_MESH,STACK_PLATE,DRAWER_DEVICE,VCT_STAND,BUS_DUCT,"
    "PASSAGE,INPUT_CU_COEFF,SORT_ORDER"
)
_ESTCODE_TAIL = "0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0,5"


def _write(path, header, rows):
    path.write_bytes(("\n".join([header, *rows]) + "\n").encode("cp932"))


def _product_row(menno, no, h1, h2, w, d, page=16, zumei="外形図", ban_type="正面図"):
    return f"{menno},{no}.0,{page},{zumei},盤{menno},{ban_type},{h1},{h2},{w},{d},100,100,900,2300,15990,11430,100,100,10,10"


def _estcode_row(model, menno, no, connect, h=0, w=0, d=0):
    return f"{model},{menno},{no}.0,盤{menno},{h},{w},{d},{connect},{_ESTCODE_TAIL}"


def _setup(client, monkeypatch, tmp_path, *, estcode_rows, product_rows):
    product = tmp_path / PRODUCT
    product.mkdir()
    _write(product / "product_df.csv", _PRODUCT_DF_HEADER, product_rows)
    _write(product / "estcode_df.csv", _ESTCODE_DF_HEADER, estcode_rows)
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "test-admin-pass")
    res = client.put(
        "/api/settings/data-source", json={"root": str(tmp_path), "admin_password": "test-admin-pass"}
    )
    assert res.status_code == 200


def _a1ge4568(client, monkeypatch, tmp_path):
    # estcode は BAN_H/W/D = 0(未設定)。寸法は外形図・正面図(product_df)から補う。
    _setup(
        client,
        monkeypatch,
        tmp_path,
        estcode_rows=[
            _estcode_row("OS2", 1, 1, "箱･単独"),
            _estcode_row("OS2", 2, 2, "箱･左右(R)"),
            _estcode_row("OS2", 3, 3, "箱･中央"),
        ],
        product_rows=[
            _product_row(1, 1, 2365, 2275, 900, 2000),
            _product_row(2, 2, 2365, 2275, 900, 2000),
            _product_row(3, 3, 2365, 2275, 1100, 2000),
        ],
    )


def _master(client, category, model, rating):
    items = client.get("/api/master-items", params={"category": category}).json()
    found = [i for i in items if (i["model"] or "").replace(" ", "") == model and i["rating"] == rating]
    assert len(found) == 1, (category, model, rating, found)
    return found[0]


def _evaluate(client):
    res = client.post(f"/api/products/{PRODUCT}/estimate-results/evaluate")
    assert res.status_code == 200, res.text
    return res.json()["results"]


def _box_rows(results):
    return sorted((r for r in results if r["result_key"].startswith("box:")), key=lambda r: r["result_key"])


def test_a1ge4568_selects_one_box_code_per_panel_with_quantity_one(client, monkeypatch, tmp_path):
    _a1ge4568(client, monkeypatch, tmp_path)
    rows = _box_rows(_evaluate(client))
    assert [r["result_key"] for r in rows] == ["box:1:1", "box:2:2", "box:3:3"]
    expect = [
        ("箱･単独", "OS2-920", "2.3*0.9*2.0"),
        ("箱･左右", "OS2-920", "2.3*0.9*2.0"),
        ("箱･中", "OS2-1120", "2.3*1.1*2.0"),
    ]
    for row, (cat, model, rating) in zip(rows, expect, strict=True):
        item = _master(client, cat, model, rating)
        assert row["master_item_id"] == item["id"] and row["code"] == item["code"]
        assert row["quantity"] == 1 and row["status"] == "auto" and row["box_category"] == cat
        assert row["judgment_scope"] == "panel" and row["code_overridden"] is False
        assert row["applicable_unit"] == "face"
        assert row["unit_price"] == item["total_price_a"]  # 価格はマスタ値そのまま(推測しない)
    assert [(r["target_panel_ban_menno"], r["target_panel_ban_no"]) for r in rows] == [(1, 1), (2, 2), (3, 3)]


def test_reevaluation_does_not_duplicate_box_rows(client, monkeypatch, tmp_path):
    _a1ge4568(client, monkeypatch, tmp_path)
    first = _box_rows(_evaluate(client))
    second = _box_rows(_evaluate(client))
    third = _box_rows(client.get(f"/api/products/{PRODUCT}/estimate-results").json())
    assert [r["id"] for r in first] == [r["id"] for r in second] == [r["id"] for r in third]


def test_manual_override_replaces_the_same_panel_row_and_survives_reevaluation_and_reload(client, monkeypatch, tmp_path):
    _a1ge4568(client, monkeypatch, tmp_path)
    before = _box_rows(_evaluate(client))
    other = _master(client, "箱･単独", "OS2-1020", "2.3*1.0*2.0")
    res = client.put(f"/api/products/{PRODUCT}/box-selections/1/1", json={"master_item_id": other["id"]})
    assert res.status_code == 200, res.text
    rows = _box_rows(res.json()["results"])
    assert len(rows) == 3  # 2件目を追加せず、同じ盤の行を置き換える
    assert rows[0]["id"] == before[0]["id"] and rows[0]["code"] == other["code"]
    assert rows[0]["code_overridden"] is True and rows[0]["status"] == "reviewed" and rows[0]["quantity"] == 1
    # 他盤の行は変わらない
    assert [(r["code"], r["id"]) for r in rows[1:]] == [(r["code"], r["id"]) for r in before[1:]]
    # 再評価・再読込でも保持される(自動選定値へ戻らない)
    assert _box_rows(_evaluate(client))[0]["code"] == other["code"]
    assert _box_rows(client.get(f"/api/products/{PRODUCT}/estimate-results").json())[0]["code"] == other["code"]
    # 再度修正しても同じ盤の1件のまま
    third = _master(client, "箱･単独", "OS2-1120", "2.3*1.1*2.0")
    res = client.put(f"/api/products/{PRODUCT}/box-selections/1/1", json={"master_item_id": third["id"]})
    assert len(_box_rows(res.json()["results"])) == 3 and _box_rows(res.json()["results"])[0]["code"] == third["code"]


def test_reset_returns_to_auto_selection(client, monkeypatch, tmp_path):
    _a1ge4568(client, monkeypatch, tmp_path)
    auto = _box_rows(_evaluate(client))[0]
    other = _master(client, "箱･単独", "OS2-1020", "2.3*1.0*2.0")
    client.put(f"/api/products/{PRODUCT}/box-selections/1/1", json={"master_item_id": other["id"]})
    res = client.delete(f"/api/products/{PRODUCT}/box-selections/1/1")
    row = _box_rows(res.json()["results"])[0]
    assert row["code"] == auto["code"] and row["code_overridden"] is False and row["status"] == "auto"


def test_override_validation(client, monkeypatch, tmp_path, db_path):
    _a1ge4568(client, monkeypatch, tmp_path)
    _evaluate(client)
    left_right = _master(client, "箱･左右", "OS2-1020", "2.3*1.0*2.0")
    # その盤(箱･単独)と違うカテゴリは選べない
    assert client.put(f"/api/products/{PRODUCT}/box-selections/1/1", json={"master_item_id": left_right["id"]}).status_code == 422
    # 箱以外のカテゴリ、存在しないコード、存在しない盤
    not_box = client.get("/api/master-items", params={"category": "底板"}).json()[0]
    assert client.put(f"/api/products/{PRODUCT}/box-selections/1/1", json={"master_item_id": not_box["id"]}).status_code == 422
    assert client.put(f"/api/products/{PRODUCT}/box-selections/1/1", json={"master_item_id": 99999999}).status_code == 422
    single = _master(client, "箱･単独", "OS2-1020", "2.3*1.0*2.0")
    assert client.put(f"/api/products/{PRODUCT}/box-selections/9/9", json={"master_item_id": single["id"]}).status_code == 404
    with get_connection(db_path) as conn:
        assert list_box_overrides(conn, PRODUCT) == {}  # 拒否した要求は保存されない


def test_unknown_connect_and_zero_candidates_need_review_and_can_be_chosen_manually(client, monkeypatch, tmp_path):
    _setup(
        client,
        monkeypatch,
        tmp_path,
        estcode_rows=[
            _estcode_row("OS2", 1, 1, "箱･右"),  # 未知の接続情報
            _estcode_row("OS2", 2, 2, "箱･単独"),  # 幅が定格の最大(1.8)を超える → 該当なし
        ],
        product_rows=[_product_row(1, 1, 2365, 2275, 900, 2000), _product_row(2, 2, 2365, 2275, 2500, 2000)],
    )
    rows = _box_rows(_evaluate(client))
    assert len(rows) == 2
    for r in rows:
        assert r["code"] == "" and r["master_item_id"] is None and r["status"] == "needs_review"
        assert r["unit_price"] is None and r["price"] is None and r["quantity"] == 1
        assert "要確認" in r["judgment_reason"]
    assert rows[0]["box_category"] is None and rows[1]["box_category"] == "箱･単独"

    # 手動選択: 未知の接続情報の盤は3カテゴリから、該当なしの盤は自分のカテゴリから選べる
    lr = _master(client, "箱･左右", "OS2-1020", "2.3*1.0*2.0")
    res = client.put(f"/api/products/{PRODUCT}/box-selections/1/1", json={"master_item_id": lr["id"]})
    assert res.status_code == 200
    chosen = _box_rows(res.json()["results"])[0]
    # 品名カテゴリは接続情報から決まる値のまま(None)。手修正後も3カテゴリから選び直せる。
    assert chosen["code"] == lr["code"] and chosen["status"] == "reviewed" and chosen["box_category"] is None
    mid = _master(client, "箱･中", "OS2-1020", "2.3*1.0*2.0")
    res = client.put(f"/api/products/{PRODUCT}/box-selections/1/1", json={"master_item_id": mid["id"]})
    assert res.status_code == 200 and _box_rows(res.json()["results"])[0]["code"] == mid["code"]
    single = _master(client, "箱･単独", "OS2-1020", "2.3*1.0*2.0")
    assert client.put(f"/api/products/{PRODUCT}/box-selections/2/2", json={"master_item_id": lr["id"]}).status_code == 422
    assert client.put(f"/api/products/{PRODUCT}/box-selections/2/2", json={"master_item_id": single["id"]}).status_code == 200


def test_missing_dimensions_and_unresolved_box_type_need_review(client, monkeypatch, tmp_path):
    _setup(
        client,
        monkeypatch,
        tmp_path,
        estcode_rows=[_estcode_row("OS2", 1, 1, "箱･単独")],
        product_rows=[_product_row(1, 1, 2365, 2275, 900, 2000, zumei="展開図")],  # 外形図ではない → 補完しない
    )
    row = _box_rows(_evaluate(client))[0]
    assert row["status"] == "needs_review" and row["code"] == "" and "未設定" in row["judgment_reason"]


def test_unresolvable_box_type_needs_review(client, monkeypatch, tmp_path):
    _setup(
        client,
        monkeypatch,
        tmp_path,
        estcode_rows=[_estcode_row("ZZZ-不明", 1, 1, "箱･単独")],
        product_rows=[_product_row(1, 1, 2365, 2275, 900, 2000)],
    )
    row = _box_rows(_evaluate(client))[0]
    assert row["status"] == "needs_review" and "第1記号" in row["judgment_reason"]


def test_detection_derived_row_with_same_code_is_flagged_and_both_rows_are_kept(client, monkeypatch, tmp_path):
    # 盤が1つなので、BBoxは一意にその盤へ所属する(複数盤が同一位置だと所属が決まらないため)。
    _setup(
        client,
        monkeypatch,
        tmp_path,
        estcode_rows=[_estcode_row("OS2", 1, 1, "箱･単独"), _estcode_row("OS2", 2, 2, "箱･単独")],
        product_rows=[_product_row(1, 1, 2365, 2275, 900, 2000), _product_row(2, 2, 2365, 2275, 900, 2000, page=17)],
    )
    auto = _box_rows(_evaluate(client))[0]
    pages = client.get("/api/drawing-pages").json()
    page16 = next(p["id"] for p in pages if p["page_no"] == 16)
    res = client.post(
        "/api/detections",
        json={
            "drawing_page_id": page16,
            "master_item_id": auto["master_item_id"],
            "bbox_x": 0.1,
            "bbox_y": 0.1,
            "bbox_w": 0.05,
            "bbox_h": 0.05,
        },
    )
    assert res.status_code == 201
    results = _evaluate(client)
    same_code = [r for r in results if r["code"] == auto["code"] and r["target_panel_ban_menno"] == 1]
    assert len(same_code) >= 2  # 根拠なく合算・削除しない(両方残る)
    assert {r["result_key"].startswith("box:") for r in same_code} == {True, False}
    assert all(r["status"] == "needs_review" for r in same_code)
    assert any("重複の可能性" in (r["judgment_reason"] or "") for r in same_code)
    # 他盤の箱行は影響を受けない
    assert [r["status"] for r in _box_rows(results)[1:]] == ["auto"]


def test_detection_rows_and_other_panels_survive_box_override(client, monkeypatch, tmp_path):
    _a1ge4568(client, monkeypatch, tmp_path)
    _evaluate(client)
    other_master = client.get("/api/master-items", params={"category": "底板"}).json()[0]
    pages = client.get("/api/drawing-pages").json()
    page16 = next(p["id"] for p in pages if p["page_no"] == 16)
    client.post(
        "/api/detections",
        json={"drawing_page_id": page16, "master_item_id": other_master["id"], "bbox_x": 0.1, "bbox_y": 0.1, "bbox_w": 0.05, "bbox_h": 0.05},
    )
    before = [r for r in _evaluate(client) if not r["result_key"].startswith("box:")]
    assert before
    single = _master(client, "箱･単独", "OS2-1020", "2.3*1.0*2.0")
    res = client.put(f"/api/products/{PRODUCT}/box-selections/1/1", json={"master_item_id": single["id"]})
    after = [r for r in res.json()["results"] if not r["result_key"].startswith("box:")]
    assert [(r["id"], r["code"], r["status"]) for r in after] == [(r["id"], r["code"], r["status"]) for r in before]


def test_pipeline_candidates_have_one_box_candidate_per_physical_panel(client, monkeypatch, tmp_path, db_path):
    _setup(
        client,
        monkeypatch,
        tmp_path,
        estcode_rows=[_estcode_row("OS2", 1, 1, "箱･単独"), _estcode_row("OS2", 1, 1, "箱･単独")],  # 同じ盤の重複行
        product_rows=[_product_row(1, 1, 2365, 2275, 900, 2000)],
    )
    with get_connection(db_path) as conn:
        outcome = build_all_candidates(conn, str(tmp_path), PRODUCT)
    boxes = [c for c in outcome.candidates if c.result_key.startswith("box:")]
    assert len(boxes) == 1 and boxes[0].quantity == 1 and boxes[0].status is EstimateResultStatus.AUTO


# --- 寸法解決(画面と同じ規則) ----------------------------------------------


def _estimate(h=0.0, w=0.0, d=0.0, menno=1, no=1):
    return EstimatePanelInfo(
        model="OS2", ban_menno=menno, ban_no=no, ban_meisyou=None, ban_h=h, ban_w=w, ban_d=d, ban_connect="箱･単独", sort_order=None
    )


class _P:
    def __init__(self, menno, no, h1, h2, w, d):
        self.ban_menno, self.ban_no, self.ban_h1, self.ban_h2, self.ban_w, self.ban_d = menno, no, h1, h2, w, d


def test_dimension_resolution_matches_screen_rules():
    rows = [_P(1, 1, 0, 2275, 0, 2000), _P(1, 1, 2365, 2275, 900, 0), _P(2, 2, 9999, 9999, 9999, 9999)]
    dims = resolve_panel_dimensions(_estimate(), rows)
    assert (dims.height, dims.width, dims.depth) == (2365, 900, 2000)  # 項目ごとに最初の正の値、0は未設定、別盤は使わない
    # estcode の正の幅・奥行は優先。高さは正面/背面が無いときだけ estcode の BAN_H
    assert resolve_panel_dimensions(_estimate(w=1000, d=800), rows).width == 1000
    assert resolve_panel_dimensions(_estimate(h=2300), []).height == 2300
    assert resolve_panel_dimensions(_estimate(h=2300), [_P(1, 1, 0, 2275, 0, 0)]).height is None  # 背面だけある場合は正面高さにしない


def test_confirmation_is_blocked_while_a_box_row_needs_review_and_saves_one_row_per_panel_after_choosing(
    client, monkeypatch, tmp_path
):
    """要確認(コード未確定)の箱の行が残っている間は、既存の仕様どおり確定できない(422)。利用者がコードを
    選べば確定でき、確定には盤ごとに1件ずつ保存される。"""
    _setup(
        client,
        monkeypatch,
        tmp_path,
        estcode_rows=[_estcode_row("OS2", 1, 1, "箱･単独"), _estcode_row("OS2", 2, 2, "箱･右")],
        product_rows=[_product_row(1, 1, 2365, 2275, 900, 2000), _product_row(2, 2, 2365, 2275, 900, 2000)],
    )
    _evaluate(client)
    assert client.post(f"/api/products/{PRODUCT}/estimate-confirmations").status_code == 422

    chosen = _master(client, "箱･単独", "OS2-920", "2.3*0.9*2.0")
    assert client.put(f"/api/products/{PRODUCT}/box-selections/2/2", json={"master_item_id": chosen["id"]}).status_code == 200
    res = client.post(f"/api/products/{PRODUCT}/estimate-confirmations")
    assert res.status_code == 201, res.text
    assert res.json()["item_count"] == 2
    by_panel = {(i["ban_menno"], i["ban_no"]): i for i in res.json()["items"]}
    assert by_panel[(1, 1)]["code"] == "11018" and by_panel[(1, 1)]["quantity"] == 1
    assert by_panel[(2, 2)]["code"] == chosen["code"] and by_panel[(2, 2)]["quantity"] == 1
