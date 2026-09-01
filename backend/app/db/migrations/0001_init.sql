-- 0001_init.sql
-- Sekisan Navi 初期スキーマ (PoC)
--
-- 注意: このスキーマは暫定である。積算コード体系・盤属性・AI検出クラス等は
-- 検討中のため、将来のマイグレーションで変更される前提とする。
-- (docs/data-model.md, docs/implementation-plan.md 参照)

-- 案件ヘッダー情報 (整理番号・製番・盤名称・解析状態)
-- PoCでは1レコードのみ想定。
CREATE TABLE project_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seiri_no TEXT NOT NULL,          -- 整理番号
    seiban TEXT NOT NULL,            -- 製番
    panel_name TEXT NOT NULL,        -- 盤名称等
    analysis_status TEXT NOT NULL,   -- 未解析 / 解析中 / 確認待ち / 確定
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 元図面ファイル (read-only 前提。本アプリからは参照のみ)
CREATE TABLE drawing_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_filename TEXT NOT NULL,
    source_path TEXT,                -- 共有フォルダ等の元パス (参考情報。書込み禁止)
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 図面ページ (PDFのページ単位で扱う)
CREATE TABLE drawing_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drawing_file_id INTEGER NOT NULL REFERENCES drawing_files(id),
    page_no INTEGER NOT NULL,
    drawing_type TEXT NOT NULL,      -- 外形図 / 内部機器配置図 / 正面図 / 単線結線図 / 基礎図 等 (暫定分類)
    drawing_name TEXT NOT NULL,
    thumbnail_url TEXT,              -- PoCではダミーURL/プレースホルダー識別子
    image_url TEXT,                  -- PoCではダミー。将来 PDF.js 等でレンダリングした画像/ページ参照に置換
    page_width INTEGER NOT NULL,     -- Viewerのプレースホルダー描画用の仮想キャンバスサイズ
    page_height INTEGER NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0
);

-- 盤 (基本情報のみ。可変属性は panel_attributes に分離)
CREATE TABLE panels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_no TEXT NOT NULL,
    name TEXT NOT NULL,
    primary_drawing_page_id INTEGER REFERENCES drawing_pages(id)
);

-- 盤の可変属性 (W/D/H/BAN_NO 等をハードコードせず、この構造で表現する)
CREATE TABLE panel_attributes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_id INTEGER NOT NULL REFERENCES panels(id),
    key TEXT NOT NULL,               -- 例: W, D, H, BAN_NO
    label TEXT NOT NULL,             -- 画面表示名
    value TEXT NOT NULL,
    unit TEXT,                       -- 例: mm (nullable)
    source TEXT NOT NULL,            -- design_data / ai / manual (暫定)
    display_order INTEGER NOT NULL DEFAULT 0
);

-- AI等による検出 (積算結果そのものではない)
CREATE TABLE detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drawing_page_id INTEGER NOT NULL REFERENCES drawing_pages(id),
    panel_id INTEGER REFERENCES panels(id),
    class_name TEXT NOT NULL,        -- YOLO等のクラス名 (暫定。将来変更される前提)
    bbox_x REAL NOT NULL,            -- page_width/page_height と同じ単位の絶対座標
    bbox_y REAL NOT NULL,
    bbox_w REAL NOT NULL,
    bbox_h REAL NOT NULL,
    confidence REAL,
    status TEXT NOT NULL DEFAULT 'pending' -- pending / reviewed / excluded (暫定)
);

-- 積算コードMaster (Excel列をそのまま持たず、必要最小限の項目に絞る)
CREATE TABLE estimate_master_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,          -- 品名 (箱・単独 等)
    item_name TEXT NOT NULL,
    model TEXT,                      -- 型式
    rating TEXT,                     -- 定格
    note TEXT
);

-- 積算結果
CREATE TABLE estimate_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    category TEXT NOT NULL,
    item_name TEXT NOT NULL,
    model TEXT,
    rating TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    unit TEXT,
    source_type TEXT NOT NULL,       -- program / ai / manual
    confidence REAL,
    status TEXT NOT NULL DEFAULT 'auto' -- auto / confirmed / needs_review / excluded
);

-- 積算結果の根拠 (図面・BBox・盤へ遡れるようにする)
CREATE TABLE estimate_references (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estimate_item_id INTEGER NOT NULL REFERENCES estimate_items(id),
    drawing_page_id INTEGER NOT NULL REFERENCES drawing_pages(id),
    detection_id INTEGER REFERENCES detections(id),
    panel_id INTEGER REFERENCES panels(id),
    reason TEXT
);
