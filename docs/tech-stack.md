# tech-stack.md — 技術スタック一覧

Sekisan Naviが実際に依存しているライブラリ・フレームワークの一覧。バージョンは
`backend/requirements.txt` / `frontend/package.json` に記載された値をそのまま転記して
いる(リポジトリから確認できないバージョンは「不明」と明記し、推測しない)。

## Backend (`backend/requirements.txt`)

| ライブラリ | 用途 | 使用箇所 | バージョン |
|---|---|---|---|
| fastapi | Webフレームワーク・ルーティング・Pydanticとの統合 | `app/api/routers/*`, `app/main.py` | 0.115.0 |
| uvicorn (extras: standard) | ASGIサーバー | 起動コマンド(`uvicorn app.main:app`) | 0.30.6 |
| pydantic | APIリクエスト/レスポンスのスキーマ検証 | `app/schemas/*` | 2.9.2 |
| pytest | テストランナー | `backend/tests/*` | 8.3.3 |
| httpx | `fastapi.testclient.TestClient`が内部で使用 | テスト実行時のみ | 0.27.2 |
| openpyxl | 積算コードMaster Excel(`estimate_master_a.xlsx`)の読み込み(セル書式=取り消し線判定を含む) | `app/db/master_importer.py` | 3.1.5 |

標準ライブラリのみで実装され、`requirements.txt`に無い依存: `sqlite3`(DBアクセス、
`app/db/connection.py`)、`csv`(`product_df.csv`/`estcode_df.csv`/`detected_df.csv`の
読み込み、`app/services/*_df.py`)。ORM(SQLAlchemy等)は導入していない
(`docs/architecture.md` 5章)。

**Python本体のバージョン**: `requirements.txt`・リポジトリ内のいずれにも
`.python-version`等の明示的な指定ファイルは無い。「不明」とし、特定のバージョンを
要求仕様として記載しない。

## Frontend (`frontend/package.json`)

### dependencies

| ライブラリ | 用途 | 使用箇所 | バージョン |
|---|---|---|---|
| react | UIライブラリ | `src/**/*.tsx`全般 | ^19.2.8 |
| react-dom | Reactのブラウザレンダラ | `src/main.tsx`(エントリポイント) | ^19.2.8 |
| pdfjs-dist | PDF描画(`mode="pdf"`時のみ使用。実製番モードの既定はPNG表示) | `src/pdf/pdfjs.ts`, `src/components/DrawingViewer/DrawingCanvas.tsx` | ^6.2.108 |

### devDependencies

| ライブラリ | 用途 | 使用箇所 | バージョン |
|---|---|---|---|
| typescript | 型チェック・ビルド(`tsc -b`) | 全体 | ~6.0.2 |
| vite | 開発サーバー・ビルドツール | `vite.config.ts` | ^8.2.2 |
| @vitejs/plugin-react | ViteのReact統合(Fast Refresh等) | `vite.config.ts` | ^6.1.0 |
| vitest | テストランナー | `**/*.test.ts(x)` | ^4.1.11 |
| jsdom | vitestのDOM環境(`test.environment: 'jsdom'`) | `vite.config.ts` | ^29.1.1 |
| @testing-library/react | コンポーネントテスト用レンダリング/クエリAPI | `**/*.test.tsx` | ^16.3.3 |
| @testing-library/jest-dom | vitest向けDOMアサーション拡張(`toBeInTheDocument`等) | `src/setupTests.ts` | ^7.0.1 |
| oxlint | Lint | `npm run lint` | ^1.79.0 |
| @types/react / @types/react-dom / @types/node | 型定義 | 全体 | ^19.2.18 / ^19.2.4 / ^24.13.3 |

**Node.js本体のバージョン**: `package.json`に`engines`指定は無く、`.nvmrc`等も
リポジトリに存在しない。「不明」とする。

## データ形式・外部データソース

コードとしての依存ライブラリではないが、Backendが読み書きする外部データ形式:

| 形式 | 用途 | 読み込み元 |
|---|---|---|
| SQLite (単一ファイル) | current stateの永続化(`detections`/`estimate_master_items`/`decision_events`/`estimate_confirmations`等) | `backend/data/sekisan_navi.db`(gitignore対象、起動時に自動生成) |
| Excel (.xlsx) | 積算コードMasterの正式参照元 | `data/master/estimate_master_a.xlsx`(gitignore対象、リポジトリに同梱しない) |
| CSV (cp932エンコード) | 盤領域・盤情報・YOLO検出結果の実データ参照(都度読み込み、DB非永続化) | 共有フォルダ配下の`product_df.csv`/`estcode_df.csv`/`detected_df.csv` |
| PNG / PDF | 図面本体 | 共有フォルダ配下(read-only参照のみ) |

## 明示的に採用していない技術

以下はいずれもコード上・設定上確認できず、意図的に導入していない
(`docs/architecture.md`参照)。

- ORM(SQLAlchemy等) — 生SQL + 自作の軽量マイグレーションランナー
- 状態管理ライブラリ(Redux/Zustand等) — `App.tsx`中心のReact標準state
- データフェッチライブラリ(React Query等) — `fetch`の薄いラッパー(`api/client.ts`)
- CIサービス(GitHub Actions等) — `.github/`ディレクトリはリポジトリに存在しない
