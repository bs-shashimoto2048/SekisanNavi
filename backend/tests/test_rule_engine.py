from app.domain.models import Detection, DetectionStatus, EstimateMasterItem
from app.domain.rule_engine import suggest_estimate_candidates


def _master_item(code: str) -> EstimateMasterItem:
    return EstimateMasterItem(
        id=1, code=code, category="附属品加算価格", model=None,
        rating=None, note=None,
    )


def test_suggest_estimate_candidates_matches_known_class():
    detection = Detection(
        id=1, drawing_page_id=1, panel_id=1, class_name="roof_fan",
        bbox_x=0, bbox_y=0, bbox_w=10, bbox_h=10, confidence=0.9,
        status=DetectionStatus.PENDING,
    )
    master_items = [_master_item("18311")]

    suggestions = suggest_estimate_candidates(detection, master_items)

    assert len(suggestions) == 1
    assert suggestions[0].master_item.code == "18311"
    assert suggestions[0].detection_id == 1


def test_suggest_estimate_candidates_no_hint_for_unknown_class():
    detection = Detection(
        id=2, drawing_page_id=1, panel_id=None, class_name="unknown_class",
        bbox_x=0, bbox_y=0, bbox_w=10, bbox_h=10, confidence=0.5,
        status=DetectionStatus.PENDING,
    )

    suggestions = suggest_estimate_candidates(detection, master_items=[])

    assert suggestions == []


def test_suggest_estimate_candidates_skips_when_master_item_missing():
    detection = Detection(
        id=3, drawing_page_id=1, panel_id=None, class_name="roof_fan",
        bbox_x=0, bbox_y=0, bbox_w=10, bbox_h=10, confidence=0.5,
        status=DetectionStatus.PENDING,
    )

    # マスタ側にコード18311が存在しない場合は候補を出さない
    suggestions = suggest_estimate_candidates(detection, master_items=[])

    assert suggestions == []
