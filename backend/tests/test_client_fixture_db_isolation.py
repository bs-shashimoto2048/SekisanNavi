"""`client`fixture(conftest.py)が実際の既定DBパスに触れないことの回帰テスト
(Issue #40 PR #42で発覚した不具合の再発防止)。

`TestClient(app)`は`with`文の中でFastAPIのlifespan(`app.main.lifespan`)を
実際に起動する。lifespanは`app.main.DB_PATH`(=`app.config.DB_PATH`をimport時に
束縛したもの)へ直接`run_migrations`/`seed`/`import_master_excel`を実行する。
`get_db`依存関係のoverrideはルートハンドラのみに効くため、`conftest.py`が
`app.main.DB_PATH`自体を`db_path`(tmp_path内の使い捨てDB)へ差し替えて
いないと、pytest実行のたびに実際の既定DBパス(`SEKISAN_NAVI_DB_PATH`未設定時は
本番運用で使われるパス)へmigrationが適用されてしまう
(実際にこの不具合が発生し、本番DBへ0009 migrationが意図せず適用された。
PR #42のコメント参照)。
"""
from pathlib import Path

import app.main as app_main
from app.config import _DEFAULT_DB_PATH


def test_client_fixture_redirects_app_main_db_path_to_the_tmp_db(client, db_path: Path):
    """`client`fixtureのセットアップ後、`app.main.DB_PATH`がtmp_path内の
    使い捨てDB(`db_path`)を指しており、実際の既定DBパスを指していない
    ことを確認する。"""
    assert app_main.DB_PATH == db_path
    assert app_main.DB_PATH != _DEFAULT_DB_PATH


def test_using_the_client_fixture_does_not_touch_the_default_db_path(client):
    """`client`fixtureを経由したAPI呼び出し(lifespan起動込み)の前後で、
    実際の既定DBパス(`SEKISAN_NAVI_DB_PATH`未設定時に使われる、本番運用でも
    使われうるパス)のファイル状態が一切変化しないことを確認する
    (存在しなければ存在しないまま、存在するならmtime/サイズも不変)。"""
    existed_before = _DEFAULT_DB_PATH.exists()
    stat_before = _DEFAULT_DB_PATH.stat() if existed_before else None

    response = client.get("/api/health")
    assert response.status_code == 200
    # migration/seed/master importが実際に走るAPI呼び出しも行い、lifespanの
    # 各処理が既定パスへ波及しないことまで確認する。
    client.get("/api/products/A1GV2421/estimate-results")

    existed_after = _DEFAULT_DB_PATH.exists()
    assert existed_after == existed_before
    if stat_before is not None:
        stat_after = _DEFAULT_DB_PATH.stat()
        assert stat_after.st_mtime == stat_before.st_mtime
        assert stat_after.st_size == stat_before.st_size
