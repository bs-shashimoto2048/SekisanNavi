"""管理者認証 (PoC簡易方式)。

管理者パスワードは環境変数 (または backend/.env) から取得する (config.ADMIN_PASSWORD)。
平文でのGit管理・DB保存は行わない (要件12/13)。

重要: 設定変更APIそのものがここを経由して検証を行う。Frontend側の入力チェックだけに
頼ってはならない (要件12)。
"""
import hmac

from app import config

# 注意: `from app.config import ADMIN_PASSWORD` ではなく `app.config` モジュールを
# 経由して都度参照する。テストコードが `monkeypatch.setattr(config, "ADMIN_PASSWORD", ...)`
# で値を差し替えられるようにするため (値をこのモジュールの名前空間へ固定値としてコピー
# してしまうと、後からの差し替えが反映されなくなる)。


def is_admin_auth_configured() -> bool:
    return bool(config.ADMIN_PASSWORD)


def verify_admin_password(candidate: str | None) -> bool:
    """管理者パスワードを検証する。

    ADMIN_PASSWORD が未設定の場合は、誰であっても常に認証失敗とする (fail-closed)。
    タイミング攻撃対策として定数時間比較 (hmac.compare_digest) を用いる。
    """
    if not config.ADMIN_PASSWORD:
        return False
    if not candidate:
        return False
    return hmac.compare_digest(candidate, config.ADMIN_PASSWORD)
