"""積算結果(EstimateResult)候補の統合パイプライン (Issue #40 Phase 5)。

Phase 5指示1章「積算結果の正本はEstimateResultとする」を受け、新方式
(`app.services.estimate_rule_evaluator`、図面情報→ルール評価)と旧方式
(`app.services.legacy_detection_adapter`、master_item_id直結Detectionの
変換)の両方の候補を1つの候補集合へ合流させる。

**新旧同一コードの扱い (Phase 5指示13章)**: 同じ対象(盤/製品全体)・同じ
積算コードが、新方式(`source_rule_id is not None`)と旧方式
(`source_rule_id is None`)の両方から算出された場合、どちらか一方を機械的に
捨てる/dedupeすることはしない(根拠・適用単位・数量算定ルールが異なる
可能性があり、本当に同一結果かをこのパイプラインだけでは判断できないため)。
代わりに、該当するすべての候補の`status`を`EstimateResultStatus.NEEDS_REVIEW`
へ設定し、作業者が実際に見て判断できるよう「要確認」として残す。
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

from app.domain.estimate_rules import EstimateResultCandidate, EstimateResultStatus
from app.services.estimate_rule_evaluator import evaluate_product
from app.services.legacy_detection_adapter import build_legacy_candidates


@dataclass
class CombinedEvaluationOutcome:
    candidates: list[EstimateResultCandidate] = field(default_factory=list)
    skipped_rule_master_ids: list[int] = field(default_factory=list)
    # 新旧両方式から同一(対象, コード)が算出され、機械的に統合できなかった
    # ため`NEEDS_REVIEW`とした組み合わせ(診断・Issue報告用)。
    conflicting_code_targets: list[tuple[int | None, int | None, str]] = field(default_factory=list)


def _target_key(candidate: EstimateResultCandidate) -> tuple[int | None, int | None, str]:
    return (candidate.target_panel_ban_menno, candidate.target_panel_ban_no, candidate.code)


def build_all_candidates(
    conn: sqlite3.Connection, data_source_root: Path, product_no: str
) -> CombinedEvaluationOutcome:
    """新方式(rule evaluator)・旧方式(legacy Detection互換)の両方の候補を
    合流させ、新旧同一コード衝突を検出して`NEEDS_REVIEW`を付与した上で返す。
    """
    rule_outcome = evaluate_product(conn, data_source_root, product_no)
    legacy_candidates = build_legacy_candidates(conn, data_source_root, product_no)

    all_candidates = [*rule_outcome.candidates, *legacy_candidates]

    by_target: dict[tuple[int | None, int | None, str], list[EstimateResultCandidate]] = {}
    for c in all_candidates:
        by_target.setdefault(_target_key(c), []).append(c)

    conflicting: list[tuple[int | None, int | None, str]] = []
    for key, group in by_target.items():
        has_new = any(c.source_rule_id is not None for c in group)
        has_legacy = any(c.source_rule_id is None for c in group)
        if has_new and has_legacy:
            conflicting.append(key)
            for c in group:
                c.status = EstimateResultStatus.NEEDS_REVIEW
                note = "要確認: 同一コードが新方式(ルール評価)・旧方式(直接付与)の両方から算出されました"
                c.judgment_reason = f"{c.judgment_reason} / {note}" if c.judgment_reason else note

    return CombinedEvaluationOutcome(
        candidates=all_candidates,
        skipped_rule_master_ids=rule_outcome.skipped_rule_master_ids,
        conflicting_code_targets=conflicting,
    )


__all__ = ["CombinedEvaluationOutcome", "build_all_candidates"]
