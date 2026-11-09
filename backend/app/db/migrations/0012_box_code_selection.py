"""0012_box_code_selection
箱コード自動選定(部品台帳「箱･単独」「箱･左右」「箱･中」)のための追加。

- `estimate_results.box_category`: 箱コード行の品名カテゴリ(箱以外はNULL)。
- `estimate_results.code_overridden`: 箱コードが利用者の手修正値か(0/1)。
- `estimate_box_overrides`: 利用者が手修正した箱コード(製番×面番号×盤番号に1件)。
  再評価(`estimate_results`の作り直し)・画面再読込でも手修正を保持するための正本。
  `master_item_id`にはFKを付けない(マスタ再取込で消えても評価時に「無効な手修正」として
  自動選定へ戻し、行の評価自体は失敗させないため。既存の`decision_events`等と同じ歴史的参照方針)。

0010/0011と同じ安全策(明示BEGIN/ROLLBACK、冪等)で、ALTER TABLE ADD COLUMN と
CREATE TABLE を1トランザクションにまとめる。既存行は手修正なし・箱以外として扱う。
"""
from __future__ import annotations

import sqlite3


def apply(conn: sqlite3.Connection) -> None:
    existing_columns = {row[1] for row in conn.execute("PRAGMA table_info(estimate_results)").fetchall()}
    if "box_category" in existing_columns:
        return

    if conn.in_transaction:
        conn.commit()

    try:
        conn.execute("BEGIN")
        conn.execute("ALTER TABLE estimate_results ADD COLUMN box_category TEXT")
        conn.execute("ALTER TABLE estimate_results ADD COLUMN code_overridden INTEGER NOT NULL DEFAULT 0")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS estimate_box_overrides (
                product_no TEXT NOT NULL,
                ban_menno INTEGER NOT NULL,
                ban_no INTEGER NOT NULL,
                master_item_id INTEGER NOT NULL,
                reason TEXT,
                updated_by TEXT,
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (product_no, ban_menno, ban_no)
            )
            """
        )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
