"""ダミーデータ投入 (PoC)。

Phase 1: ここでの値は `20250707_積算情報収集システム_U概要.xlsx` の記載内容を
「参考」にしつつ作成した例示データであり、確定仕様ではない。

Phase 1.5: 図面ページについては、実際にデータ参照ルート配下で確認できた製番
`A1GV2421` (`docs/data-source.md` 参照) の実PDFページを参照するよう変更した。
ただし:
  - Detection (BBox) の座標・クラス名・ステータスは、実際のAI検出結果ではなく、
    実図面を目視確認した上でPoC用に配置した「見た目上妥当なダミー値」である。
  - Panel Overlay (panel_areas) の座標も同様に目視ベースの概算値であり、
    製番データ内の KITEN_X/Y 等を用いた厳密なCAD座標変換は行っていない
    (理由は docs/data-model.md の「Overlay座標系」節を参照)。
  - EstimateItem の内容は引き続きExcel参考資料由来の例示であり、製番 A1GV2421 の
    実際の積算結果ではない。

Phase 1.7: 積算コードMaster (estimate_master_items) は `data/master/estimate_master_a.xlsx`
を正式な参照元とすることになったため、本ファイルでのダミー投入は廃止した。
Masterデータの投入は `app/db/master_importer.py` が別途担当する
(`main.py` の起動処理で `seed()` の後に呼び出す)。

実際の積算コード・盤属性・AI検出クラス等は今後変更される前提とする。
(docs/data-model.md, docs/implementation-plan.md 参照)

冪等性: 既にproject_infoが存在する場合は何もしない (再実行に強くする)。
"""
import sqlite3

from app.config import DB_PATH, DEFAULT_DATA_SOURCE_ROOT
from app.db.connection import get_connection
from app.db.migrate import run_migrations

# Phase 1.5 のデモで参照する実製番。データ参照ルート配下で実在を確認済み
# (docs/data-source.md)。この値はデモ用シードデータの中でのみ使用し、
# 業務ロジック (app/services/data_source.py) 側には一切埋め込まない。
DEMO_PRODUCT_NO = "A1GV2421"

# PDFページの既定サイズ (A3横, pt単位)。実際のサイズはFrontend側でPDF.jsが
# ロード時に取得する値を優先し、ここでの値はロード前の仮表示・フォールバックとして
# のみ用いる。
DEFAULT_PAGE_WIDTH_PT = 1191
DEFAULT_PAGE_HEIGHT_PT = 842


def _already_seeded(conn: sqlite3.Connection) -> bool:
    row = conn.execute("SELECT COUNT(*) AS c FROM project_info").fetchone()
    return row["c"] > 0


def seed(conn: sqlite3.Connection) -> None:
    if _already_seeded(conn):
        return

    conn.execute(
        """
        INSERT INTO project_info (seiri_no, seiban, panel_name, analysis_status)
        VALUES (?, ?, ?, ?)
        """,
        (DEMO_PRODUCT_NO, "GV2421", "高圧受電盤（中部電力ミライズ様）", "needs_review"),
    )

    (file_id,) = conn.execute(
        "INSERT INTO drawing_files (original_filename, source_path) VALUES (?, ?) RETURNING id",
        (
            f"{DEMO_PRODUCT_NO} (製番参照)",
            f"{DEFAULT_DATA_SOURCE_ROOT}\\{DEMO_PRODUCT_NO} (read-only参照。実ファイルはGit管理対象外)",
        ),
    ).fetchone()

    # 図面ページ: 実データ調査 (docs/data-source.md) で確認できた製番
    # A1GV2421 の実ページを引用する。drawing_type は product_df.csv の
    # ZUMEI列を参考にした表示上のグルーピング (括弧内の面番号は除いた見出し)。
    pages = [
        # (page_no, drawing_type, drawing_name, order)
        (16, "外形図", "外形図", 0),
        (18, "基礎図", "基礎図", 0),
        (21, "内部機器配置図", "内部機器配置図(1-1)", 0),
        (22, "内部機器配置図", "内部機器配置図(1-2)", 1),
        (23, "内部機器配置図", "内部機器配置図(2-1)", 2),
        (24, "内部機器配置図", "内部機器配置図(2-2)", 3),
        (25, "内部機器配置図", "内部機器配置図(3-1)", 4),
        (26, "内部機器配置図", "内部機器配置図(3-2)", 5),
        (27, "内部機器配置図", "内部機器配置図(4-1)", 6),
        (28, "内部機器配置図", "内部機器配置図(4-2)", 7),
        (29, "内部機器配置図", "内部機器配置図(5-1)", 8),
    ]
    page_ids: dict[int, int] = {}
    for page_no, drawing_type, drawing_name, order in pages:
        (page_id,) = conn.execute(
            """
            INSERT INTO drawing_pages
                (drawing_file_id, page_no, drawing_type, drawing_name,
                 thumbnail_url, image_url, page_width, page_height, display_order,
                 source_type, product_no, source_page_no)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'product_file', ?, ?)
            RETURNING id
            """,
            (
                file_id,
                page_no,
                drawing_type,
                drawing_name,
                None,
                None,
                DEFAULT_PAGE_WIDTH_PT,
                DEFAULT_PAGE_HEIGHT_PT,
                order,
                DEMO_PRODUCT_NO,
                page_no,
            ),
        ).fetchone()
        page_ids[page_no] = page_id

    # 盤: 製番 A1GV2421 の BAN_NO=1 (高圧受電盤) の実数値を参考値として使用。
    # (寸法等の数値のみの引用であり、図面ファイル自体はGitへ含めていない)
    (panel1_id,) = conn.execute(
        "INSERT INTO panels (panel_no, name, primary_drawing_page_id) VALUES (?, ?, ?) RETURNING id",
        ("1", "高圧受電盤", page_ids[16]),
    ).fetchone()

    panel_attrs = [
        # (key, label, value, unit, source, order)
        ("PRODUCT_NO", "製番", DEMO_PRODUCT_NO, None, "design_data", 0),
        ("BAN_NO", "盤番号", "1", None, "design_data", 1),
        ("BAN_MEISYOU", "盤名称", "高圧受電盤", None, "design_data", 2),
        ("BAN_CONNECT", "箱体接続", "箱･左右(R)", None, "design_data", 3),
        ("W", "幅 (W)", "900", "mm", "design_data", 4),
        ("D", "奥行 (D)", "2200", "mm", "design_data", 5),
        ("H1", "高さ1 (H1)", "2300", "mm", "design_data", 6),
        ("H2", "高さ2 (H2)", "2300", "mm", "design_data", 7),
        ("MODEL", "箱体型式", "IS2", None, "design_data", 8),
    ]
    for key, label, value, unit, source, order in panel_attrs:
        conn.execute(
            """
            INSERT INTO panel_attributes (panel_id, key, label, value, unit, source, display_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (panel1_id, key, label, value, unit, source, order),
        )

    # 盤範囲 (Panel Overlay)。外形図P16上で高圧受電盤(1)が写っている3箇所
    # (背面図/正面図/右側面図) を、実図面を目視確認した上での概算値として配置する。
    # 座標は 0.0〜1.0 の正規化座標 (PDFページ原寸に対する比率)。
    panel_areas = [
        # (page_no, area_x, area_y, area_w, area_h, label)
        (16, 0.230, 0.496, 0.065, 0.205, "背面図"),
        (16, 0.633, 0.111, 0.065, 0.219, "正面図"),
        (16, 0.764, 0.111, 0.159, 0.219, "右側面図"),
    ]
    for page_no, ax, ay, aw, ah, label in panel_areas:
        conn.execute(
            """
            INSERT INTO panel_areas (panel_id, drawing_page_id, area_x, area_y, area_w, area_h, label)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (panel1_id, page_ids[page_no], ax, ay, aw, ah, label),
        )

    # 検出 (Detection): 外形図P16を実際に目視確認した上で配置したダミーBBox。
    # AI対応リストのクラス名例を使用しているが、座標・信頼度は実推論結果ではない
    # (docs/data-model.md 参照)。通常/要確認/除外/確認済みの各状態を1件ずつ用意する。
    detections = [
        # (page_no, panel_id, class_name, x, y, w, h, confidence, status)
        (16, panel1_id, "sidedoor_l", 0.040, 0.131, 0.113, 0.171, 0.91, "reviewed"),
        (16, panel1_id, "roof_fan", 0.248, 0.151, 0.036, 0.026, 0.85, "pending"),
        (16, panel1_id, "roof_fan", 0.379, 0.151, 0.036, 0.026, 0.62, "needs_review"),
        (16, panel1_id, "roof_fan_r", 0.786, 0.131, 0.101, 0.051, 0.40, "excluded"),
    ]
    detection_ids: dict[str, int] = {}
    for page_no, panel_id, class_name, x, y, w, h, conf, status in detections:
        (det_id,) = conn.execute(
            """
            INSERT INTO detections
                (drawing_page_id, panel_id, class_name, bbox_x, bbox_y, bbox_w, bbox_h,
                 confidence, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (page_ids[page_no], panel_id, class_name, x, y, w, h, conf, status),
        ).fetchone()
        detection_ids[f"{page_no}:{class_name}:{status}"] = det_id

    # 積算コードMasterについて (Phase 1.7):
    # 以前はここでダミー/一部抜粋のMasterデータを投入していたが、
    # `data/master/estimate_master_a.xlsx` を正式な参照元とすることになったため、
    # ダミー投入は廃止した。Master データは `app/db/master_importer.py` が
    # 起動時に別途取り込む (本seed関数はDetection/Panel/EstimateItem等、
    # 引き続きダミーのままの部分のみを担当する)。

    # 積算結果 (要件13のツリー例に準拠したダミー値)。根拠図面は実ページ(16/18/23)を参照。
    estimate_items = [
        # (code, category, item_name, model, rating, qty, unit, source_type, confidence, status, refs)
        (
            "11001",
            "箱・単独",
            "箱",
            "OS2-816",
            "2.3*0.8*1.6",
            1,
            "面",
            "program",
            None,
            "confirmed",
            [
                (16, None, panel1_id, "外形図P16より箱体寸法を取得"),
                (18, None, panel1_id, "基礎図P18で外形を確認"),
            ],
        ),
        (
            "18004",
            "内部パネル",
            "内部パネル",
            "A1",
            "H+W=1500",
            1,
            "面",
            "ai",
            0.70,
            "needs_review",
            [
                (23, None, panel1_id, "内部機器配置図(2-1)P23を参照 (Detection未紐付け・暫定)"),
            ],
        ),
        (
            "18311",
            "附属品加算価格",
            "換気扇",
            None,
            "天井のみ1面に付",
            1,
            "箇所",
            "ai",
            0.62,
            "needs_review",
            [
                (
                    16,
                    detection_ids["16:roof_fan:needs_review"],
                    panel1_id,
                    "外形図P16のDetection(要確認)より",
                ),
            ],
        ),
    ]
    for code, category, item_name, model, rating, qty, unit, source_type, confidence, status, refs in estimate_items:
        (item_id,) = conn.execute(
            """
            INSERT INTO estimate_items
                (code, category, item_name, model, rating, quantity, unit,
                 source_type, confidence, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            """,
            (code, category, item_name, model, rating, qty, unit, source_type, confidence, status),
        ).fetchone()
        for page_no, detection_id, panel_id, reason in refs:
            conn.execute(
                """
                INSERT INTO estimate_references
                    (estimate_item_id, drawing_page_id, detection_id, panel_id, reason)
                VALUES (?, ?, ?, ?, ?)
                """,
                (item_id, page_ids[page_no], detection_id, panel_id, reason),
            )


def main() -> None:
    run_migrations(DB_PATH)
    with get_connection(DB_PATH) as conn:
        seed(conn)
    print(f"Seed completed: {DB_PATH}")


if __name__ == "__main__":
    main()
