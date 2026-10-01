"""0010_estimate_confirmation_result_snapshot.py の安全性テスト (PR #45
レビュー指摘対応)。

経緯: 当初0010は`.sql`(`executescript()`で一括実行)として実装していたが、
以下2点がレビューで指摘され、実機検証で再現を確認した。

1. `PRAGMA foreign_keys = OFF/ON`はSQLite仕様上「保留中のトランザクションが
   ある間はno-op」になる。
2. より重大な点として、`executescript()`は(スクリプト自身が明示的な
   `BEGIN`を含まない限り)各DDL文を個別にオートコミットするため、
   複数文から成るmigrationが途中で失敗すると、既に実行済みの文の結果
   (例: 旧テーブルのDROP)だけが残った中途半端なschemaになってしまう
   (`run_migrations()`呼び出し元の`conn.rollback()`では戻せない)。

このテストは、0010を`.py`(`apply(conn)`、明示的`BEGIN`/`COMMIT`/
`ROLLBACK`)へ変更した後の安全性を、実際の`app.db.migrate.run_migrations`
経由で確認する。
"""
import importlib.util
import sqlite3
from pathlib import Path

from app.config import MIGRATIONS_DIR
from app.db.connection import get_connection
from app.db.migrate import run_migrations

_0010_FILENAME = "0010_estimate_confirmation_result_snapshot.py"
# [Issue #40 Phase 6後半] 0011追加後、0009以前の状態から`run_migrations`を
# 実行すると0010に続けて0011も適用される(0011は本テストの対象外だが、
# 「0010だけが適用される」という前提のassertionはここで更新する必要がある)。
_0011_FILENAME = "0011_estimate_quantity_override.py"


def _apply_migrations_up_to_0009(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    for migration_file in sorted([*MIGRATIONS_DIR.glob("*.sql"), *MIGRATIONS_DIR.glob("*.py")]):
        if migration_file.name >= _0010_FILENAME:
            continue
        if migration_file.suffix == ".py":
            spec = importlib.util.spec_from_file_location(f"m_{migration_file.stem}", migration_file)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            module.apply(conn)
        else:
            conn.executescript(migration_file.read_text(encoding="utf-8"))
        conn.execute("INSERT INTO schema_migrations (filename) VALUES (?)", (migration_file.name,))


def test_0010_is_a_python_migration_not_sql(tmp_path):
    """SQLファイルの`executescript()`(各文を個別にオートコミットし、
    途中失敗時に中途半端な状態が残りうる)を使わないよう、0010は`.py`形式で
    あることを明示的に固定する(レビュー指摘の再発防止)。"""
    sql_path = MIGRATIONS_DIR / "0010_estimate_confirmation_result_snapshot.sql"
    py_path = MIGRATIONS_DIR / _0010_FILENAME
    assert not sql_path.exists()
    assert py_path.exists()


def test_fresh_db_applies_0010_via_real_runner_with_clean_foreign_keys(tmp_path):
    db_path = tmp_path / "fresh.db"
    applied = run_migrations(db_path)
    assert _0010_FILENAME in applied

    with get_connection(db_path) as conn:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(estimate_confirmation_items)").fetchall()]
        for c in (
            "current_factor", "factor_overridden", "judgment_method", "applicable_unit",
            "judgment_reason", "source_rule_id", "result_status",
        ):
            assert c in cols
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        assert "estimate_confirmation_result_evidence" in tables
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_rerunning_migrate_after_0010_is_a_noop(tmp_path):
    db_path = tmp_path / "fresh.db"
    run_migrations(db_path)
    assert run_migrations(db_path) == []


def test_existing_fk_bearing_confirmation_rows_survive_0010_byte_identical(tmp_path):
    """既存confirmation item(confirmation_idの外部キーを実際に持つ行)が、
    0010適用後もid/confirmation_id/件数ともに完全に維持されること。"""
    db_path = tmp_path / "legacy.db"
    with get_connection(db_path) as conn:
        _apply_migrations_up_to_0009(conn)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("INSERT INTO estimate_confirmations (product_no) VALUES ('A1GV2421')")
        cid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        for i in range(3):
            conn.execute(
                """
                INSERT INTO estimate_confirmation_items (
                    confirmation_id, detection_id, drawing_page_id, target_id, target_type,
                    code, source_type, status, quantity, unit_price, amount,
                    bbox_x, bbox_y, bbox_w, bbox_h, page_no
                ) VALUES (?, ?, 1, 'product', 'product', '11001', 'manual', 'reviewed',
                          1, 1000, 1000, 0.1, 0.1, 0.05, 0.05, 16)
                """,
                (cid, 100 + i),
            )
        before_items = [
            dict(r)
            for r in conn.execute(
                "SELECT id, confirmation_id FROM estimate_confirmation_items ORDER BY id"
            ).fetchall()
        ]
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []

    applied = run_migrations(db_path)
    assert applied == [_0010_FILENAME, _0011_FILENAME]

    with get_connection(db_path) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        after_items = [
            dict(r)
            for r in conn.execute(
                "SELECT id, confirmation_id FROM estimate_confirmation_items ORDER BY id"
            ).fetchall()
        ]
        assert after_items == before_items

        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []

        fk_list_items = conn.execute("PRAGMA foreign_key_list(estimate_confirmation_items)").fetchall()
        assert any(row["table"] == "estimate_confirmations" for row in fk_list_items)

        fk_list_evidence = conn.execute(
            "PRAGMA foreign_key_list(estimate_confirmation_result_evidence)"
        ).fetchall()
        assert any(row["table"] == "estimate_confirmation_items" for row in fk_list_evidence)

        # 新列はNULLのまま(既存行の意味を変えない)
        new_col_rows = conn.execute(
            "SELECT current_factor, result_status FROM estimate_confirmation_items"
        ).fetchall()
        assert all(r["current_factor"] is None and r["result_status"] is None for r in new_col_rows)


def test_foreign_key_enforcement_still_rejects_dangling_evidence_reference_after_0010(tmp_path):
    """0010適用後も、estimate_confirmation_result_evidence.confirmation_item_id
    の外部キーが実際に機能(存在しないidへのINSERTを拒否)すること。"""
    db_path = tmp_path / "fresh.db"
    run_migrations(db_path)
    with get_connection(db_path) as conn:
        conn.execute("INSERT INTO estimate_confirmations (product_no) VALUES ('A1GV2421')")
        cid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute(
            """
            INSERT INTO estimate_confirmation_items (confirmation_id, target_id, target_type, code)
            VALUES (?, 'product', 'product', '11001')
            """,
            (cid,),
        )
        item_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        # valid reference succeeds
        conn.execute(
            "INSERT INTO estimate_confirmation_result_evidence (confirmation_item_id, evidence_kind) VALUES (?, 'design_data')",
            (item_id,),
        )

    with get_connection(db_path) as conn:
        try:
            conn.execute(
                "INSERT INTO estimate_confirmation_result_evidence (confirmation_item_id, evidence_kind) VALUES (999999, 'design_data')"
            )
            raise AssertionError("dangling confirmation_item_id insert should have been rejected")
        except sqlite3.IntegrityError:
            pass
        finally:
            conn.rollback()


def test_mid_migration_failure_rolls_back_to_the_original_schema_with_no_partial_tables(tmp_path):
    """0010の途中(新しいevidenceテーブルのCREATEより前)で例外が起きた場合、
    estimate_confirmation_items_v2やestimate_confirmation_result_evidenceが
    残らず、元のestimate_confirmation_itemsが無傷のまま(行数・列構成とも)
    残ること(中途半端なschemaにならないことの直接的な裏付け)。"""
    db_path = tmp_path / "rollback.db"
    with get_connection(db_path) as conn:
        _apply_migrations_up_to_0009(conn)
        conn.execute("INSERT INTO estimate_confirmations (product_no) VALUES ('A1GV2421')")
        cid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute(
            "INSERT INTO estimate_confirmation_items "
            "(confirmation_id, target_id, target_type, code, source_type, status) "
            "VALUES (?, 'product', 'product', '11001', 'manual', 'reviewed')",
            (cid,),
        )

    before_tables = None
    before_item_count = None
    with get_connection(db_path) as conn:
        before_tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        before_item_count = conn.execute("SELECT COUNT(*) FROM estimate_confirmation_items").fetchone()[0]

    # 実際の0010ファイルの内容を、evidenceテーブル作成の直前で例外を送出する
    # よう書き換えたコピーを動的に読み込み、同じtransaction境界(BEGIN/COMMIT/
    # ROLLBACK)で実行する。
    source = (MIGRATIONS_DIR / _0010_FILENAME).read_text(encoding="utf-8")
    marker = (
        'conn.execute(\n'
        '            "CREATE INDEX idx_estimate_confirmation_items_confirmation_id "\n'
        '            "ON estimate_confirmation_items(confirmation_id)"\n'
        '        )'
    )
    assert marker in source, "0010 migration source changed shape; update this test's patch target"
    broken_source = source.replace(
        marker, marker + '\n        raise RuntimeError("deliberate mid-migration failure for rollback test")'
    )
    broken_path = Path(tmp_path) / "0010_broken_for_test.py"
    broken_path.write_text(broken_source, encoding="utf-8")

    spec = importlib.util.spec_from_file_location("broken_0010", broken_path)
    broken_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(broken_module)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        try:
            broken_module.apply(conn)
            raise AssertionError("broken migration should have raised")
        except RuntimeError:
            pass
    finally:
        conn.close()

    with get_connection(db_path) as conn:
        after_tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        assert after_tables == before_tables
        assert "estimate_confirmation_items_v2" not in after_tables
        assert "estimate_confirmation_result_evidence" not in after_tables
        after_item_count = conn.execute("SELECT COUNT(*) FROM estimate_confirmation_items").fetchone()[0]
        assert after_item_count == before_item_count
        cols = [r[1] for r in conn.execute("PRAGMA table_info(estimate_confirmation_items)").fetchall()]
        assert "current_factor" not in cols
