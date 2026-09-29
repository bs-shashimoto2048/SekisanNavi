"""積算確定snapshot(Issue #4 Phase B-2)を「現在状態」から組み立てる処理。

設計は `docs/decision-snapshot-design.md` を参照。Issue #4最新コメントの方針
(「snapshot値をFrontendから信頼して丸ごと受け取るのではなく、Backend側で
現在状態から組み立てて保存する」)に従い、Frontend `estimateAggregationReal.ts`
の実データ集約ロジック(特に`assignDetectionToPanel`)をBackend側へ最小限の
範囲で移植する。

移植のスコープはあくまで「1 Detection = 1明細行の対象所属判定」までであり、
`buildRealEstimateAggregation`が行う対象別/総合計の数量集約(`lineItems`/
`totalLineItems`)そのものはPhase B-1の設計判断どおり移植しない(確定snapshot
はDetection単位で保存し、対象別・総合計の集約は読み出し時に同じ考え方で
再現する。Phase B-2でも読み出しAPIは追加しないため、集約結果自体は保存しない)。

このモジュールはDB書き込みを行わない(`save_confirmation`への入力を組み立てる
だけの読み取り専用ロジック)。実際の保存は呼び出し側(router)が
`app.repositories.estimate_confirmations.save_confirmation`を呼んで行う。
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from app.domain.models import (
    Detection,
    EstimateConfirmationItemInput,
    EstimateTargetType,
)
from app.repositories.detections import list_detections
from app.repositories.master import get_master_item
from app.services.data_source import DataSourceError, resolve_product_dir
from app.services.estcode_df import EstimatePanelInfo, load_estcode_df
from app.services.panel_assignment import (
    PRODUCT_TARGET_ID,
    TIE_TARGET_ID,
    PanelAssignment as _PanelAssignment,
    ProductAssignment as _ProductAssignment,
    assign_detection_to_panel as _assign_detection_to_panel,
    panel_target_id,
)
from app.services.product_df import PanelAreaFromDf, load_product_df

# Frontend `estimateAggregationReal.ts` と同じ識別子(要求仕様への準拠。
# 表示文字列を新たに作らず、既存の実装と同じ値をそのまま踏襲する)。
# [Issue #40 Phase 2] 盤所属判定の実体(交差面積計算・tie判定)は
# `app.services.panel_assignment`へ切り出した(Backend内の二重実装解消)。
# ここでの再import・別名付けは、このモジュールの既存の公開インターフェース
# (`panel_target_id`、呼び出し側からの`_assign_detection_to_panel`等の参照)を
# 変えないための後方互換の薄いshimであり、ロジック自体の変更はない。


def _resolve_panel_name(panel: PanelAreaFromDf, estimate_panels: list[EstimatePanelInfo]) -> str:
    """Frontend `estimateAggregationReal.ts::resolvePanelName`と同じ優先順位の移植:
    estcode_df.csvの値を優先し、無ければproduct_df自身の値、それも空なら
    面番号/盤番号を使う。"""
    matched = next(
        (e for e in estimate_panels if e.ban_menno == panel.ban_menno and e.ban_no == panel.ban_no),
        None,
    )
    name = (matched.ban_meisyou if matched else None) or panel.ban_meisyou
    return name if name and name.strip() != "" else f"{panel.ban_menno}/{panel.ban_no}"


def detection_page_no_map(conn: sqlite3.Connection, product_no: str) -> dict[int, int]:
    """`drawing_pages`のうち、この製番に紐づく行の`id -> source_page_no`。

    `docs/data-model.md`の「Phase 1.8での役割変化」の通り、ダミーDrawingPage行が
    無い実製番は空dictとなり、その製番の確定snapshotは明細0件になる(エラーには
    しない。既存の他API(panels/detected-preview等)と同じ「対応データが無ければ
    空」という規則に揃える)。
    """
    rows = conn.execute(
        """
        SELECT id, source_page_no FROM drawing_pages
        WHERE product_no = ? AND source_type = 'product_file' AND source_page_no IS NOT NULL
        """,
        (product_no,),
    ).fetchall()
    return {row["id"]: row["source_page_no"] for row in rows}


def build_confirmation_items(
    conn: sqlite3.Connection, data_source_root: Path, product_no: str
) -> list[EstimateConfirmationItemInput]:
    """製番`product_no`の「現在状態」から確定snapshot明細の入力一覧を組み立てる。

    Frontendから計算済みの値を受け取らず、Backend自身が
    `detections`(DB)×`estimate_master_items`(DB)×`product_df.csv`/
    `estcode_df.csv`(都度読み込み)を組み合わせて計算する
    (Issue #4 Phase B-2最新コメントの方針。Frontend
    `estimateAggregationReal.ts::buildRealEstimateAggregation`と同じ入力から
    同じ結果になるようにロジックを移植している)。

    `resolve_product_dir`が投げる`DataSourceError`(製番が存在しない等)は
    そのまま呼び出し側(router)へ伝播させ、他の製番スコープAPIと同じ
    エラーハンドリングに委ねる。
    """
    resolution = resolve_product_dir(data_source_root, product_no)
    df_result = load_product_df(resolution.ccv_dir, resolution.product_no)
    estcode_result = load_estcode_df(resolution.ccv_dir, resolution.product_no)

    page_no_by_drawing_page_id = detection_page_no_map(conn, product_no)

    # Master Itemの再JOINをDetection件数分繰り返さないための簡易キャッシュ
    # (同一製番内で同じ積算コードが複数Detectionから参照されるのは通常の使い方のため)。
    master_cache: dict[int, object] = {}

    def _master(master_item_id: int):
        if master_item_id not in master_cache:
            master_cache[master_item_id] = get_master_item(conn, master_item_id)
        return master_cache[master_item_id]

    items: list[EstimateConfirmationItemInput] = []
    for drawing_page_id, page_no in page_no_by_drawing_page_id.items():
        detections: list[Detection] = list_detections(conn, drawing_page_id)
        panels = df_result.panels_by_page.get(page_no, [])

        for detection in detections:
            # 積算コードとして紐づいていない行(AI検出のうち未確定のもの等)は
            # 対象外(Frontend側の同じ判定と揃える)。
            if detection.master_item_id is None:
                continue

            assignment = _assign_detection_to_panel(
                (detection.bbox_x, detection.bbox_y, detection.bbox_w, detection.bbox_h),
                panels,
            )

            ban_menno: int | None = None
            ban_no: int | None = None
            panel_name: str | None = None
            if isinstance(assignment, _ProductAssignment):
                target_id = PRODUCT_TARGET_ID
                target_type = EstimateTargetType.PRODUCT
            elif isinstance(assignment, _PanelAssignment):
                target_id = panel_target_id(assignment.panel)
                target_type = EstimateTargetType.PANEL
                ban_menno = assignment.panel.ban_menno
                ban_no = assignment.panel.ban_no
                panel_name = _resolve_panel_name(assignment.panel, estcode_result.panels)
            else:
                target_id = TIE_TARGET_ID
                target_type = EstimateTargetType.TIE

            master = _master(detection.master_item_id)
            unit_price = master.total_price_a if master is not None else None
            rating = master.rating if master is not None else None
            code = detection.master_item_code or detection.class_name

            items.append(
                EstimateConfirmationItemInput(
                    target_id=target_id,
                    target_type=target_type,
                    code=code,
                    source_type=detection.source_type,
                    status=detection.status,
                    detection_id=detection.id,
                    drawing_page_id=detection.drawing_page_id,
                    ban_menno=ban_menno,
                    ban_no=ban_no,
                    panel_name=panel_name,
                    master_item_id=detection.master_item_id,
                    category=detection.master_item_category,
                    model=detection.master_item_model,
                    rating=rating,
                    quantity=1,
                    # quantity=1のDetection単位行のため、amountはunit_price自身
                    # (Frontend `accumulate()`の初回加算と同じ規則。unit_priceが
                    # 不明な場合はamountもNULLのまま、0円へ捏造しない)。
                    unit_price=unit_price,
                    amount=unit_price,
                    bbox_x=detection.bbox_x,
                    bbox_y=detection.bbox_y,
                    bbox_w=detection.bbox_w,
                    bbox_h=detection.bbox_h,
                    page_no=page_no,
                )
            )

    return items


__all__ = ["build_confirmation_items", "detection_page_no_map", "DataSourceError"]
