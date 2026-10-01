-- 0010_estimate_confirmation_result_snapshot.sql
-- Issue #40 Phase 6-A: 積算確定(EstimateConfirmation)の確定対象を
-- 旧Detectionから EstimateResult へ移行するための snapshot 列拡張。
--
-- 方針(docs/decision-snapshot-design.md、Issue #40 Phase 6-A指示に準拠):
--   - 既存列の意味は変更しない(quantity/unit_price/amount等は従来どおり
--     「この明細行の数量/単価/金額」を表す。母集団がDetectionから
--     EstimateResultへ変わるだけで、列が表す概念自体は変えていない)。
--   - 過去のconfirmation行(Phase B-1〜Phase 5以前に保存された、Detection
--     ベースの行)は一切書き換えない。全てのALTER/テーブル再構築は
--     「列を追加する」方向のみで、既存行のデータを破壊的に変更しない。
--   - 新しい行(EstimateResultベース)は、1個のEstimateResultに対し複数の
--     根拠(BBox/設計データ)を持ちうるため、根拠は
--     estimate_confirmation_result_evidence という別テーブルへ
--     1件ずつ非正規化コピーする(estimate_result_evidenceと同じ考え方)。
--
-- なぜテーブル再構築(DROP+CREATE+RENAME)が必要か:
--   SQLiteのALTER TABLEはADD COLUMNのみサポートし、既存列のNOT NULL制約を
--   解除する手段を持たない。旧`source_type`/`status`列は「確定時点の
--   Detection.source_type/status」を表すNOT NULL列だったが、
--   design_data判定のみのEstimateResult(根拠BBoxを1件も持たない結果)には
--   対応するDetectionが存在せず、これらの値を機械的に捏造することはできない
--   (実データ方針: 無い値を推測で埋めない)。そのため、この2列に限り
--   nullable化が必要であり、`0004_master_schema_v2.sql`と同じ
--   「新テーブルへ複製→旧テーブル削除→rename」パターンを踏襲する。
--   既存行のidは複製時にそのまま保持するため、AUTOINCREMENTの連番は
--   このrename後も断絶しない(SQLiteの`ALTER TABLE ... RENAME TO`は
--   `sqlite_sequence`のテーブル名も追従して書き換える)。

PRAGMA foreign_keys = OFF;

CREATE TABLE estimate_confirmation_items_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    confirmation_id INTEGER NOT NULL REFERENCES estimate_confirmations(id),

    -- 歴史的参照(FK制約なし。0007の既存コメントと同じ理由)
    detection_id INTEGER,
    drawing_page_id INTEGER,

    -- 対象(積算集約の対象別内訳を確定後も再現するための非正規化コピー)。
    -- 意味は0007から変更しない。EstimateResultベースの新しい行では
    -- target_panel_ban_menno/ban_noの有無から'product'/'panel'のいずれかを
    -- 設定する('tie'は要確認行の確定自体を拒否するため新しい行では使わない)。
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

    -- [Issue #40 Phase 6-A] 旧Detectionベースの行にのみ意味を持つ列のため
    -- nullableへ変更した(上記コメント参照)。意味自体(確定時点のDetection.
    -- source_type/status)は変更しない。EstimateResultベースの新しい行では
    -- 対応するDetectionが無い場合(design_data判定のみ)NULLのままになる。
    source_type TEXT,
    status TEXT,

    quantity REAL NOT NULL DEFAULT 1,
    unit_price REAL,
    amount REAL,

    -- 確定時点のBBox(旧Detectionベースの行のみ非NULL。EstimateResultベースの
    -- 新しい行は、根拠が複数/0件になりうるため、代わりに
    -- estimate_confirmation_result_evidence側へ1件ずつ記録する)。
    bbox_x REAL,
    bbox_y REAL,
    bbox_w REAL,
    bbox_h REAL,
    page_no INTEGER,

    -- [Issue #40 Phase 6-A 新規列] EstimateResultからのsnapshot。
    -- 旧Detectionベースの行では全てNULLのまま(既存行の意味を変えない)。
    current_factor REAL,
    factor_overridden INTEGER,
    judgment_method TEXT,
    applicable_unit TEXT,
    judgment_reason TEXT,
    source_rule_id INTEGER,
    -- EstimateResultStatus('auto'/'reviewed'/'excluded'。確定操作自体が
    -- needs_reviewの存在を拒否するため、この列に'needs_review'が入ることは
    -- 無い)。旧Detectionベースの行の`status`列(DetectionStatus)とは
    -- 別概念のため、別列として持つ。
    result_status TEXT
);

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
FROM estimate_confirmation_items;

DROP TABLE estimate_confirmation_items;
ALTER TABLE estimate_confirmation_items_v2 RENAME TO estimate_confirmation_items;

CREATE INDEX idx_estimate_confirmation_items_confirmation_id
    ON estimate_confirmation_items(confirmation_id);

PRAGMA foreign_keys = ON;

-- ============================================================
-- 積算確定snapshotの根拠 (estimate_confirmation_result_evidence、
-- Issue #40 Phase 6-A新設)。
--
-- confirmation_items 1行(= EstimateResult 1件分の確定snapshot)に対し、
-- 0件以上の根拠を1件ずつ記録する(estimate_result_evidenceと同じ
-- 「1結果 : 複数根拠」の多対多構造をsnapshot側でも再現する)。
--
-- confirmation_item_idはestimate_confirmation_itemsへのFK制約を持つ
-- (confirmation_items自体がappend-only・削除されないため、decision_events
-- のような自己参照削除問題は発生しない。header→itemsの既存FK関係と同じ
-- 考え方)。detection_id/drawing_page_idはestimate_result_evidence・
-- 既存confirmation_items同様、意図的にFK制約を持たない(確定後にDetectionが
-- 削除されても、このsnapshot行自体は解釈できる状態を維持するため)。
-- ============================================================
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

    -- 設計データ根拠の場合のみ非NULL(estimate_result_evidence.design_data_ref
    -- と同じJSON文字列をそのままコピーする)。
    design_data_ref TEXT
);

CREATE INDEX idx_estimate_confirmation_result_evidence_item_id
    ON estimate_confirmation_result_evidence(confirmation_item_id);
