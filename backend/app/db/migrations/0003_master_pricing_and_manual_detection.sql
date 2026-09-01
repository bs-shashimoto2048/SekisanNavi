-- 0003_master_pricing_and_manual_detection.sql
-- Phase 1.6: 積算コードMasterの価格内訳カラム追加 + Manual BBox(Detection)対応
--
-- 積算コードMasterに、実際の積算作業で確認する価格・工数内訳カラムを追加する。
-- 元Excel資料 (対象品目シート) の列構成を参考にしているが、値が存在しない項目は
-- NULLのまま保持し、勝手な計算値・ダミー値は生成しない (指示書 3章)。
ALTER TABLE estimate_master_items ADD COLUMN total_price_a REAL;      -- 総合価格A
ALTER TABLE estimate_master_items ADD COLUMN box_parts_price REAL;    -- 箱・部品価格
ALTER TABLE estimate_master_items ADD COLUMN painting_price REAL;     -- 塗装価格
ALTER TABLE estimate_master_items ADD COLUMN setup_a REAL;            -- 設A
ALTER TABLE estimate_master_items ADD COLUMN sheet_metal_price REAL;  -- 板金
ALTER TABLE estimate_master_items ADD COLUMN assembly_price REAL;     -- 組立
ALTER TABLE estimate_master_items ADD COLUMN inspection_price REAL;   -- 検査

-- Manual BBox追加機能向け。DetectionをAI由来/手動追加で区別し、
-- 手動追加時に選択されていた積算Master Itemへの参照を保持する
-- (表示名称・価格情報はBBox側へコピーせず、Master Itemへの参照で表現する。指示書11章)。
ALTER TABLE detections ADD COLUMN source_type TEXT NOT NULL DEFAULT 'ai';
ALTER TABLE detections ADD COLUMN master_item_id INTEGER REFERENCES estimate_master_items(id);
