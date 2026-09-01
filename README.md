# Sekisan Navi (積算ナビ)

社内向け積算情報収集Webシステム。設計データ・図面・AI検出結果などから積算に必要な情報を
収集し、ユーザーが図面上の根拠を確認しながら積算情報を確認・補完・確定できるようにする
ことを目的とする (「AIによる完全自動積算システム」ではない)。

現在は **Phase 0 (要件整理・設計) / Phase 1 (ダミーデータによるPoC) / Phase 1.5
(実図面Viewer・実データ参照) / Phase 1.6 (積算コードMaster刷新・Manual BBox追加) /
Phase 1.7 (実積算Master全面参照・BBox削除/リサイズ編集) / Phase 1.8
(製番検索・左ペインPNGサムネイル化・product_df盤領域Overlay)** が完了した段階。
詳細は `docs/` を参照:

- [`docs/architecture.md`](docs/architecture.md) — アーキテクチャ
- [`docs/data-model.md`](docs/data-model.md) — データモデル
- [`docs/ui-spec.md`](docs/ui-spec.md) — UI仕様
- [`docs/data-source.md`](docs/data-source.md) — 実データソース調査結果 (Phase 1.5)
- [`docs/implementation-plan.md`](docs/implementation-plan.md) — 実装計画・確定/暫定/未確定の分類

## 構成

```
backend/    FastAPI + SQLite (Python)
frontend/   React + TypeScript + Vite + PDF.js
docs/       設計ドキュメント
```

## セットアップ・起動方法

### Backend

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate   # Windows Git Bash の場合。cmd/PowerShellは .venv\Scripts\activate
pip install -r requirements.txt

# 管理者パスワードを設定する (システム設定画面でのデータ参照ルート変更に必要)
cp .env.example .env
# .env を編集して SEKISAN_NAVI_ADMIN_PASSWORD を設定する (実パスワード入りの.envはGit管理対象外)

uvicorn app.main:app --reload --port 8000
```

起動時に自動でSQLiteスキーマのマイグレーションとダミーデータ投入、および
積算コードMaster (`data/master/estimate_master_a.xlsx`) のインポートが行われる
(`backend/data/sekisan_navi.db` が生成される)。API仕様は起動後
`http://localhost:8000/docs` (Swagger UI) で確認できる。

**`data/master/estimate_master_a.xlsx` は社内業務データのため、このリポジトリには
含まれていない (`.gitignore`の`/data/`)。** 各自の環境で `SekisanNavi/data/master/`
配下に実ファイルを配置してから起動すること (配置パスは`backend/app/config.py`の
`MASTER_EXCEL_PATH`参照。Sheet2を読む)。ファイルが無い場合、積算コードMasterの
インポートのみエラーになるが、アプリ自体は起動する。

積算コードMasterは `data/master/estimate_master_a.xlsx` (Sheet2) を正式な参照元と
しており (Phase 1.7)、`estimate_master_items` テーブルへは `code` を一意キーとした
UPSERTで投入・再取込される。再取込を手動で行いたい場合は
`python -m app.db.master_importer` を実行する (Manual BBoxの `master_item_id` 参照は
再取込後も壊れない)。使用する品名は業務指定の13種類のみに限定しており
(`backend/app/domain/master_categories.py`)、それ以外の品名の行やコード/品名に
取り消し線が設定された行はインポート時点で除外される (Phase 1.7 追加修正。
詳細は `docs/data-model.md`/`docs/architecture.md` 参照)。

データ参照ルートの初期値は `\\beans-f1\ShareData\estimatic\a_product\output` で、
社内LAN・共有フォルダへ接続できる環境で実行することを前提とする
(接続できない環境では、実図面を参照する機能のみエラーになるが、アプリ自体は起動する)。

Phase 1.8で、画面左ペイン(図面一覧)はデータ参照ルート配下の実製番フォルダにある
`{page}.png`を使ったサムネイル表示になった (盤領域Overlayは表示しない)。
中央Drawing Viewerも、左ペインと同じ`{page}.png`を拡大表示し (PDF表示ではない。
座標基準をPNGへ統一するため)、`product_df.csv`から算出した盤領域を半透明赤色で
重畳する。PDF表示機能自体は削除しておらず、`DrawingCanvas`の別モードとして
残っている。ProjectHeaderの「製番を開く」から製番を検索・切替できる
(ルート直下の製番一覧を無条件に全件取得することはしない)。

### Frontend

```bash
cd frontend
npm install
npm run dev
```

`http://localhost:5173` で画面を確認できる。Frontendは `/api/...` への呼び出しを
Vite開発サーバーのプロキシ経由でBackendへ転送する (`vite.config.ts`)。プロキシ先は
既定で `http://127.0.0.1:8000`。

**ポートが競合する場合**: 開発機で `8000` や `5173` が既に別プロセスに使われている場合は、
`uvicorn app.main:app --port <別のポート>` で起動し、`frontend/.env.local`
(`cp .env.example .env.local` で作成) に
`VITE_BACKEND_URL=http://127.0.0.1:<そのポート>` を設定すること。
**変更が必要なのはこの1箇所だけ** — プロキシ経由のためFrontendから見ると常に同一オリジンで
アクセスすることになり、Backend側のCORS設定 (`ALLOWED_ORIGINS`) を変更する必要はない。

### テスト

```bash
# Backend
cd backend && source .venv/Scripts/activate && python -m pytest -q

# Frontend
cd frontend && npm run test
cd frontend && npm run build   # 型チェックを兼ねたビルド確認
```

## 重要な前提

- 提供されているExcel・画面案は完成仕様ではなく、検討中の参考資料として扱っている。
  項目追加・削除・名称変更・コード体系変更等が今後発生する前提で設計している。
- 元図面・PDF・設計データ・共有フォルダ上のファイルは read-only。本システムが
  上書き・削除・移動・リネームすることはない。Phase 1.5で実データへの参照
  (製番ディレクトリ配下の実PDF表示) を実装したが、これも読み取り専用のアクセスのみで、
  実ファイルへの書き込みは一切行わない。
- AIの検出結果 (Detection) と積算業務ルールは分離しており、AIクラスから
  直接積算コードを決定する実装は行わない (`backend/app/domain/rule_engine.py`)。
- データ参照ルートの変更・接続確認には管理者パスワード (`SEKISAN_NAVI_ADMIN_PASSWORD`) が
  必須で、その検証は必ずBackend側で行う。通常の製番・図面参照には不要。
