"""アプリ設定。

PoC段階では設定値は最小限に留める。将来的に環境変数化する場合もこのモジュールに集約する。
"""
import os
from pathlib import Path

# backend/ ディレクトリ直下に SQLite ファイルを置く。
# 実データ運用時も「作業領域」に置く方針とし、共有フォルダ上の元ファイルは扱わない。
BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"
# 環境変数 SEKISAN_NAVI_DB_PATH 未設定時の既定DBパス (Issue #23 Phase 2)。
# 実際に使う DB_PATH は、_load_dotenv_if_present() 実行後に下記で解決する
# (backend/.env からもこの環境変数を読み込めるようにするため。
# ADMIN_PASSWORDと同じ順序)。
_DEFAULT_DB_PATH = DATA_DIR / "sekisan_navi.db"
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


def _resolve_db_path(env_value: str | None, default: Path) -> Path:
    """`SEKISAN_NAVI_DB_PATH` 環境変数から実際に使うDBパスを解決する
    (Issue #23 Phase 2: 検証用DBをソース複製なしで切り替え可能にする)。

    - 未設定(None、または空文字列)の場合は`default`(=`_DEFAULT_DB_PATH`、従来どおり
      `backend/data/sekisan_navi.db`)をそのまま返す。既存の起動手順・テストへの
      影響は無い(後方互換な追加のみ)。
    - 設定されている場合は、その値をそのまま`Path`化して返す。相対パスを指定した
      場合、Backendプロセスの起動時カレントディレクトリを基準に解決される
      (`pathlib`の標準動作をそのまま使うだけで、このモジュール側で独自に
      `.resolve()`や絶対パス化は行わない)。起動ディレクトリを取り違えると
      意図しないDBファイルを指してしまう事故につながるため、本番DBとの取り違えを
      避けたい検証用途では絶対パスの指定を推奨する(README.md/
      docs/configuration.md参照)。
    - この関数はパス文字列の解決のみを行う。DBファイル自体の複製・作成・
      マイグレーション適用は一切行わない(呼び出し側の`app.db.connection`/
      `app.db.migrate`が既存の仕組みでそのまま行う)。
    - データ参照ルート(`system_settings.data_source_root`)の仕組みには一切
      触れない。DBファイルが切り替われば、その中身(=切り替え先DBに保存された
      data_source_root)が自動的に有効になるだけである。
    """
    if not env_value:
        return default
    return Path(env_value)


_load_dotenv_if_present()

# 検証用DB切替 (Issue #23 Phase 2)。`SEKISAN_NAVI_DB_PATH`が設定されていれば
# 本番用の既定DBの代わりにそのパスを使う。未設定時は従来どおり
# `backend/data/sekisan_navi.db`(`_DEFAULT_DB_PATH`)のまま変わらない。
# DBファイル自体の複製/バックアップはこの仕組みの対象外であり、検証時は運用者が
# 別途手動で用意する(docs/configuration.md「検証用DBの作成例」参照)。
DB_PATH = _resolve_db_path(os.environ.get("SEKISAN_NAVI_DB_PATH"), _DEFAULT_DB_PATH)

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

# 積算資料PDF Help (Issue #19 Phase 3)。積算コードMaster(MASTER_EXCEL_PATH)と
# 同様、社内業務資料はGit管理対象外とし、プロジェクト直下 data/help/ に配置する
# 運用とする(`.gitignore`の`/data/`で既に除外済み)。積算コードMasterを置き換える
# ものではなく、あくまでHelp/参考資料としての位置付け。ファイルが無くてもアプリ
# 自体は起動する(Help機能のみ「未配置」応答になる。app/api/routers/help_pdf.py参照)。
HELP_PDF_PATH = PROJECT_ROOT / "data" / "help" / "estimate-help.pdf"
