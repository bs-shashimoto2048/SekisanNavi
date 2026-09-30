"""`app.config.should_auto_migrate_on_startup`の単体テスト
(Issue #40 PR #42 再発防止: 既定DBパスへの意図しない自動migration適用の防止)。
"""
from app.config import should_auto_migrate_on_startup


def test_always_true_when_db_path_env_is_explicitly_set():
    """検証用DB等、SEKISAN_NAVI_DB_PATHを明示指定している場合は、
    migration履歴の有無やallow環境変数に関わらず常に自動適用してよい
    (Issue #23の検証用DB切替の既存挙動を変えない)。"""
    assert should_auto_migrate_on_startup(
        db_path_env="/tmp/verify.db",
        allow_default_automigrate_env=None,
        has_existing_migration_history=True,
    )
    assert should_auto_migrate_on_startup(
        db_path_env="/tmp/verify.db",
        allow_default_automigrate_env=None,
        has_existing_migration_history=False,
    )


def test_true_for_default_path_first_time_setup_with_no_migration_history():
    """既定DBパスでも、まだ1件もmigrationが適用されていない(=初回セットアップ)
    場合は自動適用してよい(README記載のuvicorn --reloadだけで動かせる
    既存の開発体験を壊さない)。"""
    assert should_auto_migrate_on_startup(
        db_path_env=None,
        allow_default_automigrate_env=None,
        has_existing_migration_history=False,
    )
    assert should_auto_migrate_on_startup(
        db_path_env="",
        allow_default_automigrate_env=None,
        has_existing_migration_history=False,
    )


def test_false_for_default_path_with_existing_history_and_no_explicit_allow():
    """既定DBパスかつ既にmigration履歴がある場合(=本番DB等の想定)は、
    明示的なallow環境変数が無い限り自動適用しない
    (Issue #40 PR #42で発覚した事故の再発防止の核心)。"""
    assert not should_auto_migrate_on_startup(
        db_path_env=None,
        allow_default_automigrate_env=None,
        has_existing_migration_history=True,
    )
    assert not should_auto_migrate_on_startup(
        db_path_env=None,
        allow_default_automigrate_env="0",
        has_existing_migration_history=True,
    )
    assert not should_auto_migrate_on_startup(
        db_path_env=None,
        allow_default_automigrate_env="true",  # "1"以外は許可扱いにしない
        has_existing_migration_history=True,
    )


def test_true_for_default_path_with_existing_history_when_explicitly_allowed():
    """既定DBパスかつ既にmigration履歴がある場合でも、
    SEKISAN_NAVI_ALLOW_DEFAULT_DB_AUTOMIGRATE=1 を明示設定していれば
    自動適用してよい(運用者の明示的なopt-in)。"""
    assert should_auto_migrate_on_startup(
        db_path_env=None,
        allow_default_automigrate_env="1",
        has_existing_migration_history=True,
    )
