"""0008_estimate_rule_engine_foundation.sql のmigration安全性テスト
(Issue #40 Phase 2 指示7: 「既存DBに対して安全に適用でき、既存データを
失わないことをテストしてください」)。

`db_path`フィクスチャ(conftest.py)は常に最新migrationまで適用済みのDBを
返すため、ここでは別に「0008を含まない状態(0007まで)のDBへデータを
投入してから0008を適用する」という、実運用の既存DBアップグレードにより
近いシナリオを検証する。
"""
import shutil
import sqlite3
from pathlib import Path

from app.config import MIGRATIONS_DIR
from app.db.connection import get_connection
from app.db.master_importer import import_master_excel
from app.db.migrate import run_migrations
from app.db.seed import seed


def _apply_migrations_up_to(db_path: Path, last_filename: str) -> None:
    with get_connection(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        for sql_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
            script = sql_file.read_text(encoding="utf-8")
            conn.executescript(script)
            conn.execute("INSERT INTO schema_migrations (filename) VALUES (?)", (sql_file.name,))
            if sql_file.name == last_filename:
                break


def _table_names(conn: sqlite3.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}


def test_0008_applies_cleanly_on_top_of_pre_existing_data(tmp_path):
    """0007までのスキーマへ実データ(detections/master items/decision_events/
    estimate_confirmations)を投入した状態から0008を適用しても、
    既存データが1件も失われないことを確認する。"""
    db_path = tmp_path / "upgrade_test.db"
    _apply_migrations_up_to(db_path, "0007_estimate_confirmations.sql")

    with get_connection(db_path) as conn:
        seed(conn)
        import_master_excel(conn)

        # 既存detectionsを1件追加(evidence_type_key列が無い時点のINSERT文と
        # 同じ列構成であることも同時に確認する)。
        page_id = conn.execute("SELECT id FROM drawing_pages LIMIT 1").fetchone()[0]
        master_item_id = conn.execute("SELECT id FROM estimate_master_items LIMIT 1").fetchone()[0]
        conn.execute(
            """
            INSERT INTO detections
                (drawing_page_id, panel_id, class_name, bbox_x, bbox_y, bbox_w, bbox_h,
                 confidence, status, source_type, master_item_id)
            VALUES (?, NULL, 'roof_fan', 0.1, 0.1, 0.05, 0.05, NULL, 'reviewed', 'manual', ?)
            """,
            (page_id, master_item_id),
        )
        detection_id = conn.execute("SELECT id FROM detections ORDER BY id DESC LIMIT 1").fetchone()[0]
        conn.execute(
            """
            INSERT INTO decision_events
                (event_type, detection_id, drawing_page_id, source_type, master_item_id,
                 after_bbox_x, after_bbox_y, after_bbox_w, after_bbox_h)
            VALUES ('create', ?, ?, 'manual', ?, 0.1, 0.1, 0.05, 0.05)
            """,
            (detection_id, page_id, master_item_id),
        )
        conn.execute("INSERT INTO estimate_confirmations (product_no) VALUES ('A1GV2421')")

    before_counts = {}
    with get_connection(db_path) as conn:
        for table in ("detections", "estimate_master_items", "decision_events", "estimate_confirmations", "drawing_pages"):
            before_counts[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        assert before_counts["detections"] >= 1
        assert before_counts["estimate_master_items"] >= 1
        assert before_counts["decision_events"] >= 1
        assert before_counts["estimate_confirmations"] == 1

    # 残りのmigration(0008を含む)を適用する(既存DBへの追いつき適用と同じ経路)。
    applied = run_migrations(db_path)
    assert "0008_estimate_rule_engine_foundation.sql" in applied

    with get_connection(db_path) as conn:
        tables = _table_names(conn)
        assert "drawing_evidence_types" in tables
        assert "estimate_rule_masters" in tables
        assert "estimate_results" in tables
        assert "estimate_result_evidence" in tables

        # 既存データが失われていないことを確認する。
        for table, count in before_counts.items():
            after = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            assert after == count, f"{table}の件数が変化した: before={count} after={after}"

        # 既存detections行のevidence_type_keyはNULLのまま(バックフィルしない)。
        row = conn.execute(
            "SELECT evidence_type_key FROM detections WHERE id = ?", (detection_id,)
        ).fetchone()
        assert row["evidence_type_key"] is None

        # 既存の主要列(master_item_id等)は変化していない。
        row = conn.execute("SELECT master_item_id FROM detections WHERE id = ?", (detection_id,)).fetchone()
        assert row["master_item_id"] == master_item_id


def test_0008_is_idempotent_via_schema_migrations_tracking(tmp_path):
    """`run_migrations`は適用済みファイル名を`schema_migrations`で記録しており、
    2回連続で呼んでも0008が再適用されない(=重複CREATE TABLEでエラーに
    ならない)ことを確認する(`db/migrate.py`の既存の仕組みをそのまま
    利用するだけの回帰確認)。"""
    db_path = tmp_path / "idempotent_test.db"
    first = run_migrations(db_path)
    assert "0008_estimate_rule_engine_foundation.sql" in first

    second = run_migrations(db_path)
    assert second == []
