"""積算ルールエンジン (PoC・スケルトン)。

要件7の通り、AI検出(Detection)から直接積算コードを決定して画面表示することは禁止する。

    Detection -> RuleEngine -> EstimateItem

の流れを概念的に固定するため、Inference結果(class_nameやbbox)を直接UIやAPIレスポンスの
積算コードに変換する処理は、必ずこのモジュールを経由させる。

PoC段階では実際のYOLO推論を接続しないため、ここでの実装は
「AIクラス名 -> 積算Masterコード候補」の対応表を持つだけの簡易なものである。
将来、判定ルールが複雑化した場合もこのモジュール内で完結させ、
API層・UI層・DB層への影響を局所化する。
"""
from __future__ import annotations

from dataclasses import dataclass

from app.domain.models import Detection, EstimateMasterItem

# AI検出クラス名 -> 積算Masterコード候補 の対応表 (暫定・仮の値)
# 本番ルールは未確定。docs/implementation-plan.md 参照。
_CLASS_TO_CODE_HINTS: dict[str, list[str]] = {
    "roof_fan": ["18311"],
    "panel": ["18004"],
    "transformer": ["44241"],
}


@dataclass
class EstimateSuggestion:
    """RuleEngineがDetectionから導いた積算コード候補 (未確定の下書き)。

    これはEstimateItemそのものではなく、あくまで「候補」である。
    最終的にEstimateItemとして確定するかどうかは、上位のワークフロー
    (将来実装するレビュー・確定操作)が判断する。
    """

    detection_id: int
    master_item: EstimateMasterItem
    reason: str


def suggest_estimate_candidates(
    detection: Detection, master_items: list[EstimateMasterItem]
) -> list[EstimateSuggestion]:
    """DetectionからEstimateMasterItemの候補を提案する。

    現時点ではクラス名の完全一致による単純な対応表引きのみ。
    将来的に盤属性・寸法・他Detectionとの位置関係等を考慮したルールへ
    拡張する場合も、API/UI側の型は変えずにこの関数の中身だけを差し替えられる。
    """
    codes = _CLASS_TO_CODE_HINTS.get(detection.class_name, [])
    if not codes:
        return []

    by_code = {item.code: item for item in master_items}
    suggestions: list[EstimateSuggestion] = []
    for code in codes:
        master_item = by_code.get(code)
        if master_item is None:
            continue
        suggestions.append(
            EstimateSuggestion(
                detection_id=detection.id,
                master_item=master_item,
                reason=f"class_name='{detection.class_name}' に対する暫定対応表による提案",
            )
        )
    return suggestions
