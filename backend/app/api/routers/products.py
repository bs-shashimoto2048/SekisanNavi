"""実データ参照API (Phase 1.5、Phase 1.8で製番検索・サムネイル・盤領域を追加)。

製番・図面参照はユーザー認証不要 (要件18: 通常の製番・図面参照に管理者パスワードは
不要)。ただしパスの安全性検証は必ずBackendで行う (app.services.data_source)。
"""
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from app.api.deps import get_db
from app.repositories.estimate_confirmations import save_confirmation
from app.repositories.system_settings import get_data_source_root
from app.schemas.estimate_confirmations import (
    EstimateConfirmationItemOut,
    EstimateConfirmationOut,
)
from app.schemas.settings import (
    DetectedPreviewItemOut,
    EstimatePanelInfoOut,
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
from app.services.detected_df import load_detected_df
from app.services.estcode_df import load_estcode_df
from app.services.estimate_confirmation_builder import build_confirmation_items
from app.services.product_df import load_page_scales, load_product_df

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


@router.get(
    "/{product_no}/drawings/{page_no}/detected-preview",
    response_model=list[DetectedPreviewItemOut],
)
def read_detected_preview(
    product_no: str, page_no: int, conn: sqlite3.Connection = Depends(get_db)
) -> list[DetectedPreviewItemOut]:
    """`detected_df.csv` (YOLO検出結果、実行済み推論の出力) のうち、指定ページに
    該当する検出結果のみを正規化して返す (Phase 1.12指示書25章)。

    Frontendへは任意のファイルパスを渡させず、page_no (intパスパラメータ) のみで
    引く。`detected_df.csv`自体が製番フォルダに存在しない、または該当ページの
    検出結果が無い場合もエラーにはせず、空配列を返す (指示書26章/27章:
    図面Viewer自体は使用可能なままにする)。
    """
    root = get_data_source_root(conn)
    try:
        resolution = resolve_product_dir(root, product_no)
    except DataSourceError as e:
        raise _error_to_http(e) from e

    page_scales = load_page_scales(resolution.ccv_dir)
    detected_result = load_detected_df(resolution.ccv_dir, resolution.product_no, page_scales)

    return [
        DetectedPreviewItemOut(
            id=item.yolo_index,
            page_no=item.page_no,
            class_name=item.device,
            confidence=item.score,
            normalized_rect=NormalizedRectOut(
                x=item.normalized_rect.x,
                y=item.normalized_rect.y,
                w=item.normalized_rect.w,
                h=item.normalized_rect.h,
            ),
        )
        for item in detected_result.items_by_page.get(page_no, [])
    ]


@router.get("/{product_no}/estimate-panels", response_model=list[EstimatePanelInfoOut])
def read_estimate_panels(
    product_no: str, conn: sqlite3.Connection = Depends(get_db)
) -> list[EstimatePanelInfoOut]:
    """`estcode_df.csv` (盤ごとの積算コード基本情報) を製番単位で全件返す
    (Phase 1.14指示書25章)。PAGE列を持たないデータのため、ページ番号は
    受け取らない。Frontend側で選択中盤のBAN_MENNO/BAN_NOと突き合わせて使う。

    `estcode_df.csv`自体が製番フォルダに存在しない場合もエラーにはせず、
    空配列を返す(指示書14章相当)。
    """
    root = get_data_source_root(conn)
    try:
        resolution = resolve_product_dir(root, product_no)
    except DataSourceError as e:
        raise _error_to_http(e) from e

    result = load_estcode_df(resolution.ccv_dir, resolution.product_no)

    return [
        EstimatePanelInfoOut(
            model=panel.model,
            ban_menno=panel.ban_menno,
            ban_no=panel.ban_no,
            ban_meisyou=panel.ban_meisyou,
            ban_h=panel.ban_h,
            ban_w=panel.ban_w,
            ban_d=panel.ban_d,
            ban_connect=panel.ban_connect,
            sort_order=panel.sort_order,
        )
        for panel in result.panels
    ]


@router.post(
    "/{product_no}/estimate-confirmations",
    response_model=EstimateConfirmationOut,
    status_code=201,
)
def create_estimate_confirmation(
    product_no: str, conn: sqlite3.Connection = Depends(get_db)
) -> EstimateConfirmationOut:
    """製番`product_no`の現在の積算結果を丸ごと確定snapshotとして保存する
    (Issue #4 Phase B-2)。

    リクエストボディは受け取らない。Frontendから計算済みの値を信頼して
    そのまま保存するのではなく、この時点の`detections`(DB)×
    `estimate_master_items`(DB)×`product_df.csv`/`estcode_df.csv`
    (都度読み込み)から、Backend自身が`build_confirmation_items()`で
    Frontend `estimateAggregationReal.ts`と同じ対象所属判定ロジックを使って
    組み立てる(Issue #4最新コメントの方針)。

    保存はDetection単位(積算明細相当)の粒度で行い、対象別・総合計の集約は
    保存しない(`docs/decision-snapshot-design.md` 4章。読み出しAPIを
    追加した際に、保存済みの明細から同じ考え方で再現する想定)。

    対応するダミーDrawingPage行が無い実製番(Phase 1.8以降の既存の制約。
    `docs/data-model.md`参照)や、積算コードに紐づくDetectionが1件も無い
    製番でも、明細0件のconfirmationとして保存できる(**0件確定を許容する**。
    「対象データが無いこと」自体も、その時点の事実として記録する価値があり、
    かつPhase B-1のrepository層は既にこれを許容する設計であるため、API層で
    追加の禁止ルールを設けない)。

    同時実行/transaction境界: 既存の他の書き込みAPIと同じく、この
    エンドポイントも`get_db`依存関係が提供する「1リクエスト=1トランザクション」
    の接続をそのまま使う。`build_confirmation_items()`(読み取りのみ)から
    `save_confirmation()`(header+明細行のINSERT)までを同一トランザクション内で
    実行し、途中で例外が発生した場合は`get_connection()`がロールバックする
    (Phase B-1の`save_confirmation()`自体のtransaction保証をそのまま利用する。
    新しいtransaction管理コードは追加していない)。
    """
    root = get_data_source_root(conn)
    try:
        items = build_confirmation_items(conn, root, product_no)
    except DataSourceError as e:
        raise _error_to_http(e) from e

    confirmation = save_confirmation(conn, product_no=product_no, items=items)

    return EstimateConfirmationOut(
        id=confirmation.id,
        product_no=confirmation.product_no,
        confirmed_at=confirmation.confirmed_at,
        item_count=len(confirmation.items),
        items=[EstimateConfirmationItemOut(**item.__dict__) for item in confirmation.items],
    )
