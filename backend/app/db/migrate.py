"""簡易スキーママイグレーションランナー。

backend/app/db/migrations/ 配下の *.sql / *.py を連番順に適用し、
適用済みファイル名を schema_migrations テーブルに記録する。

Alembic等の導入はPoC段階ではオーバースペックと判断し、
「schema migration可能な構成」を満たす最小限の実装とする。

【migrationファイルは一度mainへ入ったら書き換えない】
(Issue #40 Phase 3 PR #42レビュー指摘)
このランナーは同一ファイル名につき1度しか適用しない(schema_migrationsに
ファイル名で記録するだけの単純な仕組み)。そのため、既にどこかの環境
(本番DB等)で適用済みのファイルを後から書き換えても、そのファイル名が
既に記録されている環境には変更後の内容が決して反映されない
(実際にPhase 2で0008を書き換えて発生した不具合。詳細はPR #41/#42の
経緯およびtests/test_migrate_immutability.py参照)。
そのため、一度mainへ入ったmigrationファイルの中身は不変として扱い、
スキーマ変更が必要になった場合は必ず新しい連番ファイルを追加すること。

【.pyマイグレーションについて】
0009で「0008では既にunit_price/unit_labor列を追加済みだが、0008が
書き換え前の内容のまま適用済みの環境ではまだ追加されていない」という
状態を両方とも安全に成立させる必要が生じた。プレーンな.sqlファイル
(`ALTER TABLE ... ADD COLUMN`)には条件分岐が無く、「列が既に存在する
場合は何もしない」という冪等な追加ができないため、必要な場合のみ
`apply(conn: sqlite3.Connection) -> None` を定義した.pyファイルとして
migrationを書けるようにしている。
"""
import importlib.util
from pathlib import Path
from types import ModuleType

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


def _load_python_migration(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(f"migration_{path.stem}", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_migrations(db_path: Path = DB_PATH, migrations_dir: Path = MIGRATIONS_DIR) -> list[str]:
    """未適用のマイグレーションを適用する。適用したファイル名のリストを返す。"""
    applied_now: list[str] = []
    with get_connection(db_path) as conn:
        _ensure_migrations_table(conn)
        already = applied_migrations(conn)
        migration_files = sorted(
            [*migrations_dir.glob("*.sql"), *migrations_dir.glob("*.py")],
            key=lambda p: p.name,
        )
        for migration_file in migration_files:
            if migration_file.name in already:
                continue
            if migration_file.suffix == ".py":
                module = _load_python_migration(migration_file)
                module.apply(conn)
            else:
                script = migration_file.read_text(encoding="utf-8")
                conn.executescript(script)
            conn.execute(
                "INSERT INTO schema_migrations (filename) VALUES (?)", (migration_file.name,)
            )
            applied_now.append(migration_file.name)
    return applied_now


if __name__ == "__main__":
    applied = run_migrations()
    if applied:
        print(f"Applied migrations: {applied}")
    else:
        print("No pending migrations.")
