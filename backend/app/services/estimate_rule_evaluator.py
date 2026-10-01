"""標準rule evaluator基盤 (Issue #40 Phase 2、11章のハイブリッド方式のうち
「標準ルール」側)。

**重要 (Issue #40 Phase 2指示4)**: このモジュールは「個別積算コードを大量実装
すること」を目的にしない。Phase 3以降で実ルールを載せられる共通基盤のみを
提供する。実際に計算まで行うのは、Issue #40自身が推測禁止としていない、
資料から明確に読み取れる最小限の組み合わせだけである:

  - 判定条件: 図面情報種別の存在判定(必須種別がすべて揃っているか)、
    および設計データの単純な値比較(==/!=/>=/<=/>/<、Issue #40 Phase 6-E
    追加分のstarts_with/inを含む)のANDのみ(`StandardCondition`)。
  - 数量算定: `QuantityMethod.PER_EVIDENCE`(根拠1件につき1行)と
    `QuantityMethod.PER_CONDITION_GROUP`(条件成立グループにつき1行。
    Issue #40 6章の「複数BBoxの組合せ1セットにつき1」の実例(VCT+CH)は
    これに該当する)のみ。
  - 判定範囲: `JudgmentScope.PANEL`/`JudgmentScope.DESIGN_DATA`(いずれも
    「1盤を1グループとする」という同じ評価単位)に加え、Issue #40 Phase 6-E
    で`JudgmentScope.DRAWING`(1図面ページを1グループとする)/
    `JudgmentScope.PRODUCT`(製番全体を1グループとする)を追加した。ただし
    DRAWING/PRODUCTで実際に評価するのは「図面情報の存在判定のみ」
    (`design_data_conditions`を持たず、`required_evidence_types`が1件以上
    ある)ルールに限る。設計データ(`DesignDataContext`)はそもそも盤単位の
    データであり、それを図面単位・製番単位へどう集約するか(例: 複数盤の
    うち1つでも条件を満たせばよいのか、全盤が満たす必要があるのか)は
    業務的な判断が必要になるため、Phase 6-Eでは推測せず対象外とする
    (`skipped_rule_master_ids`)。`POSITION`/`RANGE`(BBox同士の上下・左右等の
    相対位置判定)は、Issue #40 Phase 1報告コメント5章の通り「新しい幾何
    ロジックが別途必要」であり、資料からは具体的な判定式を確認できていない
    ため、引き続き評価せず`skipped_rules`として報告するのみに留める。
  - 価格計算: `CalcType.DIRECT`(単価×数量×係数)のみ。他の`CalcType`は
    Issue #40 13-1章の指示通り推測実装しない。

上記以外の`processing_mode`/`quantity_method`/`judgment_scope`/`calc_type`の
組み合わせを持つルールは、評価対象から除外し(=積算結果を生成しない)、
呼び出し側が診断できるよう`EvaluationOutcome.skipped_rule_master_ids`へ
記録する。
"""
from __future__ import annotations

import json
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
    StandardConditionField,
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
#
# `starts_with`/`in`(Issue #40 Phase 6-E追加分)は、`StandardConditionField.
# __post_init__`で生成時にvalueの型を検証済み(starts_with→str、in→list/tuple)
# だが、評価時の実際の設計データ値(`a`)側の型は保証されない(DesignDataContext
# の値は実データ由来でNone/float/str等さまざま)。そのため、型が合わない場合は
# 例外にせず「条件不成立」として扱う(既存の`>=`等がNoneを不成立とするのと
# 同じ考え方。暗黙の型変換はしない)。
_OPERATORS = {
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
    ">=": lambda a, b: a is not None and a >= b,
    "<=": lambda a, b: a is not None and a <= b,
    ">": lambda a, b: a is not None and a > b,
    "<": lambda a, b: a is not None and a < b,
    "starts_with": lambda a, b: isinstance(a, str) and a.startswith(b),
    "in": lambda a, b: a is not None and a in b,
}

# Phase 2で実際に評価対象とする判定範囲 (docstring参照)。
# Issue #40 Phase 6-E指示3-Dで`DRAWING`/`PRODUCT`を追加した。ただし両scopeは
# 「図面情報の存在判定のみ」(design_data_conditionsを持たず、
# required_evidence_typesが1件以上ある場合)のみ評価する、という制限付き
# サポートである(関数docstring・`evaluate_product`内のコメント参照)。
_SUPPORTED_SCOPES = {
    JudgmentScope.PANEL,
    JudgmentScope.DESIGN_DATA,
    JudgmentScope.DRAWING,
    JudgmentScope.PRODUCT,
}
_SUPPORTED_QUANTITY_METHODS = {QuantityMethod.PER_EVIDENCE, QuantityMethod.PER_CONDITION_GROUP}
# DRAWING/PRODUCT scopeで実際に評価するのは「evidenceの存在判定のみ」の
# ルールに限る(docstring参照)。
_EVIDENCE_ONLY_SCOPES = {JudgmentScope.DRAWING, JudgmentScope.PRODUCT}


@dataclass
class EvaluationOutcome:
    """評価器の実行結果。`candidates`は
    `app.repositories.estimate_results.replace_results_for_product`へ渡す。"""

    candidates: list[EstimateResultCandidate] = field(default_factory=list)
    # 未実装の組み合わせのため評価しなかったルールの`estimate_rule_masters.id`一覧。
    skipped_rule_master_ids: list[int] = field(default_factory=list)


def _field_condition_holds(c: StandardConditionField, ctx: DesignDataContext) -> bool:
    actual = getattr(ctx, c.field, None)
    op = _OPERATORS.get(c.operator)
    return op is not None and op(actual, c.value)


def _design_data_conditions_hold(condition: StandardCondition, ctx: DesignDataContext) -> bool:
    """`design_data_conditions`(AND)と`design_data_any_of`(OR、Issue #40
    Phase 6-F追加)の両方を評価する。

    - `design_data_conditions`は全件成立が必要(AND)。
    - `design_data_any_of`が空でなければ、そのうち**少なくとも1グループ**
      (グループ内はAND)が成立している必要がある(OR)。空の場合はOR制約
      なし(Phase 6-E以前と同じ挙動、後方互換)。
    """
    for c in condition.design_data_conditions:
        if not _field_condition_holds(c, ctx):
            return False
    if condition.design_data_any_of:
        if not any(all(_field_condition_holds(c, ctx) for c in group) for group in condition.design_data_any_of):
            return False
    return True


def _build_design_data_ref(panel_key: str, condition: StandardCondition, ctx: DesignDataContext) -> str:
    """設計データ根拠(`EvidenceRef.design_data_ref`)のJSON文字列を組み立てる
    (Issue #40 Phase 6-B、Phase 6-FでOR(`design_data_any_of`)対応を追加)。

    「判定に実際に使った項目だけ」を保存する方針のため、
    `condition.design_data_conditions`/`design_data_any_of`(このルールが
    実際に評価したfield/operator/valueの組)だけを対象にし、
    `DesignDataContext`が持つ他の設計データ値(条件に使われていない
    フィールド)は含めない。`actual_value`は判定時点の`ctx`から取得した
    実際の値であり、再評価のたびに最新値で作り直される
    (`estimate_results`/`estimate_result_evidence`自体が現在状態の
    テーブルであるため。過去の判定根拠を遡って確認したい場合は、確定snapshot
    (`estimate_confirmation_result_evidence`、Issue #40 Phase 6-A)側へ
    確定時点の値をコピーする)。

    **後方互換性**: `design_data_any_of`が空の場合、出力JSONは
    Phase 6-B時点と全く同じ形(`{"panel": ..., "conditions": [...]}`、
    `any_of`キー無し)になる。`any_of`キーを追加するのは、このルールが
    実際にOR条件を持つ場合のみ(Phase 6-A/Bの確定snapshot
    (`estimate_confirmation_result_evidence.design_data_ref`)はこの文字列を
    そのままコピーするだけなので、ここでの形を守れば確定snapshot側の互換性も
    自動的に保たれる)。
    """

    def _condition_dict(c: StandardConditionField) -> dict:
        return {
            "field": c.field,
            "operator": c.operator,
            "expected_value": c.value,
            "actual_value": getattr(ctx, c.field, None),
        }

    payload: dict = {
        "panel": panel_key,
        "conditions": [_condition_dict(c) for c in condition.design_data_conditions],
    }
    if condition.design_data_any_of:
        payload["any_of"] = [
            {
                "matched": all(_field_condition_holds(c, ctx) for c in group),
                "conditions": [_condition_dict(c) for c in group],
            }
            for group in condition.design_data_any_of
        ]
    return json.dumps(payload, ensure_ascii=False)


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


def _evidence_by_drawing_page(
    detections: list[tuple[Detection, PanelAssignment]],
) -> dict[int, dict[str, list[Detection]]]:
    """Issue #40 Phase 6-E指示3-D: `JudgmentScope.DRAWING`向け。盤への所属
    (`PanelAssignment`)は見ず、`drawing_page_id`(図面1ページ)単位で
    `evidence_type_key`ごとに束ねる。"""
    by_drawing: dict[int, dict[str, list[Detection]]] = {}
    for detection, _assignment in detections:
        if detection.evidence_type_key is None:
            continue
        by_type = by_drawing.setdefault(detection.drawing_page_id, {})
        by_type.setdefault(detection.evidence_type_key, []).append(detection)
    return by_drawing


def _evidence_product_wide(
    detections: list[tuple[Detection, PanelAssignment]],
) -> dict[str, list[Detection]]:
    """Issue #40 Phase 6-E指示3-D: `JudgmentScope.PRODUCT`向け。盤・ページの
    区別をせず、製番全体で`evidence_type_key`ごとに束ねる。"""
    by_type: dict[str, list[Detection]] = {}
    for detection, _assignment in detections:
        if detection.evidence_type_key is None:
            continue
        by_type.setdefault(detection.evidence_type_key, []).append(detection)
    return by_type


def _evidence_refs_for_types(
    required_evidence_types: list[str], evidence_by_type: dict[str, list[Detection]]
) -> list[EvidenceRef]:
    return [
        EvidenceRef(evidence_kind=EvidenceKind.DETECTION, detection_id=d.id)
        for t in required_evidence_types
        for d in evidence_by_type[t]
    ]


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

    # Issue #40 Phase 6-E: DRAWING/PRODUCT scope向けの事前集計
    # (PANEL scopeの`detections_with_assignment`とは別の束ね方)。
    evidence_by_drawing_page = _evidence_by_drawing_page(detections_with_assignment)
    evidence_product_wide = _evidence_product_wide(detections_with_assignment)

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

        if rule.judgment_scope in _EVIDENCE_ONLY_SCOPES:
            if condition.design_data_conditions or not condition.required_evidence_types:
                # 設計データ条件を含む、またはevidenceを一切要求しない
                # DRAWING/PRODUCTルールは評価しない(docstring参照。業務的な
                # 集約判断が必要になるため推測実装しない)。
                outcome.skipped_rule_master_ids.append(rule.id)
                continue

            if rule.judgment_scope == JudgmentScope.DRAWING:
                groups: list[tuple[dict[str, list[Detection]], int | None, str]] = [
                    (evidence_by_type, drawing_page_id, f"drawing:{drawing_page_id}")
                    for drawing_page_id, evidence_by_type in sorted(evidence_by_drawing_page.items())
                ]
            else:  # JudgmentScope.PRODUCT
                groups = [(evidence_product_wide, None, f"product:{product_no}")]

            for evidence_by_type, group_drawing_page_id, result_key_group in groups:
                missing_types = [t for t in condition.required_evidence_types if t not in evidence_by_type]
                if missing_types:
                    continue

                scope_label = "図面" if rule.judgment_scope == JudgmentScope.DRAWING else "製番全体"
                reason = rule.judgment_reason_template or (
                    f"{scope_label}: 図面情報({', '.join(condition.required_evidence_types)})が存在するため成立"
                )

                if rule.quantity_method == QuantityMethod.PER_CONDITION_GROUP:
                    evidence_refs = _evidence_refs_for_types(condition.required_evidence_types, evidence_by_type)
                    outcome.candidates.append(
                        EstimateResultCandidate(
                            product_no=product_no,
                            result_key=f"{code}:{result_key_group}",
                            master_item_id=rule.master_item_id,
                            code=code,
                            quantity=1,
                            applicable_unit=rule.applicable_unit,
                            initial_factor=rule.initial_factor,
                            judgment_method=rule.judgment_method,
                            judgment_scope=rule.judgment_scope,
                            target_panel_ban_menno=None,
                            target_panel_ban_no=None,
                            target_drawing_page_id=group_drawing_page_id,
                            judgment_reason=reason,
                            source_rule_id=rule.id,
                            unit_price=unit_price,
                            unit_labor=None,
                            evidence=evidence_refs,
                        )
                    )
                else:  # QuantityMethod.PER_EVIDENCE
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
                                    target_panel_ban_menno=None,
                                    target_panel_ban_no=None,
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
            continue

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
                            design_data_ref=_build_design_data_ref(panel_key, condition, ctx),
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
