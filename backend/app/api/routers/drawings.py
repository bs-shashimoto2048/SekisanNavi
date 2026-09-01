import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.api.deps import get_db
from app.domain.models import DrawingPageSourceType
from app.repositories.drawings import get_drawing_page, list_drawing_pages
from app.repositories.system_settings import get_data_source_root
from app.schemas.common import DrawingPageOut
from app.services.data_source import DataSourceError, resolve_page_file, resolve_product_dir

router = APIRouter(prefix="/api/drawing-pages", tags=["drawings"])


@router.get("", response_model=list[DrawingPageOut])
def read_drawing_pages(conn: sqlite3.Connection = Depends(get_db)) -> list[DrawingPageOut]:
    return [DrawingPageOut(**p.__dict__) for p in list_drawing_pages(conn)]


@router.get("/{page_id}", response_model=DrawingPageOut)
def read_drawing_page(
    page_id: int, conn: sqlite3.Connection = Depends(get_db)
) -> DrawingPageOut:
    page = get_drawing_page(conn, page_id)
    if page is None:
        raise HTTPException(status_code=404, detail="drawing page not found")
    return DrawingPageOut(**page.__dict__)


@router.get("/{page_id}/file")
def read_drawing_page_file(page_id: int, conn: sqlite3.Connection = Depends(get_db)):
    """図面ページの実PDFファイルを返す (Phase 1.5)。

    source_type='product_file' の場合のみ、データ参照ルート配下から実ファイルを
    read-onlyで読み取って返す。'placeholder' の場合は実ファイルが存在しないため
    404 を返す (Frontend側はこれを見てプレースホルダー描画に切り替える)。
    """
    page = get_drawing_page(conn, page_id)
    if page is None:
        raise HTTPException(status_code=404, detail="drawing page not found")
    if page.source_type != DrawingPageSourceType.PRODUCT_FILE:
        raise HTTPException(status_code=404, detail="この図面には実ファイルが関連付けられていません。")
    if not page.product_no or not page.source_page_no:
        raise HTTPException(status_code=500, detail="図面の参照先情報が不正です。")

    root = get_data_source_root(conn)
    try:
        resolution = resolve_product_dir(root, page.product_no)
        file_path = resolve_page_file(resolution.ccv_dir, page.source_page_no)
    except DataSourceError as e:
        raise HTTPException(status_code=503, detail=e.message) from e

    return FileResponse(str(file_path), media_type="application/pdf")
