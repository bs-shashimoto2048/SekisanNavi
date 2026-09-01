import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_db
from app.repositories.system_settings import get_data_source_root, set_data_source_root
from app.schemas.settings import (
    DataSourceOut,
    DataSourceTestIn,
    DataSourceTestOut,
    DataSourceUpdateIn,
)
from app.services.admin_auth import is_admin_auth_configured, verify_admin_password
from app.services.data_source import check_root_access

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _require_admin(admin_password: str) -> None:
    if not is_admin_auth_configured():
        # 管理者パスワード自体が未設定の環境では、設定変更を一切許可しない (fail-closed)。
        raise HTTPException(
            status_code=503,
            detail="管理者認証が構成されていません (SEKISAN_NAVI_ADMIN_PASSWORD 未設定)。",
        )
    if not verify_admin_password(admin_password):
        raise HTTPException(status_code=401, detail="管理者パスワードが正しくありません。")


@router.get("/data-source", response_model=DataSourceOut)
def read_data_source(conn: sqlite3.Connection = Depends(get_db)) -> DataSourceOut:
    root = get_data_source_root(conn)
    try:
        exists = Path(root).exists()
    except OSError:
        exists = False
    return DataSourceOut(root=root, exists=exists)


@router.put("/data-source", response_model=DataSourceOut)
def update_data_source(
    body: DataSourceUpdateIn, conn: sqlite3.Connection = Depends(get_db)
) -> DataSourceOut:
    # 重要: 設定変更APIそのものがBackendで管理者認証を検証する (Frontend側チェックに依存しない)。
    _require_admin(body.admin_password)
    set_data_source_root(conn, body.root)
    try:
        exists = Path(body.root).exists()
    except OSError:
        exists = False
    return DataSourceOut(root=body.root, exists=exists)


@router.post("/data-source/test", response_model=DataSourceTestOut)
def test_data_source(
    body: DataSourceTestIn, conn: sqlite3.Connection = Depends(get_db)
) -> DataSourceTestOut:
    _require_admin(body.admin_password)
    root = body.root if body.root is not None else get_data_source_root(conn)
    success, message = check_root_access(root)
    return DataSourceTestOut(success=success, message=message)
