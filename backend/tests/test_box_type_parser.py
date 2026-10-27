"""箱体型式解析 (`app/services/box_type_parser.py`) のテスト。

正本資料「QS-SA020-N 箱体記号一覧表 N版（2026/02/20）」に基づく解析仕様の
確認。実データのDBは一切使わない純粋なユニットテスト。
"""
from __future__ import annotations

from app.services import box_type_parser as parser
from app.services.box_type_parser import normalize_box_type, parse_box_type


def _codes(analysis, group: str) -> list[str]:
    return [m.code for m in analysis.aux_matches if m.group == group]


# ---------------------------------------------------------------------------
# 1. 入力の正規化
# ---------------------------------------------------------------------------


def test_normalize_strips_whitespace_and_uppercases():
    assert normalize_box_type("  os2gtvdk  ") == "OS2GTVDK"


def test_normalize_converts_fullwidth_alnum_to_halfwidth():
    assert normalize_box_type("ｏｓ２ＧＴ") == "OS2GT"


def test_normalize_unifies_halfwidth_katakana_to_fullwidth():
    # 半角カタカナ "ﾆﾝ" は全角 "ニン" へ統一される。
    assert normalize_box_type("OS2VDﾆﾝ") == "OS2VDニン"


def test_normalize_removes_internal_whitespace():
    assert normalize_box_type("OS2 GT VD K") == "OS2GTVDK"


def test_raw_is_preserved_even_after_normalization():
    analysis = parse_box_type("  os2 gt vd k  ")
    assert analysis.raw == "  os2 gt vd k  "
    assert analysis.normalized == "OS2GTVDK"


def test_unregistered_characters_are_not_silently_dropped():
    # "Q"はどの記号にも登録が無いため、削除・補完せず未解析として保持する。
    analysis = parse_box_type("OS2QGT")
    assert "Q" in analysis.unparsed
    assert analysis.status == "partial"


# ---------------------------------------------------------------------------
# 9. 必須分解テスト
# ---------------------------------------------------------------------------


def test_os2_gt_vd_k():
    a = parse_box_type("OS2GTVDK")
    assert a.primary.code == "OS2"
    assert _codes(a, "aux1") == ["GT", "VD"]
    assert _codes(a, "aux2") == ["K"]
    assert a.unparsed == ()
    assert a.status == "parsed"
    assert a.conflicts == ()


def test_os2_za_vd():
    a = parse_box_type("OS2ZAVD")
    assert a.primary.code == "OS2"
    assert _codes(a, "aux1") == ["ZA", "VD"]
    assert a.status == "parsed"


def test_os2_za_vdt():
    a = parse_box_type("OS2ZAVDT")
    assert a.primary.code == "OS2"
    assert _codes(a, "aux1") == ["ZA", "VDT"]
    assert a.status == "parsed"


def test_oa_gt_vd_k():
    a = parse_box_type("OAGTVDK")
    assert a.primary.code == "OA"
    assert _codes(a, "aux1") == ["GT", "VD"]
    assert _codes(a, "aux2") == ["K"]
    assert a.status == "parsed"


def test_opa_za():
    a = parse_box_type("OPAZA")
    assert a.primary.code == "OPA"
    assert _codes(a, "aux1") == ["ZA"]
    assert a.status == "parsed"


def test_is2_alone_is_parsed_with_primary_definition():
    """[2026-10 追加修正: 画面に「この型式は解析できませんでした」と誤表示される
    不具合報告への回帰確認] 補助記号を伴わない単独の第1記号(`IS2`)も、
    きちんと`status="parsed"`となり、マスタに根拠のある箱体分類・設置環境・
    使用区分を返すこと。"""
    a = parse_box_type("IS2")
    assert a.status == "parsed"
    assert a.requires_review is False
    assert a.primary is not None
    assert a.primary.code == "IS2"
    assert a.primary.meaning == "標準アングルレス型"
    assert a.box_category == "A製品用・屋内キュービクル"
    assert a.product_category == "A製品"
    assert a.environment == "屋内"
    assert a.usage == "標準"
    assert a.structure == "標準アングルレス型"
    assert a.unparsed == ()
    assert a.conflicts == ()


def test_os2_alone_is_parsed_with_primary_definition():
    a = parse_box_type("OS2")
    assert a.status == "parsed"
    assert a.requires_review is False
    assert a.primary is not None
    assert a.primary.code == "OS2"
    assert a.box_category == "A製品用・屋外キュービクル"
    assert a.environment == "屋外"


def test_op_opa_opk_are_distinguished():
    assert parse_box_type("OP").primary.code == "OP"
    assert parse_box_type("OPA").primary.code == "OPA"
    assert parse_box_type("OPK").primary.code == "OPK"


def test_is2p_is_its_own_symbol_not_is2_plus_p():
    a = parse_box_type("IS2P")
    assert a.primary.code == "IS2P"
    assert a.unparsed == ()
    assert a.status == "parsed"


def test_scy5_is_not_split_into_scy_and_5():
    a = parse_box_type("SCY5")
    assert a.primary.code == "SCY5"
    assert a.unparsed == ()
    assert a.ip55 is True


def test_dhnr_is_its_own_symbol_not_dhn_plus_r():
    a = parse_box_type("DHNR")
    assert a.primary.code == "DHNR"
    assert a.unparsed == ()


def test_cdc_vd_nin():
    a = parse_box_type("CDCVDニン")
    assert a.primary.code == "CDC"
    assert _codes(a, "aux1") == ["VD"]
    assert _codes(a, "aux2") == ["ニン"]
    assert a.status == "parsed"
    assert any("耐火性収納箱認定品" in n for n in a.notes)


def test_os2_f():
    a = parse_box_type("OS2F")
    assert a.primary.code == "OS2"
    assert _codes(a, "aux3") == ["F"]
    assert "Fフロントタイプ" in a.other_notes
    assert a.status == "parsed"


def test_os2_su():
    a = parse_box_type("OS2SU")
    assert a.material == "SUS304"
    assert a.coating == "塗装仕上"
    assert a.status == "parsed"


def test_os2_hl():
    a = parse_box_type("OS2HL")
    assert a.material == "SUS304"
    assert a.surface_treatment == "ヘアライン仕上"
    assert a.status == "parsed"


def test_scy_vdt():
    a = parse_box_type("SCYVDT")
    assert a.primary.code == "SCY"
    assert _codes(a, "aux1") == ["VDT"]
    assert a.base_finish == "溶融亜鉛めっき＋塗装仕上"
    assert a.status == "parsed"


# ---------------------------------------------------------------------------
# 第1記号: 表記ゆれ・長さ違いの区別
# ---------------------------------------------------------------------------


def test_opa_takes_priority_over_op():
    assert parse_box_type("OPAGT").primary.code == "OPA"


def test_iat_vs_iatp():
    assert parse_box_type("IAT").primary.code == "IAT"
    assert parse_box_type("IATP").primary.code == "IATP"


def test_unknown_primary_symbol_does_not_attempt_aux_parsing():
    # "Q"で始まる記号は第1記号マスタに存在しない。
    a = parse_box_type("QQQQQQ")
    assert a.status == "unknown"
    assert a.primary is None
    assert a.aux_matches == ()
    assert a.unparsed == ("QQQQQQ",)


def test_empty_string_is_unknown_not_crash():
    a = parse_box_type("")
    assert a.status == "unknown"
    assert a.primary is None


# ---------------------------------------------------------------------------
# 独自積算条件 (正式規格の記号定義とは別マスタ)
# ---------------------------------------------------------------------------


def test_op_exact_gets_a2_condition_but_opa_opk_do_not():
    op = parse_box_type("OP")
    opa = parse_box_type("OPA")
    opk = parse_box_type("OPK")
    assert any("A2" in c for c in op.custom_estimate_conditions)
    assert not any("A2" in c for c in opa.custom_estimate_conditions)
    assert not any("A2" in c for c in opk.custom_estimate_conditions)
    assert any("アングル枠" in c for c in opa.custom_estimate_conditions)
    assert not any("アングル枠" in c for c in opk.custom_estimate_conditions)


def test_vza_is_classified_as_base_only_not_whole_body():
    a = parse_box_type("OS2VZA")
    assert a.surface_treatment is None  # 本体側は処理していない
    assert a.coating is None
    assert a.base_finish == "メタリコン(ZS-50)＋ウレタン塗装"


def test_za_is_classified_as_body_only():
    a = parse_box_type("OS2ZA")
    assert a.surface_treatment == "メタリコン(ZS-50)"
    assert a.coating == "ウレタン塗装"
    assert a.base_finish is None


# ---------------------------------------------------------------------------
# 競合 (本体/ベース区別を含む)
# ---------------------------------------------------------------------------


def test_su_hl_conflict_on_finish():
    a = parse_box_type("OS2SUHL")
    assert a.status == "conflict"
    assert any(c.field == "finish" for c in a.conflicts)


def test_d_za_conflict_on_body_surface():
    a = parse_box_type("OS2DZA")
    assert a.status == "conflict"
    assert any(c.field == "body_surface" for c in a.conflicts)


def test_dt_zn_conflict_on_body_surface():
    a = parse_box_type("OS2DTZN")
    assert a.status == "conflict"
    assert any(c.field == "body_surface" for c in a.conflicts)


def test_za_gt_conflict_on_body_coating():
    a = parse_box_type("OS2ZAGT")
    assert a.status == "conflict"
    assert any(c.field == "body_coating" for c in a.conflicts)


def test_za_vdt_is_not_a_hard_conflict_but_keeps_body_and_base_separate():
    a = parse_box_type("OS2ZAVDT")
    assert a.status == "parsed"
    assert a.surface_treatment == "メタリコン(ZS-50)"
    assert a.base_finish == "溶融亜鉛めっき＋塗装仕上"
    assert any("別範囲" in n for n in a.notes)


def test_gt_vd_is_not_a_hard_conflict_but_keeps_body_and_base_separate():
    a = parse_box_type("OS2GTVD")
    assert a.status == "parsed"
    assert a.coating == "厚膜塗装(3コート・外面100μm以上)"
    assert a.base_finish == "溶融亜鉛めっき"
    assert any("別範囲" in n for n in a.notes)


def test_body_and_base_processing_are_never_merged_into_one_claim():
    """OS2ZAVDTは「本体とベースへ両処理を重ねて実施」と確定してはいけない。"""
    a = parse_box_type("OS2ZAVDT")
    assert a.surface_treatment != a.base_finish
    assert "ベース" not in (a.surface_treatment or "")
    assert "メタリコン" not in (a.base_finish or "")


# ---------------------------------------------------------------------------
# 旧型・IP55・部分製作・他社製品・補助記号2/3混在
# ---------------------------------------------------------------------------


def test_legacy_symbol_requires_pre_use_check():
    a = parse_box_type("OS")
    assert a.usage == "原則使用しない"
    assert a.requires_review is True
    assert any("使用前に確認" in n for n in a.notes)


def test_legacy_group_without_explicit_usage_still_flags_review():
    a = parse_box_type("ML")
    assert a.box_category == "補用箱体・旧型・物件対応"
    assert a.requires_review is True


def test_ip55_symbol_has_note_and_flag():
    a = parse_box_type("CSW5")
    assert a.ip55 is True
    assert any("IP55" in n for n in a.notes)


def test_partial_fabrication_is_distinguished_from_complete_box():
    a = parse_box_type("DP")
    assert a.processing_target == "partial_fabrication"
    b = parse_box_type("OS2")
    assert b.processing_target == "complete_box"


def test_other_vendor_product_has_repaint_caution():
    a = parse_box_type("RB")
    assert a.processing_target == "other_vendor_product"
    assert any("板金追加加工" in n for n in a.notes)
    assert any("部品再利用不可" in n for n in a.notes)


def test_multiple_aux_groups_mixed_in_standard_order():
    a = parse_box_type("OS2GTVDニン")
    assert _codes(a, "aux1") == ["GT", "VD"]
    assert _codes(a, "aux2") == ["ニン"]
    assert not any("nonstandard_order" in w for w in a.warnings)


def test_nonstandard_order_is_accepted_with_warning():
    # 補助記号2(ニン)の後に補助記号1(VD)が続く、非標準の順序。
    a = parse_box_type("OS2ニンVD")
    assert a.status != "unknown"
    assert any("非標準" in w or "nonstandard_order" in w for w in a.warnings)


# ---------------------------------------------------------------------------
# 再連結による入力復元
# ---------------------------------------------------------------------------


def test_segments_reconstruct_normalized_string():
    for raw in ("OS2GTVDK", "OS2QGT", "SCYVDT", "CDCVDニン", "OPAZA", "ZZZ999"):
        a = parse_box_type(raw)
        if a.status == "unknown":
            continue
        reconstructed = "".join(text for _, text in a.segments)
        assert reconstructed == a.normalized, raw


def test_segments_reconstruct_even_with_unparsed_middle_section():
    a = parse_box_type("OS2QQGT")
    reconstructed = "".join(text for _, text in a.segments)
    assert reconstructed == a.normalized
    assert a.status == "partial"
    assert "QQ" in a.unparsed


# ---------------------------------------------------------------------------
# 曖昧(ambiguous)判定の機械自体のテスト(白箱テスト)
# ---------------------------------------------------------------------------


def test_ambiguous_ties_are_preserved_not_silently_resolved(monkeypatch):
    """実際の記号表では構造上あいまいさがほぼ発生しないため、同点の分割候補が
    複数残った場合に`status="ambiguous"`として全候補を保持する機構自体を、
    小さな合成辞書に差し替えて直接検証する。"""
    fake_dict = {
        "AB": [("aux1", "AB")],
        "A": [("aux1", "A")],
        "B": [("aux1", "B")],
    }
    monkeypatch.setattr(parser, "_AUX_DICT", fake_dict)
    monkeypatch.setattr(parser, "_AUX_CODE_LENGTHS", tuple(sorted({len(c) for c in fake_dict}, reverse=True)))
    # AUX1_ESTIMATE_RULESに無いコードでもクラッシュしないことを確認するため、
    # 各コードにダミーのother_noteだけ与えておく。
    monkeypatch.setitem(parser.AUX1_ESTIMATE_RULES, "AB", parser._Aux1EstimateRule(other_note="AB"))
    monkeypatch.setitem(parser.AUX1_ESTIMATE_RULES, "A", parser._Aux1EstimateRule(other_note="A"))
    monkeypatch.setitem(parser.AUX1_ESTIMATE_RULES, "B", parser._Aux1EstimateRule(other_note="B"))
    monkeypatch.setitem(parser._AUX1_BY_CODE, "AB", type("S", (), {"meaning": "AB"})())
    monkeypatch.setitem(parser._AUX1_BY_CODE, "A", type("S", (), {"meaning": "A"})())
    monkeypatch.setitem(parser._AUX1_BY_CODE, "B", type("S", (), {"meaning": "B"})())

    candidates = parser._segment("AB")
    # "AB"(1トークン) と "A"+"B"(2トークン)はどちらも未解析文字数0で同点になりうる。
    unparsed_counts = {u for u, _ in candidates}
    assert unparsed_counts == {0}
    token_counts = {len(parser._tokens_from_ops(ops)) for _, ops in candidates}
    assert token_counts == {1, 2}


# ---------------------------------------------------------------------------
# 構造化出力の形(再利用可能性)
# ---------------------------------------------------------------------------


def test_analysis_exposes_structured_fields_for_downstream_use():
    a = parse_box_type("OS2GTVDK")
    assert a.box_category == "A製品用・屋外キュービクル"
    assert a.product_category == "A製品"
    assert a.environment == "屋外"
    assert a.usage == "標準"
    # 補助記号2「K」は単独で告示番号を特定できないため、要確認として扱う
    # (資料3章の指示どおり)。
    assert a.requires_review is True
    assert any("告示番号" in n for n in a.notes)


def test_requires_review_is_false_for_a_clean_unambiguous_parse():
    a = parse_box_type("OS2GT")
    assert a.status == "parsed"
    assert a.requires_review is False
    assert a.notes == ()
