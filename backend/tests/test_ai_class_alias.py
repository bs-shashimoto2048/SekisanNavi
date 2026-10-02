"""`backend/tools/ai_class_alias.py` のテスト (Issue #40 Phase 6-G指示6)。

本番DBへは一切接続しない、純粋なmapping/検証ユーティリティのテスト。
"""
import pytest

from tools.ai_class_alias import (
    AliasResolution,
    AmbiguousAliasError,
    build_alias_map,
    resolve_class_names_for_fixture,
    resolve_evidence_type_for_ai_class,
)


def _evidence_candidate(key: str, ai_class_keys: list[str]) -> dict:
    return {"key": key, "ai_class_keys": ai_class_keys}


def test_build_alias_map_single_class_per_evidence_type():
    candidates = [_evidence_candidate("side_door", ["sidedoor_l", "sidedoor_r"])]
    mapping = build_alias_map(candidates)
    assert mapping == {"sidedoor_l": "side_door", "sidedoor_r": "side_door"}


def test_build_alias_map_multiple_ai_classes_to_one_evidence_type():
    """資料上確認済みの候補(roof_fan系3class→1図面情報)の表現。"""
    candidates = [_evidence_candidate("roof_fan_top", ["roof_fan", "roof_fan_l", "roof_fan_r"])]
    mapping = build_alias_map(candidates)
    assert mapping == {
        "roof_fan": "roof_fan_top",
        "roof_fan_l": "roof_fan_top",
        "roof_fan_r": "roof_fan_top",
    }


def test_build_alias_map_handles_evidence_types_with_no_ai_class_keys():
    candidates = [_evidence_candidate("ch", [])]
    assert build_alias_map(candidates) == {}


def test_build_alias_map_rejects_ambiguous_mapping():
    """同じAI class keyが異なるevidence_typeから参照されている場合は
    機械的に判断できないため拒否する。"""
    candidates = [
        _evidence_candidate("evidence_a", ["shared_class"]),
        _evidence_candidate("evidence_b", ["shared_class"]),
    ]
    with pytest.raises(AmbiguousAliasError):
        build_alias_map(candidates)


def test_build_alias_map_allows_duplicate_entry_pointing_to_same_evidence_type():
    """同じ(ai_class, evidence_type)の組が複数回出てきても(重複)、
    指す先が同じなら問題ない。"""
    candidates = [
        _evidence_candidate("side_door", ["sidedoor_l"]),
        _evidence_candidate("side_door", ["sidedoor_l"]),
    ]
    mapping = build_alias_map(candidates)
    assert mapping == {"sidedoor_l": "side_door"}


def test_resolve_evidence_type_for_ai_class_known():
    mapping = {"roof_fan_l": "roof_fan_top"}
    assert resolve_evidence_type_for_ai_class("roof_fan_l", mapping) == "roof_fan_top"


def test_resolve_evidence_type_for_ai_class_unknown_returns_none():
    """未知のAI classは推測で埋めずNoneを返す。"""
    mapping = {"roof_fan_l": "roof_fan_top"}
    assert resolve_evidence_type_for_ai_class("completely_unknown_class", mapping) is None


def test_resolve_class_names_for_fixture_preserves_raw_class_name():
    mapping = {"roof_fan_l": "roof_fan_top"}
    results = resolve_class_names_for_fixture(["roof_fan_l", "unknown_class"], mapping)
    assert results == [
        AliasResolution(class_name="roof_fan_l", evidence_type_key="roof_fan_top", matched=True),
        AliasResolution(class_name="unknown_class", evidence_type_key=None, matched=False),
    ]
    # raw class_nameがそのまま残っていること(失われていない)。
    assert [r.class_name for r in results] == ["roof_fan_l", "unknown_class"]


def test_resolve_class_names_for_fixture_handles_duplicate_class_names():
    mapping = {"roof_fan_l": "roof_fan_top"}
    results = resolve_class_names_for_fixture(["roof_fan_l", "roof_fan_l"], mapping)
    assert len(results) == 2
    assert all(r.evidence_type_key == "roof_fan_top" for r in results)
