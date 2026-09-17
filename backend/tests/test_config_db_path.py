"""SEKISAN_NAVI_DB_PATH によるDBパス切替 (Issue #23 Phase 2) のテスト。

対象:
1. 環境変数未指定 → 従来の既定DBパス (`app.config._resolve_db_path`)
2. `SEKISAN_NAVI_DB_PATH` 指定 → 指定パスを使用
3. 指定DBに対してmigrationが正常に適用されること
4. 指定DBへの書き込み(Manual BBox作成含む)が、別ファイルとして用意した
   もう一方のDB(本番相当)へ一切波及しないこと
5. 既存Backend testへの回帰は、通常どおり `pytest -q` の全件実行で確認する
   (このファイル自体はそれに追加される形)。

この機能はDBファイルパスの解決のみを変更対象とする(データ参照ルート・
Frontend・DB自動コピー機能はいずれも対象外。Issue #23 Phase 2要件)。
"""
from pathlib import Path

from app import config
from app.db.connection import get_connection
from app.db.master_importer import import_master_excel
from app.db.migrate import run_migrations
from app.db.seed import seed
from app.repositories.detections import create_manual_detection, list_detections
from app.repositories.drawings import list_drawing_pages
from app.repositories.master import list_master_items
from app.repositories.system_settings import get_data_source_root, set_data_source_root


def _setup_product_db(db_path: Path) -> None:
    """conftest.pyの`db_path`フィクスチャと同じ手順で、1つの独立したDBファイルを
    migration + ダミーデータ投入 + Master Excel取り込みまで済んだ状態にする。"""
    run_migrations(db_path)
    with get_connection(db_path) as conn:
        seed(conn)
        import_master_excel(conn)


def _first_drawing_page_id(db_path: Path) -> int:
    with get_connection(db_path) as conn:
        pages = list_drawing_pages(conn)
    return pages[0].id


def _first_master_item_id(db_path: Path) -> int:
    with get_connection(db_path) as conn:
        items = list_master_items(conn)
    return items[0].id


def _detection_count(db_path: Path) -> int:
    with get_connection(db_path) as conn:
        return len(list_detections(conn))


# --- 1. 環境変数未指定 → 従来の既定DBパス -----------------------------------


def test_resolve_db_path_returns_default_when_env_value_is_none():
    default = Path("/anywhere/backend/data/sekisan_navi.db")
    assert config._resolve_db_path(None, default) == default


def test_resolve_db_path_returns_default_when_env_value_is_empty_string():
    # 空文字列(環境変数が定義だけされて値が空、等)も「未指定」と同様に扱う。
    default = Path("/anywhere/backend/data/sekisan_navi.db")
    assert config._resolve_db_path("", default) == default


def test_module_level_db_path_matches_default_when_env_var_is_unset(monkeypatch):
    # このプロセス自体の起動時にSEKISAN_NAVI_DB_PATHが設定されていない前提を
    # 明示し、既存の`config.DB_PATH`(モジュール読み込み時に一度だけ解決済み)が
    # 既定値(_DEFAULT_DB_PATH)と一致することを確認する。
    monkeypatch.delenv("SEKISAN_NAVI_DB_PATH", raising=False)
    assert config.DB_PATH == config._DEFAULT_DB_PATH
    assert config.DB_PATH == config.BACKEND_DIR / "data" / "sekisan_navi.db"


# --- 2. SEKISAN_NAVI_DB_PATH 指定 → 指定パスを使用 ---------------------------


def test_resolve_db_path_uses_env_value_when_set(tmp_path):
    default = Path("/anywhere/backend/data/sekisan_navi.db")
    custom = tmp_path / "verification.db"
    assert config._resolve_db_path(str(custom), default) == custom


def test_resolve_db_path_does_not_resolve_or_absolutize_relative_paths():
    # relativeなパス文字列を渡した場合、このモジュール自身では絶対パス化しない
    # (起動時カレントディレクトリ基準で解決される、という文書化した挙動どおり)。
    default = Path("/anywhere/backend/data/sekisan_navi.db")
    resolved = config._resolve_db_path("verification/sub.db", default)
    assert resolved == Path("verification/sub.db")
    assert not resolved.is_absolute()


# --- 3. 指定DBに対してmigrationが正常に適用されること ------------------------


def test_migrations_apply_to_the_specified_db_path(tmp_path):
    verification_db = tmp_path / "verification.db"
    assert not verification_db.exists()

    run_migrations(verification_db)

    assert verification_db.exists()
    with get_connection(verification_db) as conn:
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
    # 主要テーブルが一通り作成されていること (0001〜0007までの全migrationが適用済み)。
    for table in (
        "detections",
        "decision_events",
        "estimate_confirmations",
        "estimate_confirmation_items",
        "system_settings",
    ):
        assert table in tables


# --- 4. 指定DBへの書き込みが、既定/別DBへ波及しないこと -----------------------


def test_writes_to_one_db_do_not_appear_in_another_db(tmp_path):
    """`system_settings`(データ参照ルート)への書き込みが、DBファイル単位で
    完全に分離されることを確認する。"""
    production_like_db = tmp_path / "production.db"
    verification_db = tmp_path / "verification.db"
    for path in (production_like_db, verification_db):
        run_migrations(path)

    with get_connection(production_like_db) as conn:
        set_data_source_root(conn, r"\\prod-share\real-data")

    # 検証用DBだけへ別の値を書き込む。
    with get_connection(verification_db) as conn:
        set_data_source_root(conn, r"\\verify-share\copy-only")

    with get_connection(production_like_db) as conn:
        assert get_data_source_root(conn) == r"\\prod-share\real-data"
    with get_connection(verification_db) as conn:
        assert get_data_source_root(conn) == r"\\verify-share\copy-only"


def test_manual_bbox_created_in_verification_db_does_not_affect_production_like_db(
    tmp_path,
):
    """Issue #23が最も懸念する具体的なシナリオ: 検証用DBでManual BBoxを作成しても、
    別ファイルとして用意した「本番相当」DBには一切変更が入らないことを確認する。"""
    production_like_db = tmp_path / "production.db"
    verification_db = tmp_path / "verification.db"
    for path in (production_like_db, verification_db):
        _setup_product_db(path)

    production_count_before = _detection_count(production_like_db)
    verification_count_before = _detection_count(verification_db)

    page_id = _first_drawing_page_id(verification_db)
    master_item_id = _first_master_item_id(verification_db)
    with get_connection(verification_db) as conn:
        created = create_manual_detection(
            conn,
            drawing_page_id=page_id,
            master_item_id=master_item_id,
            class_name="TEST-ISOLATION",
            bbox_x=0.11,
            bbox_y=0.22,
            bbox_w=0.05,
            bbox_h=0.03,
        )
    assert created.id is not None

    # 検証用DBには1件増えている。
    assert _detection_count(verification_db) == verification_count_before + 1

    # 「本番相当」DBの件数・中身は一切変化していない。
    assert _detection_count(production_like_db) == production_count_before
    with get_connection(production_like_db) as conn:
        class_names = [d.class_name for d in list_detections(conn)]
    assert "TEST-ISOLATION" not in class_names
