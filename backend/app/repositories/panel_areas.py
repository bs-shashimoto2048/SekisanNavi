import sqlite3

from app.domain.models import PanelArea


def _row_to_area(row: sqlite3.Row) -> PanelArea:
    return PanelArea(
        id=row["id"],
        panel_id=row["panel_id"],
        drawing_page_id=row["drawing_page_id"],
        area_x=row["area_x"],
        area_y=row["area_y"],
        area_w=row["area_w"],
        area_h=row["area_h"],
        label=row["label"],
    )


def list_panel_areas(
    conn: sqlite3.Connection, drawing_page_id: int | None = None
) -> list[PanelArea]:
    if drawing_page_id is not None:
        rows = conn.execute(
            """
            SELECT id, panel_id, drawing_page_id, area_x, area_y, area_w, area_h, label
            FROM panel_areas WHERE drawing_page_id = ?
            ORDER BY id
            """,
            (drawing_page_id,),
        ).fetchall()
    else:
        rows = conn.execute(
            """
            SELECT id, panel_id, drawing_page_id, area_x, area_y, area_w, area_h, label
            FROM panel_areas ORDER BY id
            """
        ).fetchall()
    return [_row_to_area(r) for r in rows]
