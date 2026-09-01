"""簡易スキーママイグレーションランナー。

backend/app/db/migrations/ 配下の *.sql を連番順に適用し、
適用済みファイル名を schema_migrations テーブルに記録する。

Alembic等の導入はPoC段階ではオーバースペックと判断し、
「schema migration可能な構成」を満たす最小限の実装とする。
"""
from pathlib import Path

from app.config import DB_PATH, MIGRATIONS_DIR
from app.db.connection import get_connection


def _ensure_migrations_table(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )


def applied_migrations(conn) -> set[str]:
    _ensure_migrations_table(conn)
    rows = conn.execute("SELECT filename FROM schema_migrations").fetchall()
    return {row["filename"] for row in rows}


def run_migrations(db_path: Path = DB_PATH, migrations_dir: Path = MIGRATIONS_DIR) -> list[str]:
    """未適用のマイグレーションを適用する。適用したファイル名のリストを返す。"""
    applied_now: list[str] = []
    with get_connection(db_path) as conn:
        _ensure_migrations_table(conn)
        already = applied_migrations(conn)
        for sql_file in sorted(migrations_dir.glob("*.sql")):
            if sql_file.name in already:
                continue
            script = sql_file.read_text(encoding="utf-8")
            conn.executescript(script)
            conn.execute(
                "INSERT INTO schema_migrations (filename) VALUES (?)", (sql_file.name,)
            )
            applied_now.append(sql_file.name)
    return applied_now


if __name__ == "__main__":
    applied = run_migrations()
    if applied:
        print(f"Applied migrations: {applied}")
    else:
        print("No pending migrations.")
