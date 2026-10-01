"""migrationファイルの不変性、および0008/0009分割の安全性テスト
(Issue #40 Phase 3 PR #42レビュー指摘対応)。

背景: PR #41のレビュー対応で、既にmainへmerge済み・本番DBへ適用済みの
`0008_estimate_rule_engine_foundation.sql` を直接書き換えて
`unit_price`/`unit_labor`列を追加してしまった。migrationは同一ファイル名
につき1度しか適用されない仕組み(`app/db/migrate.py`)のため、0008を既に
適用済みの環境(本番DB)にはこの変更が反映されず、
`GET/POST /api/products/{product_no}/estimate-results*` が
`no such column: unit_price` で500エラーになる不具合を引き起こした。

この教訓から、以下を明示的にテストする。
1. 0008が「まだunit_price/unit_laborを含まない内容」で適用済みのDBへ
   0009だけを適用すると、2列が追加され、以後の参照が正常に動作すること。
2. まっさらな新規DBへ0001〜0009を順に適用しても、最終スキーマが同じに
   なり、正常に動作すること(0008の時点で既に2列を含むため、0009は
   何もしない=冪等)。
3. schema_migrationsの履歴に0008・0009がそれぞれ1回のみ記録されること。
4. 0008の内容はPR #41でmainへmergeされた時点から一切変更されていない
   こと(=migrationファイルは一度mainへ入ったら書き換えない、という
   前提そのものをテストで固定する)。
"""
import hashlib
import sqlite3
from pathlib import Path

from app.config import MIGRATIONS_DIR
from app.db.connection import get_connection
from app.db.migrate import run_migrations
from app.repositories.estimate_results import list_results_for_product

# PR #41でmainへmergeされた時点の0008_estimate_rule_engine_foundation.sqlの
# 内容(改行コード差異を吸収するため、テキストとして読み込んでからハッシュ化
# する)のsha256。この値は「mainへ入った後は不変」であるべき0008の内容を
# 固定するためのものであり、意図的な内容変更以外でこのテストが落ちた場合、
# 0008を書き換えてしまっていないか疑うこと。スキーマ変更が必要な場合は、
# 0008を編集するのではなく新しい連番migrationファイルを追加すること。
_0008_FROZEN_SHA256 = "fed3cf260f98e4a8a8a9839b1648efad26d430f862b683144cacbc1438ff91d1"


def _hash_text_file(path: Path) -> str:
    return hashlib.sha256(path.read_text(encoding="utf-8").encode("utf-8")).hexdigest()


def test_0008_content_is_frozen_since_pr41_merge():
    """0008の内容がPR #41でmainへmergeされた時点から変更されていないことを
    固定する(要件4: migrationファイルは一度mainへ入ったら書き換えない)。"""
    path = MIGRATIONS_DIR / "0008_estimate_rule_engine_foundation.sql"
    assert _hash_text_file(path) == _0008_FROZEN_SHA256, (
        "0008_estimate_rule_engine_foundation.sqlの内容が変更されています。"
        "既にmainへ入ったmigrationファイルは書き換えず、"
        "新しい連番migrationファイルを追加してください。"
    )
    # 0008自体は既にunit_price/unit_laborを含む(PR #41でmainへmergeされた
    # 時点の内容そのもの)。
    content = path.read_text(encoding="utf-8")
    assert "unit_price REAL" in content
    assert "unit_labor REAL" in content


def _apply_legacy_0008_without_unit_price_labor(conn: sqlite3.Connection) -> None:
    """0008が本番DBへ最初に適用された時点(unit_price/unit_labor追加前)の
    内容を再現する。別途ハードコードしたスキーマを保守しないよう、現在の
    (frozenな)0008ファイルから該当2列の定義行だけを取り除いて実行する。"""
    script = (MIGRATIONS_DIR / "0008_estimate_rule_engine_foundation.sql").read_text(encoding="utf-8")
    legacy_script = script.replace("    unit_price REAL,\n    unit_labor REAL,\n", "")
    # コメント中の"unit_price"言及(価格計算式の説明)は残ってよい。列定義
    # そのものが取り除けていることだけを確認する。
    assert "unit_price REAL" not in legacy_script, "legacy 0008の再現に失敗しています(削除できていない)"
    conn.executescript(legacy_script)


def _apply_migrations_up_to_0007(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    for sql_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if sql_file.name >= "0008":
            continue
        conn.executescript(sql_file.read_text(encoding="utf-8"))
        conn.execute("INSERT INTO schema_migrations (filename) VALUES (?)", (sql_file.name,))


def test_0009_alone_adds_columns_to_a_db_where_0008_was_applied_without_them(tmp_path):
    """要件1: 0008が(本番DBのように)unit_price/unit_labor無しの内容で
    適用済みのDBへ0009だけを適用すると、2列が追加され、
    estimate-results参照が正常に動作すること。"""
    db_path = tmp_path / "legacy_0008.db"
    with get_connection(db_path) as conn:
        _apply_migrations_up_to_0007(conn)
        _apply_legacy_0008_without_unit_price_labor(conn)
        conn.execute(
            "INSERT INTO schema_migrations (filename) VALUES (?)",
            ("0008_estimate_rule_engine_foundation.sql",),
        )
        columns_before = {row[1] for row in conn.execute("PRAGMA table_info(estimate_results)").fetchall()}
        assert "unit_price" not in columns_before
        assert "unit_labor" not in columns_before

    applied = run_migrations(db_path)
    # [Issue #40 Phase 6-A] 0010新設により、legacy 0008からの追いつき適用では
    # 0009に続けて0010も未適用のため、この1回のrun_migrations()呼び出しで
    # 両方とも順に適用される。
    assert applied == [
        "0009_estimate_results_unit_price_labor.py",
        "0010_estimate_confirmation_result_snapshot.py",
    ]

    with get_connection(db_path) as conn:
        columns_after = {row[1] for row in conn.execute("PRAGMA table_info(estimate_results)").fetchall()}
        assert "unit_price" in columns_after
        assert "unit_labor" in columns_after

        # PR #42発見の不具合そのもの: このクエリが `no such column: unit_price`
        # で例外を投げないことを確認する(修正前はここで500エラーになっていた)。
        results = list_results_for_product(conn, product_no="A1GV2421")
        assert results == []


def test_fresh_db_applies_0001_through_0009_in_order_with_final_schema_correct(tmp_path):
    """要件2: まっさらな新規DBへ0001〜0009を順に適用しても、最終スキーマが
    正常になり(0008の時点で既にunit_price/unit_laborを含むため0009は
    冪等に何もしない)、正常に動作すること。"""
    db_path = tmp_path / "fresh.db"
    applied = run_migrations(db_path)

    assert "0008_estimate_rule_engine_foundation.sql" in applied
    assert "0009_estimate_results_unit_price_labor.py" in applied
    assert applied.index("0008_estimate_rule_engine_foundation.sql") < applied.index(
        "0009_estimate_results_unit_price_labor.py"
    )

    with get_connection(db_path) as conn:
        columns = [row[1] for row in conn.execute("PRAGMA table_info(estimate_results)").fetchall()]
        # 重複ALTER TABLEでエラーになっていないこと(=列が重複していないこと)。
        assert columns.count("unit_price") == 1
        assert columns.count("unit_labor") == 1

        results = list_results_for_product(conn, product_no="A1GV2421")
        assert results == []


def test_schema_migrations_records_0008_and_0009_exactly_once_each(tmp_path):
    """要件3: schema_migrationsの履歴に0008・0009がそれぞれ1回のみ
    記録されること(新規DB・legacy 0008からの追いつき適用の両方で確認する)。"""
    fresh_db = tmp_path / "fresh.db"
    run_migrations(fresh_db)
    with get_connection(fresh_db) as conn:
        for filename in (
            "0008_estimate_rule_engine_foundation.sql",
            "0009_estimate_results_unit_price_labor.py",
        ):
            count = conn.execute(
                "SELECT COUNT(*) FROM schema_migrations WHERE filename = ?", (filename,)
            ).fetchone()[0]
            assert count == 1, f"{filename}がschema_migrationsに{count}回記録されている"
    # 2回目の実行は何も適用しない(重複記録が発生しないことの確認)。
    assert run_migrations(fresh_db) == []

    legacy_db = tmp_path / "legacy_0008.db"
    with get_connection(legacy_db) as conn:
        _apply_migrations_up_to_0007(conn)
        _apply_legacy_0008_without_unit_price_labor(conn)
        conn.execute(
            "INSERT INTO schema_migrations (filename) VALUES (?)",
            ("0008_estimate_rule_engine_foundation.sql",),
        )
    run_migrations(legacy_db)
    with get_connection(legacy_db) as conn:
        for filename in (
            "0008_estimate_rule_engine_foundation.sql",
            "0009_estimate_results_unit_price_labor.py",
        ):
            count = conn.execute(
                "SELECT COUNT(*) FROM schema_migrations WHERE filename = ?", (filename,)
            ).fetchone()[0]
            assert count == 1, f"{filename}がschema_migrationsに{count}回記録されている"
