"""Issue #40 Phase 6-G指示5/6: AI class → 図面情報(evidence_type_key)の
alias mapping基盤。

**調査結論(指示5)**: `class_name`(AI検出クラス、例`roof_fan_l`)を
`evidence_type_key`(図面情報、例`roof_fan_top`)へ正規化する処理は、
以下のいずれの時点でも実装しうるが、今回は**どの時点にも実装しない**。

  - AI detection生成時(推論結果をDBへ書き込む時点): 既存の
    `source_type='ai'`のDetection行は、Phase 2指示により意図的に
    `evidence_type_key`をバックフィルしない設計(`migration
    0008_estimate_rule_engine_foundation.sql`のコメント参照)。ここで
    書き込むと、既存の「新しい評価器は`evidence_type_key`が設定された
    行のみを対象にする」という設計原則(既存行は全てNULLのまま)を破る。
  - import時(CSV等からのバッチ投入時): 現状、AI検出結果を`detections`
    テーブルへインポートするバッチパイプライン自体が存在しない
    (`detected_df.csv`は読み取り専用のプレビューAPI
    `GET .../detected-preview`が都度計算するのみで、DBへは一切コピー
    しない。`docs/data-model.md` 8.5章参照)。将来そのようなパイプラインが
    実装された場合の有力な候補ではあるが、今回は実装しない。
  - rule evaluation時: 評価器(`estimate_rule_evaluator.py`)が
    `detection.evidence_type_key`を直接参照する現行設計を変えず、
    `class_name`からの動的解決を評価器自身に混ぜ込むと、
    「どのDetectionがどのevidence_typeとして評価されたか」の監査性が
    下がる(事後に`class_name`を遡って調べないと分からなくなる)。

**推奨思想(指示5「raw AI classは失わない」)**: `class_name`列は変更・
上書きしない。`evidence_type_key`列への値の設定(もし将来行う場合)は、
既存の`evidence_type_key`書き込み経路(Phase 3の`create_evidence_detection`
と同じ、「新しい列へ明示的に書く」操作)として実装すべきで、`class_name`を
`evidence_type_key`の代わりに動的変換して使う、という設計にはしない。

**本モジュールの位置づけ(指示6)**: 上記のいずれの接続も行わず、
`backend/data_candidates/phase6f_drawing_evidence_types.json`の
`ai_class_keys`を読んだ上で使える、**純粋なmapping/検証ユーティリティ**
のみを提供する。本番DBへのevidence type投入は行わない。候補マニフェストを
production runtimeから自動ロードする経路も用意しない(呼び出し側
[このモジュールの利用者]が明示的にマニフェストを読み込んで渡す)。
"""
from __future__ import annotations

from dataclasses import dataclass


class AmbiguousAliasError(ValueError):
    """同じAI class keyが、互いに異なる複数のevidence_type候補から
    参照されている場合に送出する(資料上、どちらが正しいか機械的に
    判断できないため安全側に倒して拒否する。指示6「ambiguous mapping拒否」)。"""


def build_alias_map(evidence_type_candidates: list[dict]) -> dict[str, str]:
    """候補マニフェスト(`phase6f_drawing_evidence_types.json`の
    `candidates`配列)から、`ai_class_key -> evidence_type_key`の
    mappingを構築する。

    1つのAI class keyが異なる複数のevidence_type候補の`ai_class_keys`に
    含まれている場合は`AmbiguousAliasError`を送出する(同じclassが
    複数候補に重複して書かれているだけ[同じevidence_type_keyを指す]なら
    問題ない)。
    """
    mapping: dict[str, str] = {}
    for candidate in evidence_type_candidates:
        evidence_type_key = candidate["key"]
        for ai_class in candidate.get("ai_class_keys", []):
            existing = mapping.get(ai_class)
            if existing is not None and existing != evidence_type_key:
                raise AmbiguousAliasError(
                    f"AI class {ai_class!r} is referenced by multiple evidence_type candidates: "
                    f"{existing!r} and {evidence_type_key!r}"
                )
            mapping[ai_class] = evidence_type_key
    return mapping


def resolve_evidence_type_for_ai_class(ai_class: str, alias_map: dict[str, str]) -> str | None:
    """`ai_class`(例: `"roof_fan_l"`)に対応する`evidence_type_key`
    (例: `"roof_fan_top"`)を返す。未知のAI classの場合は`None`
    (推測で埋めない。指示6「unknown class」)。"""
    return alias_map.get(ai_class)


@dataclass(frozen=True)
class AliasResolution:
    """1件の`class_name`に対する解決結果(fixture変換用、指示6
    「pure mapping validation / fixture conversion utility」)。
    `class_name`はそのまま保持する(raw AI classを失わない、指示5)。"""

    class_name: str
    evidence_type_key: str | None
    matched: bool


def resolve_class_names_for_fixture(class_names: list[str], alias_map: dict[str, str]) -> list[AliasResolution]:
    """複数の`class_name`(例: 検証用fixtureへ投入したいAI検出クラス名の
    リスト)を、一括でalias解決する読み取り専用の変換ユーティリティ。
    DBへは一切書き込まない。"""
    return [
        AliasResolution(
            class_name=c,
            evidence_type_key=alias_map.get(c),
            matched=c in alias_map,
        )
        for c in class_names
    ]


__all__ = [
    "AmbiguousAliasError",
    "build_alias_map",
    "resolve_evidence_type_for_ai_class",
    "AliasResolution",
    "resolve_class_names_for_fixture",
]
