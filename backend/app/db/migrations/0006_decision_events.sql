-- 0006_decision_events.sql
-- Issue #4 Phase A-1: 判断・修正データ保存の最小event logging。
--
-- 設計の詳細・理由付けは docs/decision-event-design.md を参照。既存の
-- detections / estimate_master_items 等へのALTERは行わず、完全に独立した
-- 追加専用(append-only)のテーブルとして新設する。
--
-- detection_id は意図的に外部キー制約を付けない (REFERENCES detections(id) を
-- 書かない)。理由: backend/app/db/connection.py が全接続で
-- PRAGMA foreign_keys = ON を有効化しているため、もしFK制約を付けた場合、
-- delete イベントを記録した直後に本体の Detection を DELETE しようとすると、
-- まさにそのイベント行自身が参照しているために外部キー違反で削除が失敗する
-- (「削除の事実を記録する」というevent logの目的そのものと矛盾するため)。
-- 削除後の解釈は drawing_page_id / source_type / master_item_id / before_bbox_*
-- の非正規化コピー列だけで完結させる設計とする(detection-event-design.md 6章)。
CREATE TABLE decision_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- 'create' | 'delete' | 'bbox_edit' (Phase A対象の3種のみ。
    -- move/resizeは区別せず 'bbox_edit' へ統合する。設計3章/4.1章参照)
    event_type TEXT NOT NULL,
    detection_id INTEGER NOT NULL,
    -- 以下は削除後もイベント単体で解釈できるようにするための非正規化コピー
    -- (イベント発生時点の値。現在のdetections/estimate_master_itemsへは
    -- 依存しない。detection-event-design.md 6章参照)。
    drawing_page_id INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    master_item_id INTEGER,
    before_bbox_x REAL,
    before_bbox_y REAL,
    before_bbox_w REAL,
    before_bbox_h REAL,
    after_bbox_x REAL,
    after_bbox_y REAL,
    after_bbox_w REAL,
    after_bbox_h REAL
);

CREATE INDEX idx_decision_events_detection_id ON decision_events(detection_id);
CREATE INDEX idx_decision_events_drawing_page_id ON decision_events(drawing_page_id);
