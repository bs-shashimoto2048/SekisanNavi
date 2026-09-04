# configuration.md — 設定・環境変数

Sekisan Naviが参照する設定値の一覧。secretの実値は記載しない(プレースホルダ・
既定値のみ)。

## Backend

### 環境変数

| 変数 | 必須 | 既定値 | 説明 |
|---|---|---|---|
| `SEKISAN_NAVI_ADMIN_PASSWORD` | 事実上必須 | 未設定 | データ参照ルート変更・接続テストAPIの認証に使う定数時間比較用パスワード。未設定の場合、これらのAPIは常に認証失敗になる(fail-closed、`app/config.py`)。`backend/.env`(Git管理対象外)からも読み込める(`_load_dotenv_if_present()`)。 |

`backend/.env.example`をコピーして`backend/.env`を作成し、値を設定する運用
(README参照)。実パスワード入りの`.env`はコミットしないこと(`.gitignore`)。

### `app/config.py` のコード内既定値(環境変数ではない)

| 設定 | 値 | 説明 |
|---|---|---|
| `DB_PATH` | `backend/data/sekisan_navi.db` | SQLiteファイルの配置先(gitignore対象、起動時に自動生成)。 |
| `MIGRATIONS_DIR` | `backend/app/db/migrations/` | マイグレーションSQLの配置先。 |
| `ALLOWED_ORIGINS` | `http://localhost:5173〜5175`, `http://127.0.0.1:5173〜5175` | CORS許可オリジン。Vite開発サーバー用に複数ポートを許可(5173使用中時の予備ポート分)。 |
| `DEFAULT_DATA_SOURCE_ROOT` | `\\beans-f1\ShareData\estimatic\a_product\output` | データ参照ルートの初期値(`system_settings`テーブルへ投入される)。社内共有フォルダのUNCパス。 |
| `CCV_SUBDIR_CANDIDATES` | `["CCV", "ccv"]` | 製番ディレクトリ配下に存在すれば使うサブディレクトリ名候補(暫定。`docs/data-source.md`参照)。 |
| `PRODUCT_NO_PATTERN` | `^[A-Za-z0-9]{4,20}$` | 製番として許可する文字列パターン(パストラバーサル対策)。 |
| `MASTER_EXCEL_PATH` | `<repo root>/data/master/estimate_master_a.xlsx` | 積算コードMasterの正式参照元(gitignore対象、各自配置)。 |
| `MASTER_EXCEL_SHEET` | `"Sheet2"` | 上記Excelの読み込み対象シート名。 |

### `system_settings` テーブル(DB管理、実行時に変更可能)

| key | 説明 |
|---|---|
| `data_source_root` | データ参照ルート。`PUT /api/settings/data-source`(管理者パスワード必須)で変更可能。既定値は上記`DEFAULT_DATA_SOURCE_ROOT`。 |

## Frontend

### 環境変数(`frontend/.env.local`、Git管理対象外)

`frontend/.env.example`をコピーして作成する。

| 変数 | 必須 | 既定値 | 説明 |
|---|---|---|---|
| `VITE_BACKEND_URL` | 任意 | `http://127.0.0.1:8000`(`vite.config.ts`内のfallback) | Vite開発サーバーが`/api`宛リクエストをプロキシする先のBackend URL。Backendのポートを変えた場合、変更が必要なのはここ1箇所だけ。 |
| `VITE_API_BASE_URL` | 任意 | 未設定(相対パス`''`を使う) | Frontend/Backendを別ホストへ分離配置する等、プロキシを使わず直接絶対URLで呼び出したい場合のみ設定する(`src/api/client.ts::BASE_URL`)。 |

### ビルド時に埋め込まれる値

`import.meta.env.VITE_API_BASE_URL`のみ`src/api/client.ts`が参照する。それ以外の
Frontend側ハードコード設定値は無い(Backend URLの解決はVite開発サーバーの
プロキシ機構に一任しており、本番ビルド後の配信方式・リバースプロキシ構成は
リポジトリ内に記載が無く「不明」)。

## ポート番号について

`README.md`のセットアップ手順は既定値としてBackend `8000` / Frontend(Vite)
`5173`を使用する例を示している。両者とも開発機のポート競合等で変更可能で、
変更が必要な箇所は「Backend起動時の`--port`指定」と「`VITE_BACKEND_URL`」の
2箇所のみ(`ALLOWED_ORIGINS`はVite側の複数候補ポートを既にカバーしているため
Backend側の追加変更は不要)。

## secretの取り扱い

- `SEKISAN_NAVI_ADMIN_PASSWORD`の実値・`data/master/estimate_master_a.xlsx`・
  `backend/data/sekisan_navi.db`(実データ投入後)はいずれもリポジトリに含めない
  (`.gitignore`参照)。
- ドキュメント・README・スクリーンショットへも実パスワード・実業務データを
  記載/掲載しない。
