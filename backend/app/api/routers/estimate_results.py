"""Issue #40 Phase 2: 積算コード選定〜数量・係数・金額/工数算出の一貫ルール化。

積算結果(EstimateResult)・図面情報マスタの最小API。Phase 2ではUIを一切
実装しないため、これらのエンドポイントはPhase 3/4向けの基盤としてのみ存在
する(既存のViewer/積算集約/積算明細画面はこのAPIを一切呼ばない)。
"""
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_db
from app.domain.box_code_selection import BOX_CATEGORIES
from app.domain.busbar_selections import BUSBAR_ALLOWED_FACTORS
from app.domain.master_categories import COPPER_BUS_CODE_CATEGORIES
from app.repositories.estimate_box_overrides import delete_box_override, set_box_override
from app.repositories.estimate_busbar_selections import list_selections, replace_face_selections
from app.repositories.master import get_master_item, get_master_item_by_code
from app.services.box_code_candidates import box_result_key
from app.domain.estimate_rules import EstimateResultEvidence
from app.repositories.drawing_evidence_types import list_evidence_types
from app.services.drawing_evidence_candidates import list_drawing_evidence_type_candidates
from app.repositories.estimate_results import (
    FactorNotAllowedError,
    list_results_for_product,
    replace_results_for_product,
    reset_factor_to_initial,
    reset_quantity_to_initial,
    set_current_factor,
    set_current_quantity,
)
from app.repositories.estimate_rule_masters import get_allowed_factors
from app.repositories.system_settings import get_data_source_root
from app.schemas.estimate_rules import (
    DrawingEvidenceTypeCandidateOut,
    DrawingEvidenceTypeOut,
    EstimateResultEvaluateOut,
    EstimateResultEvidenceOut,
    BoxCodeOverrideIn,
    BusbarSelectionsReplaceIn,
    EstimateResultFactorOverrideIn,
    EstimateResultOut,
    EstimateResultQuantityOverrideIn,
)
from app.services.data_source import DataSourceError
from app.services.estimate_result_pipeline import build_all_candidates

router = APIRouter(prefix="/api/products", tags=["estimate-results"])
evidence_types_router = APIRouter(prefix="/api/drawing-evidence-types", tags=["estimate-results"])


def _error_to_http(e: DataSourceError) -> HTTPException:
    # products.pyと同じ変換規則(要件を重複定義しないため、ここでも
    # DataSourceErrorのmessageのみを使う最小限の変換に留める)。
    return HTTPException(status_code=400, detail=e.message)


def _evidence_out(evidence: list[EstimateResultEvidence]) -> list[EstimateResultEvidenceOut]:
    return [EstimateResultEvidenceOut(**e.__dict__) for e in evidence]


def _result_out(conn: sqlite3.Connection, result) -> EstimateResultOut:
    data = {k: v for k, v in result.__dict__.items() if k != "evidence"}
    allowed_factors = (
        list(BUSBAR_ALLOWED_FACTORS)
        if result.result_key.startswith("busbar:")
        else get_allowed_factors(conn, result.source_rule_id) if result.source_rule_id is not None else None
    )
    return EstimateResultOut(
        **data, allowed_factors=allowed_factors, evidence=_evidence_out(result.evidence)
    )


@router.get("/{product_no}/busbar-selections")
def read_busbar_selections(product_no: str, conn: sqlite3.Connection = Depends(get_db)):
    """主回路銅帯の選択コード・係数を製番単位で返す。"""
    return [
        {"ban_menno": row.ban_menno, "row_id": row.row_id, "code": row.code, "factor": row.factor}
        for row in list_selections(conn, product_no)
    ]


@router.put("/{product_no}/busbar-selections/{ban_menno}", response_model=EstimateResultEvaluateOut)
def replace_busbar_selections(
    product_no: str,
    ban_menno: int,
    body: BusbarSelectionsReplaceIn,
    conn: sqlite3.Connection = Depends(get_db),
) -> EstimateResultEvaluateOut:
    """指定面の銅帯選択行を置換し、積算結果を再評価する。

    各行のコードと係数はPanelInfoの選択状態が正本。行の削除・未選択化は
    この面の保存内容から消し、対応するEstimateResultも再評価で除去する。
    """
    if ban_menno <= 0:
        raise HTTPException(status_code=422, detail="面番号は1以上を指定してください。")
    rows: list[tuple[str, str, float]] = []
    for row in body.rows:
        item = get_master_item_by_code(conn, row.code)
        if item is None or item.category not in COPPER_BUS_CODE_CATEGORIES:
            raise HTTPException(status_code=422, detail=f"主回路銅帯のコードが見つかりません: {row.code}")
        rows.append((row.row_id, row.code, row.factor))
    replace_face_selections(conn, product_no=product_no, ban_menno=ban_menno, selections=rows)
    return _re_evaluate(conn, product_no)


@evidence_types_router.get("", response_model=list[DrawingEvidenceTypeOut])
def read_evidence_types(conn: sqlite3.Connection = Depends(get_db)) -> list[DrawingEvidenceTypeOut]:
    """図面情報マスタ一覧 (Issue #40 10-1章)。Phase 2では実データを投入しない
    ため、通常は空配列を返す(Phase 3以降で投入スクリプト/管理画面から
    登録される想定)。"""
    return [DrawingEvidenceTypeOut(**e.__dict__) for e in list_evidence_types(conn)]


@evidence_types_router.get("/candidates", response_model=list[DrawingEvidenceTypeCandidateOut])
def read_evidence_type_candidates() -> list[DrawingEvidenceTypeCandidateOut]:
    """Issue #40 追加修正: 図面情報パネルの「候補/確認待ち」表示向け。

    `drawing_evidence_types`(上の`read_evidence_types`)が0件のときに、
    画面を空白のまま見せず「何が検討中で、何が確認待ちなのか」を示すための
    読み取り専用API。候補マニフェスト(`backend/data_candidates/
    phase6f_drawing_evidence_types.json`)をファイルから読むだけで、DBへは
    一切接続しない(本番DB・検証DBいずれにも書き込まない)。
    """
    return [
        DrawingEvidenceTypeCandidateOut(**c.__dict__)
        for c in list_drawing_evidence_type_candidates()
    ]


@router.get("/{product_no}/estimate-results", response_model=list[EstimateResultOut])
def read_estimate_results(
    product_no: str,
    detection_id: int | None = Query(default=None),
    conn: sqlite3.Connection = Depends(get_db),
) -> list[EstimateResultOut]:
    """製番`product_no`の現在の積算結果一覧を返す(読み取り専用。評価器は
    実行しない)。評価器を実行して最新化したい場合は
    `POST .../estimate-results/evaluate`を呼ぶ。

    `detection_id`を指定すると、そのBBoxが根拠になっている積算結果だけに
    絞り込む (Issue #40 Phase 3「根拠BBox→関係する積算結果」)。
    """
    results = list_results_for_product(conn, product_no=product_no, detection_id=detection_id)
    return [_result_out(conn, r) for r in results]


@router.post("/{product_no}/estimate-results/evaluate", response_model=EstimateResultEvaluateOut)
def evaluate_estimate_results(
    product_no: str, conn: sqlite3.Connection = Depends(get_db)
) -> EstimateResultEvaluateOut:
    """製番`product_no`について、現在の根拠(detections)×設計データ×
    有効なルールマスタから積算結果を再評価する (Issue #40 Phase 2)。

    Issue #40 Phase 5より、新方式(図面情報→ルール評価)に加えて、旧方式
    (`master_item_id`直結Detection)も`app.services.estimate_result_pipeline.
    build_all_candidates`経由でEstimateResultへ変換し、同じ`estimate_results`
    テーブルへ統合する(積算結果の正本をEstimateResultへ一本化する方針)。
    新旧両方式が同じ(対象, コード)を算出した場合は、機械的に一方を破棄せず
    `status=needs_review`として両方残す(Phase 5指示13章)。

    手修正済みの係数(`factor_overridden=1`)は上書きしない
    (`app.repositories.estimate_results.replace_results_for_product`参照)。
    条件が成立しなくなった既存結果は削除される。
    """
    root = get_data_source_root(conn)
    try:
        outcome = build_all_candidates(conn, root, product_no)
    except DataSourceError as e:
        raise _error_to_http(e) from e

    results = replace_results_for_product(conn, product_no=product_no, candidates=outcome.candidates)
    return EstimateResultEvaluateOut(
        results=[_result_out(conn, r) for r in results],
        skipped_rule_master_ids=outcome.skipped_rule_master_ids,
    )


def _re_evaluate(conn: sqlite3.Connection, product_no: str) -> EstimateResultEvaluateOut:
    root = get_data_source_root(conn)
    try:
        outcome = build_all_candidates(conn, root, product_no)
    except DataSourceError as e:
        raise _error_to_http(e) from e
    results = replace_results_for_product(conn, product_no=product_no, candidates=outcome.candidates)
    return EstimateResultEvaluateOut(
        results=[_result_out(conn, r) for r in results],
        skipped_rule_master_ids=outcome.skipped_rule_master_ids,
    )


@router.put(
    "/{product_no}/box-selections/{ban_menno}/{ban_no}",
    response_model=EstimateResultEvaluateOut,
)
def override_box_code(
    product_no: str,
    ban_menno: int,
    ban_no: int,
    body: BoxCodeOverrideIn,
    conn: sqlite3.Connection = Depends(get_db),
) -> EstimateResultEvaluateOut:
    """盤の箱コードの手修正。同じ盤の箱行(`box:面:盤`)の1件を置き換える(2件目は作らない)。

    手修正は`estimate_box_overrides`に保存し、再評価・再読込でも保持する。選べるのは箱3カテゴリの
    コードのみで、その盤の品名カテゴリが確定している場合は同じカテゴリの中からだけ選べる。
    保存後に再評価して、最新の積算結果一覧を返す。
    """
    key = box_result_key(ban_menno, ban_no)
    current = next(
        (r for r in list_results_for_product(conn, product_no=product_no) if r.result_key == key), None
    )
    if current is None:
        raise HTTPException(status_code=404, detail="指定された盤の箱コード行が見つかりません。")
    item = get_master_item(conn, body.master_item_id)
    if item is None:
        raise HTTPException(status_code=422, detail="指定された部品台帳コードが見つかりません。")
    if item.category not in BOX_CATEGORIES:
        raise HTTPException(status_code=422, detail="箱の品名カテゴリ(箱･単独/箱･左右/箱･中)のコードのみ選べます。")
    if current.box_category is not None and item.category != current.box_category:
        raise HTTPException(
            status_code=422,
            detail=f"この盤の品名カテゴリは「{current.box_category}」です。同じカテゴリのコードを選んでください。",
        )
    set_box_override(
        conn,
        product_no=product_no,
        ban_menno=ban_menno,
        ban_no=ban_no,
        master_item_id=item.id,
        reason=body.reason,
        updated_by=body.updated_by,
    )
    return _re_evaluate(conn, product_no)


@router.delete(
    "/{product_no}/box-selections/{ban_menno}/{ban_no}",
    response_model=EstimateResultEvaluateOut,
)
def reset_box_code(
    product_no: str,
    ban_menno: int,
    ban_no: int,
    conn: sqlite3.Connection = Depends(get_db),
) -> EstimateResultEvaluateOut:
    """箱コードの手修正を取り消し、自動選定へ戻す(以後の再評価は自動選定に追従する)。"""
    delete_box_override(conn, product_no=product_no, ban_menno=ban_menno, ban_no=ban_no)
    return _re_evaluate(conn, product_no)


@router.patch(
    "/{product_no}/estimate-results/{result_id}",
    response_model=EstimateResultOut,
)
def override_estimate_result_factor(
    product_no: str,
    result_id: int,
    body: EstimateResultFactorOverrideIn,
    conn: sqlite3.Connection = Depends(get_db),
) -> EstimateResultOut:
    """係数の手修正 (Issue #40 7-3章)。以後の再評価でもこの値を保持する。

    対象の積算結果に紐づくルール(`source_rule_id`)へ許容係数候補
    (`allowed_factors`)が設定されている場合、その候補に含まれない値は
    422で拒否する(PR #41レビュー指摘対応。`allowed_factors`が未設定なら
    現時点では自由入力を許容する)。
    """
    try:
        result = set_current_factor(
            conn,
            product_no=product_no,
            result_id=result_id,
            current_factor=body.current_factor,
            reason=body.reason,
            updated_by=body.updated_by,
        )
    except FactorNotAllowedError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    if result is None:
        raise HTTPException(status_code=404, detail="指定された積算結果が見つかりません。")
    return _result_out(conn, result)


@router.post(
    "/{product_no}/estimate-results/{result_id}/reset-factor",
    response_model=EstimateResultOut,
)
def reset_estimate_result_factor(
    product_no: str,
    result_id: int,
    conn: sqlite3.Connection = Depends(get_db),
) -> EstimateResultOut:
    """「初期値へ戻す」操作 (Issue #40 7-3章)。以後の再評価では最新の
    初期係数へ再び追従するようになる。"""
    result = reset_factor_to_initial(conn, product_no=product_no, result_id=result_id)
    if result is None:
        raise HTTPException(status_code=404, detail="指定された積算結果が見つかりません。")
    return _result_out(conn, result)


@router.patch(
    "/{product_no}/estimate-results/{result_id}/quantity",
    response_model=EstimateResultOut,
)
def override_estimate_result_quantity(
    product_no: str,
    result_id: int,
    body: EstimateResultQuantityOverrideIn,
    conn: sqlite3.Connection = Depends(get_db),
) -> EstimateResultOut:
    """数量の手修正 (Issue #40 Phase 6後半)。以後の再評価でもこの値を保持する
    (`override_estimate_result_factor`と同じ考え方)。数値妥当性(0以上・
    NaN/Infinity禁止)は`EstimateResultQuantityOverrideIn`側で検証済み。
    """
    result = set_current_quantity(
        conn,
        product_no=product_no,
        result_id=result_id,
        current_quantity=body.current_quantity,
        reason=body.reason,
        updated_by=body.updated_by,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="指定された積算結果が見つかりません。")
    return _result_out(conn, result)


@router.post(
    "/{product_no}/estimate-results/{result_id}/reset-quantity",
    response_model=EstimateResultOut,
)
def reset_estimate_result_quantity(
    product_no: str,
    result_id: int,
    conn: sqlite3.Connection = Depends(get_db),
) -> EstimateResultOut:
    """「初期値へ戻す」操作(数量、Issue #40 Phase 6後半)。以後の再評価では
    最新の自動算定値へ再び追従するようになる。"""
    result = reset_quantity_to_initial(conn, product_no=product_no, result_id=result_id)
    if result is None:
        raise HTTPException(status_code=404, detail="指定された積算結果が見つかりません。")
    return _result_out(conn, result)
