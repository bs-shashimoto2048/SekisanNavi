"""積算結果 (EstimateResult、Issue #40 Phase 2、12章) の book-keeping。

`estimate_results`はconfirmationのような不変snapshotではなく、評価器
(`app.services.estimate_rule_evaluator`)が実行されるたびに「今あるべき状態」
へ更新される現在状態のテーブルである。ただし、作業者が手修正した係数
(`current_factor`)は再評価で失われてはならない(Issue #40 7-3章)ため、
このモジュールの`replace_results_for_product`が「作り直す」のではなく
「UPSERTしつつ手修正列だけ保持する」制御を担う。

`price`/`labor`は`unit_price/unit_labor × quantity × current_factor`の
キャッシュ値であり、`unit_price`/`unit_labor`(係数適用前の値、evaluator算出時に
確定)を都度SQL側で掛け合わせて再計算する。これにより、係数の手修正
(`set_current_factor`)・初期値復元(`reset_factor_to_initial`)の直後にも
evaluatorを再実行することなく`price`/`labor`を最新化できる
(SQLiteの掛け算はNULL×何か=NULLになるため、`unit_price`がNULLの行は
`price`も自動的にNULLのままになり、0円への捏造を防ぐ仕組みをPython側の
分岐無しで維持できる)。
"""
from __future__ import annotations

import sqlite3
from collections.abc import Sequence

from app.domain.estimate_rules import (
    ApplicableUnit,
    EstimateResult,
    EstimateResultCandidate,
    EstimateResultEvidence,
    EstimateResultStatus,
    EvidenceKind,
    JudgmentMethod,
    JudgmentScope,
)
from app.repositories.estimate_rule_masters import get_allowed_factors

# 許容係数候補との比較に使う許容誤差 (Issue #40 7-3章、PR #41レビュー指摘対応)。
# 候補値(0.7等)は10進小数だがfloatはIEEE754二進表現のため、単純な`==`比較は
# 丸め誤差で意図せず不一致になりうる。候補自体が業務上「小数点2桁程度」の
# 粒度である前提のもと、十分小さい絶対誤差で同値判定する。
_FACTOR_TOLERANCE = 1e-9


class FactorNotAllowedError(Exception):
    """係数の手修正値が、対象ルールの`allowed_factors`候補に含まれない場合
    (Issue #40 7-3章「係数は…その積算コードで取り得る候補値から選択する」、
    PR #41レビュー指摘対応)。呼び出し側(router)がHTTP 422等へ変換する。
    """

    def __init__(self, current_factor: float, allowed_factors: list[float]):
        self.current_factor = current_factor
        self.allowed_factors = allowed_factors
        super().__init__(
            f"係数 {current_factor} はこの積算結果で許容される候補 {allowed_factors} に含まれていません。"
        )


_COLUMNS = """
    id, product_no, result_key, master_item_id, code, quantity, applicable_unit,
    initial_factor, current_factor, factor_overridden, factor_override_reason,
    factor_updated_at, factor_updated_by, judgment_method, judgment_scope,
    target_panel_ban_menno, target_panel_ban_no, target_drawing_page_id,
    judgment_reason, source_rule_id, unit_price, unit_labor, price, labor, status
"""


def _row_to_result(row: sqlite3.Row) -> EstimateResult:
    return EstimateResult(
        id=row["id"],
        product_no=row["product_no"],
        result_key=row["result_key"],
        master_item_id=row["master_item_id"],
        code=row["code"],
        quantity=row["quantity"],
        applicable_unit=ApplicableUnit(row["applicable_unit"]) if row["applicable_unit"] else None,
        initial_factor=row["initial_factor"],
        current_factor=row["current_factor"],
        factor_overridden=bool(row["factor_overridden"]),
        factor_override_reason=row["factor_override_reason"],
        factor_updated_at=row["factor_updated_at"],
        factor_updated_by=row["factor_updated_by"],
        judgment_method=JudgmentMethod(row["judgment_method"]),
        judgment_scope=JudgmentScope(row["judgment_scope"]),
        target_panel_ban_menno=row["target_panel_ban_menno"],
        target_panel_ban_no=row["target_panel_ban_no"],
        target_drawing_page_id=row["target_drawing_page_id"],
        judgment_reason=row["judgment_reason"],
        source_rule_id=row["source_rule_id"],
        unit_price=row["unit_price"],
        unit_labor=row["unit_labor"],
        price=row["price"],
        labor=row["labor"],
        status=EstimateResultStatus(row["status"]),
    )


def _row_to_evidence(row: sqlite3.Row) -> EstimateResultEvidence:
    return EstimateResultEvidence(
        id=row["id"],
        estimate_result_id=row["estimate_result_id"],
        evidence_kind=EvidenceKind(row["evidence_kind"]),
        detection_id=row["detection_id"],
        design_data_ref=row["design_data_ref"],
    )


def _load_evidence(conn: sqlite3.Connection, estimate_result_ids: list[int]) -> dict[int, list[EstimateResultEvidence]]:
    if not estimate_result_ids:
        return {}
    placeholders = ",".join("?" for _ in estimate_result_ids)
    rows = conn.execute(
        f"""
        SELECT id, estimate_result_id, evidence_kind, detection_id, design_data_ref
        FROM estimate_result_evidence
        WHERE estimate_result_id IN ({placeholders})
        ORDER BY id
        """,
        estimate_result_ids,
    ).fetchall()
    by_result: dict[int, list[EstimateResultEvidence]] = {rid: [] for rid in estimate_result_ids}
    for row in rows:
        by_result.setdefault(row["estimate_result_id"], []).append(_row_to_evidence(row))
    return by_result


def list_results_for_product(
    conn: sqlite3.Connection, *, product_no: str, detection_id: int | None = None
) -> list[EstimateResult]:
    """製番`product_no`の現在の積算結果一覧を`id`昇順で返す(根拠込み)。

    `detection_id`を指定すると、その根拠(`estimate_result_evidence.
    detection_id`)を持つ積算結果だけに絞り込む(Issue #40 Phase 3
    「根拠BBox→関係する積算結果」の双方向トレーサビリティ用)。1つのBBoxが
    複数の積算結果の根拠になりうる(Issue #40 9章)ため、常にlistで返す。
    """
    if detection_id is not None:
        rows = conn.execute(
            f"""
            SELECT {_COLUMNS} FROM estimate_results
            WHERE product_no = ?
              AND id IN (
                  SELECT estimate_result_id FROM estimate_result_evidence
                  WHERE detection_id = ?
              )
            ORDER BY id
            """,
            (product_no, detection_id),
        ).fetchall()
    else:
        rows = conn.execute(
            f"SELECT {_COLUMNS} FROM estimate_results WHERE product_no = ? ORDER BY id",
            (product_no,),
        ).fetchall()
    results = [_row_to_result(r) for r in rows]
    evidence_by_result = _load_evidence(conn, [r.id for r in results])
    for result in results:
        result.evidence = evidence_by_result.get(result.id, [])
    return results


def get_result(conn: sqlite3.Connection, *, product_no: str, result_id: int) -> EstimateResult | None:
    row = conn.execute(
        f"SELECT {_COLUMNS} FROM estimate_results WHERE id = ? AND product_no = ?",
        (result_id, product_no),
    ).fetchone()
    if row is None:
        return None
    result = _row_to_result(row)
    result.evidence = _load_evidence(conn, [result.id]).get(result.id, [])
    return result


def _insert_evidence(conn: sqlite3.Connection, estimate_result_id: int, candidate: EstimateResultCandidate) -> None:
    for ev in candidate.evidence:
        conn.execute(
            """
            INSERT INTO estimate_result_evidence
                (estimate_result_id, evidence_kind, detection_id, design_data_ref)
            VALUES (?, ?, ?, ?)
            """,
            (estimate_result_id, ev.evidence_kind.value, ev.detection_id, ev.design_data_ref),
        )


def replace_results_for_product(
    conn: sqlite3.Connection,
    *,
    product_no: str,
    candidates: Sequence[EstimateResultCandidate],
) -> list[EstimateResult]:
    """評価器が算出した候補一式で、製番`product_no`の`estimate_results`を
    最新状態へ揃える(Issue #40 Phase 2 指示: 評価器基盤)。

    - `result_key`が既存行と一致する候補: 派生列(quantity/initial_factor/
      judgment_reason/unit_price/unit_labor等)を更新する。`factor_overridden=1`
      の既存行は`current_factor`/`factor_overridden`/`factor_override_reason`/
      `factor_updated_at`/`factor_updated_by`を**そのまま維持**する
      (Issue #40 7-3章)。`factor_overridden=0`の行は`current_factor`を
      新しい`initial_factor`へ追従させる(まだ手修正されていない値のため、
      最新の初期係数をそのまま「現在係数」として扱ってよい)。
    - 新規`result_key`: `current_factor=initial_factor`、
      `factor_overridden=0`で新規行を作成する。
    - 既存行のうち、今回の候補集合に`result_key`が含まれないもの:
      削除する(Issue #40 6章「どれかのBBox削除/移動で条件不成立になれば
      結果も削除」に基づく。手修正の有無に関わらず削除する。条件が不成立に
      なった結果を保持し続ける根拠がIssue本文に無いため)。`ON DELETE
      CASCADE`により`estimate_result_evidence`側も連動して削除される。
    - 生存する全結果の`estimate_result_evidence`は、いったん全削除してから
      候補の`evidence`で作り直す(evidenceは派生データであり手修正の対象では
      ないため、差分更新の複雑さを避けてシンプルに再構築する)。
    - `price`/`labor`は`unit_price/unit_labor × quantity × current_factor`の
      SQL式で計算する(モジュールdocstring参照)。手修正済みの行は保持された
      `current_factor`がそのままこの式に使われるため、手修正後に再評価しても
      表示金額は手修正係数を反映し続ける。
    """
    existing_rows = conn.execute(
        "SELECT id, result_key FROM estimate_results WHERE product_no = ?",
        (product_no,),
    ).fetchall()
    existing_by_key = {row["result_key"]: row["id"] for row in existing_rows}
    candidate_keys = {c.result_key for c in candidates}

    # 候補に無くなった既存行を削除する (evidenceはON DELETE CASCADEで連動)。
    stale_ids = [rid for key, rid in existing_by_key.items() if key not in candidate_keys]
    if stale_ids:
        placeholders = ",".join("?" for _ in stale_ids)
        conn.execute(f"DELETE FROM estimate_results WHERE id IN ({placeholders})", stale_ids)

    for candidate in candidates:
        existing_id = existing_by_key.get(candidate.result_key)
        common_params = (
            candidate.master_item_id,
            candidate.code,
            candidate.quantity,
            candidate.applicable_unit.value if candidate.applicable_unit else None,
            candidate.initial_factor,
            candidate.judgment_method.value,
            candidate.judgment_scope.value,
            candidate.target_panel_ban_menno,
            candidate.target_panel_ban_no,
            candidate.target_drawing_page_id,
            candidate.judgment_reason,
            candidate.source_rule_id,
            candidate.unit_price,
            candidate.unit_labor,
        )
        if existing_id is not None:
            # 注意: 単一のUPDATE文のSET式は常に「更新前」の列値を参照する
            # (SQLの一般的な仕様。SQLiteも例外ではない)。そのため
            # unit_price/quantity/current_factorを更新しつつ同じ文で
            # price = unit_price * quantity * current_factor と書いても、
            # 更新前の値で計算されてしまう。ここでは2段階に分け、まず
            # unit_price/quantity/current_factor等を確定させてから、
            # 別のUPDATE文で確定後の値を使ってprice/laborを再計算する。
            #
            # factor_overridden=1の行は current_factor を更新しない(既存値の
            # ままprice/labor再計算に使われる)。0の行は current_factor も
            # 新しい initial_factor へ追従させる。
            #
            # Issue #40 Phase 5: statusは`factor_overridden`のような手修正保護
            # 対象ではなく(現時点でstatusを手動変更するAPIは無い)、候補の値で
            # 毎回上書きしてよい(quantity/judgment_reason等と同じ扱い)。
            conn.execute(
                """
                UPDATE estimate_results
                SET master_item_id = ?, code = ?, quantity = ?, applicable_unit = ?,
                    initial_factor = ?, judgment_method = ?, judgment_scope = ?,
                    target_panel_ban_menno = ?, target_panel_ban_no = ?,
                    target_drawing_page_id = ?, judgment_reason = ?, source_rule_id = ?,
                    unit_price = ?, unit_labor = ?, status = ?,
                    current_factor = CASE WHEN factor_overridden = 1 THEN current_factor ELSE ? END,
                    updated_at = datetime('now')
                WHERE id = ?
                """,
                (*common_params, candidate.status.value, candidate.initial_factor, existing_id),
            )
            conn.execute(
                """
                UPDATE estimate_results
                SET price = unit_price * quantity * current_factor,
                    labor = unit_labor * quantity * current_factor
                WHERE id = ?
                """,
                (existing_id,),
            )
            result_id = existing_id
        else:
            cursor = conn.execute(
                """
                INSERT INTO estimate_results
                    (product_no, result_key, master_item_id, code, quantity, applicable_unit,
                     initial_factor, current_factor, factor_overridden,
                     judgment_method, judgment_scope, target_panel_ban_menno, target_panel_ban_no,
                     target_drawing_page_id, judgment_reason, source_rule_id,
                     unit_price, unit_labor, price, labor, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        ? * ?, ? * ?, ?)
                """,
                (
                    product_no,
                    candidate.result_key,
                    candidate.master_item_id,
                    candidate.code,
                    candidate.quantity,
                    candidate.applicable_unit.value if candidate.applicable_unit else None,
                    candidate.initial_factor,
                    candidate.initial_factor,
                    candidate.judgment_method.value,
                    candidate.judgment_scope.value,
                    candidate.target_panel_ban_menno,
                    candidate.target_panel_ban_no,
                    candidate.target_drawing_page_id,
                    candidate.judgment_reason,
                    candidate.source_rule_id,
                    candidate.unit_price,
                    candidate.unit_labor,
                    candidate.unit_price,
                    candidate.quantity * candidate.initial_factor,
                    candidate.unit_labor,
                    candidate.quantity * candidate.initial_factor,
                    candidate.status.value,
                ),
            )
            result_id = cursor.lastrowid

        conn.execute("DELETE FROM estimate_result_evidence WHERE estimate_result_id = ?", (result_id,))
        _insert_evidence(conn, result_id, candidate)

    return list_results_for_product(conn, product_no=product_no)


def set_current_factor(
    conn: sqlite3.Connection,
    *,
    product_no: str,
    result_id: int,
    current_factor: float,
    reason: str | None,
    updated_by: str | None,
) -> EstimateResult | None:
    """係数の手修正 (Issue #40 7-3章)。`factor_overridden`をTrueにし、
    以後の再評価(`replace_results_for_product`)からこの値を保護する。
    `price`/`labor`もこの場で新しい係数を使って再計算する。

    **PR #41レビュー指摘対応**: 対象の積算結果が`source_rule_id`を持ち、
    かつそのルール(`estimate_rule_masters.allowed_factors`)に候補値が
    設定されている場合、`current_factor`がその候補に含まれない値なら
    `FactorNotAllowedError`を投げて保存を拒否する(Issue #40 7-3章「係数は
    可能な限り自由入力ではなく、その積算コードで取り得る候補値から選択する」
    をAPI層でも保証するため)。`allowed_factors`が未設定(None)の場合は
    Phase 1時点で係数候補が未確定のルールを想定し、現時点では自由入力を
    許容する(推測で候補を捏造しない)。
    """
    row = conn.execute(
        "SELECT source_rule_id FROM estimate_results WHERE id = ? AND product_no = ?",
        (result_id, product_no),
    ).fetchone()
    if row is None:
        return None

    source_rule_id = row["source_rule_id"]
    if source_rule_id is not None:
        allowed_factors = get_allowed_factors(conn, source_rule_id)
        if allowed_factors is not None and not any(
            abs(current_factor - candidate) <= _FACTOR_TOLERANCE for candidate in allowed_factors
        ):
            raise FactorNotAllowedError(current_factor, allowed_factors)

    cur = conn.execute(
        """
        UPDATE estimate_results
        SET current_factor = ?, factor_overridden = 1, factor_override_reason = ?,
            factor_updated_at = datetime('now'), factor_updated_by = ?,
            price = unit_price * quantity * ?, labor = unit_labor * quantity * ?,
            updated_at = datetime('now')
        WHERE id = ? AND product_no = ?
        """,
        (current_factor, reason, updated_by, current_factor, current_factor, result_id, product_no),
    )
    if cur.rowcount == 0:
        return None
    return get_result(conn, product_no=product_no, result_id=result_id)


def reset_factor_to_initial(
    conn: sqlite3.Connection, *, product_no: str, result_id: int
) -> EstimateResult | None:
    """「初期値へ戻す」操作 (Issue #40 7-3章)。`current_factor`を
    `initial_factor`へ戻し、`factor_overridden`をFalseにする(以後の
    再評価で最新の初期係数へ追従するようになる)。`price`/`labor`も
    `initial_factor`を使って再計算する。
    """
    cur = conn.execute(
        """
        UPDATE estimate_results
        SET current_factor = initial_factor, factor_overridden = 0,
            factor_override_reason = NULL, factor_updated_at = NULL,
            factor_updated_by = NULL,
            price = unit_price * quantity * initial_factor,
            labor = unit_labor * quantity * initial_factor,
            updated_at = datetime('now')
        WHERE id = ? AND product_no = ?
        """,
        (result_id, product_no),
    )
    if cur.rowcount == 0:
        return None
    return get_result(conn, product_no=product_no, result_id=result_id)


__all__ = [
    "list_results_for_product",
    "get_result",
    "replace_results_for_product",
    "set_current_factor",
    "reset_factor_to_initial",
    "FactorNotAllowedError",
]
