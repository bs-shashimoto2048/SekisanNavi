"""system_settings テーブルの読み書き。

管理者パスワード等の認証情報はここでは扱わない (config.ADMIN_PASSWORD / 環境変数)。
値は文字列のみを保持する単純なkey-valueストアとする。
"""
import sqlite3

from app.config import DEFAULT_DATA_SOURCE_ROOT

DATA_SOURCE_ROOT_KEY = "data_source_root"


def get_setting(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute(
        "SELECT value FROM system_settings WHERE key = ?", (key,)
    ).fetchone()
    return row["value"] if row else None


def set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        """
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
        """,
        (key, value),
    )


def get_data_source_root(conn: sqlite3.Connection) -> str:
    """データ参照ルートを取得する。

    未設定の場合は初期値 (config.DEFAULT_DATA_SOURCE_ROOT) をDBへ登録した上で返す
    (要件14: 初回起動時に初期値を登録してよい)。以降はDBの値のみを参照する。
    """
    value = get_setting(conn, DATA_SOURCE_ROOT_KEY)
    if value is None:
        set_setting(conn, DATA_SOURCE_ROOT_KEY, DEFAULT_DATA_SOURCE_ROOT)
        return DEFAULT_DATA_SOURCE_ROOT
    return value


def set_data_source_root(conn: sqlite3.Connection, value: str) -> None:
    set_setting(conn, DATA_SOURCE_ROOT_KEY, value)
