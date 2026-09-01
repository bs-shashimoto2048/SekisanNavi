"""並行リクエストに対する回帰テスト。

実機確認で「Failed to fetch」が多発した根本原因は、FastAPIの同期(def)依存関係・
エンドポイントがスレッドプール経由で実行されるため、1リクエストの中でも
get_db()依存関係の生成とエンドポイント本体の実行が異なるスレッドに割り当てられ、
sqlite3.Connection (既定 check_same_thread=True) がスレッド跨ぎで使われて
sqlite3.ProgrammingError → 500 (かつCORSヘッダ欠落) となっていたことだった。

Frontend側のPromise.all等による同時多発リクエストを再現し、この回帰を防ぐ。
"""
import concurrent.futures


def test_concurrent_requests_do_not_trigger_sqlite_thread_error(client):
    endpoints = [
        "/api/project",
        "/api/drawing-pages",
        "/api/estimate-items",
        "/api/panels",
        "/api/detections",
        "/api/master-items",
    ]

    def hit(path: str):
        return client.get(path)

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as executor:
        futures = [executor.submit(hit, ep) for _ in range(20) for ep in endpoints]
        responses = [f.result() for f in futures]

    statuses = [r.status_code for r in responses]
    assert all(s == 200 for s in statuses), f"unexpected statuses: {set(statuses)}"
