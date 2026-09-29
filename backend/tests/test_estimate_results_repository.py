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
    list_results_for_product,
    replace_results_for_product,
    reset_factor_to_initial,
    set_current_factor,
)


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
        replace_results_for_product(conn, product_no="A1GV2421", candidates=[_candidate()])
        # 2回目の評価では候補が0件(条件不成立)になったとする。
        results = replace_results_for_product(conn, product_no="A1GV2421", candidates=[])

    assert results == []


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
