import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# backend/ をimportパスに追加 (pytestをbackend/から実行する前提だが、念のため)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app.main as app_main
from app.api.deps import get_db
from app.db.connection import get_connection
from app.db.master_importer import import_master_excel
from app.db.migrate import run_migrations
from app.db.seed import seed
from app.main import app


@pytest.fixture()
def db_path(tmp_path) -> Path:
    path = tmp_path / "test.db"
    run_migrations(path)
    with get_connection(path) as conn:
        seed(conn)
        # 積算コードMasterは実Excel (data/master/estimate_master_a.xlsx) をそのまま
        # 参照元とする (Phase 1.7)。プロジェクトに同梱された安定ファイルのため、
        # ダミーへ差し替えずテストでも実ファイルをそのまま使う。
        import_master_excel(conn)
    return path


@pytest.fixture()
def client(db_path, monkeypatch) -> TestClient:
    """`TestClient(app)`は`with`文に入る際、実際にFastAPIのlifespan
    (`app.main.lifespan`)を起動する。lifespanは`app.config.DB_PATH`
    (=`app.main`がimport時に束縛した`app.main.DB_PATH`)へ直接
    `run_migrations`/`seed`/`import_master_excel`を実行するため、
    `get_db`依存関係のoverride(下記`_override_get_db`、ルートハンドラのみに
    効く)だけでは不十分で、`app.main.DB_PATH`自体をこの`db_path`
    (tmp_path内の使い捨てDB)へ差し替えないと、lifespanが実際の既定DBパス
    (`SEKISAN_NAVI_DB_PATH`未設定時は本番運用で使われるパス)へ
    migration/seed/master importを適用してしまう(Issue #40 PR #42で
    発覚した、テスト実行のたびに本番DBへ新migrationが適用されていた
    不具合の直接の原因)。"""
    monkeypatch.setattr(app_main, "DB_PATH", db_path)

    def _override_get_db():
        with get_connection(db_path) as conn:
            yield conn

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
