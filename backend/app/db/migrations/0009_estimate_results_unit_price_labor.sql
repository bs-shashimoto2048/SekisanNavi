-- 0009_estimate_results_unit_price_labor.sql
-- Issue #40 Phase 2レビュー指摘対応(PR #41)で、係数の手修正・初期値復元時に
-- evaluatorを再実行せずにprice/laborを再計算できるよう、estimate_resultsへ
-- unit_price/unit_labor列を追加する必要が生じた。
--
-- 本来はこの内容も0008_estimate_rule_engine_foundation.sqlへ含めるべきだったが、
-- 0008が先に本番DBへ適用された後にこの2列の追加が判明したため、0008の内容を
-- 直接書き換えても既に適用済み(schema_migrationsへ記録済み)のDBには反映されない
-- (migrationは同一ファイル名につき1度しか実行されない仕組みのため)。そのため、
-- 新規の連番migrationとしてこの2列の追加のみを切り出す。
--
-- 影響範囲: estimate_results.price/laborの計算式(app/repositories/
-- estimate_results.py)・app/domain/estimate_rules.pyのEstimateResult定義は
-- 既に0008の内容として実装済みであり、この2列を前提としている。このmigrationを
-- 適用していないDBでは GET/POST /api/products/{product_no}/estimate-results* が
-- 500エラーになる (no such column: unit_price)。

ALTER TABLE estimate_results ADD COLUMN unit_price REAL;
ALTER TABLE estimate_results ADD COLUMN unit_labor REAL;
