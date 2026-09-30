-- 0008_estimate_rule_engine_foundation.sql
-- Issue #40 Phase 2: 積算コード選定〜数量・係数・金額/工数算出の一貫ルール化。
-- 「図面情報(根拠)」と「積算結果(導出物)」を分離したデータモデル/ルールエンジン基盤。
--
-- 設計の背景・判断根拠はIssue #40 Phase 1/Phase 2報告コメント参照。既存の
-- detections / estimate_master_items / estimate_confirmations 等へのALTERは
-- 最小限に留め(detections.evidence_type_keyの追加のみ)、新しい概念は
-- 完全に独立したテーブル群として追加する(既存の追記専用・FK制約なしの
-- 歴史的参照という設計原則を踏襲する)。
--
-- 重要: このmigrationは「基盤」のみを追加する。実際の判定ルール・係数候補・
-- 価格計算式のデータは1件も投入しない(Issue #40指示: 個別コードの大量実装は
-- Phase 3以降。資料に根拠がない計算式を推測で確定しない)。

-- ============================================================
-- 1. 図面情報マスタ (Issue #40 10-1章)
--    「VCT」「CH」「トランス」等、作業者が図面上で入力する意味のカタログ。
--    積算コードそのものは持たず、ルール(estimate_rule_masters)を介して
--    コードへつなぐ(Issue #40 10-1章「積算コードそのものを直接持たせない」)。
-- ============================================================
CREATE TABLE drawing_evidence_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- 内部識別子。作業者向け表示名(display_name)とは別に持つ(表示文言の変更が
    -- 既存データ・ルール参照を壊さないようにするため)。
    key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    category TEXT,
    -- 'estimate_target' | 'condition' | 'both' (Issue #40 2-2章)
    usage TEXT NOT NULL DEFAULT 'both',
    -- 既定の判定範囲。'position' | 'range' | 'panel' | 'drawing' | 'product' | 'design_data'
    -- (Issue #40 4章「判定範囲」)。個々のルール側で上書きできる想定のため、
    -- あくまで初期値/ヒントに過ぎない。
    default_judgment_scope TEXT NOT NULL DEFAULT 'panel',
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_drawing_evidence_types_enabled ON drawing_evidence_types(enabled);

-- ============================================================
-- 2. 積算コード/ルールマスタ (Issue #40 10-2章)
--    既存 estimate_master_items (品名/型式/定格/価格内訳) を土台に、
--    ルール関連の列だけを1:1で追加する(既存列を複製しない)。
-- ============================================================
CREATE TABLE estimate_rule_masters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    master_item_id INTEGER NOT NULL UNIQUE REFERENCES estimate_master_items(id),

    -- 判定方法: 'design_data' | 'drawing_judgment' | 'needs_confirmation'
    -- (Issue #40 1章。UI表示は「設計データ/図面判定/要確認」)。
    judgment_method TEXT NOT NULL DEFAULT 'needs_confirmation',
    -- 判定範囲: 'position' | 'range' | 'panel' | 'drawing' | 'product' | 'design_data'
    -- (Issue #40 4章)。
    judgment_scope TEXT NOT NULL DEFAULT 'design_data',
    -- 適用単位 (Issue #40 5章)。内部enum化可としているため自由入力のTEXTで持つ
    -- (候補: face/unit/product/location/sheet/actual_quantity/other、
    -- `app/domain/estimate_rules.py::ApplicableUnit`参照)。
    applicable_unit TEXT,
    -- 数量算定方式 (Issue #40 6章)。Phase 2時点で実装済みなのは
    -- 'per_evidence'(根拠1件につき1)のみ。他の値は将来の拡張用に列挙するのみで、
    -- 評価器側は未実装のためneeds_confirmationへフォールバックする
    -- (`app/services/estimate_rule_evaluator.py`参照)。
    quantity_method TEXT NOT NULL DEFAULT 'per_evidence',
    initial_factor REAL NOT NULL DEFAULT 1.0,
    -- 許容係数候補 (Issue #40 7-3章「自由入力ではなく候補値から選択」)。
    -- JSON配列文字列 (例: '[0.5, 0.7, 1.0]')。未設定の場合は候補を持たない
    -- (=自由入力扱いになるが、Phase 2ではUIを一切実装しないため実害は無い)。
    allowed_factors TEXT,
    -- 標準ルールの判定条件 (Issue #40 11章「標準ルール」)。JSON文字列。
    -- 構造は `app/services/estimate_rule_evaluator.py::StandardCondition` の
    -- 単純な形(必須図面情報種別 + 設計データ条件のAND)のみサポートする
    -- (資料からは複雑な条件式の機械可読な仕様を確認できていないため、
    -- Phase 2では最小限の構造に留める。Issue #40 Phase 1報告コメント参照)。
    judgment_condition TEXT,
    judgment_reason_template TEXT,
    -- 価格計算種別 (Issue #40 13-2章): 'direct' | 'add' | 'subtract' |
    -- 'multiply_price' | 'multiply_labor' | 'multiply_both' | 'custom'。
    -- Phase 2で実際に計算するのは 'direct' のみ(単価×数量×係数、Issue #40
    -- 13-2章が「基本算出モデル」として明示する式)。他の値は列挙のみで、
    -- 評価器は price=NULL のまま "要確認" として扱う(推測実装しない)。
    calc_type TEXT NOT NULL DEFAULT 'direct',
    -- 処理方式: 'standard' | 'custom' (Issue #40 11章のハイブリッド方式)。
    processing_mode TEXT NOT NULL DEFAULT 'standard',
    -- 専用ルールhandlerの識別キー (processing_mode='custom'の場合のみ使用)。
    -- Phase 2時点ではhandlerを1件も登録しない(空のregistry)。
    custom_handler_key TEXT,
    -- Viewerへ図示するか (Issue #40 1章「設計データだけで決定できるコードは
    -- Viewerへ図示しない」)。
    auto_display INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_estimate_rule_masters_master_item_id ON estimate_rule_masters(master_item_id);
CREATE INDEX idx_estimate_rule_masters_enabled ON estimate_rule_masters(enabled);

-- ============================================================
-- 3. 積算結果 (EstimateResult、Issue #40 12章の標準モデル)
--    「導出物」。confirmation(過去snapshot)とは異なり、常に「現在の根拠+
--    設計データ+ルール」から評価器が再構築する現在状態のテーブルである
--    (append-onlyではない。ただし手修正した係数は再評価で上書きしない。
--    Issue #40 7-3章/14章)。
--
--    `result_key` は同じ根拠の組み合わせ・同じルールから導かれた結果を
--    再評価のたびに同一視するための安定キー(評価器が
--    `f"{code}:{judgment_scope}:{target_key}:{evidence_fingerprint}"`のような
--    形で決定論的に生成する。詳細は`app/services/estimate_rule_evaluator.py`
--    参照)。UNIQUE制約により、同じ(product_no, result_key)への再評価は
--    UPSERTとして扱われ、current_factor/factor_overriddenなどの手修正済み
--    列は評価器がSELECTで読み取った上で意図的に保持する(SQLのUPSERT構文
--    ではなく、Python側で「既存行があれば手修正列を引き継ぐ」制御を行う。
--    UNIQUE制約はあくまで重複防止のため)。
-- ============================================================
CREATE TABLE estimate_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_no TEXT NOT NULL,
    result_key TEXT NOT NULL,

    master_item_id INTEGER REFERENCES estimate_master_items(id),
    code TEXT NOT NULL,

    quantity REAL NOT NULL DEFAULT 1,
    applicable_unit TEXT,

    initial_factor REAL NOT NULL DEFAULT 1.0,
    current_factor REAL NOT NULL DEFAULT 1.0,
    factor_overridden INTEGER NOT NULL DEFAULT 0,
    factor_override_reason TEXT,
    factor_updated_at TEXT,
    factor_updated_by TEXT,

    -- 'design_data' | 'drawing_judgment' | 'needs_confirmation'
    judgment_method TEXT NOT NULL,
    -- 'position' | 'range' | 'panel' | 'drawing' | 'product' | 'design_data'
    judgment_scope TEXT NOT NULL,

    target_panel_ban_menno INTEGER,
    target_panel_ban_no INTEGER,
    -- FKなし(estimate_confirmation_items等と同じ、drawing_pagesの
    -- 現況に依存しない参考情報として保持する)。
    target_drawing_page_id INTEGER,

    judgment_reason TEXT,
    source_rule_id INTEGER REFERENCES estimate_rule_masters(id),

    -- 係数適用前の単価/工数(evaluator算出時点のestimate_master_items由来値の
    -- コピー)。price/laborの再計算(係数の手修正・初期値復元時、evaluatorを
    -- 再実行せずに済むように保持する)に使う。calc_type='direct'以外、および
    -- 業務ルールが未確定な組み合わせでは常にNULL。
    unit_price REAL,
    unit_labor REAL,
    -- 価格・工数 (Issue #40 13章)。`unit_price/unit_labor × quantity ×
    -- current_factor`で計算した値。unit_price/unit_laborがNULLの場合は
    -- 常にNULLのまま(0円/0工数への捏造はしない)。
    price REAL,
    labor REAL,

    -- 'auto' | 'reviewed' | 'needs_review' | 'excluded'
    status TEXT NOT NULL DEFAULT 'auto',

    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_estimate_results_product_result_key
    ON estimate_results(product_no, result_key);
CREATE INDEX idx_estimate_results_product_no ON estimate_results(product_no);
CREATE INDEX idx_estimate_results_master_item_id ON estimate_results(master_item_id);

-- ============================================================
-- 4. 積算結果⇔根拠 の多対多 (EstimateResultEvidence、Issue #40 9章/12章)
--    複数BBox条件・双方向トレーサビリティの両方をこの1テーブルで表現する。
--    設計データのみで確定した結果は、この表に行を持たない(またはdesign_data
--    種別の行のみを持つ)。
--
--    estimate_result_id にはON DELETE CASCADEを付ける(estimate_resultsは
--    confirmationのような不変snapshotではなく、評価器が毎回作り直す現在状態
--    であり、Python側の再評価ロジックが整合性を管理するため)。detection_id
--    は既存の decision_events / estimate_confirmation_items と同じ理由
--    (歴史的参照、削除後もこの行自体は解釈できるようにする設計)でFK制約を
--    持たない。
-- ============================================================
CREATE TABLE estimate_result_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estimate_result_id INTEGER NOT NULL REFERENCES estimate_results(id) ON DELETE CASCADE,
    -- 'detection' | 'design_data'
    evidence_kind TEXT NOT NULL,
    -- FKなし(上記コメント参照)。evidence_kind='detection'の場合のみ非NULL。
    detection_id INTEGER,
    -- evidence_kind='design_data'の場合、どの設計データ項目を根拠にしたかを
    -- 表すJSON文字列(例: '{"panel": "1:1", "fields": ["ban_w", "ban_d"]}')。
    -- 構造はPhase 3以降で確定させる想定のため、現時点では自由なTEXTとする。
    design_data_ref TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_estimate_result_evidence_result_id
    ON estimate_result_evidence(estimate_result_id);
CREATE INDEX idx_estimate_result_evidence_detection_id
    ON estimate_result_evidence(detection_id);

-- ============================================================
-- 5. detections の拡張(既存列は一切変更しない、追加のみ)
--    Issue #40 2-1章「BBox = 積算コード、を廃止する」を受け、BBoxが
--    「図面上の意味を持った根拠情報」であることを表す新しい分類列を追加する。
--    既存の master_item_id は一切変更・削除しない(Issue #40指示2:
--    「新しい設計までDetection=積算コードへ引きずらない」は、既存の
--    Detection運用・Viewer挙動を壊さないことを優先し、
--    master_item_idは従来通り残しつつ、新しい評価器はこちらの
--    evidence_type_keyが設定された行のみを対象にする形で実現する)。
--    既存行はすべてNULLのまま(バックフィルはしない。Phase 3の入力UI再設計
--    以降、新規/更新されるBBoxから徐々に設定されていく想定)。
-- ============================================================
ALTER TABLE detections ADD COLUMN evidence_type_key TEXT REFERENCES drawing_evidence_types(key);

CREATE INDEX idx_detections_evidence_type_key ON detections(evidence_type_key);
