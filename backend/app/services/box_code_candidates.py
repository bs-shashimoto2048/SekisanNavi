"""盤ごとの箱コード自動選定 → 積算結果候補 (EstimateResultCandidate) への変換。

選定規則そのものは`app.domain.box_code_selection`(純粋関数)。このモジュールは
  - 盤一覧(estcode_df.csv)と盤寸法の解決(画面と同じ規則)
  - 製番の箱体型式 → 第1記号(`box_type_parser`の既存解決処理を再利用)
  - 手修正(`estimate_box_overrides`)の反映
  - EstimateResultCandidateの組み立て
を担う。DBへは書き込まない(読み取りのみ)。書き込みは呼び出し側の
`replace_results_for_product`が行う。

**盤寸法は画面(PanelInfo、`frontend/src/domain/panelDimensions.ts`)と同じ規則**:
  1. estcode_df.csv の BAN_W / BAN_D は正の値のみ有効(0・欠損は未設定)。
  2. 未設定の項目は、product_df.csv の「ZUMEI に『外形図』を含み BAN_TYPE が『正面図』」の行
     (ページ昇順、BAN_MENNO+BAN_NO 一致、項目ごとに最初の正の値)で補う。
  3. 高さ(BAN_H1=正面高さ)は上記の外形図・正面図の行から。正面高さも背面高さも無いときだけ
     estcode_df.csv の BAN_H(画面が単一の高さとして表示する値)を使う。BAN_H2は使わない。
  4. どれも無ければ未設定(推測せず要確認)。
"""
from __future__ import annotations

import json
import math
import sqlite3

from app.domain.box_code_selection import (
    BOX_CATEGORIES,
    BoxSelection,
    PanelDimensionsMm,
    SelectionStatus,
    select_box_code,
)
from app.domain.estimate_rules import (
    ApplicableUnit,
    EstimateResultCandidate,
    EstimateResultStatus,
    EvidenceKind,
    EvidenceRef,
    JudgmentMethod,
    JudgmentScope,
)
from app.domain.models import EstimateMasterItem
from app.repositories.estimate_box_overrides import BoxOverride
from app.repositories.master import list_master_items
from app.services.box_type_parser import parse_box_type
from app.services.estcode_df import EstcodeDfResult, EstimatePanelInfo
from app.services.product_df import PanelAreaFromDf, ProductDfResult

OUTLINE_DRAWING_KEYWORD = "外形図"
FRONT_VIEW_TYPE = "正面図"
BOX_RESULT_KEY_PREFIX = "box:"


def box_result_key(ban_menno: int, ban_no: int) -> str:
    return f"{BOX_RESULT_KEY_PREFIX}{ban_menno}:{ban_no}"


def _is_set(value: float | None) -> bool:
    return value is not None and math.isfinite(value) and value > 0


def outline_front_panels(df_result: ProductDfResult) -> list[PanelAreaFromDf]:
    """寸法の補完元(外形図かつ正面図)をページ昇順で返す(`selectOutlineFrontPanels`と同じ)。"""
    rows: list[PanelAreaFromDf] = []
    for page_no in sorted(df_result.panels_by_page):
        name = df_result.drawing_name_by_page.get(page_no, "")
        if OUTLINE_DRAWING_KEYWORD not in name:
            continue
        rows.extend(p for p in df_result.panels_by_page[page_no] if p.ban_type == FRONT_VIEW_TYPE)
    return rows


def resolve_panel_dimensions(
    estimate: EstimatePanelInfo, outline_rows: list[PanelAreaFromDf]
) -> PanelDimensionsMm:
    sources = [p for p in outline_rows if p.ban_menno == estimate.ban_menno and p.ban_no == estimate.ban_no]

    def first_set(pick) -> float | None:
        for p in sources:
            v = pick(p)
            if _is_set(v):
                return v
        return None

    front = first_set(lambda p: p.ban_h1)
    back = first_set(lambda p: p.ban_h2)
    if front is not None:
        height = front
    elif back is None and _is_set(estimate.ban_h):
        height = estimate.ban_h
    else:
        height = None
    width = estimate.ban_w if _is_set(estimate.ban_w) else first_set(lambda p: p.ban_w)
    depth = estimate.ban_d if _is_set(estimate.ban_d) else first_set(lambda p: p.ban_d)
    return PanelDimensionsMm(height=height, width=width, depth=depth)


def resolve_primary_symbol(estimate_panels: list[EstimatePanelInfo]) -> tuple[str | None, str | None]:
    """製番の箱体型式と第1記号。画面(PanelInfo)と同じく、型式が入っている最初の盤の値を使う。"""
    for panel in estimate_panels:
        model = (panel.model or "").strip()
        if model:
            analysis = parse_box_type(model)
            return model, (analysis.primary.code if analysis.primary is not None else None)
    return None, None


def list_box_master_items(conn: sqlite3.Connection) -> list[EstimateMasterItem]:
    items: list[EstimateMasterItem] = []
    for category in BOX_CATEGORIES:
        items.extend(list_master_items(conn, category=category))
    return items


def build_box_candidates(
    conn: sqlite3.Connection,
    *,
    product_no: str,
    df_result: ProductDfResult,
    estcode_result: EstcodeDfResult,
    overrides: dict[tuple[int, int], BoxOverride],
) -> list[EstimateResultCandidate]:
    """estcode_df.csvの物理盤(面番号+盤番号)ごとに、箱コード候補を1件ずつ作る。

    estcode_df.csvが無い/盤が0件のときは何も作らない(盤を捏造しない)。
    """
    if not estcode_result.panels:
        return []
    master_items = list_box_master_items(conn)
    master_by_id = {m.id: m for m in master_items}
    outline_rows = outline_front_panels(df_result)
    model, symbol = resolve_primary_symbol(estcode_result.panels)

    candidates: list[EstimateResultCandidate] = []
    seen: set[tuple[int, int]] = set()
    for panel in estcode_result.panels:
        key = (panel.ban_menno, panel.ban_no)
        if key in seen:
            continue  # 物理盤につき箱コードは最大1件
        seen.add(key)

        dims = resolve_panel_dimensions(panel, outline_rows)
        selection = select_box_code(
            connect=panel.ban_connect,
            primary_symbol=symbol,
            dimensions=dims,
            master_items=master_items,
        )
        override = overrides.get(key)
        # 手修正コードが今も箱3カテゴリのマスタに存在する場合のみ有効。無ければ自動選定へ戻す。
        override_item = master_by_id.get(override.master_item_id) if override is not None else None
        candidates.append(_to_candidate(product_no, panel, dims, model, selection, override_item))
    return candidates


def _dims_text(dims: PanelDimensionsMm) -> str:
    def f(v: float | None) -> str:
        return "未設定" if v is None else f"{v:g}"

    return f"高さ(BAN_H1){f(dims.height)}・幅{f(dims.width)}・奥行{f(dims.depth)}mm"


def _to_candidate(
    product_no: str,
    panel: EstimatePanelInfo,
    dims: PanelDimensionsMm,
    model: str | None,
    selection: BoxSelection,
    override_item: EstimateMasterItem | None,
) -> EstimateResultCandidate:
    ref = json.dumps(
        {"ban_menno": panel.ban_menno, "ban_no": panel.ban_no, "box_type": model, "connect": panel.ban_connect},
        ensure_ascii=False,
    )
    evidence = [EvidenceRef(evidence_kind=EvidenceKind.DESIGN_DATA, design_data_ref=ref)]
    base = dict(
        product_no=product_no,
        result_key=box_result_key(panel.ban_menno, panel.ban_no),
        quantity=1.0,
        applicable_unit=ApplicableUnit.UNIT,
        initial_factor=1.0,
        judgment_scope=JudgmentScope.PANEL,
        target_panel_ban_menno=panel.ban_menno,
        target_panel_ban_no=panel.ban_no,
        target_drawing_page_id=None,
        source_rule_id=None,
        unit_labor=None,
        evidence=evidence,
    )

    if override_item is not None:
        if selection.status is SelectionStatus.SELECTED and selection.item is not None:
            auto_note = f"自動選定は{selection.item.code}でした"
        else:
            auto_note = f"自動選定は要確認でした({selection.reason})"
        return EstimateResultCandidate(
            master_item_id=override_item.id,
            code=override_item.code,
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_reason=f"箱コードを手修正しました({override_item.model} / {override_item.rating})。{auto_note}",
            unit_price=override_item.total_price_a,
            status=EstimateResultStatus.REVIEWED,
            # 品名カテゴリは接続情報から決まる値のまま(手修正で選んだコードのカテゴリに固定しない)。
            # 接続情報が不明な盤(None)は、手修正後も3カテゴリから選び直せる。
            box_category=selection.category,
            code_overridden=True,
            **base,
        )

    if selection.status is SelectionStatus.SELECTED and selection.item is not None:
        return EstimateResultCandidate(
            master_item_id=selection.item.id,
            code=selection.item.code,
            judgment_method=JudgmentMethod.DESIGN_DATA,
            judgment_reason=selection.reason,
            unit_price=selection.item.total_price_a,
            status=EstimateResultStatus.AUTO,
            box_category=selection.category,
            **base,
        )

    # 要確認: コードは選ばない(空コード・マスタ参照なし・金額なし)。
    return EstimateResultCandidate(
        master_item_id=None,
        code="",
        judgment_method=JudgmentMethod.NEEDS_CONFIRMATION,
        judgment_reason=f"要確認: {selection.reason}({_dims_text(dims)})",
        unit_price=None,
        status=EstimateResultStatus.NEEDS_REVIEW,
        box_category=selection.category,
        **base,
    )


def mark_duplicates_with_detection_results(
    box_candidates: list[EstimateResultCandidate], other_candidates: list[EstimateResultCandidate]
) -> list[tuple[int | None, int | None, str]]:
    """図面検出由来(新旧方式)の候補と同じ盤・同じコードの箱行を、双方とも要確認にする。

    根拠なく合算・削除しない(どちらの行も残す)。戻り値は衝突した(面番号, 盤番号, コード)。
    """
    conflicts: list[tuple[int | None, int | None, str]] = []
    note = "要確認: 同じ盤・同じコードの明細が箱コード自動選定と図面検出由来の両方にあります(重複の可能性)"
    for box in box_candidates:
        if not box.code:
            continue
        twins = [
            c
            for c in other_candidates
            if c.code == box.code
            and c.target_panel_ban_menno == box.target_panel_ban_menno
            and c.target_panel_ban_no == box.target_panel_ban_no
        ]
        if not twins:
            continue
        conflicts.append((box.target_panel_ban_menno, box.target_panel_ban_no, box.code))
        for c in [box, *twins]:
            c.status = EstimateResultStatus.NEEDS_REVIEW
            c.judgment_reason = f"{c.judgment_reason} / {note}" if c.judgment_reason else note
    return conflicts


__all__ = [
    "BOX_RESULT_KEY_PREFIX",
    "box_result_key",
    "build_box_candidates",
    "list_box_master_items",
    "mark_duplicates_with_detection_results",
    "outline_front_panels",
    "resolve_panel_dimensions",
    "resolve_primary_symbol",
]
