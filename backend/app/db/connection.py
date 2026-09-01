"""SQLite接続ヘルパー。

PoCではSQLAlchemy等は導入せず、標準ライブラリのsqlite3を薄くラップするに留める。
Domain層・Repository層のテスト容易性を優先し、接続はこのモジュールに集約する。
"""
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from app.config import DB_PATH


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    # check_same_thread=False: FastAPIの同期(def)依存関係・エンドポイントは
    # run_in_threadpool経由でスレッドプールへ委譲される。1リクエストの中でも
    # 依存関係の生成(get_db)とエンドポイント本体の実行が異なるプールスレッドに
    # 割り当てられる場合があり、既定 (check_same_thread=True) のままだと
    # 「SQLite objects created in a thread can only be used in that same thread」
    # というProgrammingErrorが不定期に発生する (実機確認で再現・特定済み)。
    # 各リクエストは専用に新規接続を作成し(このモジュールの外で使い回さない)、
    # 同一接続を複数スレッドから "同時に" 使うことはないため、
    # check_same_thread=False によりスレッド跨ぎのハンドオフのみを許可する。
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def get_connection(db_path: Path = DB_PATH):
    """withブロック内でコネクションを使うためのコンテキストマネージャ。"""
    conn = _connect(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
