"""`app.main.lifespan`が`should_auto_migrate_on_startup`のゲートを実際に
経由して`run_migrations`の呼び出しを制御することの統合テスト
(Issue #40 PR #42 再発防止)。

`tests/conftest.py`の`client`fixtureは`app.main.DB_PATH`を常にtmp_path
(かつ`SEKISAN_NAVI_DB_PATH`相当の「明示指定」扱い)へ差し替えてしまうため、
「既定DBパスかつ既存のmigration履歴がある」ケースそのものは`client`
fixtureでは再現できない。このテストでは`TestClient`を直接使い、
`app.main.DB_PATH`と環境変数を個別に制御して、lifespanの分岐を検証する。
"""
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

import app.main as app_main
from app.db.migrate import run_migrations


def test_lifespan_skips_auto_migrate_for_default_path_like_db_with_existing_history(tmp_path, monkeypatch):
    """既定DBパスを模した(=SEKISAN_NAVI_DB_PATH未設定、かつ既にmigration履歴が
    ある)状態では、lifespanは`run_migrations`を呼ばないことを確認する。"""
    prod_like_db = tmp_path / "prod_like.db"
    run_migrations(prod_like_db)  # 既存のmigration履歴を持つ状態を再現する

    monkeypatch.delenv("SEKISAN_NAVI_DB_PATH", raising=False)
    monkeypatch.delenv("SEKISAN_NAVI_ALLOW_DEFAULT_DB_AUTOMIGRATE", raising=False)
    monkeypatch.setattr(app_main, "DB_PATH", prod_like_db)

    spy = MagicMock(wraps=run_migrations)
    monkeypatch.setattr(app_main, "run_migrations", spy)

    with TestClient(app_main.app):
        pass

    spy.assert_not_called()


def test_lifespan_runs_auto_migrate_for_default_path_like_db_with_no_history(tmp_path, monkeypatch):
    """既定DBパスを模していても、まだmigration履歴が無い(初回セットアップ)
    場合はlifespanが`run_migrations`を呼ぶことを確認する。"""
    fresh_db = tmp_path / "fresh_default_like.db"

    monkeypatch.delenv("SEKISAN_NAVI_DB_PATH", raising=False)
    monkeypatch.delenv("SEKISAN_NAVI_ALLOW_DEFAULT_DB_AUTOMIGRATE", raising=False)
    monkeypatch.setattr(app_main, "DB_PATH", fresh_db)

    spy = MagicMock(wraps=run_migrations)
    monkeypatch.setattr(app_main, "run_migrations", spy)

    with TestClient(app_main.app):
        pass

    spy.assert_called_once_with(fresh_db)


def test_lifespan_runs_auto_migrate_for_default_path_like_db_when_explicitly_allowed(tmp_path, monkeypatch):
    """既定DBパスを模していて既存履歴があっても、
    SEKISAN_NAVI_ALLOW_DEFAULT_DB_AUTOMIGRATE=1 を設定していれば
    lifespanが`run_migrations`を呼ぶことを確認する。"""
    prod_like_db = tmp_path / "prod_like_allowed.db"
    run_migrations(prod_like_db)

    monkeypatch.delenv("SEKISAN_NAVI_DB_PATH", raising=False)
    monkeypatch.setenv("SEKISAN_NAVI_ALLOW_DEFAULT_DB_AUTOMIGRATE", "1")
    monkeypatch.setattr(app_main, "DB_PATH", prod_like_db)

    spy = MagicMock(wraps=run_migrations)
    monkeypatch.setattr(app_main, "run_migrations", spy)

    with TestClient(app_main.app):
        pass

    spy.assert_called_once_with(prod_like_db)
