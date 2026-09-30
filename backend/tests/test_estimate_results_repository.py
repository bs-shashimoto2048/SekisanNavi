"""`app.repositories.estimate_results` のテスト (Issue #40 Phase 2)。

評価器を経由せず、`EstimateResultCandidate`を直接組み立てて
`replace_results_for_product`の挙動(UPSERT・手修正の保護・削除)を検証する。
"""
from app.domain.estimate_rules import (
    ApplicableUnit,
    EstimateResultCandidate,
    EvidenceKind,
    EvidenceRef,
    JudgmentMethod,
    JudgmentScope,
)
from app.repositories.estimate_results import (
    FactorNotAllowedError,
    list_results_for_product,
    replace_results_for_product,
    reset_factor_to_initial,
    set_current_factor,
)
from app.repositories.estimate_rule_masters import create_rule_master


def _candidate(**overrides) -> EstimateResultCandidate:
    base = dict(
        product_no="A1GV2421",
        result_key="18323:panel:1:1",
        master_item_id=None,
        code="18323",
        quantity=1,
        applicable_unit=ApplicableUnit.UNIT,
        initial_factor=1.0,
        judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
        judgment_scope=JudgmentScope.PANEL,
        target_panel_ban_menno=1,
        target_panel_ban_no=1,
        target_drawing_page_id=None,
        judgment_reason="test",
        source_rule_id=None,
        unit_price=1000.0,
        unit_labor=None,
        evidence=[EvidenceRef(evidence_kind=EvidenceKind.DETECTION, detection_id=101)],
    )
    base.update(overrides)
    return EstimateResultCandidate(**base)


def test_replace_results_creates_new_rows_with_price_and_evidence(db_path):
    from app.db.connection import get_connection

    with get_connection(db_path) as conn:
        results = replace_results_for_product(conn, product_no="A1GV2421", candidates=[_candidate()])

    assert len(results) == 1
    r = results[0]
    assert r.code == "18323"
    assert r.quantity == 1
    assert r.initial_factor == 1.0
    assert r.current_factor == 1.0
    assert r.factor_overridden is False
    assert r.price == 1000.0  # 1000 * 1 * 1.0
    assert len(r.evidence) == 1
    assert r.evidence[0].detection_id == 101


def test_replace_results_removes_rows_whose_condition_no_longer_holds(db_path):
    from app.db.connection import get_connection

    with get_connection(db_path) as conn:
        [created] = replace_results_for_product(conn, product_no="A1GV2421", candidates=[_candidate()])
        assert len(created.evidence) == 1
        # 2回目の評価では候補が0件(条件不成立)になったとする。
        results = replace_results_for_product(conn, product_no="A1GV2421", candidates=[])

        # PR #41自己レビュー確認事項: estimate_result_evidence側も
        # ON DELETE CASCADEで連動削除され、孤立行(dangling row)が残らないこと。
        remaining_evidence = conn.execute(
            "SELECT COUNT(*) FROM estimate_result_evidence WHERE estimate_result_id = ?",
            (created.id,),
        ).fetchone()[0]

    assert results == []
    assert remaining_evidence == 0


def test_manual_factor_override_survives_reevaluation(db_path):
    """Issue #40 7-3章: 手修正後、再評価してもcurrent_factorが上書きされない。"""
    from app.db.connection import get_connection

    with get_connection(db_path) as conn:
        [created] = replace_results_for_product(conn, product_no="A1GV2421", candidates=[_candidate()])

        overridden = set_current_factor(
            conn,
            product_no="A1GV2421",
            result_id=created.id,
            current_factor=0.7,
            reason="現地確認により0.7へ変更",
            updated_by="tester",
        )
        assert overridden.current_factor == 0.7
        assert overridden.factor_overridden is True
        assert overridden.factor_override_reason == "現地確認により0.7へ変更"
        assert overridden.price == 700.0  # 1000 * 1 * 0.7 (手修正係数を反映)

        # 再評価: initial_factorが変わった新しい候補が来ても、current_factorは
        # 保持される。
        [reevaluated] = replace_results_for_product(
            conn, product_no="A1GV2421", candidates=[_candidate(initial_factor=0.5)]
        )
        assert reevaluated.id == created.id
        assert reevaluated.initial_factor == 0.5  # 派生値は更新される
        assert reevaluated.current_factor == 0.7  # 手修正値は保持される
        assert reevaluated.factor_overridden is True
        assert reevaluated.price == 700.0  # 1000 * 1 * 0.7 (保持された係数のまま)


def test_unoverridden_result_tracks_initial_factor_on_reevaluation(db_path):
    """手修正していない結果は、再評価のたびに最新のinitial_factorへ追従する。"""
    from app.db.connection import get_connection

    with get_connection(db_path) as conn:
        replace_results_for_product(conn, product_no="A1GV2421", candidates=[_candidate(initial_factor=1.0)])
        [updated] = replace_results_for_product(
            conn, product_no="A1GV2421", candidates=[_candidate(initial_factor=0.6)]
        )

    assert updated.initial_factor == 0.6
    assert updated.current_factor == 0.6
    assert updated.factor_overridden is False
    assert updated.price == 600.0


def test_reset_factor_to_initial(db_path):
    from app.db.connection import get_connection

    with get_connection(db_path) as conn:
        [created] = replace_results_for_product(conn, product_no="A1GV2421", candidates=[_candidate()])
        set_current_factor(
            conn, product_no="A1GV2421", result_id=created.id, current_factor=0.7, reason=None, updated_by=None
        )
        reset = reset_factor_to_initial(conn, product_no="A1GV2421", result_id=created.id)

    assert reset.current_factor == reset.initial_factor == 1.0
    assert reset.factor_overridden is False
    assert reset.factor_override_reason is None


def test_no_price_fabricated_when_unit_price_unknown(db_path):
    from app.db.connection import get_connection

    with get_connection(db_path) as conn:
        [created] = replace_results_for_product(
            conn, product_no="A1GV2421", candidates=[_candidate(unit_price=None)]
        )

    assert created.price is None
    assert created.labor is None


def test_list_results_for_product_scopes_by_product_no(db_path):
    from app.db.connection import get_connection

    with get_connection(db_path) as conn:
        replace_results_for_product(conn, product_no="A1GV2421", candidates=[_candidate()])
        replace_results_for_product(
            conn, product_no="OTHER999", candidates=[_candidate(product_no="OTHER999", result_key="18323:panel:9:9")]
        )

        a1_results = list_results_for_product(conn, product_no="A1GV2421")
        other_results = list_results_for_product(conn, product_no="OTHER999")

    assert len(a1_results) == 1
    assert len(other_results) == 1
    assert a1_results[0].product_no == "A1GV2421"
    assert other_results[0].product_no == "OTHER999"


# --- PR #41レビュー指摘対応: 係数override APIのallowed_factors制約 ---


def _create_rule_with_allowed_factors(conn, allowed_factors):
    master_item_id = conn.execute("SELECT id FROM estimate_master_items LIMIT 1").fetchone()[0]
    rule = create_rule_master(
        conn,
        master_item_id=master_item_id,
        judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
        judgment_scope=JudgmentScope.PANEL,
        allowed_factors=allowed_factors,
    )
    return rule.id


def test_set_current_factor_succeeds_when_value_is_in_allowed_factors(db_path):
    from app.db.connection import get_connection

    with get_connection(db_path) as conn:
        rule_id = _create_rule_with_allowed_factors(conn, [0.5, 0.7, 1.0])
        [created] = replace_results_for_product(
            conn, product_no="A1GV2421", candidates=[_candidate(source_rule_id=rule_id)]
        )

        result = set_current_factor(
            conn,
            product_no="A1GV2421",
            result_id=created.id,
            current_factor=0.7,
            reason=None,
            updated_by=None,
        )

    assert result.current_factor == 0.7
    assert result.factor_overridden is True


def test_set_current_factor_rejects_value_outside_allowed_factors(db_path):
    from app.db.connection import get_connection

    with get_connection(db_path) as conn:
        rule_id = _create_rule_with_allowed_factors(conn, [0.5, 0.7, 1.0])
        [created] = replace_results_for_product(
            conn, product_no="A1GV2421", candidates=[_candidate(source_rule_id=rule_id)]
        )

        try:
            set_current_factor(
                conn,
                product_no="A1GV2421",
                result_id=created.id,
                current_factor=0.9,
                reason=None,
                updated_by=None,
            )
            assert False, "FactorNotAllowedErrorが送出されるべき"
        except FactorNotAllowedError as e:
            assert e.current_factor == 0.9
            assert e.allowed_factors == [0.5, 0.7, 1.0]

        # 拒否された場合、既存の値は変更されない(現状維持)。
        unchanged = [r for r in list_results_for_product(conn, product_no="A1GV2421") if r.id == created.id][0]
    assert unchanged.current_factor == 1.0
    assert unchanged.factor_overridden is False


def test_set_current_factor_allows_free_input_when_allowed_factors_is_null(db_path):
    """allowed_factors未設定のルールは、現時点では自由入力を許容する
    (Phase 1で係数候補が未確定のルールへの後方互換。PR #41レビュー指摘の
    明示要件)。"""
    from app.db.connection import get_connection

    with get_connection(db_path) as conn:
        rule_id = _create_rule_with_allowed_factors(conn, None)
        [created] = replace_results_for_product(
            conn, product_no="A1GV2421", candidates=[_candidate(source_rule_id=rule_id)]
        )

        result = set_current_factor(
            conn,
            product_no="A1GV2421",
            result_id=created.id,
            current_factor=0.37,  # 候補に無さそうな任意の値
            reason=None,
            updated_by=None,
        )

    assert result.current_factor == 0.37
    assert result.factor_overridden is True


def test_set_current_factor_allows_free_input_when_no_source_rule(db_path):
    """source_rule_idが無い積算結果(専用ルール由来等)は、参照先のルールが
    無いため従来通り自由入力を許容する。"""
    from app.db.connection import get_connection

    with get_connection(db_path) as conn:
        [created] = replace_results_for_product(
            conn, product_no="A1GV2421", candidates=[_candidate(source_rule_id=None)]
        )

        result = set_current_factor(
            conn,
            product_no="A1GV2421",
            result_id=created.id,
            current_factor=0.37,
            reason=None,
            updated_by=None,
        )

    assert result.current_factor == 0.37


def test_reset_factor_to_initial_is_unaffected_by_allowed_factors(db_path):
    """reset-factorの挙動は変更しない(PR #41レビュー指摘の明示要件)。
    initial_factor自体が候補外であっても、reset操作自体は拒否しない
    (ルールマスタ側の初期係数設定はこの制約の対象外)。"""
    from app.db.connection import get_connection

    with get_connection(db_path) as conn:
        rule_id = _create_rule_with_allowed_factors(conn, [0.5, 0.7])
        [created] = replace_results_for_product(
            conn,
            product_no="A1GV2421",
            candidates=[_candidate(source_rule_id=rule_id, initial_factor=1.0)],
        )
        set_current_factor(
            conn, product_no="A1GV2421", result_id=created.id, current_factor=0.7, reason=None, updated_by=None
        )

        reset = reset_factor_to_initial(conn, product_no="A1GV2421", result_id=created.id)

    assert reset.current_factor == 1.0  # initial_factor(候補外の1.0)へそのまま復元される
    assert reset.factor_overridden is False


# --- Issue #40 Phase 3: 根拠BBox→関係する積算結果 (detection_idでの絞り込み) ---


def test_list_results_for_product_filters_by_detection_id(db_path):
    from app.db.connection import get_connection

    with get_connection(db_path) as conn:
        replace_results_for_product(
            conn,
            product_no="A1GV2421",
            candidates=[
                _candidate(
                    result_key="18323:evidence:101",
                    evidence=[EvidenceRef(evidence_kind=EvidenceKind.DETECTION, detection_id=101)],
                ),
                _candidate(
                    result_key="18500:evidence:202",
                    code="18500",
                    evidence=[EvidenceRef(evidence_kind=EvidenceKind.DETECTION, detection_id=202)],
                ),
            ],
        )

        matches_101 = list_results_for_product(conn, product_no="A1GV2421", detection_id=101)
        matches_202 = list_results_for_product(conn, product_no="A1GV2421", detection_id=202)
        matches_none = list_results_for_product(conn, product_no="A1GV2421", detection_id=999)

    assert len(matches_101) == 1
    assert matches_101[0].code == "18323"
    assert len(matches_202) == 1
    assert matches_202[0].code == "18500"
    assert matches_none == []


def test_list_results_for_product_filters_by_detection_id_shared_by_multiple_results(db_path):
    """1つのBBoxが複数の積算結果の根拠になりうる(Issue #40 9章)ケース。"""
    from app.db.connection import get_connection

    with get_connection(db_path) as conn:
        replace_results_for_product(
            conn,
            product_no="A1GV2421",
            candidates=[
                _candidate(
                    result_key="18323:panel:1:1",
                    evidence=[
                        EvidenceRef(evidence_kind=EvidenceKind.DETECTION, detection_id=101),
                        EvidenceRef(evidence_kind=EvidenceKind.DETECTION, detection_id=102),
                    ],
                ),
                _candidate(
                    result_key="18500:panel:1:1",
                    code="18500",
                    evidence=[EvidenceRef(evidence_kind=EvidenceKind.DETECTION, detection_id=101)],
                ),
            ],
        )

        matches = list_results_for_product(conn, product_no="A1GV2421", detection_id=101)

    assert {r.code for r in matches} == {"18323", "18500"}
