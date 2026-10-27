"""製番単位の積算仕様Excel出力 (読み取り専用)。

指示(図面情報パネルの表示内容・Excel出力):
  - 「図面情報」パネル(`PanelInfo.tsx`、旧「盤情報」)に現在表示する盤情報と、
    アプリが保持している他の積算仕様情報を、製番単位でExcelへ出力する。
  - 旧「図面情報」パネル(図面情報タイプ選択+BBox作成の入口、現在は
    「図面情報追加」へ移動済み)に表示していた情報はExcel出力に含めない
    (`drawing_evidence_types`/候補マニフェストはこのモジュールが一切参照
    しないことで担保する)。
  - 実際に取得・保持している情報だけを出力し、未取得の値や仕様を推測で
    埋めない。取得できない項目は固定の`_UNCONFIRMED`文字列("未確認")で
    明示し、「0」や空文字など実データと誤認しうる値で埋めない。
  - 各盤に属する情報は面番号・盤番号・盤名称で識別できるようにし、
    製番仕様(どの盤にも属さない)と各盤の仕様を混同しない
    (`EstimateResult.target_panel_ban_menno/ban_no`の有無で機械的に区別する)。
  - 読み取り専用: 既存DB・積算データへの書き込みは一切行わない。使う関数は
    すべて既存の読み取り専用repository/service(`list_results_for_product`・
    `get_master_item`・`load_estcode_df`)のみで、このモジュール自身もDB更新
    系のSQLを一切発行しない。

データソースの対応関係 (指示: 「出力対象に含める既存データの範囲と出典を
実装前に調査」した結果をそのまま反映する):
  - 「盤情報」シート ← `estcode_df.csv`(`load_estcode_df`、`GET /api/products/
    {product_no}/estimate-panels`と同じ読み取り関数)。Frontend側の
    `PanelInfo.tsx`は高さ/幅/奥行についてproduct_df.csv側の値への
    fallback表示を行うが、このExcel出力では単純化のためfallbackを行わず
    estcode_df.csv自身の値のみを使う(欠損時は「未確認」。product_df.csvの
    値を推測で補わないという指示をより厳格に満たすための意図的な設計)。
  - 「積算仕様」シート ← `estimate_results`テーブル(`list_results_for_product`、
    `GET /api/products/{product_no}/estimate-results`と同じ読み取り関数)。
    品名/型式/定格は`master_item_id`経由で`estimate_master_items`
    (`get_master_item`)を引く(いずれも既存の読み取り専用経路)。
"""
from __future__ import annotations

import io
import sqlite3
from datetime import datetime

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.worksheet.worksheet import Worksheet

from app.repositories.estimate_results import list_results_for_product
from app.repositories.master import get_master_item
from app.services.data_source import resolve_product_dir
from app.services.estcode_df import EstimatePanelInfo, load_estcode_df

_UNCONFIRMED = "未確認"


def _cell(value: object | None) -> object:
    """Noneは「未確認」として明示する(空欄のまま・0埋めにはしない)。"""
    return value if value is not None else _UNCONFIRMED


def _enum_value(value: object | None) -> object:
    """`str, Enum`系フィールド用。`.value`を明示的に取り出してから`_cell`する
    (openpyxlがEnumメンバーをそのままセルへ書き込んだ場合の表示崩れを避ける)。
    """
    return _cell(getattr(value, "value", value))


def _write_header(ws: Worksheet, headers: list[str]) -> None:
    ws.append(headers)
    for cell in ws[1]:
        cell.font = Font(bold=True)


def _append_panel_row(ws: Worksheet, panel: EstimatePanelInfo) -> None:
    ws.append(
        [
            panel.ban_menno,
            panel.ban_no,
            _cell(panel.ban_meisyou),
            _cell(panel.model),
            _cell(panel.ban_h),
            _cell(panel.ban_w),
            _cell(panel.ban_d),
            _cell(panel.ban_connect),
        ]
    )


def build_product_export_workbook(conn: sqlite3.Connection, root: str, product_no: str) -> bytes:
    """製番`product_no`の盤情報・積算仕様をまとめたExcel(.xlsx)をバイト列で返す。

    製番自体が存在しない/データ参照ルートが不正な場合は、`resolve_product_dir`
    がそのまま`DataSourceError`系の例外を送出する(呼び出し元のrouterが
    既存の`_error_to_http`でHTTPエラーへ変換する想定、他のproductsエンドポイント
    と同じ扱い)。
    """
    resolution = resolve_product_dir(root, product_no)

    estcode_result = load_estcode_df(resolution.ccv_dir, resolution.product_no)
    results = list_results_for_product(conn, product_no=product_no)

    wb = Workbook()

    # --- 概要 (指示: 製番単位での出力であることを明示する最小限の表紙) ---
    overview = wb.active
    overview.title = "概要"
    _write_header(overview, ["項目", "値"])
    overview.append(["製番", product_no])
    overview.append(["出力日時", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])

    # --- 盤情報 (指示: 「図面情報」パネル(旧「盤情報」)に現在表示する盤情報) ---
    panel_sheet = wb.create_sheet("盤情報")
    _write_header(panel_sheet, ["面番号", "盤番号", "盤名称", "型式", "高さ", "幅", "奥行", "接続"])
    for panel in sorted(estcode_result.panels, key=lambda p: (p.ban_menno, p.ban_no)):
        _append_panel_row(panel_sheet, panel)

    # --- 積算仕様 (指示: アプリが保持している他の積算仕様情報。
    #     対象区分列で製番仕様/各盤を区別し、各盤は面番号・盤番号で識別する) ---
    spec_sheet = wb.create_sheet("積算仕様")
    _write_header(
        spec_sheet,
        [
            "対象区分",
            "面番号",
            "盤番号",
            "コード",
            "品名",
            "型式",
            "定格",
            "数量",
            "適用単位",
            "係数",
            "単価",
            "金額",
            "判定方法",
            "ステータス",
        ],
    )
    master_item_cache: dict[int, object | None] = {}
    for r in results:
        master_item = None
        if r.master_item_id is not None:
            if r.master_item_id not in master_item_cache:
                master_item_cache[r.master_item_id] = get_master_item(conn, r.master_item_id)
            master_item = master_item_cache[r.master_item_id]

        # 製番仕様(どの盤にも属さない)と各盤の仕様は、target_panel_ban_menno/
        # ban_noの有無で機械的に区別する(フロントエンドのUI上の「要確認」
        # バケット分類はBBox幾何形状からの導出ロジックであり、このテーブルの
        # 列に直接保持されていないため、ここでは再現・推測しない)。
        is_panel_specific = r.target_panel_ban_menno is not None and r.target_panel_ban_no is not None

        spec_sheet.append(
            [
                "各盤" if is_panel_specific else "製番仕様",
                # 製番仕様(どの盤にも属さない)行は面番号/盤番号セルを空欄にする
                # (「未確認」ではない。値が無いこと自体が正しい状態のため)。
                r.target_panel_ban_menno if is_panel_specific else None,
                r.target_panel_ban_no if is_panel_specific else None,
                r.code,
                _cell(master_item.category) if master_item is not None else _UNCONFIRMED,
                _cell(master_item.model) if master_item is not None else _UNCONFIRMED,
                _cell(master_item.rating) if master_item is not None else _UNCONFIRMED,
                r.quantity,
                _enum_value(r.applicable_unit),
                r.current_factor,
                _cell(r.unit_price),
                _cell(r.price),
                _enum_value(r.judgment_method),
                _enum_value(r.status),
            ]
        )

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()
