"""Persistence for selected main-circuit busbar rows."""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass


@dataclass(frozen=True)
class BusbarSelection:
    ban_menno: int
    row_id: str
    code: str
    factor: float


def list_selections(conn: sqlite3.Connection, product_no: str) -> list[BusbarSelection]:
    rows = conn.execute(
        """SELECT ban_menno, row_id, code, factor
           FROM estimate_busbar_selections WHERE product_no = ?
           ORDER BY ban_menno, row_id""",
        (product_no,),
    ).fetchall()
    return [BusbarSelection(**dict(row)) for row in rows]


def replace_face_selections(
    conn: sqlite3.Connection,
    *,
    product_no: str,
    ban_menno: int,
    selections: list[tuple[str, str, float]],
) -> None:
    conn.execute(
        "DELETE FROM estimate_busbar_selections WHERE product_no = ? AND ban_menno = ?",
        (product_no, ban_menno),
    )
    conn.executemany(
        """INSERT INTO estimate_busbar_selections
           (product_no, ban_menno, row_id, code, factor)
           VALUES (?, ?, ?, ?, ?)""",
        [(product_no, ban_menno, row_id, code, factor) for row_id, code, factor in selections],
    )
