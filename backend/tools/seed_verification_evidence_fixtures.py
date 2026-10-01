"""Issue #40 Phase 6-D: 実データ検証準備の検証用fixture投入スクリプト。

**目的**: drawing_evidence_types / estimate_rule_masters へ投入する「実マスタ
投入候補」を、検証用DBコピー上でだけ動かして確認できるようにする。本番DBへ
書き込むためのものではない(本番投入の判断自体はPhase 6-D報告の対象外)。

**安全策(Issue #40 Phase 6-D指示5章)**:
  - `--db-path` を必須引数とし、既定DBパス(`app.config.DATA_DIR/sekisan_navi.db`、
    すなわち本番運用で使われる想定のパス)と一致する場合は実行を拒否する。
  - 既存migrationは一切変更しない(このスクリプトはmigration 0008で追加済みの
    `drawing_evidence_types`/`estimate_rule_masters`テーブルへINSERTするのみ)。
  - 冪等: 同じkey/master_item_idが既に存在する場合はスキップする(再実行しても
    重複挿入しない)。
  - 投入前後の件数を表示する。
  - `--cleanup` で、このスクリプトが投入した候補行だけを安全に削除できる
    (`note`/`description`列に埋め込んだ目印 `CANDIDATE_MARKER` で識別する。
    実マスタ投入候補であり、業務が確定した実マスタではないことが常に
    行自体から分かるようにするため)。

**この候補データの位置づけ**: Issue #40 Phase 6-D報告コメントで示す
`drawing_evidence_types`/`estimate_rule_masters`候補一覧のうち、代表検証ケース
として選定したものだけをここに実装している(候補一覧全件ではない)。資料根拠は
Phase 6-D報告コメント本文を参照。価格(`unit_price`相当)は
`estimate_master_items.total_price_a`から評価器が参照するため、このスクリプト
自体は価格・工数の数値を一切扱わない(推測で埋めない、Issue #40 Phase 6-D指示)。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import DATA_DIR  # noqa: E402
from app.db.connection import get_connection  # noqa: E402
from app.domain.estimate_rules import (  # noqa: E402
    ApplicableUnit,
    CalcType,
    EvidenceUsage,
    JudgmentMethod,
    JudgmentScope,
    ProcessingMode,
    QuantityMethod,
    StandardCondition,
    StandardConditionField,
)
from app.repositories.drawing_evidence_types import (  # noqa: E402
    create_evidence_type,
    get_evidence_type_by_key,
    list_evidence_types,
)
from app.repositories.estimate_rule_masters import (  # noqa: E402
    create_rule_master,
    get_rule_master_by_master_item_id,
    list_rule_masters,
)

# このスクリプトが投入した行であることを示す目印。cleanup対象の判定にも使う。
CANDIDATE_MARKER = "[Phase6-D検証用候補]"

DEFAULT_DB_PATH = DATA_DIR / "sekisan_navi.db"


# ============================================================
# 図面情報マスタ候補 (代表検証ケース分のみ。全候補はIssue #40 Phase 6-D
# 報告コメント本文の一覧表を参照)
# ============================================================
EVIDENCE_TYPE_CANDIDATES = [
    dict(
        key="side_door",
        display_name="側面扉",
        category="扉",
        usage=EvidenceUsage.ESTIMATE_TARGET,
        default_judgment_scope=JudgmentScope.PANEL,
        description=(
            f"{CANDIDATE_MARKER} 側面図に描かれる扉。根拠: "
            "積算コードPDF『18302側面扉（追加）.pdf』(箱コード標準含有枚数を"
            "超える側面扉を追加選択する場合の判定対象)。既存AI検出class "
            "`sidedoor_l`/`sidedoor_r`に対応。"
        ),
    ),
    dict(
        key="roof_fan_top",
        display_name="換気扇(天井取付)",
        category="換気",
        usage=EvidenceUsage.ESTIMATE_TARGET,
        default_judgment_scope=JudgmentScope.PANEL,
        description=(
            f"{CANDIDATE_MARKER} 盤上部中央に描かれる換気扇。根拠: "
            "積算コードPDF『18311換気扇上部取付.pdf』。既存AI検出class "
            "`roof_fan`/`roof_fan_l`/`roof_fan_r`に対応(正面/左側面/右側面の"
            "3クラスをどう1つの図面情報へ束ねるかは要確認。本候補では "
            "`roof_fan`のみを対象とする簡略版)。"
        ),
    ),
    dict(
        key="small_door",
        display_name="小扉",
        category="扉",
        usage=EvidenceUsage.ESTIMATE_TARGET,
        default_judgment_scope=JudgmentScope.PANEL,
        description=(
            f"{CANDIDATE_MARKER} 正面に描かれる小窓/小扉。根拠: AI対応リスト"
            "Excel(`20250707_A製品自動化検討_対応仕分け.xlsx`のAI対応リストシート)"
            "の既存AI検出class `small_door`(検出対象:小扉)。屋内操作用(18305)/"
            "屋外操作用(18306)のどちらに対応するかは、積算コードPDF"
            "『18305小扉(屋内操作用).pdf』『18306小扉(屋外操作用).pdf』の両方に"
            "成立条件のテキスト記載が無く**要確認**(本候補は暫定的に18305へ"
            "紐付けている)。"
        ),
    ),
    dict(
        key="vct",
        display_name="VCT",
        category="受電機器",
        usage=EvidenceUsage.CONDITION,
        default_judgment_scope=JudgmentScope.PANEL,
        description=(
            f"{CANDIDATE_MARKER} 単線結線図/盤内配置図上のVCT(計器用変圧変流器)。"
            "根拠: 積算コードPDF『18323VCT架台.pdf』。既存AI検出class "
            "`vct_stand`に対応。"
        ),
    ),
    dict(
        key="ch",
        display_name="CH",
        category="受電機器",
        usage=EvidenceUsage.CONDITION,
        default_judgment_scope=JudgmentScope.PANEL,
        description=(
            f"{CANDIDATE_MARKER} VCTに付随するケーブルヘッド。根拠: 積算コード"
            "PDF『18323VCT架台.pdf』(VCTとCHの上下位置関係で18323の要否が決まる)。"
            "対応する既存AI検出classは確認できていない(**要確認**)。"
        ),
    ),
]


# ============================================================
# 積算コード/ルールマスタ候補 (代表検証ケース分のみ)
#
# 重要な簡略化・既知の未実装 (Issue #40 Phase 2評価器の制約。資料の不足では
# なく、現行評価器`app/services/estimate_rule_evaluator.py`が対応している
# 範囲に合わせて今回の検証候補を選んだことによる):
#   - 18323 (VCT架台) は本来「VCTとCHの上下位置関係」が成立条件に含まれるが
#     (資料に明記)、評価器は`JudgmentScope.POSITION`/`RANGE`を未実装のため、
#     本候補では「同一盤内にVCT・CH両方が存在するか」のみを評価する簡略版と
#     した。位置関係を無視しているため、本番投入前に必ず幾何ロジックを
#     追加する必要がある(Phase 1報告コメント5章で既出の既知の課題)。
#   - 18322 (盤内通路、IS/OS系) は資料が「型式がIS/OS系かどうか」で分岐すると
#     読めるが、`StandardCondition`の比較演算子は `==`/`!=`/`>=`/`<=`/`>`/`<`
#     のみで前方一致("IS"で始まるか)を表現できないため、本候補では実データ
#     (A1GV2421全盤がmodel='IS2')に合わせて `model == "IS2"` という**デモ専用の
#     暫定条件**にしている。他の型式(IS1/IS3/OS系等)には対応しない
#     (本番投入時は前方一致または列挙によるOR条件の表現方法を別途検討する
#     必要がある、という構造上の制約として報告する)。
#   - 19959/19961等の製番単位倍率コード(`calc_type=multiply_price`、
#     `quantity_method=per_product`)は評価器が未実装のため、今回の代表検証
#     ケースには含めない(資料根拠はあるが、評価器側の対応が先。Phase 2
#     docstring参照)。
# ============================================================
RULE_MASTER_CANDIDATES = [
    dict(
        code="18302",
        master_item_id=737,
        judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
        judgment_scope=JudgmentScope.PANEL,
        applicable_unit=ApplicableUnit.LOCATION,
        quantity_method=QuantityMethod.PER_EVIDENCE,
        condition=StandardCondition(required_evidence_types=["side_door"]),
        reason_template="盤 {panel}: 図面情報(側面扉)が存在するため18302(側面扉追加)が成立",
        note=(
            f"{CANDIDATE_MARKER} 根拠: 積算コードPDF『18302側面扉（追加）.pdf』。"
            "本番A1GV2421 page16には既存Manual BBox(master_item_id=737, "
            "旧方式でcode直結済み)が既に存在するため、検証DBで本候補を評価すると"
            "意図的に衝突(新旧2系統が同じ18302を出す)を再現できる。"
        ),
    ),
    dict(
        code="18311",
        master_item_id=748,
        judgment_method=JudgmentMethod.DRAWING_JUDGMENT,
        judgment_scope=JudgmentScope.PANEL,
        applicable_unit=ApplicableUnit.LOCATION,
        quantity_method=QuantityMethod.PER_EVIDENCE,
        condition=StandardCondition(required_evidence_types=["roof_fan_top"]),
        reason_template="盤 {panel}: 図面情報(換気扇上部取付)が存在するため18311が成立(根拠1件につき1)",
        note=(
            f"{CANDIDATE_MARKER} 根拠: 積算コードPDF『18311換気扇上部取付.pdf』。"
            "同種BBox複数件→数量複数(カテゴリB)の代表例。本番A1GV2421 page16には"
            "既存Manual BBox 4件(master_item_id=748)が既に存在するため、こちらも"
            "衝突再現に使える。"
        ),
    ),
    dict(
        code="18305",
        master_item_id=741,
        judgment_method=JudgmentMethod.NEEDS_CONFIRMATION,
        judgment_scope=JudgmentScope.PANEL,
        applicable_unit=ApplicableUnit.LOCATION,
        quantity_method=QuantityMethod.PER_EVIDENCE,
        condition=StandardCondition(required_evidence_types=["small_door"]),
        reason_template="盤 {panel}: 図面情報(小扉)が存在するため18305が成立候補(屋内/屋外の判別は要確認)",
        note=(
            f"{CANDIDATE_MARKER} 根拠: AI対応リストExcelの`small_door`class。"
            "屋内(18305)/屋外(18306)のどちらかは資料から確定できないため"
            "`judgment_method=needs_confirmation`としている(要確認のまま、"
            "推測でdrawing_judgmentへ昇格させない)。本番A1GV2421 page21に"
            "既存の18305/18306 Manual BBoxは無いため、非衝突の正常系検証に使える。"
        ),
    ),
    dict(
        code="18323",
        master_item_id=760,
        judgment_method=JudgmentMethod.NEEDS_CONFIRMATION,
        judgment_scope=JudgmentScope.PANEL,
        applicable_unit=ApplicableUnit.UNIT,
        quantity_method=QuantityMethod.PER_CONDITION_GROUP,
        condition=StandardCondition(required_evidence_types=["vct", "ch"]),
        reason_template="盤 {panel}: 図面情報(VCT・CH)が両方存在するため18323が成立候補(上下位置関係は未評価)",
        note=(
            f"{CANDIDATE_MARKER} 根拠: 積算コードPDF『18323VCT架台.pdf』。"
            "複数種類BBox成立→1コード(カテゴリC)の代表例。**簡略版**: 本来は"
            "CHがVCTの上/下どちらにあるかで成立/不成立が決まるが、評価器が"
            "position scope未対応のため、本候補は「同一盤内に両方存在するか」"
            "のみで判定する(過大計上の可能性があるため`judgment_method="
            "needs_confirmation`のまま)。本番A1GV2421 page23に既存Manual BBox"
            "(master_item_id=760)が存在するため、衝突再現にも使える。"
        ),
    ),
    dict(
        code="18322",
        master_item_id=759,
        judgment_method=JudgmentMethod.NEEDS_CONFIRMATION,
        judgment_scope=JudgmentScope.DESIGN_DATA,
        applicable_unit=ApplicableUnit.LOCATION,
        quantity_method=QuantityMethod.PER_CONDITION_GROUP,
        condition=StandardCondition(
            design_data_conditions=[StandardConditionField(field="model", operator="==", value="IS2")]
        ),
        reason_template="盤 {panel}: 設計データ(型式IS2)により18322(盤内通路IS/OS系)が成立候補",
        note=(
            f"{CANDIDATE_MARKER} 根拠: 積算コードPDF『18321-322盤内通路.pdf』"
            "(「18321=IA,OA」「18322=IS,OS」)。設計データのみ判定(カテゴリD)の"
            "代表例。**デモ専用の暫定条件**: 本来は型式がIS/OS系かどうかの"
            "前方一致判定が必要だが、`StandardCondition`は等価比較のみ対応のため、"
            "実データ(A1GV2421全盤がmodel='IS2')に合わせて`model == \"IS2\"`へ"
            "単純化している。他の型式には対応しない。盤内通路スペース自体の"
            "有無を型式だけで断定してよいかも資料からは確認できず要確認。"
        ),
    ),
]


def _check_not_default_db(db_path: Path) -> None:
    resolved = db_path.resolve()
    default_resolved = DEFAULT_DB_PATH.resolve()
    if resolved == default_resolved:
        print(
            f"ERROR: --db-path が既定(本番想定)DBパスと一致しています: {resolved}\n"
            "本番DBへの投入はこのスクリプトでは行いません。検証用DBコピーの"
            "パスを明示してください(例: 事前に本番DBをコピーした別ファイル)。",
            file=sys.stderr,
        )
        sys.exit(1)
    if not resolved.exists():
        print(f"ERROR: 指定されたDBファイルが存在しません: {resolved}", file=sys.stderr)
        sys.exit(1)


def _print_counts(conn, label: str) -> None:
    evidence_count = len(list_evidence_types(conn))
    rule_count = len(list_rule_masters(conn))
    print(f"[{label}] drawing_evidence_types={evidence_count}件 / estimate_rule_masters={rule_count}件")


def seed(db_path: Path) -> None:
    _check_not_default_db(db_path)
    with get_connection(db_path) as conn:
        _print_counts(conn, "投入前")

        created_evidence = 0
        skipped_evidence = 0
        for candidate in EVIDENCE_TYPE_CANDIDATES:
            existing = get_evidence_type_by_key(conn, candidate["key"])
            if existing is not None:
                skipped_evidence += 1
                print(f"  skip (既存): drawing_evidence_types.key={candidate['key']!r}")
                continue
            create_evidence_type(
                conn,
                key=candidate["key"],
                display_name=candidate["display_name"],
                category=candidate["category"],
                usage=candidate["usage"],
                default_judgment_scope=candidate["default_judgment_scope"],
                description=candidate["description"],
            )
            created_evidence += 1
            print(f"  created: drawing_evidence_types.key={candidate['key']!r}")

        created_rule = 0
        skipped_rule = 0
        for candidate in RULE_MASTER_CANDIDATES:
            existing = get_rule_master_by_master_item_id(conn, candidate["master_item_id"])
            if existing is not None:
                skipped_rule += 1
                print(
                    "  skip (既存): estimate_rule_masters.master_item_id="
                    f"{candidate['master_item_id']!r} (code={candidate['code']})"
                )
                continue
            create_rule_master(
                conn,
                master_item_id=candidate["master_item_id"],
                judgment_method=candidate["judgment_method"],
                judgment_scope=candidate["judgment_scope"],
                applicable_unit=candidate["applicable_unit"],
                quantity_method=candidate["quantity_method"],
                judgment_condition=candidate["condition"],
                judgment_reason_template=candidate["reason_template"],
                calc_type=CalcType.DIRECT,
                processing_mode=ProcessingMode.STANDARD,
                note=candidate["note"],
            )
            created_rule += 1
            print(f"  created: estimate_rule_masters.code={candidate['code']} (master_item_id={candidate['master_item_id']})")

        print(
            f"\n投入結果: drawing_evidence_types 新規{created_evidence}件/スキップ{skipped_evidence}件、"
            f"estimate_rule_masters 新規{created_rule}件/スキップ{skipped_rule}件"
        )
        _print_counts(conn, "投入後")


def cleanup(db_path: Path) -> None:
    _check_not_default_db(db_path)
    with get_connection(db_path) as conn:
        _print_counts(conn, "削除前")

        rule_rows = conn.execute(
            "SELECT id, master_item_id FROM estimate_rule_masters WHERE note LIKE ?",
            (f"{CANDIDATE_MARKER}%",),
        ).fetchall()
        for row in rule_rows:
            conn.execute("DELETE FROM estimate_results WHERE source_rule_id = ?", (row["id"],))
            conn.execute("DELETE FROM estimate_rule_masters WHERE id = ?", (row["id"],))
            print(f"  deleted: estimate_rule_masters.id={row['id']} (master_item_id={row['master_item_id']})")

        evidence_rows = conn.execute(
            "SELECT id, key FROM drawing_evidence_types WHERE description LIKE ?",
            (f"{CANDIDATE_MARKER}%",),
        ).fetchall()
        for row in evidence_rows:
            conn.execute(
                "UPDATE detections SET evidence_type_key = NULL WHERE evidence_type_key = ?",
                (row["key"],),
            )
            conn.execute("DELETE FROM drawing_evidence_types WHERE id = ?", (row["id"],))
            print(f"  deleted: drawing_evidence_types.id={row['id']} (key={row['key']!r})")

        print(f"\n削除結果: estimate_rule_masters {len(rule_rows)}件 / drawing_evidence_types {len(evidence_rows)}件")
        _print_counts(conn, "削除後")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Issue #40 Phase 6-D 検証用fixture投入/削除スクリプト。"
            "検証用DBコピーに限定して使うこと(本番DBパスでは実行拒否される)。"
        )
    )
    parser.add_argument(
        "--db-path",
        required=True,
        type=Path,
        help="投入/削除対象のSQLiteファイルパス(検証用DBコピー。本番既定パスは指定不可)",
    )
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="投入済みの候補行(目印付きのnote/description)だけを削除する",
    )
    args = parser.parse_args()

    if args.cleanup:
        cleanup(args.db_path)
    else:
        seed(args.db_path)


if __name__ == "__main__":
    main()
