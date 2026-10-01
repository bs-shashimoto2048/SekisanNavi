"""0011_estimate_quantity_override.py の安全性テスト (Issue #40 Phase 6後半)。

0010 (PR #45レビュー指摘) で確立した安全パターン-「複数のDDL文を含む
migrationは`.py`+明示的`BEGIN`/`COMMIT`/`ROLLBACK`にする」-を0011にも
そのまま適用しているため、`test_migration_0010_safety.py`と同じ観点
(新規DB全適用・冪等性・既存DBの追いつき適用・FK整合性・中途失敗時の
ロールバック安全性)で検証する。

0001〜0010は一切編集しない(指示10章)。
"""
import importlib.util
import sqlite3
from pathlib import Path

from app.config import MIGRATIONS_DIR
from app.db.connection import get_connection
from app.db.migrate import run_migrations

_0011_FILENAME = "0011_estimate_quantity_override.py"


def _apply_migrations_up_to_0010(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    for migration_file in sorted([*MIGRATIONS_DIR.glob("*.sql"), *MIGRATIONS_DIR.glob("*.py")]):
        if migration_file.name >= _0011_FILENAME:
            continue
        if migration_file.suffix == ".py":
            spec = importlib.util.spec_from_file_location(f"m_{migration_file.stem}", migration_file)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            module.apply(conn)
        else:
            conn.executescript(migration_file.read_text(encoding="utf-8"))
        conn.execute("INSERT INTO schema_migrations (filename) VALUES (?)", (migration_file.name,))


def test_0011_is_a_python_migration_not_sql():
    sql_path = MIGRATIONS_DIR / "0011_estimate_quantity_override.sql"
    py_path = MIGRATIONS_DIR / _0011_FILENAME
    assert not sql_path.exists()
    assert py_path.exists()


def test_fresh_db_applies_0011_via_real_runner_with_clean_foreign_keys(tmp_path):
    db_path = tmp_path / "fresh.db"
    applied = run_migrations(db_path)
    assert _0011_FILENAME in applied

    with get_connection(db_path) as conn:
        result_cols = [r[1] for r in conn.execute("PRAGMA table_info(estimate_results)").fetchall()]
        for c in ("initial_quantity", "current_quantity", "quantity_overridden", "quantity_override_reason"):
            assert c in result_cols

        item_cols = [r[1] for r in conn.execute("PRAGMA table_info(estimate_confirmation_items)").fetchall()]
        for c in ("initial_quantity", "current_quantity", "quantity_overridden", "quantity_override_reason"):
            assert c in item_cols

        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []


def test_rerunning_migrate_after_0011_is_a_noop(tmp_path):
    db_path = tmp_path / "fresh.db"
    run_migrations(db_path)
    assert run_migrations(db_path) == []


def test_existing_estimate_results_rows_survive_0011_with_backfilled_initial_and_current_quantity(tmp_path):
    """0011適用前から存在するestimate_results行は、id/値とも維持されたまま、
    新設4列のうちinitial_quantity/current_quantityは既存quantity列の値で
    後方互換的に埋められ(指示10章「既存DB追いつき」)、
    quantity_overridden=falseのまま追加される。"""
    db_path = tmp_path / "legacy.db"
    with get_connection(db_path) as conn:
        _apply_migrations_up_to_0010(conn)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute(
            "INSERT INTO estimate_results (product_no, result_key, code, quantity, current_factor, "
            "initial_factor, factor_overridden, status, judgment_method, judgment_scope) "
            "VALUES ('A1GV2421', 'k1', '11001', 3, 1.0, 1.0, 0, 'reviewed', 'drawing_judgment', 'panel')"
        )
        result_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        before = dict(
            conn.execute("SELECT id, product_no, result_key, code, quantity FROM estimate_results WHERE id = ?", (result_id,)).fetchone()
        )
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []

    applied = run_migrations(db_path)
    assert applied == [_0011_FILENAME]

    with get_connection(db_path) as conn:
        conn.execute("PRAGMA foreign_keys = ON")
        after = dict(
            conn.execute(
                "SELECT id, product_no, result_key, code, quantity, initial_quantity, current_quantity, "
                "quantity_overridden, quantity_override_reason FROM estimate_results WHERE id = ?",
                (result_id,),
            ).fetchone()
        )
        assert after["id"] == before["id"]
        assert after["product_no"] == before["product_no"]
        assert after["result_key"] == before["result_key"]
        assert after["code"] == before["code"]
        assert after["quantity"] == before["quantity"]
        assert after["initial_quantity"] == before["quantity"]
        assert after["current_quantity"] == before["quantity"]
        assert after["quantity_overridden"] == 0
        assert after["quantity_override_reason"] is None

        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []

        # confirmation_items側の新列は過去snapshotの意味を変えないため、
        # backfillせずNULLのまま残る(指示8章)。
        conn.execute(
            "INSERT INTO estimate_confirmations (product_no) VALUES ('A1GV2421')"
        )
        cid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute(
            "INSERT INTO estimate_confirmation_items "
            "(confirmation_id, target_id, target_type, code, source_type, status, quantity) "
            "VALUES (?, 'product', 'product', '11001', 'manual', 'reviewed', 2)",
            (cid,),
        )


def test_legacy_confirmation_item_inserted_before_0011_reads_new_columns_as_null(tmp_path):
    db_path = tmp_path / "legacy_items.db"
    with get_connection(db_path) as conn:
        _apply_migrations_up_to_0010(conn)
        conn.execute("INSERT INTO estimate_confirmations (product_no) VALUES ('A1GV2421')")
        cid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.execute(
            "INSERT INTO estimate_confirmation_items "
            "(confirmation_id, target_id, target_type, code, source_type, status, quantity) "
            "VALUES (?, 'product', 'product', '11001', 'manual', 'reviewed', 2)",
            (cid,),
        )
        item_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    run_migrations(db_path)

    with get_connection(db_path) as conn:
        row = dict(
            conn.execute(
                "SELECT quantity, initial_quantity, current_quantity, quantity_overridden, quantity_override_reason "
                "FROM estimate_confirmation_items WHERE id = ?",
                (item_id,),
            ).fetchone()
        )
        assert row["quantity"] == 2
        assert row["initial_quantity"] is None
        assert row["current_quantity"] is None
        assert row["quantity_overridden"] is None
        assert row["quantity_override_reason"] is None


def test_mid_migration_failure_rolls_back_0011_to_the_original_schema_with_no_partial_columns(tmp_path):
    db_path = tmp_path / "rollback.db"
    with get_connection(db_path) as conn:
        _apply_migrations_up_to_0010(conn)
        conn.execute(
            "INSERT INTO estimate_results (product_no, result_key, code, quantity, current_factor, "
            "initial_factor, factor_overridden, status, judgment_method, judgment_scope) "
            "VALUES ('A1GV2421', 'k1', '11001', 3, 1.0, 1.0, 0, 'reviewed', 'drawing_judgment', 'panel')"
        )

    before_result_cols = None
    before_item_cols = None
    before_result_count = None
    with get_connection(db_path) as conn:
        before_result_cols = [r[1] for r in conn.execute("PRAGMA table_info(estimate_results)").fetchall()]
        before_item_cols = [r[1] for r in conn.execute("PRAGMA table_info(estimate_confirmation_items)").fetchall()]
        before_result_count = conn.execute("SELECT COUNT(*) FROM estimate_results").fetchone()[0]

    source = (MIGRATIONS_DIR / _0011_FILENAME).read_text(encoding="utf-8")
    marker = 'conn.execute("ALTER TABLE estimate_confirmation_items ADD COLUMN initial_quantity REAL")'
    assert marker in source, "0011 migration source changed shape; update this test's patch target"
    broken_source = source.replace(
        marker, marker + '\n        raise RuntimeError("deliberate mid-migration failure for rollback test")'
    )
    broken_path = Path(tmp_path) / "0011_broken_for_test.py"
    broken_path.write_text(broken_source, encoding="utf-8")

    spec = importlib.util.spec_from_file_location("broken_0011", broken_path)
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
        after_result_cols = [r[1] for r in conn.execute("PRAGMA table_info(estimate_results)").fetchall()]
        after_item_cols = [r[1] for r in conn.execute("PRAGMA table_info(estimate_confirmation_items)").fetchall()]
        after_result_count = conn.execute("SELECT COUNT(*) FROM estimate_results").fetchone()[0]
        assert after_result_cols == before_result_cols
        assert after_item_cols == before_item_cols
        assert after_result_count == before_result_count
        assert "initial_quantity" not in after_result_cols
        assert "initial_quantity" not in after_item_cols
