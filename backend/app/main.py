"""Sekisan Navi (積算ナビ) Backend エントリポイント。

PoC段階の方針:
  - 起動時にマイグレーションとダミーデータ投入を自動実行する (開発の手間を減らすため)。
  - 本番運用では別途明示的なマイグレーション/投入コマンドに切り替える想定。
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import (
    detections,
    drawings,
    estimates,
    master,
    panel_areas,
    panels,
    products,
    project,
    settings,
)
from app.config import ALLOWED_ORIGINS, DB_PATH
from app.db.connection import get_connection
from app.db.master_importer import MasterImportError, import_master_excel
from app.db.migrate import run_migrations
from app.db.seed import seed


@asynccontextmanager
async def lifespan(_app: FastAPI):
    run_migrations(DB_PATH)
    with get_connection(DB_PATH) as conn:
        seed(conn)
        try:
            result = import_master_excel(conn)
            print(
                f"Master import: imported={result.imported} "
                f"(inserted={result.inserted}, updated={result.updated}), "
                f"skipped_no_code={result.skipped_no_code}, "
                f"excluded_by_strike={result.excluded_by_strike}, "
                f"excluded_by_category={result.excluded_by_category}, "
                f"removed_stale={result.removed_stale}"
            )
            if result.retained_invalid_referenced:
                print(
                    "WARNING: Manual BBoxが参照しているため削除しなかった無効Master行: "
                    f"{result.retained_invalid_referenced}"
                )
        except MasterImportError as e:
            # Master Excelが見つからない/想定構成でない場合もアプリ起動自体は
            # 妨げない (積算コードMaster関連の機能のみ空になる)。
            print(f"WARNING: Master import skipped: {e}")
    yield


app = FastAPI(
    title="Sekisan Navi API",
    description="積算情報収集Webシステム 積算ナビ のバックエンドAPI (PoC)",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(project.router)
app.include_router(drawings.router)
app.include_router(panels.router)
app.include_router(panel_areas.router)
app.include_router(detections.router)
app.include_router(estimates.router)
app.include_router(master.router)
app.include_router(settings.router)
app.include_router(products.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
