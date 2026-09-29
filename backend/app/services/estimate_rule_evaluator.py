"""標準rule evaluator基盤 (Issue #40 Phase 2、11章のハイブリッド方式のうち
「標準ルール」側)。

**重要 (Issue #40 Phase 2指示4)**: このモジュールは「個別積算コードを大量実装
すること」を目的にしない。Phase 3以降で実ルールを載せられる共通基盤のみを
提供する。実際に計算まで行うのは、Issue #40自身が推測禁止としていない、
資料から明確に読み取れる最小限の組み合わせだけである:

  - 判定条件: 図面情報種別の存在判定(必須種別がすべて揃っているか)、
    および設計データの単純な値比較(==/!=/>=/<=/>/<)のANDのみ
    (`StandardCondition`)。
  - 数量算定: `QuantityMethod.PER_EVIDENCE`(根拠1件につき1行)と
    `QuantityMethod.PER_CONDITION_GROUP`(条件成立グループにつき1行。
    Issue #40 6章の「複数BBoxの組合せ1セットにつき1」の実例(VCT+CH)は
    これに該当する)のみ。
  - 判定範囲: `JudgmentScope.PANEL`/`JudgmentScope.DESIGN_DATA`のみ(いずれも
    「1盤を1グループとする」という同じ評価単位)。`POSITION`/`RANGE`
    (BBox同士の上下・左右等の相対位置判定)は、Issue #40 Phase 1報告
    コメント5章の通り「新しい幾何ロジックが別途必要」であり、資料からは
    具体的な判定式を確認できていないため、Phase 2では評価せず
    `skipped_rules`として報告するのみに留める。`PRODUCT`/`DRAWING`スコープも
    同様(複数盤・複数図面にまたがる集約方法が未確認のため)。
  - 価格計算: `CalcType.DIRECT`(単価×数量×係数)のみ。他の`CalcType`は
    Issue #40 13-1章の指示通り推測実装しない。

上記以外の`processing_mode`/`quantity_method`/`judgment_scope`/`calc_type`の
組み合わせを持つルールは、評価対象から除外し(=積算結果を生成しない)、
呼び出し側が診断できるよう`EvaluationOutcome.skipped_rule_master_ids`へ
記録する。
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

from app.domain.estimate_rules import (
    EstimateResultCandidate,
    EvidenceKind,
    EvidenceRef,
    JudgmentScope,
    ProcessingMode,
    QuantityMethod,
    StandardCondition,
)
from app.domain.models import Detection
from app.repositories.detections import list_detections
from app.repositories.estimate_rule_masters import list_rule_masters
from app.repositories.master import get_master_item
from app.services.data_source import DataSourceError, resolve_product_dir
from app.services.design_data_context import DesignDataContext, build_design_data_context
from app.services.estcode_df import load_estcode_df
from app.services.estimate_confirmation_builder import detection_page_no_map
from app.services.panel_assignment import (
    PanelAssignment,
    assign_detection_to_panel,
    physical_panel_key,
)
from app.services.product_df import load_product_df

# 設計データ条件で使える比較演算子 (Issue #40 11章「標準ルール」の最小構造。
# `StandardConditionField`のdocstring参照)。
_OPERATORS = {
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
    ">=": lambda a, b: a is not None and a >= b,
    "<=": lambda a, b: a is not None and a <= b,
    ">": lambda a, b: a is not None and a > b,
    "<": lambda a, b: a is not None and a < b,
}

# Phase 2で実際に評価対象とする判定範囲 (docstring参照)。
_SUPPORTED_SCOPES = {JudgmentScope.PANEL, JudgmentScope.DESIGN_DATA}
_SUPPORTED_QUANTITY_METHODS = {QuantityMethod.PER_EVIDENCE, QuantityMethod.PER_CONDITION_GROUP}


@dataclass
class EvaluationOutcome:
    """評価器の実行結果。`candidates`は
    `app.repositories.estimate_results.replace_results_for_product`へ渡す。"""

    candidates: list[EstimateResultCandidate] = field(default_factory=list)
    # 未実装の組み合わせのため評価しなかったルールの`estimate_rule_masters.id`一覧。
    skipped_rule_master_ids: list[int] = field(default_factory=list)


def _design_data_conditions_hold(condition: StandardCondition, ctx: DesignDataContext) -> bool:
    for c in condition.design_data_conditions:
        actual = getattr(ctx, c.field, None)
        op = _OPERATORS.get(c.operator)
        if op is None or not op(actual, c.value):
            return False
    return True


def _panel_evidence_by_type(
    detections: list[tuple[Detection, PanelAssignment]], panel_key: str
) -> dict[str, list[Detection]]:
    """指定した物理盤へ所属するDetectionを、`evidence_type_key`ごとに束ねる。
    `evidence_type_key`が未設定(None)のDetectionは対象外
    (Issue #40 Phase 2指示: 既存detectionsはバックフィルしない。Phase 3の
    入力UI以降で設定されたものだけが評価対象になる)。"""
    by_type: dict[str, list[Detection]] = {}
    for detection, assignment in detections:
        if detection.evidence_type_key is None:
            continue
        if not isinstance(assignment, PanelAssignment):
            continue
        if physical_panel_key(assignment.panel) != panel_key:
            continue
        by_type.setdefault(detection.evidence_type_key, []).append(detection)
    return by_type


def evaluate_product(
    conn: sqlite3.Connection, data_source_root: Path, product_no: str
) -> EvaluationOutcome:
    """製番`product_no`について、現在の根拠(detections)×設計データ×
    有効な標準ルールから、積算結果候補一式を組み立てる(Issue #40 Phase 2
    「標準rule evaluatorの基盤」)。

    このモジュール自身はDBへ書き込まない(読み取り専用)。呼び出し側
    (router)が戻り値を`app.repositories.estimate_results.
    replace_results_for_product`へ渡して保存する(既存の
    `build_confirmation_items`と同じ「読み取り専用ロジック/保存は呼び出し側」
    という役割分担)。
    """
    resolution = resolve_product_dir(data_source_root, product_no)
    df_result = load_product_df(resolution.ccv_dir, resolution.product_no)
    estcode_result = load_estcode_df(resolution.ccv_dir, resolution.product_no)

    page_no_by_drawing_page_id = detection_page_no_map(conn, product_no)

    # 製番全体の設計データcontext(物理盤キー単位)。複数ページにまたがる場合、
    # 最初に見つかった代表行を採用する(`design_data_context.py`と同じ規則)。
    design_contexts: dict[str, DesignDataContext] = {}
    for page_no_panels in df_result.panels_by_page.values():
        partial = build_design_data_context(page_no_panels, estcode_result.panels)
        for key, ctx in partial.items():
            design_contexts.setdefault(key, ctx)

    # 全Detectionを盤へ割り当てておく(ページをまたいで1回で済むよう事前計算)。
    detections_with_assignment: list[tuple[Detection, PanelAssignment]] = []
    for drawing_page_id, page_no in page_no_by_drawing_page_id.items():
        panels = df_result.panels_by_page.get(page_no, [])
        for detection in list_detections(conn, drawing_page_id):
            assignment = assign_detection_to_panel(
                (detection.bbox_x, detection.bbox_y, detection.bbox_w, detection.bbox_h),
                panels,
            )
            detections_with_assignment.append((detection, assignment))

    master_cache: dict[int, object] = {}

    def _get_master(master_item_id: int):
        if master_item_id not in master_cache:
            master_cache[master_item_id] = get_master_item(conn, master_item_id)
        return master_cache[master_item_id]

    outcome = EvaluationOutcome()
    rules = list_rule_masters(conn, enabled_only=True)

    for rule in rules:
        if rule.processing_mode != ProcessingMode.STANDARD:
            # 専用ルール(custom): Phase 2ではhandlerを1件も登録しないため、
            # 常にスキップする(Issue #40 11章「専用ルール」はPhase 5以降)。
            outcome.skipped_rule_master_ids.append(rule.id)
            continue
        if rule.judgment_scope not in _SUPPORTED_SCOPES:
            outcome.skipped_rule_master_ids.append(rule.id)
            continue
        if rule.quantity_method not in _SUPPORTED_QUANTITY_METHODS:
            outcome.skipped_rule_master_ids.append(rule.id)
            continue
        condition = rule.judgment_condition or StandardCondition()

        master = _get_master(rule.master_item_id)
        if master is None:
            outcome.skipped_rule_master_ids.append(rule.id)
            continue
        code = master.code
        unit_price = master.total_price_a if rule.calc_type.value == "direct" else None

        for panel_key, ctx in design_contexts.items():
            if not _design_data_conditions_hold(condition, ctx):
                continue

            evidence_by_type = _panel_evidence_by_type(detections_with_assignment, panel_key)
            missing_types = [t for t in condition.required_evidence_types if t not in evidence_by_type]
            if missing_types:
                continue

            reason = rule.judgment_reason_template or (
                f"盤 {ctx.ban_menno}/{ctx.ban_no}: "
                + (
                    f"図面情報({', '.join(condition.required_evidence_types)})と設計データ条件が成立"
                    if condition.required_evidence_types
                    else "設計データ条件が成立"
                )
            )

            if rule.quantity_method == QuantityMethod.PER_CONDITION_GROUP or not condition.required_evidence_types:
                # 条件成立グループにつき1行(VCT+CH等の複数根拠の組合せ、または
                # 図面情報を必要としない純粋な設計データ判定)。
                evidence_refs: list[EvidenceRef] = []
                for t in condition.required_evidence_types:
                    for d in evidence_by_type[t]:
                        evidence_refs.append(EvidenceRef(evidence_kind=EvidenceKind.DETECTION, detection_id=d.id))
                if not evidence_refs:
                    evidence_refs.append(
                        EvidenceRef(
                            evidence_kind=EvidenceKind.DESIGN_DATA,
                            design_data_ref=f'{{"panel": "{panel_key}"}}',
                        )
                    )
                outcome.candidates.append(
                    EstimateResultCandidate(
                        product_no=product_no,
                        result_key=f"{code}:panel:{panel_key}",
                        master_item_id=rule.master_item_id,
                        code=code,
                        quantity=1,
                        applicable_unit=rule.applicable_unit,
                        initial_factor=rule.initial_factor,
                        judgment_method=rule.judgment_method,
                        judgment_scope=rule.judgment_scope,
                        target_panel_ban_menno=ctx.ban_menno,
                        target_panel_ban_no=ctx.ban_no,
                        target_drawing_page_id=None,
                        judgment_reason=reason,
                        source_rule_id=rule.id,
                        unit_price=unit_price,
                        unit_labor=None,  # Issue #40 13-1章: 工数→工賃の換算は未確定のため実装しない
                        evidence=evidence_refs,
                    )
                )
            else:
                # 根拠1件につき1行 (QuantityMethod.PER_EVIDENCE)。
                # required_evidence_typesの各種別ごとに、該当するDetection
                # 1件ずつが独立した積算結果になる(例: 側面扉追加のBBoxが
                # 3件あれば3行)。
                for t in condition.required_evidence_types:
                    for d in evidence_by_type[t]:
                        outcome.candidates.append(
                            EstimateResultCandidate(
                                product_no=product_no,
                                result_key=f"{code}:evidence:{d.id}",
                                master_item_id=rule.master_item_id,
                                code=code,
                                quantity=1,
                                applicable_unit=rule.applicable_unit,
                                initial_factor=rule.initial_factor,
                                judgment_method=rule.judgment_method,
                                judgment_scope=rule.judgment_scope,
                                target_panel_ban_menno=ctx.ban_menno,
                                target_panel_ban_no=ctx.ban_no,
                                target_drawing_page_id=d.drawing_page_id,
                                judgment_reason=reason,
                                source_rule_id=rule.id,
                                unit_price=unit_price,
                                unit_labor=None,
                                evidence=[
                                    EvidenceRef(evidence_kind=EvidenceKind.DETECTION, detection_id=d.id)
                                ],
                            )
                        )

    return outcome


__all__ = ["EvaluationOutcome", "evaluate_product", "DataSourceError"]
