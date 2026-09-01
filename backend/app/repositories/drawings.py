import sqlite3

from app.domain.models import DrawingPage, DrawingPageSourceType

_COLUMNS = """
    id, drawing_file_id, page_no, drawing_type, drawing_name,
    thumbnail_url, image_url, page_width, page_height, display_order,
    source_type, product_no, source_page_no
"""


def _row_to_page(row: sqlite3.Row) -> DrawingPage:
    return DrawingPage(
        id=row["id"],
        drawing_file_id=row["drawing_file_id"],
        page_no=row["page_no"],
        drawing_type=row["drawing_type"],
        drawing_name=row["drawing_name"],
        thumbnail_url=row["thumbnail_url"],
        image_url=row["image_url"],
        page_width=row["page_width"],
        page_height=row["page_height"],
        display_order=row["display_order"],
        source_type=DrawingPageSourceType(row["source_type"]),
        product_no=row["product_no"],
        source_page_no=row["source_page_no"],
    )


def list_drawing_pages(conn: sqlite3.Connection) -> list[DrawingPage]:
    rows = conn.execute(
        f"""
        SELECT {_COLUMNS}
        FROM drawing_pages
        ORDER BY drawing_type, display_order, page_no
        """
    ).fetchall()
    return [_row_to_page(r) for r in rows]


def get_drawing_page(conn: sqlite3.Connection, page_id: int) -> DrawingPage | None:
    row = conn.execute(
        f"SELECT {_COLUMNS} FROM drawing_pages WHERE id = ?",
        (page_id,),
    ).fetchone()
    return _row_to_page(row) if row else None
