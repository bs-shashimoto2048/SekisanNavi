"""旧Detectionベース明細(master_item_id直結のManual/AI BBox)を、
EstimateResultモデルへ変換する互換レイヤ (Issue #40 Phase 5)。

Phase 5の方針(Issue #40 Phase 5指示1章)により、積算結果の正本は
EstimateResultに一本化する。既存の`master_item_id`直結Detection(Phase 1.6
以来の「BBox = 積算コード」方式)は削除・変更せず保持したまま、この
アダプタが読み取り専用でEstimateResultCandidateへ変換する
(`app.services.estimate_rule_evaluator`と同様、DBへは書き込まない)。

**AI/手動は「積算結果の種類」ではなく根拠情報の取得元** (Phase 5指示1章)。
このモジュールは`Detection.source_type`の値を`judgment_method`へは
反映しない。`judgment_method`は`Detection.status`から次の対応で決める。

  - `reviewed` (配置時点で確認済みという既存の暗黙規則。docs/data-model.md
    参照): `JudgmentMethod.DRAWING_JUDGMENT`(図面上のBBoxに基づく判断が
    既に行われている、という実態に最も近いため)。
  - `pending`/`needs_review`: `JudgmentMethod.NEEDS_CONFIRMATION`
    (作業者による確認がまだ済んでいない状態を「要確認」タブへ反映する)。
  - `excluded`: 変換しない(積算結果を生成しない。旧集計でも除外扱い
    だったコード自体を復活させない)。

`applicable_unit`/`initial_factor`は、当該`master_item_id`に対応する
`estimate_rule_masters`行が既に存在する場合(Phase 2/3設定済みのコードに
たまたま旧方式のBBoxも付いているケース)はそちらの値を借用する
(実データを読むだけで、推測して埋めるものではない)。存在しない場合は
`applicable_unit=None`(不明、捏造しない)・`initial_factor=1.0`(DB既定値と
同じ)とする。

盤所属判定は`app.services.panel_assignment`(Backend内で唯一の実装、
`estimate_rule_evaluator`とも共用)をそのまま使う。`TieAssignment`
(複数盤の交差面積が同値で機械的に一意へ決定できない)の場合は、
`target_panel_ban_menno/no`を設定せず(製品全体と同じ形)、
`status=NEEDS_REVIEW`を明示して「要確認」であることを積算結果自体に
残す(Phase 5指示13章「一意に判断できない場合は要確認として残す」の
考え方を、旧来の盤所属tie判定にもそのまま適用する)。
"""
from __future__ import annotations

from pathlib import Path

from app.domain.estimate_rules import (
    EstimateResultCandidate,
    EstimateResultStatus,
    EvidenceKind,
    EvidenceRef,
    JudgmentMethod,
    JudgmentScope,
)
from app.domain.models import Detection, DetectionStatus
from app.repositories.detections import list_detections
from app.repositories.estimate_rule_masters import get_rule_master_by_master_item_id
from app.repositories.master import get_master_item
from app.services.data_source import resolve_product_dir
from app.services.estimate_confirmation_builder import detection_page_no_map
from app.services.panel_assignment import Assignment, TieAssignment, assign_detection_to_panel
from app.services.product_df import load_product_df

_STATUS_TO_JUDGMENT_METHOD = {
    DetectionStatus.REVIEWED: JudgmentMethod.DRAWING_JUDGMENT,
    DetectionStatus.PENDING: JudgmentMethod.NEEDS_CONFIRMATION,
    DetectionStatus.NEEDS_REVIEW: JudgmentMethod.NEEDS_CONFIRMATION,
}


def build_legacy_candidates(conn, data_source_root: Path, product_no: str) -> list[EstimateResultCandidate]:
    """製番`product_no`について、`master_item_id`直結のDetection(旧方式)から
    EstimateResultCandidate一式を組み立てる(読み取り専用)。

    `estimate_rule_evaluator.evaluate_product`とは独立して動作する(あちらは
    図面情報×設計データ条件を起点に評価するのに対し、こちらは既存Detectionを
    起点に変換するだけで、判定条件の評価は行わない)。呼び出し側
    (`app.services.estimate_result_pipeline.build_all_candidates`)が
    両方の結果を1つの候補集合へ合流させる。
    """
    resolution = resolve_product_dir(data_source_root, product_no)
    df_result = load_product_df(resolution.ccv_dir, resolution.product_no)
    page_no_by_drawing_page_id = detection_page_no_map(conn, product_no)

    master_cache: dict[int, object] = {}
    rule_cache: dict[int, object | None] = {}

    def _get_master(master_item_id: int):
        if master_item_id not in master_cache:
            master_cache[master_item_id] = get_master_item(conn, master_item_id)
        return master_cache[master_item_id]

    def _get_existing_rule(master_item_id: int):
        if master_item_id not in rule_cache:
            rule_cache[master_item_id] = get_rule_master_by_master_item_id(conn, master_item_id)
        return rule_cache[master_item_id]

    candidates: list[EstimateResultCandidate] = []

    for drawing_page_id, page_no in page_no_by_drawing_page_id.items():
        panels = df_result.panels_by_page.get(page_no, [])
        for detection in list_detections(conn, drawing_page_id):
            if detection.master_item_id is None:
                continue
            # 新方式(Phase 3の`create_evidence_detection`)はmaster_item_idを
            # 常にNULLにして作るため、実運用ではmaster_item_id・
            # evidence_type_keyが同時に設定されることは無い(2つの作成経路は
            # 互いに排他)。念のためevidence_type_keyが設定されている行は
            # 新方式の対象として扱い、ここでは変換しない(二重計上防止)。
            if detection.evidence_type_key is not None:
                continue
            if detection.status == DetectionStatus.EXCLUDED:
                continue
            judgment_method = _STATUS_TO_JUDGMENT_METHOD.get(detection.status)
            if judgment_method is None:
                continue

            master = _get_master(detection.master_item_id)
            if master is None:
                continue
            code = detection.master_item_code or master.code

            existing_rule = _get_existing_rule(detection.master_item_id)
            applicable_unit = existing_rule.applicable_unit if existing_rule is not None else None
            initial_factor = existing_rule.initial_factor if existing_rule is not None else 1.0

            assignment: Assignment = assign_detection_to_panel(
                (detection.bbox_x, detection.bbox_y, detection.bbox_w, detection.bbox_h),
                panels,
            )
            status = EstimateResultStatus.AUTO
            if isinstance(assignment, TieAssignment):
                ban_menno = None
                ban_no = None
                judgment_scope = JudgmentScope.PRODUCT
                status = EstimateResultStatus.NEEDS_REVIEW
                reason = "旧方式(Manual/AI BBox直接付与): 複数盤の交差面積が同値のため盤を一意に決定できません"
            elif assignment.kind == "panel":
                ban_menno = assignment.panel.ban_menno
                ban_no = assignment.panel.ban_no
                judgment_scope = JudgmentScope.PANEL
                reason = f"旧方式(Manual/AI BBox直接付与): 盤 {ban_menno}/{ban_no} 上のBBoxとして直接付与"
            else:
                ban_menno = None
                ban_no = None
                judgment_scope = JudgmentScope.PRODUCT
                reason = "旧方式(Manual/AI BBox直接付与): どの盤とも交差しないため製品全体扱い"

            candidates.append(
                EstimateResultCandidate(
                    product_no=product_no,
                    result_key=f"{code}:legacy:{detection.id}",
                    master_item_id=detection.master_item_id,
                    code=code,
                    quantity=1,
                    applicable_unit=applicable_unit,
                    initial_factor=initial_factor,
                    judgment_method=judgment_method,
                    judgment_scope=judgment_scope,
                    target_panel_ban_menno=ban_menno,
                    target_panel_ban_no=ban_no,
                    target_drawing_page_id=drawing_page_id,
                    judgment_reason=reason,
                    source_rule_id=None,
                    unit_price=master.total_price_a,
                    unit_labor=None,
                    evidence=[EvidenceRef(evidence_kind=EvidenceKind.DETECTION, detection_id=detection.id)],
                    status=status,
                )
            )

    return candidates


__all__ = ["build_legacy_candidates"]
