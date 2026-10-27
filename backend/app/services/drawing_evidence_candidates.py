"""Issue #40 追加修正: 図面情報パネルの「候補／確認待ち」表示向け。

`backend/data_candidates/phase6f_drawing_evidence_types.json`(本番seedでは
ない、人間/validatorレビュー専用の候補マニフェスト、`docs/master-candidate-
status.md`参照)を**読み取り専用**で読み込み、図面情報パネルが「登録済みの
図面情報が0件のときに、どんな候補が検討中か」を表示できるようにする。

**重要な境界線(推測で状態を変えない)**:
  - このモジュールはJSONファイルを読むだけで、DBへは一切接続しない。
    `drawing_evidence_types`テーブルへの投入(本番・検証問わず)は行わない。
  - `status`/`blocker`はマニフェストにある値をそのまま返す。ここで
    「ready相当」への格上げ・日本語理由の言い換え・新しい確認理由の追加は
    一切行わない(Issue #40指示: 元データにある内容のみを表示する)。
  - ファイルが存在しない/壊れている場合も例外を投げず空リストを返す
    (読み取り専用の付加情報であり、図面情報パネル自体の表示を壊さないため)。
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from app.config import BACKEND_DIR

CANDIDATES_PATH = BACKEND_DIR / "data_candidates" / "phase6f_drawing_evidence_types.json"


@dataclass(frozen=True)
class DrawingEvidenceTypeCandidate:
    """候補マニフェスト1件分の表示用の読み取り専用ビュー。

    マニフェストJSONの構造(`backend/tools/validate_candidate_manifests.py`
    が検証対象とする構造)から、図面情報パネルの一覧表示に必要な項目だけを
    取り出す(`ai_class_keys`/`related_codes`/`source_refs`/`notes`等、
    このUIの表示に使わない項目はそのまま捨てる。DB投入も一切行わない)。
    """

    key: str
    display_name: str
    category: str | None
    status: str
    blocker: str | None


def _coerce_str_or_none(value: object) -> str | None:
    if isinstance(value, str) and value.strip() != "":
        return value
    return None


def list_drawing_evidence_type_candidates(
    path: Path = CANDIDATES_PATH,
) -> list[DrawingEvidenceTypeCandidate]:
    """候補マニフェストを読み取り専用で読み込む。

    ファイルが存在しない・JSONとして壊れている・`candidates`が配列でない
    等、想定外の状態は例外にせず空リストにフォールバックする(このAPIは
    「参考情報が出せれば出す」付加的な機能であり、失敗時に図面情報パネル
    本体(登録済み一覧の取得)を道連れにしてはならない)。
    """
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    candidates = raw.get("candidates") if isinstance(raw, dict) else None
    if not isinstance(candidates, list):
        return []

    result: list[DrawingEvidenceTypeCandidate] = []
    for c in candidates:
        if not isinstance(c, dict):
            continue
        key = c.get("key")
        display_name = c.get("display_name")
        status = c.get("status")
        if not isinstance(key, str) or key == "":
            continue
        if not isinstance(display_name, str) or display_name == "":
            continue
        if not isinstance(status, str) or status == "":
            continue
        result.append(
            DrawingEvidenceTypeCandidate(
                key=key,
                display_name=display_name,
                category=_coerce_str_or_none(c.get("category")),
                status=status,
                blocker=_coerce_str_or_none(c.get("blocker")),
            )
        )
    return result
