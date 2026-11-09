"""箱コードの手修正(製番×面番号×盤番号に1件)の保存。

`estimate_results`は評価のたびに作り直される現在状態であり、手修正をそこだけに置くと
再評価で失われる。そのため手修正は独立テーブル`estimate_box_overrides`を正本とし、
評価器(`app.services.box_code_candidates`)が候補生成時に読んで反映する。
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass


@dataclass
class BoxOverride:
    product_no: str
    ban_menno: int
    ban_no: int
    master_item_id: int
    reason: str | None
    updated_by: str | None


def _row(row: sqlite3.Row) -> BoxOverride:
    return BoxOverride(
        product_no=row["product_no"],
        ban_menno=row["ban_menno"],
        ban_no=row["ban_no"],
        master_item_id=row["master_item_id"],
        reason=row["reason"],
        updated_by=row["updated_by"],
    )


def list_box_overrides(conn: sqlite3.Connection, product_no: str) -> dict[tuple[int, int], BoxOverride]:
    rows = conn.execute(
        "SELECT product_no, ban_menno, ban_no, master_item_id, reason, updated_by "
        "FROM estimate_box_overrides WHERE product_no = ?",
        (product_no,),
    ).fetchall()
    return {(r["ban_menno"], r["ban_no"]): _row(r) for r in rows}


def set_box_override(
    conn: sqlite3.Connection,
    *,
    product_no: str,
    ban_menno: int,
    ban_no: int,
    master_item_id: int,
    reason: str | None = None,
    updated_by: str | None = None,
) -> None:
    """同じ盤の手修正は常に1件。再選択は置き換える(2件目を追加しない)。"""
    conn.execute(
        """
        INSERT INTO estimate_box_overrides
            (product_no, ban_menno, ban_no, master_item_id, reason, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(product_no, ban_menno, ban_no) DO UPDATE SET
            master_item_id = excluded.master_item_id,
            reason = excluded.reason,
            updated_by = excluded.updated_by,
            updated_at = datetime('now')
        """,
        (product_no, ban_menno, ban_no, master_item_id, reason, updated_by),
    )


def delete_box_override(conn: sqlite3.Connection, *, product_no: str, ban_menno: int, ban_no: int) -> bool:
    cur = conn.execute(
        "DELETE FROM estimate_box_overrides WHERE product_no = ? AND ban_menno = ? AND ban_no = ?",
        (product_no, ban_menno, ban_no),
    )
    return cur.rowcount > 0
