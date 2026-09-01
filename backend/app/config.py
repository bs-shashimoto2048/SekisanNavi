"""アプリ設定。

PoC段階では設定値は最小限に留める。将来的に環境変数化する場合もこのモジュールに集約する。
"""
import os
from pathlib import Path

# backend/ ディレクトリ直下に SQLite ファイルを置く。
# 実データ運用時も「作業領域」に置く方針とし、共有フォルダ上の元ファイルは扱わない。
BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"
DB_PATH = DATA_DIR / "sekisan_navi.db"
MIGRATIONS_DIR = Path(__file__).resolve().parent / "db" / "migrations"

# CORS: PoCではローカルVite開発サーバーからのアクセスのみ許可する。
# 5173が使用中の場合にViteが自動的に採用する予備ポートもいくつか許可しておく。
ALLOWED_ORIGINS = [
    f"http://{host}:{port}"
    for host in ("localhost", "127.0.0.1")
    for port in (5173, 5174, 5175)
]


def _load_dotenv_if_present() -> None:
    """backend/.env が存在すれば読み込み、未設定の環境変数のみ補完する。

    python-dotenv 等の依存を増やさず、PoCに必要な最小限の実装に留める。
    既にOS環境変数として設定済みの値は上書きしない。
    実パスワード入りの `.env` はGit管理対象外とすること (.gitignore 参照)。
    """
    env_path = BACKEND_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv_if_present()

# 管理者パスワード。環境変数 (または backend/.env) から取得する簡易方式。
# 平文でのGit管理・DB保存は行わない (要件12/13)。未設定の場合、設定変更APIは
# 常に認証失敗として扱う (fail-closed)。
ADMIN_PASSWORD = os.environ.get("SEKISAN_NAVI_ADMIN_PASSWORD")

# データ参照ルートの初期値 (要件8)。
# 業務ロジック内へ直接この値を書かず、system_settings 経由でのみ参照すること。
DEFAULT_DATA_SOURCE_ROOT = r"\\beans-f1\ShareData\estimatic\a_product\output"

# 製番ディレクトリ内の実データ配置は現時点で「CCV」という名称のフォルダは
# 確認できていない (docs/data-source.md 参照・未確認事項)。
# 見つかった場合にのみ利用する暫定的なサブディレクトリ名候補。
CCV_SUBDIR_CANDIDATES = ["CCV", "ccv"]

# 製番として許可する文字列パターン (実データ例: A1GV2421, A1AB3211 等の英数字)。
PRODUCT_NO_PATTERN = r"^[A-Za-z0-9]{4,20}$"

# 積算コードMasterの正式参照元 (Phase 1.7, 要件1)。
# プロジェクト直下 data/master/ に配置された実Excelファイル。ここでの値は
# app/db/master_importer.py からのみ参照し、他箇所へパスを直書きしない。
PROJECT_ROOT = BACKEND_DIR.parent
MASTER_EXCEL_PATH = PROJECT_ROOT / "data" / "master" / "estimate_master_a.xlsx"
# 実データ調査の結果、対象品目の全件データは "Sheet2" (912行、コード/品名/型式/定格/
# 総合価格A/箱・部品価格/塗装価格/設A/板金/組立/検査 の11列構成) に格納されている。
# "Sheet1" は同一データを一部のみコピーした作業用シートのため使用しない
# (docs/data-model.md, docs/implementation-plan.md 参照)。
MASTER_EXCEL_SHEET = "Sheet2"
