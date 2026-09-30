"""0009_estimate_results_unit_price_labor
Issue #40 Phase 2レビュー対応(PR #41)で、係数の手修正・初期値復元時に
evaluatorを再実行せずにprice/laborを再計算できるよう、estimate_resultsへ
unit_price/unit_labor列を追加した。この2列は本来この0009として独立した
migrationにすべきところ、実際には既に本番DBへ適用済みだった
0008_estimate_rule_engine_foundation.sqlを直接書き換える形で追加して
しまっていた(PR #42での修正経緯)。

migrationは同一ファイル名につき1度しか適用されない仕組みのため、この
書き換えは「0008が本番DBへ適用された時点より後に本番DBを新規に作り直す」
場合にしか反映されず、既に0008を適用済みの環境(本番DB)には反映されない
という不具合を引き起こした。

この0009は、それを是正するための独立したmigrationである。ただし、
0008の現在の内容(mainへmergeされた時点のまま、今後変更しない)には
既にunit_price/unit_labor列が含まれているため、次の2つの状態の両方に
対して安全に適用できる必要がある。

1. 0008が「まだunit_price/unit_laborを含まない内容」で適用済みのDB
   (本番DBがこれに該当する)→ この0009が2列を追加する。
2. 新規に0001から順に適用するDB → 0008の時点で既に2列が存在した状態で
   この0009を迎える → 何もしない(重複ALTER TABLEでエラーにしない)。

プレーンな.sqlファイルの`ALTER TABLE ... ADD COLUMN`には条件分岐が無く
上記の冪等性を表現できないため、`apply(conn)`を持つ.pyマイグレーションと
して書く(`app/db/migrate.py`のdocstring参照)。
"""
import sqlite3


def apply(conn: sqlite3.Connection) -> None:
    existing_columns = {row[1] for row in conn.execute("PRAGMA table_info(estimate_results)").fetchall()}
    if "unit_price" not in existing_columns:
        conn.execute("ALTER TABLE estimate_results ADD COLUMN unit_price REAL")
    if "unit_labor" not in existing_columns:
        conn.execute("ALTER TABLE estimate_results ADD COLUMN unit_labor REAL")
