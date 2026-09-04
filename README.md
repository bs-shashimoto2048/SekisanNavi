# Sekisan Navi (積算ナビ)

設計データ・図面・AI検出結果などから積算に必要な情報を収集し、ユーザーが図面上の
根拠を確認しながら積算情報を確認・補完・確定できるようにする、社内向け積算情報収集
Webシステムのプロトタイプ(PoC)。「AIによる完全自動積算システム」ではなく、
人の判断を安全に減らしていくための土台という位置付け(詳細は
[Product Vision](docs/product-vision.md)参照)。

## 解決する課題

- 図面・設計データ・AI検出結果が別々に存在し、積算に必要な情報を人手で
  図面から拾い集める作業に時間がかかる。
- 「なぜその数量・金額になったか」の根拠(どの図面のどのBBoxか)を、後から
  遡って追跡しづらい。
- Master価格表(Excel)の更新や図面の再確認によって、過去の積算結果が
  いつの間にか変わってしまう(再現性の問題)。

Sekisan Naviは、これらを画面上で完結させ、かつ将来の段階的自動化(判断データの
蓄積)につながる形で解決することを目指している。

## 現在実装済みの主要機能

- **実図面Viewer**: 製番配下の実PNG/PDFをブラウザ上でzoom/pan/Fit表示し、
  盤領域・AI検出結果・Manual BBoxを重畳表示する。
- **図面一覧**: 製番配下のページをサムネイル一覧表示し、種類別にグループ化する。
- **Manual BBox追加・編集**: 積算コードMasterから品目を選び、図面上へBBoxを
  ドラッグ配置。作成後の移動・リサイズ・削除・Undo/Redoに対応する。
- **積算コードMaster検索**: 実Excel(`estimate_master_a.xlsx`)を正式参照元とした
  品目検索・カテゴリタブ切替。
- **盤情報**: 実データ(`estcode_df.csv`)由来の盤ごとの寸法・型式等を表示する。
- **積算集約・積算明細**: 対象(総合計/製品全体/個別盤/要確認)ごとに数量・金額を
  集約表示し、明細1件ずつの根拠(どの図面のどのBBoxか)を追跡できる。
- **積算確定snapshot**: 製番単位で、その時点の積算結果一式をBackend側で
  組み立ててDBへ確定保存する(Master価格が後から変わっても確定内容自体は
  変化しない)。
- **判断・修正データの最小記録**: Manual BBoxのcreate/delete/move/resizeを
  `decision_events`として自動的に記録する(通常の操作から自然に蓄積、
  読み出しUIは未実装)。
- **製番検索・切替、データ参照ルートの管理者設定**。

実装状況の詳細な確定/暫定/未確定の区分は [`docs/implementation-plan.md`](docs/implementation-plan.md)
を参照。

## 基本的な画面構成・操作の流れ

1. 画面上部のヘッダーで現在の案件情報を確認し、「製番を開く」から実製番を検索・選択する。
2. 左ペイン「図面一覧」でページを選び、中央Viewerで図面・盤領域・検出結果を確認する。
3. 積算コードMaster(画面下部)で品目を選び、Viewer上へドラッグしてBBoxを配置する
   (積算コードとして紐付け)。
4. 右ペイン「積算集約」で対象ごとの数量・金額を確認し、「積算明細」で個々の
   根拠(BBox)を追跡する。
5. 内容を確認できたら「積算確定する」で、その時点の結果をsnapshotとして確定保存する。

詳細な画面仕様は [`docs/ui-spec.md`](docs/ui-spec.md) を参照。

## 技術構成

| 層 | 技術 |
|---|---|
| Frontend | React 19 + TypeScript + Vite 8 + PDF.js |
| Backend | FastAPI + Pydantic + SQLite(生SQL、ORM無し) |
| テスト | pytest(Backend) / vitest + Testing Library(Frontend) |

バージョンの詳細・使用箇所は [`docs/tech-stack.md`](docs/tech-stack.md) を参照。

```
backend/    FastAPI + SQLite (Python)
frontend/   React + TypeScript + Vite + PDF.js
docs/       設計・仕様・開発ドキュメント
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
`http://localhost:8000/docs` (Swagger UI) で確認できる(詳細は
[`docs/api-reference.md`](docs/api-reference.md))。

**`data/master/estimate_master_a.xlsx` は社内業務データのため、このリポジトリには
含まれていない (`.gitignore`の`/data/`)。** 各自の環境で `SekisanNavi/data/master/`
配下に実ファイルを配置してから起動すること (配置パスは`backend/app/config.py`の
`MASTER_EXCEL_PATH`参照。Sheet2を読む)。ファイルが無い場合、積算コードMasterの
インポートのみエラーになるが、アプリ自体は起動する。

積算コードMasterは `data/master/estimate_master_a.xlsx` (Sheet2) を正式な参照元と
しており、`estimate_master_items` テーブルへは `code` を一意キーとした
UPSERTで投入・再取込される。再取込を手動で行いたい場合は
`python -m app.db.master_importer` を実行する (Manual BBoxの `master_item_id` 参照は
再取込後も壊れない)。使用する品名は業務指定の13種類のみに限定しており
(`backend/app/domain/master_categories.py`)、それ以外の品名の行やコード/品名に
取り消し線が設定された行はインポート時点で除外される。詳細は
[`docs/data-model.md`](docs/data-model.md)/[`docs/architecture.md`](docs/architecture.md) 参照。

データ参照ルートの初期値は `\\beans-f1\ShareData\estimatic\a_product\output` で、
社内LAN・共有フォルダへ接続できる環境で実行することを前提とする
(接続できない環境では、実図面を参照する機能のみエラーになるが、アプリ自体は起動する)。

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

設定値・環境変数の一覧は [`docs/configuration.md`](docs/configuration.md) を参照。

### テスト・型チェック・Lint

```bash
# Backend
cd backend && source .venv/Scripts/activate && python -m pytest -q

# Frontend
cd frontend && npm run test    # = vitest run
cd frontend && npx tsc -b tsconfig.app.json --noEmit
cd frontend && npm run lint
cd frontend && npm run build   # 型チェックを兼ねたビルド確認
```

2026-09時点のmainで、Backend 175件・Frontend 602件(28ファイル)のテストが
全件成功することを確認済み。

## Documentation

| Doc | 内容 |
|---|---|
| [`docs/product-vision.md`](docs/product-vision.md) | Product Vision — なぜ作るのか・将来の段階的自動化への方向性 |
| [`docs/architecture.md`](docs/architecture.md) | アーキテクチャ(レイヤー構成・ディレクトリ構成・主要な設計判断) |
| [`docs/data-model.md`](docs/data-model.md) | データモデル(テーブル定義・状態一覧) |
| [`docs/api-reference.md`](docs/api-reference.md) | APIリファレンス(現在存在するエンドポイント一覧) |
| [`docs/ui-spec.md`](docs/ui-spec.md) | UI仕様 |
| [`docs/tech-stack.md`](docs/tech-stack.md) | 技術スタック一覧(バージョン・用途) |
| [`docs/configuration.md`](docs/configuration.md) | 設定・環境変数一覧 |
| [`docs/coding-conventions.md`](docs/coding-conventions.md) | コーディング規約(命名・層構成・テスト方針) |
| [`docs/known-limitations.md`](docs/known-limitations.md) | 既知の制約・未実装事項 |
| [`docs/data-source.md`](docs/data-source.md) | 実データソース調査結果 |
| [`docs/decision-data-gap-analysis.md`](docs/decision-data-gap-analysis.md) | 将来自動化に向けた判断・修正データの保存状況棚卸し |
| [`docs/decision-event-design.md`](docs/decision-event-design.md) | 判断履歴(`decision_events`)の設計 |
| [`docs/decision-snapshot-design.md`](docs/decision-snapshot-design.md) | 積算確定snapshotの設計 |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | 実装計画・確定/暫定/未確定の分類・各Phaseの実施記録 |
| [`docs/DOCUMENTATION_REPORT.md`](docs/DOCUMENTATION_REPORT.md) | ドキュメント整備状況のレポート(Issue #11) |
| [`CLAUDE.md`](CLAUDE.md) | Claude Code向け開発ガイド |

## 重要な前提・現在の制約

- 提供されているExcel・画面案は完成仕様ではなく、検討中の参考資料として扱っている。
  項目追加・削除・名称変更・コード体系変更等が今後発生する前提で設計している。
- 元図面・PDF・設計データ・共有フォルダ上のファイルは read-only。本システムが
  上書き・削除・移動・リネームすることはない。
- AIの検出結果 (Detection) と積算業務ルールは分離しており、AIクラスから
  直接積算コードを決定する実装は行わない (`backend/app/domain/rule_engine.py`)。
- データ参照ルートの変更・接続確認には管理者パスワード (`SEKISAN_NAVI_ADMIN_PASSWORD`) が
  必須で、その検証は必ずBackend側で行う。通常の製番・図面参照には不要。
- 認証・actor記録・判断履歴の読み出しUI・確定snapshot履歴閲覧UI・CIはいずれも
  未実装。詳細は [`docs/known-limitations.md`](docs/known-limitations.md) を参照。

## Product Vision

現在の実装はゴールではなく、**将来の見積り自動化のための判断データを安全に
蓄積していく基盤**という位置付けにある。通常の積算作業(BBox作成・修正・確定)を
行うだけで、後から分析・自動化に使える判断データが自然に残る設計を志向している
(`decision_events`・積算確定snapshotはその第一歩)。背景・段階的な自動化の考え方は
[`docs/product-vision.md`](docs/product-vision.md) を参照。
