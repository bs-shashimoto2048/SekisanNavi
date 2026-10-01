"""Issue #40 Phase 2: 積算コード選定〜数量・係数・金額/工数算出の一貫ルール化。

積算結果(EstimateResult)・図面情報マスタの最小API。Phase 2ではUIを一切
実装しないため、これらのエンドポイントはPhase 3/4向けの基盤としてのみ存在
する(既存のViewer/積算集約/積算明細画面はこのAPIを一切呼ばない)。
"""
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_db
from app.domain.estimate_rules import EstimateResultEvidence
from app.repositories.drawing_evidence_types import list_evidence_types
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
    DrawingEvidenceTypeOut,
    EstimateResultEvaluateOut,
    EstimateResultEvidenceOut,
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
        get_allowed_factors(conn, result.source_rule_id) if result.source_rule_id is not None else None
    )
    return EstimateResultOut(
        **data, allowed_factors=allowed_factors, evidence=_evidence_out(result.evidence)
    )


@evidence_types_router.get("", response_model=list[DrawingEvidenceTypeOut])
def read_evidence_types(conn: sqlite3.Connection = Depends(get_db)) -> list[DrawingEvidenceTypeOut]:
    """図面情報マスタ一覧 (Issue #40 10-1章)。Phase 2では実データを投入しない
    ため、通常は空配列を返す(Phase 3以降で投入スクリプト/管理画面から
    登録される想定)。"""
    return [DrawingEvidenceTypeOut(**e.__dict__) for e in list_evidence_types(conn)]


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
