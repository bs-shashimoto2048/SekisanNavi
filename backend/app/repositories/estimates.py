import sqlite3

from app.domain.models import (
    EstimateItem,
    EstimateReference,
    EstimateSourceType,
    EstimateStatus,
)


def _load_references(conn: sqlite3.Connection, estimate_item_id: int) -> list[EstimateReference]:
    rows = conn.execute(
        """
        SELECT id, estimate_item_id, drawing_page_id, detection_id, panel_id, reason
        FROM estimate_references
        WHERE estimate_item_id = ?
        ORDER BY id
        """,
        (estimate_item_id,),
    ).fetchall()
    return [
        EstimateReference(
            id=r["id"],
            estimate_item_id=r["estimate_item_id"],
            drawing_page_id=r["drawing_page_id"],
            detection_id=r["detection_id"],
            panel_id=r["panel_id"],
            reason=r["reason"],
        )
        for r in rows
    ]


def _row_to_item(conn: sqlite3.Connection, row: sqlite3.Row) -> EstimateItem:
    return EstimateItem(
        id=row["id"],
        code=row["code"],
        category=row["category"],
        item_name=row["item_name"],
        model=row["model"],
        rating=row["rating"],
        quantity=row["quantity"],
        unit=row["unit"],
        source_type=EstimateSourceType(row["source_type"]),
        confidence=row["confidence"],
        status=EstimateStatus(row["status"]),
        references=_load_references(conn, row["id"]),
    )


def list_estimate_items(conn: sqlite3.Connection) -> list[EstimateItem]:
    rows = conn.execute(
        """
        SELECT id, code, category, item_name, model, rating, quantity, unit,
               source_type, confidence, status
        FROM estimate_items
        ORDER BY category, code
        """
    ).fetchall()
    return [_row_to_item(conn, r) for r in rows]
