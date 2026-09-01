import sqlite3

from app.domain.models import AttributeSource, Panel, PanelAttribute


def _load_attributes(conn: sqlite3.Connection, panel_id: int) -> list[PanelAttribute]:
    rows = conn.execute(
        """
        SELECT id, panel_id, key, label, value, unit, source, display_order
        FROM panel_attributes
        WHERE panel_id = ?
        ORDER BY display_order
        """,
        (panel_id,),
    ).fetchall()
    return [
        PanelAttribute(
            id=r["id"],
            panel_id=r["panel_id"],
            key=r["key"],
            label=r["label"],
            value=r["value"],
            unit=r["unit"],
            source=AttributeSource(r["source"]),
            display_order=r["display_order"],
        )
        for r in rows
    ]


def _row_to_panel(conn: sqlite3.Connection, row: sqlite3.Row) -> Panel:
    return Panel(
        id=row["id"],
        panel_no=row["panel_no"],
        name=row["name"],
        primary_drawing_page_id=row["primary_drawing_page_id"],
        attributes=_load_attributes(conn, row["id"]),
    )


def list_panels(conn: sqlite3.Connection) -> list[Panel]:
    rows = conn.execute(
        "SELECT id, panel_no, name, primary_drawing_page_id FROM panels ORDER BY id"
    ).fetchall()
    return [_row_to_panel(conn, r) for r in rows]


def get_panel(conn: sqlite3.Connection, panel_id: int) -> Panel | None:
    row = conn.execute(
        "SELECT id, panel_no, name, primary_drawing_page_id FROM panels WHERE id = ?",
        (panel_id,),
    ).fetchone()
    return _row_to_panel(conn, row) if row else None
