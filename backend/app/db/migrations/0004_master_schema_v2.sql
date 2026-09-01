-- 0004_master_schema_v2.sql
-- Phase 1.7: 積算コードMasterを正式Excel (data/master/estimate_master_a.xlsx) 参照へ
-- 切り替えるためのスキーマ調整。
--
-- 実データ調査の結果、estimate_master_items.item_name (Phase1で独自に設けた列) に
-- 対応する列は正式Excelに存在しないことが判明した。UIの表示カラムにも含まれない列
-- のため削除する。また、正式Excelには「品名」が空欄の行 (例: コード19957、社内向けの
-- 注記行) が1件存在することを確認したため、category は NOT NULL を外し nullable とする。
--
-- SQLiteはALTER TABLEでの列削除(DROP COLUMN)はサポートするが、NOT NULL制約の解除は
-- 直接サポートしないため、テーブルを再構築する。detections.master_item_id からの
-- 外部キー参照が既に存在する可能性があるため、再構築中は一時的にPRAGMA foreign_keysを
-- OFFにし、idを保持したまま複製する (Manual BBoxの参照が壊れないようにするため。
-- 指示書7章/15章参照)。

PRAGMA foreign_keys = OFF;

CREATE TABLE estimate_master_items_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    category TEXT,
    model TEXT,
    rating TEXT,
    note TEXT,
    total_price_a REAL,
    box_parts_price REAL,
    painting_price REAL,
    setup_a REAL,
    sheet_metal_price REAL,
    assembly_price REAL,
    inspection_price REAL
);

INSERT INTO estimate_master_items_v2
    (id, code, category, model, rating, note, total_price_a, box_parts_price,
     painting_price, setup_a, sheet_metal_price, assembly_price, inspection_price)
SELECT id, code, category, model, rating, note, total_price_a, box_parts_price,
       painting_price, setup_a, sheet_metal_price, assembly_price, inspection_price
FROM estimate_master_items;

DROP TABLE estimate_master_items;
ALTER TABLE estimate_master_items_v2 RENAME TO estimate_master_items;

PRAGMA foreign_keys = ON;
