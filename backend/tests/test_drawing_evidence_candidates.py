"""`app.services.drawing_evidence_candidates`のテスト (Issue #40 追加修正:
図面情報パネルの「候補/確認待ち」表示)。

このモジュールは候補マニフェストJSON(本番seedではない、レビュー専用
ファイル)を読み取り専用で読み込むだけであり、DBへは一切接続しない。
テストも同様にDBを使わず、`tmp_path`に合成した小さなJSONファイルのみで
検証する。
"""
import json

from app.services.drawing_evidence_candidates import (
    CANDIDATES_PATH,
    DrawingEvidenceTypeCandidate,
    list_drawing_evidence_type_candidates,
)


def _write_manifest(tmp_path, candidates):
    path = tmp_path / "candidates.json"
    path.write_text(json.dumps({"candidates": candidates}, ensure_ascii=False), encoding="utf-8")
    return path


def test_reads_key_display_name_category_status_blocker_verbatim(tmp_path):
    path = _write_manifest(
        tmp_path,
        [
            {
                "key": "side_door",
                "display_name": "側面扉",
                "category": "扉",
                "status": "needs_business_confirmation",
                "blocker": "標準含有枚数のカウント変換規則が未確定",
                "ai_class_keys": ["sidedoor_l", "sidedoor_r"],
                "source_refs": ["積算コードPDF"],
            }
        ],
    )
    result = list_drawing_evidence_type_candidates(path)
    assert result == [
        DrawingEvidenceTypeCandidate(
            key="side_door",
            display_name="側面扉",
            category="扉",
            status="needs_business_confirmation",
            blocker="標準含有枚数のカウント変換規則が未確定",
        )
    ]


def test_category_and_blocker_become_none_when_missing_or_blank(tmp_path):
    path = _write_manifest(
        tmp_path,
        [
            {"key": "a", "display_name": "A", "status": "blocked", "blocker": ""},
            {"key": "b", "display_name": "B", "status": "blocked", "category": None, "blocker": None},
        ],
    )
    result = list_drawing_evidence_type_candidates(path)
    assert result[0].category is None
    assert result[0].blocker is None
    assert result[1].category is None
    assert result[1].blocker is None


def test_skips_entries_missing_required_fields_without_crashing(tmp_path):
    path = _write_manifest(
        tmp_path,
        [
            {"key": "", "display_name": "空key", "status": "blocked"},
            {"key": "no_name", "display_name": "", "status": "blocked"},
            {"key": "no_status", "display_name": "No Status"},
            {"key": "valid", "display_name": "正常", "status": "blocked"},
        ],
    )
    result = list_drawing_evidence_type_candidates(path)
    assert [c.key for c in result] == ["valid"]


def test_returns_empty_list_when_file_does_not_exist(tmp_path):
    missing = tmp_path / "does_not_exist.json"
    assert list_drawing_evidence_type_candidates(missing) == []


def test_returns_empty_list_when_json_is_malformed(tmp_path):
    path = tmp_path / "broken.json"
    path.write_text("{not valid json", encoding="utf-8")
    assert list_drawing_evidence_type_candidates(path) == []


def test_returns_empty_list_when_candidates_is_not_a_list(tmp_path):
    path = tmp_path / "wrong_shape.json"
    path.write_text(json.dumps({"candidates": "not-a-list"}), encoding="utf-8")
    assert list_drawing_evidence_type_candidates(path) == []


def test_returns_empty_list_when_top_level_is_not_an_object(tmp_path):
    path = tmp_path / "wrong_top.json"
    path.write_text(json.dumps([1, 2, 3]), encoding="utf-8")
    assert list_drawing_evidence_type_candidates(path) == []


def test_non_dict_candidate_entries_are_skipped(tmp_path):
    path = _write_manifest(tmp_path, ["not-a-dict", {"key": "ok", "display_name": "OK", "status": "blocked"}])
    result = list_drawing_evidence_type_candidates(path)
    assert [c.key for c in result] == ["ok"]


def test_reads_the_real_manifest_verbatim_without_depending_on_its_item_count():
    """実際のマニフェスト(`backend/data_candidates/phase6f_drawing_evidence_types.json`)
    を素の既定パスで読み、値を書き換えずにそのまま返すことを確認する
    (推測でstatusを書き換えていないことの確認)。件数・個別の中身は
    マニフェスト側の更新で変わりうるため固定せず、マニフェスト自身の
    内容と一致すること(件数・key・status・blockerが原本どおり)だけを検証する。"""
    raw = json.loads(CANDIDATES_PATH.read_text(encoding="utf-8"))["candidates"]
    result = list_drawing_evidence_type_candidates()
    assert len(result) > 0
    assert len(result) == len(raw)
    assert [c.key for c in result] == [r["key"] for r in raw]
    assert [c.status for c in result] == [r["status"] for r in raw]
    assert [c.blocker for c in result] == [r.get("blocker") or None for r in raw]
    assert all(isinstance(c.key, str) and c.key != "" for c in result)
