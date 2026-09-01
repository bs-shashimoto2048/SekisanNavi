import sqlite3

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_db
from app.repositories.master import list_master_items
from app.schemas.common import EstimateMasterItemOut

router = APIRouter(prefix="/api/master-items", tags=["master"])


@router.get("", response_model=list[EstimateMasterItemOut])
def read_master_items(
    q: str | None = Query(default=None, description="コード/品名/型式の部分一致検索"),
    category: str | None = Query(default=None, description="品名(カテゴリ)での絞り込み"),
    conn: sqlite3.Connection = Depends(get_db),
) -> list[EstimateMasterItemOut]:
    return [
        EstimateMasterItemOut(**m.__dict__) for m in list_master_items(conn, q, category)
    ]
