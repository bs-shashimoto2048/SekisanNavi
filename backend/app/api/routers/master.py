import sqlite3

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_db
from app.repositories.master import list_copper_bus_code_options, list_master_items
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


@router.get("/copper-bus-code-options", response_model=list[EstimateMasterItemOut])
def read_copper_bus_code_options(
    conn: sqlite3.Connection = Depends(get_db),
) -> list[EstimateMasterItemOut]:
    """主回路銅帯コード選択UI(部品台帳、Issue #40 Phase 6-H)向け。

    仕様区分(品名)→型式→定格→コードの順に絞り込むためのmaster item候補
    一覧を返す(`q`/`category`等の絞り込みはFrontend側で行う)。このコード
    選択操作は、BBox追加対象の選択・積算確定のいずれにも連動しない
    (`list_master_items`/`get_master_item`経由の既存経路は一切変更しない)。
    """
    return [
        EstimateMasterItemOut(**m.__dict__) for m in list_copper_bus_code_options(conn)
    ]
