-- 0002_data_source_and_overlay.sql
-- Phase 1.5: 実データ参照設定・実図面Viewer・Panel Overlay対応
--
-- 注意:
-- detections.bbox_x/y/w/h は 0001 で作成済みの列を流用するが、
-- Phase 1.5 より「ページ絶対座標」から「0.0〜1.0 の正規化座標
-- (PDFページ原寸に対する比率。architecture.md/data-model.md参照)」へ
-- 意味を変更した。列定義自体への変更はないため本ファイルにALTER文はない。

-- システム共通設定 (key-value)。管理者認証情報は含めない (要件13で分離)。
CREATE TABLE system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 図面ページの取得元を区別する。
--   placeholder  : Phase 1までのダミー描画 (実ファイルなし)
--   product_file : 実データ参照ルート配下の実PDFファイルを参照する
ALTER TABLE drawing_pages ADD COLUMN source_type TEXT NOT NULL DEFAULT 'placeholder';
ALTER TABLE drawing_pages ADD COLUMN product_no TEXT;
ALTER TABLE drawing_pages ADD COLUMN source_page_no INTEGER;

-- 盤範囲 (Panel Overlay)。Detectionとは独立したOverlay Layerとして扱う。
-- 座標は detections と同じく 0.0〜1.0 の正規化座標。
-- 盤範囲の仕様は未確定 (data-model.md参照)。1つの盤が同一ページ内に複数の
-- 範囲 (正面/背面/側面等) を持つ場合を想定し、panel_id×drawing_page_id に対して
-- 複数行を許容する。
CREATE TABLE panel_areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_id INTEGER NOT NULL REFERENCES panels(id),
    drawing_page_id INTEGER NOT NULL REFERENCES drawing_pages(id),
    area_x REAL NOT NULL,
    area_y REAL NOT NULL,
    area_w REAL NOT NULL,
    area_h REAL NOT NULL,
    label TEXT
);
