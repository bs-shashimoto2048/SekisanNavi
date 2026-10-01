"""0010_estimate_confirmation_result_snapshot
Issue #40 Phase 6-A: 積算確定(EstimateConfirmation)の確定対象を
旧Detectionから EstimateResult へ移行するための snapshot 列拡張。

方針(docs/decision-snapshot-design.md、Issue #40 Phase 6-A指示に準拠):
  - 既存列の意味は変更しない(quantity/unit_price/amount等は従来どおり
    「この明細行の数量/単価/金額」を表す。母集団がDetectionから
    EstimateResultへ変わるだけで、列が表す概念自体は変えていない)。
  - 過去のconfirmation行(Phase B-1〜Phase 5以前に保存された、Detection
    ベースの行)は一切書き換えない。全てのALTER/テーブル再構築は
    「列を追加する」方向のみで、既存行のデータを破壊的に変更しない。
  - 新しい行(EstimateResultベース)は、1個のEstimateResultに対し複数の
    根拠(BBox/設計データ)を持ちうるため、根拠は
    estimate_confirmation_result_evidence という別テーブルへ
    1件ずつ非正規化コピーする(estimate_result_evidenceと同じ考え方)。

なぜテーブル再構築(DROP+CREATE+RENAME)が必要か:
  SQLiteのALTER TABLEはADD COLUMNのみサポートし、既存列のNOT NULL制約を
  解除する手段を持たない。旧`source_type`/`status`列は「確定時点の
  Detection.source_type/status」を表すNOT NULL列だったが、
  design_data判定のみのEstimateResult(根拠BBoxを1件も持たない結果)には
  対応するDetectionが存在せず、これらの値を機械的に捏造することはできない
  (実データ方針: 無い値を推測で埋めない)。そのため、この2列に限り
  nullable化が必要であり、`0004_master_schema_v2.sql`と同じ
  「新テーブルへ複製→旧テーブル削除→rename」パターンを踏襲する。
  既存行のidは複製時にそのまま保持するため、AUTOINCREMENTの連番は
  このrename後も断絶しない(SQLiteの`ALTER TABLE ... RENAME TO`は
  `sqlite_sequence`のテーブル名も追従して書き換える。別途検証スクリプトで
  確認済み)。

【PR #45レビュー指摘によりSQLファイルからPython migrationへ変更】
当初は本migrationを `.sql`(`app/db/migrate.py::run_migrations`が
`conn.executescript()`で一括実行)として実装していたが、以下2点の問題が
レビューで指摘され、実機検証でも再現することを確認した。

1. `PRAGMA foreign_keys = OFF/ON`はSQLiteの仕様上「保留中のトランザクション
   がある間は no-op になる」("This pragma is a no-op within a transaction")。
   `executescript()`は実行前に保留中のトランザクションを一旦COMMITするため、
   このmigration単体では当該PRAGMAの効果自体は確認できた(検証用スクリプトで
   `PRAGMA foreign_keys`の値・`PRAGMA foreign_key_check`で確認済み)。
   ただし、そもそも本migrationが行っているのは「`estimate_confirmation_items`
   (他テーブル`estimate_confirmations`を参照する"子"テーブル)を複製・再構築
   する」操作であり、SQLiteの外部キー制約は参照先(親)テーブルを削除する
   操作やDML(INSERT/UPDATE/DELETE)でのみ検査される。子テーブル自身を
   DROP/RENAMEする操作はPRAGMAの状態に関わらず外部キー違反にならないことを
   実機検証で確認した(`verify_fk_recreate.py`相当の検証:
   `PRAGMA foreign_keys = ON`のまま子テーブルを複製・DROP・RENAMEしても
   `PRAGMA foreign_key_check`は0件のまま)。そのため、このPRAGMA切替自体が
   本migrationには不要と判断し、削除した(0004は親テーブル
   `estimate_master_items`の再構築であり、子テーブル`detections`が存在する
   ため、あちらでは引き続きPRAGMA切替が妥当)。
2. より重大な問題として、`executescript()`は(スクリプト自身が明示的な
   `BEGIN`を含まない限り)各DDL文を個別にオートコミットする。そのため、
   複数文から成るこのmigrationが途中(例: `CREATE TABLE
   estimate_confirmation_result_evidence`の直前)で失敗した場合、
   `DROP TABLE estimate_confirmation_items`は既にコミット済みで、
   `estimate_confirmation_items`テーブル自体が存在しない中途半端な状態が
   そのまま残ってしまうことを実機検証で確認した(`run_migrations()`
   呼び出し元の`get_connection()`がcatchする`conn.rollback()`は、個々のDDL文が
   既にオートコミットされているため何も戻せない)。

   この問題を解消するため、本migrationは`.py`形式(`apply(conn)`)へ変更し、
   明示的に`BEGIN`してからDDL文を発行し、成功時のみ`COMMIT`、例外発生時は
   `ROLLBACK`してから再送出する。これにより、本migration内の一連のDDLが
   「全て適用されるか、全く適用されないか」のいずれかになることを保証する
   (実機検証: わざと不正なSQLを混ぜた同等のシーケンスで、明示的`BEGIN`が
   無い場合は中間テーブルが残る一方、`BEGIN`/`ROLLBACK`で挟むと元のテーブルが
   無傷のまま残ることを確認済み)。

   `BEGIN`後は`PRAGMA foreign_keys`の切替が意味を持たなくなる(上記1の通り
   no-opになる仕様のため)が、1で述べた通りこのmigrationには元より不要な
   操作だったため、問題にならない。
"""
from __future__ import annotations

import sqlite3


def apply(conn: sqlite3.Connection) -> None:
    existing_columns = {row[1] for row in conn.execute("PRAGMA table_info(estimate_confirmation_items)").fetchall()}
    if "current_factor" in existing_columns:
        # 既にこのmigrationが適用済みのスキーマ(他経路で先に反映された等)に
        # 対しても安全に冪等であるよう防御しておく(0009と同じ考え方)。
        return

    # `run_migrations()`のループは、このmigrationの直前に処理された
    # migration(前のファイルの`schema_migrations`へのINSERT等)によって
    # 暗黙のトランザクションを開いたままにしていることがある(pysqlite3は
    # INSERT/UPDATE/DELETE文の前で、既存のトランザクションが無ければ自動的に
    # `BEGIN`する仕様のため)。`conn.execute("BEGIN")`はトランザクション中に
    # 呼ぶと`OperationalError: cannot start a transaction within a
    # transaction`になるため、`executescript()`の「実行前に保留中の
    # トランザクションを暗黙的にCOMMITする」仕様を明示的に真似て、まず
    # 保留分を確定させてから自分自身のトランザクションを開始する
    # (実機検証で、この対応が無いと新規DBへの通常のmigration適用シーケンス
    # 自体が失敗することを確認した)。
    if conn.in_transaction:
        conn.commit()

    try:
        conn.execute("BEGIN")

        conn.execute(
            """
            CREATE TABLE estimate_confirmation_items_v2 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                confirmation_id INTEGER NOT NULL REFERENCES estimate_confirmations(id),

                -- 歴史的参照(FK制約なし。0007の既存コメントと同じ理由)
                detection_id INTEGER,
                drawing_page_id INTEGER,

                -- 対象(積算集約の対象別内訳を確定後も再現するための非正規化
                -- コピー)。意味は0007から変更しない。EstimateResultベースの
                -- 新しい行ではtarget_panel_ban_menno/ban_noの有無から
                -- 'product'/'panel'のいずれかを設定する('tie'は要確認行の
                -- 確定自体を拒否するため新しい行では使わない)。
                target_id TEXT NOT NULL,
                target_type TEXT NOT NULL,
                ban_menno INTEGER,
                ban_no INTEGER,
                panel_name TEXT,

                -- 積算コード(確定時点の値)
                master_item_id INTEGER,
                code TEXT NOT NULL,
                category TEXT,
                model TEXT,
                rating TEXT,

                -- [Issue #40 Phase 6-A] 旧Detectionベースの行にのみ意味を持つ
                -- 列のためnullableへ変更した(モジュールdocstring参照)。
                -- 意味自体(確定時点のDetection.source_type/status)は
                -- 変更しない。EstimateResultベースの新しい行では対応する
                -- Detectionが無い場合(design_data判定のみ)NULLのままになる。
                source_type TEXT,
                status TEXT,

                quantity REAL NOT NULL DEFAULT 1,
                unit_price REAL,
                amount REAL,

                -- 確定時点のBBox(旧Detectionベースの行のみ非NULL。
                -- EstimateResultベースの新しい行は、根拠が複数/0件になりうる
                -- ため、代わりにestimate_confirmation_result_evidence側へ
                -- 1件ずつ記録する)。
                bbox_x REAL,
                bbox_y REAL,
                bbox_w REAL,
                bbox_h REAL,
                page_no INTEGER,

                -- [Issue #40 Phase 6-A 新規列] EstimateResultからのsnapshot。
                -- 旧Detectionベースの行では全てNULLのまま(既存行の意味を
                -- 変えない)。
                current_factor REAL,
                factor_overridden INTEGER,
                judgment_method TEXT,
                applicable_unit TEXT,
                judgment_reason TEXT,
                source_rule_id INTEGER,
                -- EstimateResultStatus('auto'/'reviewed'/'excluded'。確定操作
                -- 自体がneeds_reviewの存在を拒否するため、この列に
                -- 'needs_review'が入ることは無い)。旧Detectionベースの行の
                -- `status`列(DetectionStatus)とは別概念のため、別列として持つ。
                result_status TEXT
            )
            """
        )

        conn.execute(
            """
            INSERT INTO estimate_confirmation_items_v2 (
                id, confirmation_id, detection_id, drawing_page_id,
                target_id, target_type, ban_menno, ban_no, panel_name,
                master_item_id, code, category, model, rating,
                source_type, status, quantity, unit_price, amount,
                bbox_x, bbox_y, bbox_w, bbox_h, page_no
            )
            SELECT
                id, confirmation_id, detection_id, drawing_page_id,
                target_id, target_type, ban_menno, ban_no, panel_name,
                master_item_id, code, category, model, rating,
                source_type, status, quantity, unit_price, amount,
                bbox_x, bbox_y, bbox_w, bbox_h, page_no
            FROM estimate_confirmation_items
            """
        )

        conn.execute("DROP TABLE estimate_confirmation_items")
        conn.execute("ALTER TABLE estimate_confirmation_items_v2 RENAME TO estimate_confirmation_items")
        conn.execute(
            "CREATE INDEX idx_estimate_confirmation_items_confirmation_id "
            "ON estimate_confirmation_items(confirmation_id)"
        )

        # ============================================================
        # 積算確定snapshotの根拠 (estimate_confirmation_result_evidence、
        # Issue #40 Phase 6-A新設)。
        #
        # confirmation_items 1行(= EstimateResult 1件分の確定snapshot)に
        # 対し、0件以上の根拠を1件ずつ記録する(estimate_result_evidenceと
        # 同じ「1結果 : 複数根拠」の多対多構造をsnapshot側でも再現する)。
        #
        # confirmation_item_idはestimate_confirmation_itemsへのFK制約を持つ
        # (confirmation_items自体がappend-only・削除されないため、
        # decision_eventsのような自己参照削除問題は発生しない。header→items
        # の既存FK関係と同じ考え方)。detection_id/drawing_page_idは
        # estimate_result_evidence・既存confirmation_items同様、意図的に
        # FK制約を持たない(確定後にDetectionが削除されても、このsnapshot行
        # 自体は解釈できる状態を維持するため)。
        # ============================================================
        conn.execute(
            """
            CREATE TABLE estimate_confirmation_result_evidence (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                confirmation_item_id INTEGER NOT NULL REFERENCES estimate_confirmation_items(id),

                -- 'detection' | 'design_data'
                evidence_kind TEXT NOT NULL,

                -- BBox根拠の場合のみ非NULL(FKなし、上記コメント参照)。
                detection_id INTEGER,
                drawing_page_id INTEGER,
                -- 'ai' | 'manual'。BBox根拠のみ非NULL。
                source_type TEXT,
                -- 図面情報マスタのkey(evidence_type_key経由のBBoxのみ非NULL)。
                evidence_type_key TEXT,
                -- 表示名解決用の非正規化コピー(旧Manual BBox経由のBBoxのみ非NULL)。
                master_item_code TEXT,
                class_name TEXT,
                bbox_x REAL,
                bbox_y REAL,
                bbox_w REAL,
                bbox_h REAL,
                page_no INTEGER,

                -- 設計データ根拠の場合のみ非NULL(estimate_result_evidence.
                -- design_data_refと同じJSON文字列をそのままコピーする)。
                design_data_ref TEXT
            )
            """
        )
        conn.execute(
            "CREATE INDEX idx_estimate_confirmation_result_evidence_item_id "
            "ON estimate_confirmation_result_evidence(confirmation_item_id)"
        )

        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
