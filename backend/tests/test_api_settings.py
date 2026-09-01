"""/api/settings/data-source の管理者認証まわりのテスト。

重要な観点 (要件12): 設定変更APIそのものがBackendで管理者認証を検証すること。
Frontend側のチェックには一切依存しないことをここで担保する。
"""
from app import config


def test_get_data_source_requires_no_auth(client):
    res = client.get("/api/settings/data-source")
    assert res.status_code == 200
    body = res.json()
    assert "root" in body
    assert "exists" in body


def test_update_data_source_fails_without_admin_password_configured(client, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", None)
    res = client.put(
        "/api/settings/data-source",
        json={"root": r"\\example\share", "admin_password": "anything"},
    )
    assert res.status_code == 503


def test_update_data_source_rejects_wrong_password(client, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "correct-horse-battery-staple")
    res = client.put(
        "/api/settings/data-source",
        json={"root": r"\\example\share", "admin_password": "wrong"},
    )
    assert res.status_code == 401


def test_update_data_source_succeeds_with_correct_password(client, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "correct-horse-battery-staple")
    res = client.put(
        "/api/settings/data-source",
        json={"root": r"\\example\share\new-root", "admin_password": "correct-horse-battery-staple"},
    )
    assert res.status_code == 200
    assert res.json()["root"] == r"\\example\share\new-root"

    # 保存された値が以降のGETにも反映されること
    get_res = client.get("/api/settings/data-source")
    assert get_res.json()["root"] == r"\\example\share\new-root"


def test_test_connection_requires_admin_password(client, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "correct-horse-battery-staple")
    res = client.post(
        "/api/settings/data-source/test",
        json={"root": r"\\example\share", "admin_password": "wrong"},
    )
    assert res.status_code == 401


def test_test_connection_reports_success_for_real_directory(client, monkeypatch, tmp_path):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "correct-horse-battery-staple")
    res = client.post(
        "/api/settings/data-source/test",
        json={"root": str(tmp_path), "admin_password": "correct-horse-battery-staple"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True


def test_test_connection_does_not_leak_internal_details_on_failure(client, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", "correct-horse-battery-staple")
    res = client.post(
        "/api/settings/data-source/test",
        json={"root": r"\\nonexistent-host\share", "admin_password": "correct-horse-battery-staple"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is False
    # スタックトレースや例外クラス名等の内部詳細を含まないこと
    assert "Traceback" not in body["message"]
    assert "Error" not in body["message"]
