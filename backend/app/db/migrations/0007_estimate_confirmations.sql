-- 0007_estimate_confirmations.sql
-- Issue #4 Phase B-1: 積算確定snapshotの最小schema。
--
-- 設計の詳細・理由付けは docs/decision-snapshot-design.md を参照。既存の
-- detections / estimate_master_items / estimate_items 等へのALTERは行わず、
-- 完全に独立した追加専用(append-only)のテーブルを2つ新設する。実データの
-- 積算集約は estimate_items (Phase 0/1のダミー専用テーブル) を経由しないため、
-- そちらへ手を入れず、Detection単位(積算明細相当)の粒度で確定結果を
-- 別テーブルへ保存する方針とする(設計2章/4章)。

-- 確定操作そのもの(1回の確定 = 1行)。製番(product_no)単位で丸ごと固定する
-- (設計3章: Master Excel再インポートが製番横断で価格へ影響するため)。
-- 上書き禁止・append-only。既存行のUPDATE/DELETEは行わない(設計9章)。
CREATE TABLE estimate_confirmations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_no TEXT NOT NULL,
    confirmed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_estimate_confirmations_product_no
    ON estimate_confirmations(product_no);

-- 確定時点の明細行(Detection 1件 = 1行。積算明細(detailItems)と同じ粒度)。
-- confirmation_id は同一トランザクション内でheader行を先にINSERTしてから
-- 明細行をINSERTする設計のため、安全にFK制約を付けられる(設計6章:
-- header行が常に先に存在することが保証されるため、decision_eventsのような
-- 自己参照削除の問題が起きない)。
--
-- detection_id / drawing_page_id は decision_events と同じ理由で意図的に
-- 外部キー制約を付けない(歴史的参照)。PRAGMA foreign_keys = ON の環境で
-- FK制約を付けると、確定後にDetectionを削除しようとした際、このsnapshot行
-- 自身が参照しているために外部キー違反で削除が失敗してしまう(「確定時点の
-- 事実を保持する」というsnapshotの目的そのものと矛盾するため。設計6章)。
--
-- code/category/model/rating/unit_price/amount/対象所属/BBox座標は、いずれも
-- 確定時点の値を非正規化コピーとして保存する。将来 estimate_master_items が
-- 再UPSERTされても、product_df.csv/estcode_df.csvの内容が変わっても、この
-- snapshot行自体は一切変化しない(設計5章/7章)。
CREATE TABLE estimate_confirmation_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    confirmation_id INTEGER NOT NULL REFERENCES estimate_confirmations(id),

    -- 歴史的参照(FK制約なし。上記コメント参照)
    detection_id INTEGER,
    drawing_page_id INTEGER,

    -- 対象(積算集約の対象別内訳を確定後も再現するための非正規化コピー)
    target_id TEXT NOT NULL,       -- 'product' / 'panel:{面番号}:{盤番号}' / '__tie__'
    target_type TEXT NOT NULL,     -- 'product' / 'panel' / 'tie'
    ban_menno INTEGER,             -- target_type='panel'の場合のみ非NULL
    ban_no INTEGER,                -- 同上
    panel_name TEXT,               -- 確定時点のestcode_df.csv由来の盤名称(同上)

    -- 積算コード(確定時点の値。master_item_idはFKなしの参考情報に留め、
    -- 表示・金額の再現には下記の非正規化コピー列自体を使う)
    master_item_id INTEGER,
    code TEXT NOT NULL,
    category TEXT,
    model TEXT,
    rating TEXT,

    source_type TEXT NOT NULL,     -- 'ai' / 'manual'(確定時点のDetection.source_type)
    quantity REAL NOT NULL DEFAULT 1,  -- Detection単位の行のため常に1(将来の拡張余地として列を残す)
    unit_price REAL,               -- 確定時点のestimate_master_items.total_price_a
    amount REAL,                   -- quantity(=1) * unit_price相当。unit_priceがNULLならNULL
    status TEXT NOT NULL,          -- 確定時点のDetection.status(○/△/×の元値)

    -- 確定時点のBBox(座標そのものを非正規化コピー。detection_idの参照に依存しない)
    bbox_x REAL,
    bbox_y REAL,
    bbox_w REAL,
    bbox_h REAL,
    page_no INTEGER                -- 確定時点のページ番号(表示・図面ナビゲーション参考用)
);

CREATE INDEX idx_estimate_confirmation_items_confirmation_id
    ON estimate_confirmation_items(confirmation_id);
