import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# backend/ をimportパスに追加 (pytestをbackend/から実行する前提だが、念のため)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

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
def client(db_path) -> TestClient:
    def _override_get_db():
        with get_connection(db_path) as conn:
            yield conn

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
