"""実データ参照API (Phase 1.5、Phase 1.8で製番検索・サムネイル・盤領域を追加)。

製番・図面参照はユーザー認証不要 (要件18: 通常の製番・図面参照に管理者パスワードは
不要)。ただしパスの安全性検証は必ずBackendで行う (app.services.data_source)。
"""
import logging
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from app import config
from app.api.deps import get_db
from app.repositories.decision_analysis import (
    list_confirmation_analysis_for_product,
    list_detection_summaries_for_product,
    summarize_events_for_product,
)
from app.repositories.decision_events import list_events_for_product
from app.repositories.estimate_confirmations import (
    get_confirmation,
    list_confirmations,
    save_confirmation,
)
from app.repositories.system_settings import get_data_source_root
from app.schemas.decision_analysis import (
    DecisionAnalysisConfirmationItemOut,
    DecisionAnalysisConfirmationOut,
    DecisionAnalysisDetectionSummaryOut,
    DecisionAnalysisMasterItemBreakdownOut,
    DecisionAnalysisSummaryOut,
)
from app.schemas.decision_events import DecisionEventOut
from app.schemas.estimate_confirmations import (
    EstimateConfirmationDetailOut,
    EstimateConfirmationEvidenceOut,
    EstimateConfirmationItemOut,
    EstimateConfirmationOut,
    EstimateConfirmationSummaryOut,
)
from app.schemas.settings import (
    DetectedPreviewItemOut,
    DesignDocumentOut,
    DesignPageOut,
    DesignPagesOut,
    EstimatePanelInfoOut,
    MaterialRowOut,
    NormalizedRectOut,
    PanelPreviewOut,
    ProductDrawingOut,
    ProductInfoOut,
    ProductSearchOut,
    SteelItemOut,
    SteelOutlineOut,
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
from app.services.design_pages import design_document_path, list_design_documents, load_design_pages
from app.services.detected_df import load_detected_df
from app.services.estcode_df import load_estcode_df
from app.services.material_csv import load_material_csv
from app.services.steel_outline import select_outline_steel
from app.services.estimate_confirmation_builder import (
    NeedsReviewResultsExistError,
    build_confirmation_items,
)
from app.services.product_df import load_page_scales, load_product_df

router = APIRouter(prefix="/api/products", tags=["products"])

# 旧隔離データの表示用プレビューPNG({PREVIEW_ROOT}/{製番}/{PDF名}__preview.png)の互換参照先。
# 新しい出力のPNGは製番フォルダ直下から読み、ここは旧配置のフォールバックとして使う。
PREVIEW_ROOT = config.PREVIEW_ROOT


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


def _confirmation_item_out(item) -> EstimateConfirmationItemOut:
    """`EstimateConfirmationItem`(dataclass)をAPIスキーマへ変換する。

    [Issue #40 Phase 6-A] `item.evidence`はdataclassのlistであり、Pydanticの
    `EstimateConfirmationItemOut(**item.__dict__)`という単純な展開では
    ネストしたBaseModelへ自動変換されない(dictまたは`EstimateConfirmation
    EvidenceOut`インスタンスのみ受け付けるため、dataclassインスタンスは
    バリデーションエラーになる)。そのため`evidence`だけ明示的に変換する。
    """
    data = {k: v for k, v in item.__dict__.items() if k != "evidence"}
    return EstimateConfirmationItemOut(
        **data,
        evidence=[EstimateConfirmationEvidenceOut(**ev.__dict__) for ev in item.evidence],
    )


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


def _safe_direct_child(root_dir: Path, filename: str) -> Path | None:
    """指定ディレクトリ直下の通常ファイルだけを返す。リンクと別階層への脱出を拒否する。"""
    try:
        root = root_dir.resolve(strict=False)
        raw = root_dir / filename
        if raw.is_symlink():
            return None
        path = raw.resolve(strict=False)
        if path.parent != root or not path.is_file():
            return None
    except (OSError, ValueError):
        return None
    return path


def _preview_png_for_key(ccv_dir: Path, product_no: str, key: str) -> Path | None:
    """PDFの表示用プレビューPNG。新しい出力は製番フォルダ直下、旧隔離プレビューはPREVIEW_ROOTから読む。
    キーは呼び出し側でPDF実在確認済みのものだけを渡す。"""
    local = _safe_direct_child(ccv_dir, f"{key}__preview.png")
    if local is not None:
        return local
    try:
        root = PREVIEW_ROOT.resolve(strict=False)
        product_dir = (root / product_no).resolve(strict=False)
        if product_dir.parent != root:
            return None
        return _safe_direct_child(product_dir, f"{key}__preview.png")
    except (OSError, ValueError):
        return None


def _document_preview_png(ccv_dir: Path, key: str) -> Path | None:
    """固定書類キーに対応し、対応PDFも実在するときだけ書類用PNGを返す。"""
    if design_document_path(ccv_dir, key) is None:
        return None
    return _safe_direct_child(ccv_dir, f"{key}__preview.png")


def _inference_png_for_key(ccv_dir: Path, key: str) -> Path | None:
    """推論用PNG(`{キー}.png`)。リンク自体を拒否し、解決後のパスが製番ディレクトリ直下の実在ファイル
    のときだけ返す(外部を指すシンボリックリンク等は配信しない)。"""
    try:
        root = ccv_dir.resolve(strict=False)
        raw = ccv_dir / f"{key}.png"
        if raw.is_symlink():
            return None
        path = raw.resolve(strict=False)
        if path.parent != root or not path.is_file():
            return None
    except (OSError, ValueError):
        return None
    return path


@router.get("/{product_no}/design-pages", response_model=DesignPagesOut)
def read_design_pages(
    product_no: str, conn: sqlite3.Connection = Depends(get_db)
) -> DesignPagesOut:
    """製番の`design.csv`(ページ番号・図名)を基準にした図面一覧。対応するPDFがある行だけを返す。
    読み取り専用。`design.csv`が無い・空・不正でもエラーにはせず`status`で返す。
    例外文言・実パスは応答に含めない。"""
    root = get_data_source_root(conn)
    try:
        resolution = resolve_product_dir(root, product_no)
    except DataSourceError as e:
        raise _error_to_http(e) from e

    # 「面番号/盤番号」は、既存の図面一覧と同じ元データ(product_df.csvのBAN_MENNO/BAN_NO)から、
    # `1/1`の形で重複を除き出現順に作る(再採番・加工はしない)。
    # product_df.csvが壊れていても一覧自体は壊さない(面番号/盤番号が空になるだけ。例外の詳細は出さない)。
    ban_labels_by_page: dict[int, list[str]] = {}
    try:
        product_df = load_product_df(resolution.ccv_dir, resolution.product_no)
        for page_no, panels in product_df.panels_by_page.items():
            labels: list[str] = []
            for panel in panels:
                label = f"{panel.ban_menno}/{panel.ban_no}"
                if label not in labels:
                    labels.append(label)
            ban_labels_by_page[page_no] = labels
    except Exception as e:  # noqa: BLE001 - csv.Error等。一覧の表示を優先し、型名だけを記録する
        logging.getLogger(__name__).warning(
            "product_df.csv could not be read for ban labels (product_no=%s): %s", resolution.product_no, type(e).__name__
        )
        ban_labels_by_page = {}

    result = load_design_pages(
        resolution.ccv_dir,
        resolution.product_no,
        lambda key: _preview_png_for_key(resolution.ccv_dir, resolution.product_no, key) is not None,
        ban_labels_by_page,
    )
    return DesignPagesOut(
        status=result.status,
        items=[
            DesignPageOut(
                key=p.key,
                page_label=p.page_label,
                drawing_name=p.drawing_name,
                mode=p.mode,
                inference_page_no=p.inference_page_no,
                ban_labels=p.ban_labels,
            )
            for p in result.pages
        ],
        skipped_rows=result.skipped_rows,
        documents=[
            DesignDocumentOut(key=d.key, kind=d.kind, label=d.label) for d in list_design_documents(resolution.ccv_dir)
        ],
    )


@router.get("/{product_no}/design-documents/{key}/file")
def read_design_document_file(
    product_no: str, key: str, conn: sqlite3.Connection = Depends(get_db)
):
    """図面一覧の最上段の書類(`0_S0`=共通製作仕様書、`0_A1`=設計作図完了シート)のPDF。`key`は固定の2つだけを受け付け、
    任意のファイル名は受け取らない。ファイルが無い・対象外のキーは、固定文言の404(ページ番号の経路`/drawings/{page_no}/file`は使わない)。"""
    root = get_data_source_root(conn)
    try:
        resolution = resolve_product_dir(root, product_no)
    except DataSourceError as e:
        raise _error_to_http(e) from e
    path = design_document_path(resolution.ccv_dir, key)
    if path is None:
        raise HTTPException(status_code=404, detail="書類が見つかりません。")
    return FileResponse(str(path), media_type="application/pdf")


@router.get("/{product_no}/design-documents/{key}/image")
def read_design_document_image(
    product_no: str, key: str, conn: sqlite3.Connection = Depends(get_db)
):
    """最上段の固定書類のサムネイルPNG。PDFとPNGの両方が実在する場合のみ配信する。"""
    root = get_data_source_root(conn)
    try:
        resolution = resolve_product_dir(root, product_no)
    except DataSourceError as e:
        raise _error_to_http(e) from e
    path = _document_preview_png(resolution.ccv_dir, key)
    if path is None:
        raise HTTPException(status_code=404, detail="この書類の表示用画像は作成されていません。")
    return FileResponse(str(path), media_type="image/png")


@router.get("/{product_no}/design-pages/{key}/image")
def read_design_page_image(
    product_no: str, key: str, conn: sqlite3.Connection = Depends(get_db)
):
    """design.csv基準の一覧の1ページぶんの画像。推論用PNGがあるページはその元PNG、無いページは
    表示用プレビューPNG。`key`は一覧(`design-pages`)に載っているものだけを受け付け、任意の
    ファイル名は受け取らない(実在するPDF名との照合済みの値のみ)。見つからない場合は固定文言の404。"""
    root = get_data_source_root(conn)
    try:
        resolution = resolve_product_dir(root, product_no)
    except DataSourceError as e:
        raise _error_to_http(e) from e

    result = load_design_pages(
        resolution.ccv_dir,
        resolution.product_no,
        lambda k: _preview_png_for_key(resolution.ccv_dir, resolution.product_no, k) is not None,
    )
    page = next((p for p in result.pages if p.key == key), None)
    if page is None:
        raise HTTPException(status_code=404, detail="図面が見つかりません。")
    if page.mode == "inference":
        inference = _inference_png_for_key(resolution.ccv_dir, page.key)
        if inference is not None:
            return FileResponse(str(inference), media_type="image/png")
        raise HTTPException(status_code=404, detail="この図面の表示用画像は作成されていません。")
    if page.mode == "preview":
        preview = _preview_png_for_key(resolution.ccv_dir, resolution.product_no, page.key)
        if preview is not None:
            return FileResponse(str(preview), media_type="image/png")
    raise HTTPException(status_code=404, detail="この図面の表示用画像は作成されていません。")


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


@router.get("/{product_no}/materials", response_model=list[MaterialRowOut])
def read_materials(
    product_no: str, conn: sqlite3.Connection = Depends(get_db)
) -> list[MaterialRowOut]:
    """`material.csv` (設計データの`*.boxspec`由来の材料一覧) を製番単位で全件返す。

    ページ・材料シンボル・箱体型式(CABTYPE)・構成部ごとの行をCSV順のまま返す。
    `material.csv`自体が製番フォルダに存在しない(旧データ・boxspecなし)場合や、
    データ行が無い場合もエラーにはせず空配列を返す(Frontendは「材料情報なし」を表示する)。
    読み込みのみで、製番フォルダへは書き込まない。
    """
    root = get_data_source_root(conn)
    try:
        resolution = resolve_product_dir(root, product_no)
    except DataSourceError as e:
        raise _error_to_http(e) from e

    result = load_material_csv(resolution.ccv_dir, resolution.product_no)

    return [
        MaterialRowOut(
            page=row.page,
            source_file=row.source_file,
            symbol_name=row.symbol_name,
            cabtype=row.cabtype,
            component_code=row.component_code,
            component_name=row.component_name,
            material_spec=row.material_spec,
        )
        for row in result.rows
    ]


@router.get("/{product_no}/steel", response_model=SteelOutlineOut)
def read_steel_outline(
    product_no: str, conn: sqlite3.Connection = Depends(get_db)
) -> SteelOutlineOut:
    """図面情報の「鋼材」欄用。`material.csv` のうち、製番の「外形図」(`product_df.csv` の ZUMEI から連番を
    除いた図面種別が完全一致するページ)で情報量が最大の1ページぶんを返す。選択中の図面ページには連動しない。
    選び方・同点時の規則は `select_outline_steel` を参照。読み取り専用。

    `material.csv` が無い・空・不正・外形図のデータが無い場合もエラーにはせず `status`
    (missing/empty/invalid/no_outline)で返す。例外の文言・実パス・製番・ファイル名は応答に含めない。
    """
    root = get_data_source_root(conn)
    try:
        resolution = resolve_product_dir(root, product_no)
    except DataSourceError as e:
        raise _error_to_http(e) from e

    result = load_material_csv(resolution.ccv_dir, resolution.product_no)
    if not result.file_present:
        return SteelOutlineOut(status="missing")
    if not result.rows:
        # 行が1件も無い: 列不足・読み取り失敗(warnings あり)か、見出しのみ(warnings なし)
        return SteelOutlineOut(status="invalid" if result.warnings else "empty")

    try:
        product_df = load_product_df(resolution.ccv_dir, resolution.product_no)
        drawing_type_by_page = product_df.drawing_type_by_page
        drawing_name_by_page = product_df.drawing_name_by_page
    except Exception:  # noqa: BLE001 - 図面種別が分からないだけで、画面全体を止めない
        return SteelOutlineOut(status="no_outline")

    selection = select_outline_steel(result.rows, drawing_type_by_page)
    if selection.page is None:
        return SteelOutlineOut(status="no_outline")
    return SteelOutlineOut(
        status="ok",
        source_page=selection.page,
        source_drawing_name=drawing_name_by_page.get(selection.page_no) if selection.page_no is not None else None,
        items=[
            SteelItemOut(
                symbol_name=r.symbol_name.strip(),
                cabtype=r.cabtype.strip(),
                component_name=r.component_name.strip(),
                material_spec=r.material_spec.strip(),
            )
            for r in selection.rows
        ],
    )


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
    """製番`product_no`の現在の積算結果(EstimateResult)を丸ごと確定snapshot
    として保存する (Issue #4 Phase B-2、Issue #40 Phase 6-Aで確定対象を
    EstimateResultへ移行)。

    リクエストボディは受け取らない。Frontendから計算済みの値を信頼して
    そのまま保存するのではなく、この時点の`estimate_results`(+
    `estimate_result_evidence`)×`estimate_master_items`×`estcode_df.csv`/
    `product_df.csv`(都度読み込み)から、Backend自身が
    `build_confirmation_items()`で組み立てる(Issue #4最新コメントの方針を
    Phase 6-Aでも踏襲する)。

    保存はEstimateResult単位(積算明細相当)の粒度で行い、対象別・総合計の集約は
    保存しない(`docs/decision-snapshot-design.md` 4章。読み出しAPIを
    追加した際に、保存済みの明細から同じ考え方で再現する想定)。

    **[Issue #40 Phase 6-A] `status=needs_review`のEstimateResultが1件でも
    存在する場合はHTTP 422を返し、確定操作自体を拒否する**(新旧コード衝突・
    盤所属tie等の未解決状態を含んだまま確定しない。需要確認行を黙って除外する
    「部分確定」は行わない)。

    対応するダミーDrawingPage行が無い実製番(Phase 1.8以降の既存の制約。
    `docs/data-model.md`参照)や、積算コードに紐づくEstimateResultが1件も無い
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
    except NeedsReviewResultsExistError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    confirmation = save_confirmation(conn, product_no=product_no, items=items)

    return EstimateConfirmationOut(
        id=confirmation.id,
        product_no=confirmation.product_no,
        confirmed_at=confirmation.confirmed_at,
        item_count=len(confirmation.items),
        items=[_confirmation_item_out(item) for item in confirmation.items],
    )


@router.get(
    "/{product_no}/estimate-confirmations",
    response_model=list[EstimateConfirmationSummaryOut],
)
def list_estimate_confirmations(
    product_no: str, conn: sqlite3.Connection = Depends(get_db)
) -> list[EstimateConfirmationSummaryOut]:
    """製番`product_no`の過去確定snapshot一覧を新しい順で返す (Issue #4 Phase B-4)。

    明細(items)は含めない一覧表示用の軽量版(`EstimateConfirmationSummaryOut`)。
    `item_count`/`total_amount`はDBから都度算出するのみで、保存済みの値自体は
    一切変更しない(append-only方針は維持したまま、読み出し専用のSELECTを
    追加しただけ)。

    製番自体がデータソース上に実在するかどうかはこのエンドポイントの責務外
    とする(`create_estimate_confirmation`と異なり、`resolve_product_dir`は
    呼ばない)。確定snapshotは`detection_id`/`drawing_page_id`同様、実データ
    ディレクトリの現在状態から独立した歴史的記録であるため、確定履歴が
    1件も無い製番(=まだ一度も確定していない製番、または製番自体が誤り)は
    どちらも同じ「空配列」として扱う(404にしない。「確定履歴0件」は
    正常系であり、エラーではない)。
    """
    summaries = list_confirmations(conn, product_no=product_no)
    return [EstimateConfirmationSummaryOut(**s.__dict__) for s in summaries]


@router.get(
    "/{product_no}/estimate-confirmations/{confirmation_id}",
    response_model=EstimateConfirmationDetailOut,
)
def read_estimate_confirmation(
    product_no: str,
    confirmation_id: int,
    conn: sqlite3.Connection = Depends(get_db),
) -> EstimateConfirmationDetailOut:
    """確定snapshot1件の詳細(header + 明細一式)を返す (Issue #4 Phase B-4)。

    保存済みの値をそのまま返すのみで、現在の`estimate_master_items`や
    `product_df.csv`/`estcode_df.csv`から再計算しない(確定時点の再現性を
    保つ。設計7章)。

    `confirmation_id`が存在しない、または存在していても`product_no`が
    一致しない(=別製番のconfirmation)場合は404とする。確定snapshotの
    `id`は製番横断で連番のため、`product_no`を無視して`id`だけで検索すると
    他製番のconfirmationを閲覧できてしまう(要件6: 別製番のconfirmation id
    へアクセスできないこと)。
    """
    confirmation = get_confirmation(conn, product_no=product_no, confirmation_id=confirmation_id)
    if confirmation is None:
        raise HTTPException(
            status_code=404,
            detail=f"confirmation {confirmation_id} not found for product {product_no}",
        )

    total_amount = sum(item.amount for item in confirmation.items if item.amount is not None)

    return EstimateConfirmationDetailOut(
        id=confirmation.id,
        product_no=confirmation.product_no,
        confirmed_at=confirmation.confirmed_at,
        item_count=len(confirmation.items),
        total_amount=total_amount,
        items=[_confirmation_item_out(item) for item in confirmation.items],
    )


@router.get(
    "/{product_no}/decision-events",
    response_model=list[DecisionEventOut],
)
def list_decision_events(
    product_no: str, conn: sqlite3.Connection = Depends(get_db)
) -> list[DecisionEventOut]:
    """製番`product_no`の判断履歴(decision_events)を発生順(古い順)で返す
    (Issue #4 Phase A-2)。

    読み出し専用のSELECTのみで、`decision_events`のappend-only方針・
    `record_event()`のtransaction境界には一切手を入れていない。保存済みの
    値をそのまま返すのみで、現在の`detections`/`estimate_master_items`から
    値を補完・再計算しない。

    `decision_events`自体には`product_no`列が無いため、`drawing_page_id`から
    `drawing_pages.product_no`をJOINで解決して絞り込む
    (`repositories/decision_events.py::list_events_for_product`)。製番自体が
    データソース上に実在するかはこのエンドポイントの責務外とする
    (`resolve_product_dir`は呼ばない。履歴が1件も無い製番は空配列を返し、
    404にはしない。confirmation履歴読み出しAPIと同じ方針)。
    """
    events = list_events_for_product(conn, product_no=product_no)
    return [DecisionEventOut(**e.__dict__) for e in events]


@router.get(
    "/{product_no}/decision-analysis/summary",
    response_model=DecisionAnalysisSummaryOut,
)
def read_decision_analysis_summary(
    product_no: str, conn: sqlite3.Connection = Depends(get_db)
) -> DecisionAnalysisSummaryOut:
    """製番`product_no`のdecision_eventsをevent_type別・ページ別・積算コード別に
    集計する (Issue #17 Phase C-1)。

    Phase C-0の棚卸し(Issue #17)で推奨された「候補1: 既存データだけを使った
    最小分析API」の一部。read-only SELECTのみで、新規テーブル・カラムは
    追加しない。`decision_events`のappend-only保存・BBox編集・Undo/Redoの
    書き込み処理は一切変更しない。

    既知の制約: Undo/Redoは通常のcreate/delete/bbox_editと区別できないため
    この集計でも区別しない。move/resizeも保存時に区別していないため
    `bbox_edit`のまま扱う。`bbox_edit_count_by_master_item`の`current_code`
    のみ、表示用に**現在の**`estimate_master_items`を参照する(現在値JOIN。
    確定snapshot値や記録時点の値ではない)。
    """
    summary = summarize_events_for_product(conn, product_no=product_no)
    return DecisionAnalysisSummaryOut(
        product_no=summary.product_no,
        event_counts=summary.event_counts,
        total_events=summary.total_events,
        bbox_edit_count_by_page_no=summary.bbox_edit_count_by_page_no,
        bbox_edit_count_by_master_item=[
            DecisionAnalysisMasterItemBreakdownOut(**b.__dict__)
            for b in summary.bbox_edit_count_by_master_item
        ],
    )


@router.get(
    "/{product_no}/decision-analysis/detections",
    response_model=list[DecisionAnalysisDetectionSummaryOut],
)
def list_decision_analysis_detections(
    product_no: str, conn: sqlite3.Connection = Depends(get_db)
) -> list[DecisionAnalysisDetectionSummaryOut]:
    """製番`product_no`について、decision_eventsが1件以上存在するDetection単位で
    操作系列・編集回数を返す (Issue #17 Phase C-1)。

    `event_count`/`bbox_edit_count`/`first_event_id`/`last_event_id`のみを
    集計し、`page_no`/`source_type`/`master_item_id`は最初に記録されたevent
    (`first_event_id`)の値をそのまま転記する(現在の`detections`へは依存
    しないため、Detectionが既に削除されていても取得できる)。読み出し専用の
    SELECTのみ。
    """
    detections = list_detection_summaries_for_product(conn, product_no=product_no)
    return [DecisionAnalysisDetectionSummaryOut(**d.__dict__) for d in detections]


@router.get(
    "/{product_no}/decision-analysis/confirmations",
    response_model=list[DecisionAnalysisConfirmationOut],
)
def list_decision_analysis_confirmations(
    product_no: str, conn: sqlite3.Connection = Depends(get_db)
) -> list[DecisionAnalysisConfirmationOut]:
    """製番`product_no`の各確定snapshotについて、明細ごとに「確定時点以前に
    そのdetection_idへ何件のevent/bbox_editが存在したか」を突合して返す
    (Issue #17 Phase C-1)。

    明細の`code`は確定snapshot自身(`estimate_confirmation_items.code`)の
    非正規化コピーをそのまま使う(現在のMasterへは再度JOINしない)。
    `detection_id`が特定できない明細(値が`None`)はevent件数を0として扱う
    (エラーにはしない)。

    既知の制約: `decision_events.occurred_at`/`estimate_confirmations.
    confirmed_at`はいずれも秒精度のため、同一秒に発生したevent/確定の前後
    関係は厳密には区別できない(`occurred_at <= confirmed_at`で「確定時点
    以前」と判定する)。また`detection_id`はUndo/Redoによるcreate/delete
    (AUTOINCREMENTでの再採番)で分断されうるため、分断前後のIDは別の
    Detectionとして扱われ、統合しない。
    """
    confirmations = list_confirmation_analysis_for_product(conn, product_no=product_no)
    return [
        DecisionAnalysisConfirmationOut(
            confirmation_id=c.confirmation_id,
            confirmed_at=c.confirmed_at,
            items=[DecisionAnalysisConfirmationItemOut(**item.__dict__) for item in c.items],
        )
        for c in confirmations
    ]
