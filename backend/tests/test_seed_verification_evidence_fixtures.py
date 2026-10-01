"""`backend/tools/seed_verification_evidence_fixtures.py` のテスト
(Issue #40 Phase 6-D PR #48レビュー指摘対応)。

このスクリプトは検証用DBコピー専用であり、本番DBへは一切接続しない。
テストも同じ方針を守り、`db_path`フィクスチャ(`tmp_path`配下の使い捨てDB)
のみを対象にする(本番DB・本番seedには一切触れない)。

レビュー指摘の再発防止として、特に「`--cleanup`がcandidate
evidence_type由来のDetectionを削除せず`evidence_type_key=NULL`へ落として
孤児化させる」問題が再発しないことを確認する。
"""
import sqlite3
from pathlib import Path

import pytest

from app.db.connection import get_connection
from app.domain.estimate_rules import EvidenceUsage, JudgmentScope
from app.repositories.detections import create_evidence_detection
from app.repositories.drawing_evidence_types import create_evidence_type, list_evidence_types
from app.repositories.estimate_results import replace_results_for_product
from app.repositories.estimate_rule_masters import list_rule_masters
from app.services.estimate_rule_evaluator import evaluate_product
from tests.test_estimate_rule_evaluator import (
    _ESTCODE_DF_HEADER,
    _ESTCODE_ROW_1_1,
    _PRODUCT_DF_HEADER,
    _PANEL_1_1_ROW,
    _configure_root,
    _page16_id,
    _write_cp932_csv,
)
from tools import seed_verification_evidence_fixtures as fx


def _setup_product_dir(tmp_path: Path) -> Path:
    product = tmp_path / "A1GV2421"
    product.mkdir()
    _write_cp932_csv(product / "product_df.csv", _PRODUCT_DF_HEADER, [_PANEL_1_1_ROW])
    _write_cp932_csv(product / "estcode_df.csv", _ESTCODE_DF_HEADER, [_ESTCODE_ROW_1_1])
    return product


def _fk_violations(db_path: Path) -> list:
    with get_connection(db_path) as conn:
        return conn.execute("PRAGMA foreign_key_check").fetchall()


def test_refuses_default_production_db_path():
    """既定(本番想定)DBパスでは常に拒否する(ファイルの実在有無に関わらず、
    パス一致の判定が先に働くこと)。"""
    with pytest.raises(SystemExit):
        fx._check_not_default_db(fx.DEFAULT_DB_PATH)


def test_refuses_nonexistent_verification_db_path(tmp_path):
    with pytest.raises(SystemExit):
        fx._check_not_default_db(tmp_path / "does-not-exist.db")


def test_seed_is_idempotent(db_path):
    fx.seed(db_path)
    with get_connection(db_path) as conn:
        first_evidence = len(list_evidence_types(conn))
        first_rule = len(list_rule_masters(conn))

    fx.seed(db_path)  # 2回目: 全てskipされ、件数は変化しないはず。
    with get_connection(db_path) as conn:
        second_evidence = len(list_evidence_types(conn))
        second_rule = len(list_rule_masters(conn))

    assert first_evidence == second_evidence == len(fx.EVIDENCE_TYPE_CANDIDATES)
    assert first_rule == second_rule == len(fx.RULE_MASTER_CANDIDATES)


def test_cleanup_brings_candidate_counts_back_to_zero(db_path):
    fx.seed(db_path)
    fx.cleanup(db_path)
    with get_connection(db_path) as conn:
        assert len(list_evidence_types(conn)) == 0
        assert len(list_rule_masters(conn)) == 0


def test_cleanup_is_safe_to_run_multiple_times(db_path):
    """cleanupを複数回実行しても例外にならず、件数も0のまま安定する。"""
    fx.seed(db_path)
    fx.cleanup(db_path)
    fx.cleanup(db_path)
    fx.cleanup(db_path)
    with get_connection(db_path) as conn:
        assert len(list_evidence_types(conn)) == 0
        assert len(list_rule_masters(conn)) == 0


def test_seed_evaluate_cleanup_reseed_roundtrip_without_orphaning_detections(
    client, monkeypatch, tmp_path, db_path
):
    """PR #48レビュー指摘の再現・再発防止テスト。

    candidate evidence_type(`side_door`)を参照する検証用BBoxを作成し、
    評価器を実行してEstimateResult/EstimateResultEvidenceを発生させた状態で
    cleanupすると、
      - candidate行(evidence_type/rule_master)が0件になる
      - そのBBox(Detection)自体が削除される(evidence_type_key=NULLへ
        落として残留させない)
      - そのDetectionを根拠にしていたEstimateResult/Evidenceも道連れで消え、
        `estimate_result_evidence.detection_id`の孤児(dangling reference)が
        残らない
      - `PRAGMA foreign_key_check`で違反が出ない
      - その後の再seedが成功する(往復できる)
    ことを確認する。
    """
    fx.seed(db_path)

    product_dir = _setup_product_dir(tmp_path)
    _configure_root(client, monkeypatch, tmp_path)

    with get_connection(db_path) as conn:
        page_id = _page16_id(client)
        detection = create_evidence_detection(
            conn,
            drawing_page_id=page_id,
            evidence_type_key="side_door",
            bbox_x=0.1,
            bbox_y=0.1,
            bbox_w=0.05,
            bbox_h=0.05,
        )
        detection_id = detection.id

        outcome = evaluate_product(conn, str(tmp_path), "A1GV2421")
        replace_results_for_product(conn, product_no="A1GV2421", candidates=outcome.candidates)

        evidence_rows_before = conn.execute(
            "SELECT COUNT(*) FROM estimate_result_evidence WHERE detection_id = ?",
            (detection_id,),
        ).fetchone()[0]
        assert evidence_rows_before > 0, "評価器がこのBBoxを根拠にしたEstimateResultを作っているはず"

    fx.cleanup(db_path)

    with get_connection(db_path) as conn:
        assert len(list_evidence_types(conn)) == 0
        assert len(list_rule_masters(conn)) == 0

        remaining_detection = conn.execute(
            "SELECT 1 FROM detections WHERE id = ?", (detection_id,)
        ).fetchone()
        assert remaining_detection is None, "candidate evidence_type由来のBBoxはcleanupで削除されるべき"

        orphaned_evidence_rows = conn.execute(
            "SELECT COUNT(*) FROM estimate_result_evidence WHERE detection_id = ?",
            (detection_id,),
        ).fetchone()[0]
        assert orphaned_evidence_rows == 0, "削除したDetectionを指すestimate_result_evidenceが孤児として残っている"

    assert _fk_violations(db_path) == []

    # 再seedが成功すること(往復できる)。
    fx.seed(db_path)
    with get_connection(db_path) as conn:
        assert len(list_evidence_types(conn)) == len(fx.EVIDENCE_TYPE_CANDIDATES)
        assert len(list_rule_masters(conn)) == len(fx.RULE_MASTER_CANDIDATES)
    assert _fk_violations(db_path) == []


def test_cleanup_does_not_touch_marker_free_existing_data(db_path):
    """目印(`CANDIDATE_MARKER`)の無い既存データは、同じkey/コード体系と
    紛れていてもcleanupの対象にならないことを確認する。"""
    with get_connection(db_path) as conn:
        existing_type = create_evidence_type(
            conn,
            key="existing_untouched_type",
            display_name="既存の図面情報(マーカー無し)",
            category=None,
            usage=EvidenceUsage.BOTH,
            default_judgment_scope=JudgmentScope.PANEL,
            description="テスト用の既存データ(Phase 6-D fixtureのmarkerを含まない)",
        )
        page_id_rows = conn.execute("SELECT id FROM drawing_pages LIMIT 1").fetchone()
        page_id = page_id_rows["id"]
        existing_detection = create_evidence_detection(
            conn,
            drawing_page_id=page_id,
            evidence_type_key="existing_untouched_type",
            bbox_x=0.2,
            bbox_y=0.2,
            bbox_w=0.05,
            bbox_h=0.05,
        )
        existing_detection_id = existing_detection.id

    fx.seed(db_path)
    fx.cleanup(db_path)

    with get_connection(db_path) as conn:
        still_there = conn.execute(
            "SELECT 1 FROM drawing_evidence_types WHERE key = ?", ("existing_untouched_type",)
        ).fetchone()
        assert still_there is not None, "marker無しの既存evidence_typeはcleanupで消えてはいけない"

        detection_still_there = conn.execute(
            "SELECT evidence_type_key FROM detections WHERE id = ?", (existing_detection_id,)
        ).fetchone()
        assert detection_still_there is not None, "marker無しの既存Detectionはcleanupで消えてはいけない"
        assert detection_still_there["evidence_type_key"] == "existing_untouched_type"

    assert _fk_violations(db_path) == []
