"""Sekisan Navi (積算ナビ) Backend エントリポイント。

PoC段階の方針:
  - 起動時にマイグレーションとダミーデータ投入を自動実行する (開発の手間を減らすため)。
  - 本番運用では別途明示的なマイグレーション/投入コマンドに切り替える想定。

【Issue #40 PR #42 再発防止】既定DBパス(=本番運用で使われるパス、
`SEKISAN_NAVI_DB_PATH`未設定)かつ、既に何らかのmigration履歴を持つDB
(=初回セットアップではない)に対しては、起動時のmigration自動適用を
既定で無効化する(`app.config.should_auto_migrate_on_startup`参照)。
開発中のソースコード変更による`uvicorn --reload`の再起動だけで、
常駐Backendが未検証の新migrationを本番DBへ意図せず適用してしまう事故が
発生したため。検証用DB(`SEKISAN_NAVI_DB_PATH`で明示指定)、および
真っ新な初回セットアップ(migration未適用のDB)に対しては、
従来どおり常に自動適用する。
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import (
    detections,
    drawings,
    estimate_results,
    estimates,
    help_pdf,
    master,
    panel_areas,
    panels,
    products,
    project,
    settings,
)
from app.config import ALLOWED_ORIGINS, DB_PATH, should_auto_migrate_on_startup
from app.db.connection import get_connection
from app.db.master_importer import MasterImportError, import_master_excel
from app.db.migrate import applied_migrations, run_migrations
from app.db.seed import seed


@asynccontextmanager
async def lifespan(_app: FastAPI):
    with get_connection(DB_PATH) as conn:
        has_existing_migration_history = len(applied_migrations(conn)) > 0

    if should_auto_migrate_on_startup(
        db_path_env=os.environ.get("SEKISAN_NAVI_DB_PATH"),
        allow_default_automigrate_env=os.environ.get("SEKISAN_NAVI_ALLOW_DEFAULT_DB_AUTOMIGRATE"),
        has_existing_migration_history=has_existing_migration_history,
    ):
        run_migrations(DB_PATH)
    else:
        print(
            "WARNING: 既定DBパス(SEKISAN_NAVI_DB_PATH未設定)かつ既存のmigration履歴があるため、"
            "起動時のmigration自動適用をスキップしました。migrationを適用するには "
            "`python -m app.db.migrate` を明示的に実行するか、"
            "SEKISAN_NAVI_ALLOW_DEFAULT_DB_AUTOMIGRATE=1 を設定してください。"
        )
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
app.include_router(help_pdf.router)
app.include_router(estimate_results.router)
app.include_router(estimate_results.evidence_types_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
