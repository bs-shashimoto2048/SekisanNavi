# configuration.md — 設定・環境変数

Sekisan Naviが参照する設定値の一覧。secretの実値は記載しない(プレースホルダ・
既定値のみ)。

## Backend

### 環境変数

| 変数 | 必須 | 既定値 | 説明 |
|---|---|---|---|
| `SEKISAN_NAVI_ADMIN_PASSWORD` | 事実上必須 | 未設定 | データ参照ルート変更・接続テストAPIの認証に使う定数時間比較用パスワード。未設定の場合、これらのAPIは常に認証失敗になる(fail-closed、`app/config.py`)。`backend/.env`(Git管理対象外)からも読み込める(`_load_dotenv_if_present()`)。 |
| `SEKISAN_NAVI_DB_PATH` | 任意 | 未設定(下記`DB_PATH`の既定値を使用) | Issue #23 Phase 2で追加。使用するSQLite DBファイルのパスを上書きする(検証用DBへの切替用)。未設定時は挙動が一切変わらない。相対パスを指定した場合、Backend起動時のカレントディレクトリを基準に解決される(このモジュール側では`.resolve()`等による絶対パス化は行わない)。起動ディレクトリの取り違えによる事故を避けたい場合は絶対パスを推奨する。`backend/.env`からも読み込める。データ参照ルート(`system_settings.data_source_root`)はDBファイルの中身の一部のため、この変数は変更しない(切替先DBに保存されている値がそのまま使われる)。詳細な運用手順は本ファイル末尾の「検証用DBへの切替」節、および[README.md](../README.md)参照。 |

`backend/.env.example`をコピーして`backend/.env`を作成し、値を設定する運用
(README参照)。実パスワード入りの`.env`はコミットしないこと(`.gitignore`)。

### `app/config.py` のコード内既定値(環境変数ではない)

| 設定 | 値 | 説明 |
|---|---|---|
| `DB_PATH` | `backend/data/sekisan_navi.db` | SQLiteファイルの配置先(gitignore対象、起動時に自動生成)。環境変数`SEKISAN_NAVI_DB_PATH`が設定されている場合はそちらが優先される(上記参照)。 |
| `MIGRATIONS_DIR` | `backend/app/db/migrations/` | マイグレーションSQLの配置先。 |
| `ALLOWED_ORIGINS` | `http://localhost:5173〜5175`, `http://127.0.0.1:5173〜5175` | CORS許可オリジン。Vite開発サーバー用に複数ポートを許可(5173使用中時の予備ポート分)。 |
| `DEFAULT_DATA_SOURCE_ROOT` | `\\beans-f1\ShareData\estimatic\a_product\output` | データ参照ルートの初期値(`system_settings`テーブルへ投入される)。社内共有フォルダのUNCパス。 |
| `CCV_SUBDIR_CANDIDATES` | `["CCV", "ccv"]` | 製番ディレクトリ配下に存在すれば使うサブディレクトリ名候補(暫定。`docs/data-source.md`参照)。 |
| `PRODUCT_NO_PATTERN` | `^[A-Za-z0-9]{4,20}$` | 製番として許可する文字列パターン(パストラバーサル対策)。 |
| `MASTER_EXCEL_PATH` | `<repo root>/data/master/estimate_master_a.xlsx` | 積算コードMasterの正式参照元(gitignore対象、各自配置)。 |
| `MASTER_EXCEL_SHEET` | `"Sheet2"` | 上記Excelの読み込み対象シート名。 |
| `HELP_PDF_PATH` | `<repo root>/data/help/estimate-help.pdf` | 積算資料PDF(Help)の**標準配置場所**(Issue #19 Phase 3で導入、Phase 4で正式な標準配置場所として再確認。gitignore対象、各自配置)。積算コードMasterを置き換えるものではなく、あくまでHelp/参考資料。 |

`HELP_PDF_PATH`にファイルが無くてもアプリ自体・Backend起動は妨げない(`MASTER_EXCEL_PATH`と
同じ方針)。Frontendの「積算資料」ボタン→modalから軽量な存在確認API
(`GET /api/help/estimate-pdf/status`)を呼び、無い場合は「積算資料が配置されていません」と
明確に案内する(`docs/api-reference.md`参照)。配信は常にこの固定パス1ファイルのみを対象とし、
リクエストから任意のパスを指定できる仕組みは無い。

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

## 検証用DBへの切替 (Issue #23 Phase 2)

実製番を使った作業検証(Manual BBox作成/移動/リサイズ/削除、Undo/Redo、積算確定等)を
本番用DB (`backend/data/sekisan_navi.db`) と分離して行うための手順。Issue #23の
Phase 1調査で、`decision_events`/`estimate_confirmations`がappend-only(特に
積算確定は削除・更新APIが存在せず完全に不可逆)であることを確認しており、実データでの
作業検証は本番DBとは別のDBファイルに対して行うことを推奨する。

### 前提

- `SEKISAN_NAVI_DB_PATH`環境変数は、DBファイルパスの切替のみを行う。以下は
  この仕組みの対象外であり、変更・自動化されない。
  - データ参照ルート(`system_settings.data_source_root`)の値そのもの
    (切替先DBファイルへコピーされた値がそのまま使われるだけ)
  - DBファイルのコピー・バックアップ自体(運用者が別途手動で行う)
  - Frontend側の表示(検証用DBに接続していることを示すUIバナー等は無い。
    どのBackendポートに接続しているかは、起動時の`netstat`等でのプロセス確認
    (下記手順5)で判断すること)

### 手順例

1. 本番DBを安全なタイミング(書き込み中でない時)でコピーする。
   ```bash
   cp backend/data/sekisan_navi.db /path/to/verification/sekisan_navi.db
   ```
2. 検証用DBファイルを指定して、Backendを本番用とは別のポートで起動する。
   ```bash
   cd backend
   SEKISAN_NAVI_DB_PATH=/path/to/verification/sekisan_navi.db \
     uvicorn app.main:app --port 8010
   ```
   相対パスも指定できるが、Backend起動時のカレントディレクトリを基準に解決される
   ため、本番DBとの取り違えを避けたい場合は絶対パスを指定すること。
   起動時のmigration・ダミーデータ投入・Master Excelインポートは、このDBファイル
   に対してのみ行われる(本番DBには一切書き込まれない)。
3. Frontendの接続先を検証用backendへ向ける。
   ```bash
   cd frontend
   cp .env.example .env.local   # 未作成の場合
   # .env.local に以下を設定
   # VITE_BACKEND_URL=http://127.0.0.1:8010
   npm run dev
   ```
4. 一連の作業検証を実施する。
5. 検証前後で、実際にどちらのBackendポートに接続しているかを`netstat`等で
   プロセスのコマンドラインまで確認し、本番/検証の取り違えがないことを確認する
   (Issue #19の作業でも、backend port 8000/8010の取り違え防止のため同様の確認を
   実施した実績がある)。
6. 検証後は検証用DBファイルを破棄するか任意の場所(Git管理対象外)へ保管し、
   Frontendの`VITE_BACKEND_URL`を本番backendのポートへ戻す。

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
