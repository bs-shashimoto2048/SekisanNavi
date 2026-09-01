import sqlite3
from collections.abc import Iterator

from app.db.connection import get_connection


def get_db() -> Iterator[sqlite3.Connection]:
    with get_connection() as conn:
        yield conn
