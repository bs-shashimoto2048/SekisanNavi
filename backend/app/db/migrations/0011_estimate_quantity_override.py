"""0011_estimate_quantity_override
Issue #40 Phase 6後半: 数量手修正機能。

`estimate_results`/`estimate_confirmation_items`へ、係数override
(`initial_factor`/`current_factor`/`factor_overridden`/
`factor_override_reason`)と同じ考え方の数量override列を追加する。

- `initial_quantity`: 評価器が算出した自動値そのもの(再評価のたびに
  最新化される。既存の`initial_factor`と同じ役割)。
- `current_quantity`: 実際に計算へ使う値(手修正されていれば手修正値、
  されていなければ`initial_quantity`に追従)。
- `quantity_overridden`/`quantity_override_reason`: 手修正の有無と理由。

**既存`quantity`列の意味は変えない**(指示8章「既存quantity列の意味を壊さない
こと」)。`estimate_results.quantity`は今後も「計算に使う現在の数量」を表す
列のまま、`current_quantity`と常に同じ値になるよう`app/repositories/
estimate_results.py`が同期させる(既存の集約・表示コードがこの列を読むだけで
手修正を自動的に反映できるようにするため)。

`estimate_confirmation_items.quantity`は、Phase 6-Aで移行したEstimateResult
ベースの新しい行ではこれまで同様`quantity`(=確定時点のcurrent_quantity)を
保存する。過去(Phase 6後半以前)に保存された行の`quantity`の意味(旧
Detectionベースでは常に1、Phase 6-A移行後はEstimateResult.quantity)は
変更しない。新設4列(`initial_quantity`/`current_quantity`/
`quantity_overridden`/`quantity_override_reason`)は、過去の行では全てNULLの
まま安全に読み出せる(値を推測で埋めない)。

【0010のレビュー指摘(PR #45)を踏まえた安全策】
このmigrationは`ALTER TABLE ... ADD COLUMN`のみを行い、0004/0010のような
テーブル再構築(DROP+CREATE+RENAME)は不要(NOT NULL制約の解除が絡まない
単純な列追加のため)。ただし、複数のALTER TABLE文を1つのスクリプトとして
実行する場合、SQLiteの`executescript()`は各DDL文を個別にオートコミットする
ため、途中で失敗すると一部の列だけが追加された中途半端な状態が残りうる
(0010と同じ問題。PR #45レビュー指摘)。そのため、このmigrationも`.py`
(`apply(conn)`)とし、明示的な`BEGIN`で一連のALTER TABLE文を1つの
トランザクションにまとめ、失敗時は`ROLLBACK`してから再送出する
(0010と全く同じ安全パターン)。
"""
from __future__ import annotations

import sqlite3


def apply(conn: sqlite3.Connection) -> None:
    existing_columns = {row[1] for row in conn.execute("PRAGMA table_info(estimate_results)").fetchall()}
    if "initial_quantity" in existing_columns:
        # 既にこのmigrationが適用済みのスキーマに対しても安全に冪等であるよう
        # 防御しておく(0009/0010と同じ考え方)。
        return

    # 直前のmigration/ループ処理(`app/db/migrate.py::run_migrations`が各
    # migration適用後に発行する`INSERT INTO schema_migrations`)がpysqlite3の
    # 自動BEGIN仕様により暗黙のトランザクションを開いたままにしていることが
    # あるため、`executescript()`の「実行前に保留中のトランザクションを暗黙的に
    # COMMITする」仕様を明示的に真似て、まず保留分を確定させてから自分自身の
    # トランザクションを開始する(0010と同じ対応、実機検証で必要性を確認済み)。
    if conn.in_transaction:
        conn.commit()

    try:
        conn.execute("BEGIN")

        conn.execute("ALTER TABLE estimate_results ADD COLUMN initial_quantity REAL")
        conn.execute("ALTER TABLE estimate_results ADD COLUMN current_quantity REAL")
        conn.execute("ALTER TABLE estimate_results ADD COLUMN quantity_overridden INTEGER NOT NULL DEFAULT 0")
        conn.execute("ALTER TABLE estimate_results ADD COLUMN quantity_override_reason TEXT")
        # 既存行(このmigration適用時点で既に存在する行)を、手修正なしの
        # 初期状態として後方互換的に埋める(評価器が次に再評価した時点で
        # initial_quantity自体は最新化される。次回評価までの間も画面が
        # NULL/0円等の捏造値にならないよう、既存のquantity値をそのまま
        # initial_quantity/current_quantityへコピーする)。
        conn.execute(
            "UPDATE estimate_results SET initial_quantity = quantity, current_quantity = quantity "
            "WHERE initial_quantity IS NULL"
        )

        conn.execute("ALTER TABLE estimate_confirmation_items ADD COLUMN initial_quantity REAL")
        conn.execute("ALTER TABLE estimate_confirmation_items ADD COLUMN current_quantity REAL")
        conn.execute("ALTER TABLE estimate_confirmation_items ADD COLUMN quantity_overridden INTEGER")
        conn.execute("ALTER TABLE estimate_confirmation_items ADD COLUMN quantity_override_reason TEXT")
        # confirmation_items側は過去snapshotの値を推測で埋めない(指示8章
        # 「過去snapshot: 新列NULL」)ため、backfillは行わない。

        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
