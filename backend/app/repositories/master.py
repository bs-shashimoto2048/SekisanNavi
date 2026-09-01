import sqlite3

from app.domain.master_categories import ALLOWED_CATEGORIES
from app.domain.models import EstimateMasterItem

_COLUMNS = """
    id, code, category, model, rating, note,
    total_price_a, box_parts_price, painting_price, setup_a,
    sheet_metal_price, assembly_price, inspection_price
"""

# 品名(category)の表示順を、Excel出現順や五十音順ではなく業務指定の固定順にする
# (`master_categories.ALLOWED_CATEGORIES` が唯一の参照元。Frontendへ順序を
# 別途ハードコードしない — Frontendは本APIが返す順序をそのまま使う)。
# Master Importerが対象13品名以外を取り込まないため、実質的にCASE式のELSEに
# 落ちる行は存在しない想定だが、念のため末尾に回すフォールバックを用意する。
_CATEGORY_ORDER_SQL = "CASE category " + " ".join(
    f"WHEN ? THEN {i}" for i in range(len(ALLOWED_CATEGORIES))
) + f" ELSE {len(ALLOWED_CATEGORIES)} END"


def _row_to_master_item(row: sqlite3.Row) -> EstimateMasterItem:
    return EstimateMasterItem(
        id=row["id"],
        code=row["code"],
        category=row["category"],
        model=row["model"],
        rating=row["rating"],
        note=row["note"],
        total_price_a=row["total_price_a"],
        box_parts_price=row["box_parts_price"],
        painting_price=row["painting_price"],
        setup_a=row["setup_a"],
        sheet_metal_price=row["sheet_metal_price"],
        assembly_price=row["assembly_price"],
        inspection_price=row["inspection_price"],
    )


def list_master_items(
    conn: sqlite3.Connection, query: str | None = None, category: str | None = None
) -> list[EstimateMasterItem]:
    sql = f"""
        SELECT {_COLUMNS}
        FROM estimate_master_items
        WHERE 1 = 1
    """
    params: list[str] = []
    if category:
        sql += " AND category = ?"
        params.append(category)
    if query:
        sql += " AND (code LIKE ? OR model LIKE ? OR rating LIKE ?)"
        like = f"%{query}%"
        params.extend([like, like, like])
    sql += f" ORDER BY {_CATEGORY_ORDER_SQL}, code"
    # ORDER BY句のCASE式に渡すプレースホルダは、WHERE句のパラメータの後に
    # SQL文中に出現するため、paramsリストの末尾へ同じ順序で追加する。
    order_params = [*params, *ALLOWED_CATEGORIES]
    rows = conn.execute(sql, order_params).fetchall()
    return [_row_to_master_item(r) for r in rows]


def get_master_item(conn: sqlite3.Connection, master_item_id: int) -> EstimateMasterItem | None:
    row = conn.execute(
        f"SELECT {_COLUMNS} FROM estimate_master_items WHERE id = ?",
        (master_item_id,),
    ).fetchone()
    return _row_to_master_item(row) if row else None
