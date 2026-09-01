"""実データ参照API (Phase 1.5、Phase 1.8で製番検索・サムネイル・盤領域を追加)。

製番・図面参照はユーザー認証不要 (要件18: 通常の製番・図面参照に管理者パスワードは
不要)。ただしパスの安全性検証は必ずBackendで行う (app.services.data_source)。
"""
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from app.api.deps import get_db
from app.repositories.system_settings import get_data_source_root
from app.schemas.settings import (
    NormalizedRectOut,
    PanelPreviewOut,
    ProductDrawingOut,
    ProductInfoOut,
    ProductSearchOut,
)
from app.services.data_source import (
    DEFAULT_PRODUCT_SEARCH_LIMIT,
    DataSourceError,
    InvalidProductNo,
    PageNotFound,
    ProductNotFound,
    RootUnavailable,
    list_page_numbers,
    resolve_page_file,
    resolve_product_dir,
    search_product_dirs,
)
from app.services.product_df import load_product_df

router = APIRouter(prefix="/api/products", tags=["products"])


def _error_to_http(e: DataSourceError) -> HTTPException:
    if isinstance(e, InvalidProductNo):
        return HTTPException(status_code=400, detail=e.message)
    if isinstance(e, ProductNotFound):
        return HTTPException(status_code=404, detail=e.message)
    if isinstance(e, PageNotFound):
        return HTTPException(status_code=404, detail=e.message)
    if isinstance(e, RootUnavailable):
        return HTTPException(status_code=503, detail=e.message)
    return HTTPException(status_code=400, detail=e.message)


@router.get("/search", response_model=ProductSearchOut)
def search_products(
    q: str = Query(min_length=1, max_length=20, description="製番の前方一致検索文字列"),
    limit: int = Query(default=DEFAULT_PRODUCT_SEARCH_LIMIT, ge=1, le=50),
    conn: sqlite3.Connection = Depends(get_db),
) -> ProductSearchOut:
    """製番の前方一致候補検索 (要件2/3)。ルート直下を全件返すことはしない。"""
    root = get_data_source_root(conn)
    try:
        matches, truncated = search_product_dirs(root, q, limit)
    except DataSourceError as e:
        raise _error_to_http(e) from e
    return ProductSearchOut(matches=matches, truncated=truncated)


@router.get("/{product_no}", response_model=ProductInfoOut)
def read_product(
    product_no: str, conn: sqlite3.Connection = Depends(get_db)
) -> ProductInfoOut:
    root = get_data_source_root(conn)
    try:
        resolution = resolve_product_dir(root, product_no)
    except DataSourceError as e:
        raise _error_to_http(e) from e
    return ProductInfoOut(
        product_no=resolution.product_no,
        exists=True,
        ccv_resolved=resolution.ccv_resolved,
    )


@router.get("/{product_no}/drawings", response_model=list[ProductDrawingOut])
def read_product_drawings(
    product_no: str, conn: sqlite3.Connection = Depends(get_db)
) -> list[ProductDrawingOut]:
    """製番配下のページ一覧を、左ペインのPNGサムネイル表示用に整形して返す (Phase 1.8)。

    Frontendへはproduct_df.csvの生データをそのまま渡さず、ページごとに
    「サムネイルURL・図面種別・盤領域一覧」へ整形したモデルを返す (指示書28章)。
    """
    root = get_data_source_root(conn)
    try:
        resolution = resolve_product_dir(root, product_no)
        pages = list_page_numbers(resolution.ccv_dir)
    except DataSourceError as e:
        raise _error_to_http(e) from e

    df_result = load_product_df(resolution.ccv_dir, resolution.product_no)

    return [
        ProductDrawingOut(
            page_no=p,
            thumbnail_url=f"/api/products/{resolution.product_no}/drawings/{p}/thumbnail",
            drawing_type=df_result.drawing_type_by_page.get(p),
            drawing_name=df_result.drawing_name_by_page.get(p),
            panels=[
                PanelPreviewOut(
                    page_no=panel.page_no,
                    ban_menno=panel.ban_menno,
                    ban_no=panel.ban_no,
                    ban_meisyou=panel.ban_meisyou,
                    ban_type=panel.ban_type,
                    ban_h1=panel.ban_h1,
                    ban_h2=panel.ban_h2,
                    ban_w=panel.ban_w,
                    ban_d=panel.ban_d,
                    normalized_rect=NormalizedRectOut(
                        x=panel.normalized_rect.x,
                        y=panel.normalized_rect.y,
                        w=panel.normalized_rect.w,
                        h=panel.normalized_rect.h,
                    ),
                )
                for panel in df_result.panels_by_page.get(p, [])
            ],
        )
        for p in pages
    ]


@router.get("/{product_no}/drawings/{page_no}/file")
def read_product_drawing_file(
    product_no: str, page_no: int, conn: sqlite3.Connection = Depends(get_db)
):
    root = get_data_source_root(conn)
    try:
        resolution = resolve_product_dir(root, product_no)
        file_path = resolve_page_file(resolution.ccv_dir, page_no, extension="pdf")
    except DataSourceError as e:
        raise _error_to_http(e) from e
    return FileResponse(str(file_path), media_type="application/pdf")


@router.get("/{product_no}/drawings/{page_no}/thumbnail")
def read_product_drawing_thumbnail(
    product_no: str, page_no: int, conn: sqlite3.Connection = Depends(get_db)
):
    """左ペインサムネイル用のPNG画像配信 (Phase 1.8, 要件8)。

    `{page_no}.png` を安全なパス解決の上でそのまま配信する。任意のファイルパスを
    クエリ等で受け取る形式にはしていない (page_noはintパスパラメータのみ)。
    """
    root = get_data_source_root(conn)
    try:
        resolution = resolve_product_dir(root, product_no)
        file_path = resolve_page_file(resolution.ccv_dir, page_no, extension="png")
    except DataSourceError as e:
        raise _error_to_http(e) from e
    return FileResponse(str(file_path), media_type="image/png")
