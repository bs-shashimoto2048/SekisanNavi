# implementation-plan.md — 実装計画と仕様分類

Sekisan Navi (積算ナビ) の実装計画。参考資料 (`20250707_積算情報収集システム_U概要.xlsx`,
提供画面案) に書かれているという理由だけで仕様を「確定」とはしない(要件19)。
ここでは項目ごとに **確定 / 暫定 / 未確定** を明記する。

- **確定**: 今回の指示・要件で明示された、変更予定のない方針。
- **暫定**: PoCとして値・構造を仮に置いたもの。実機確認や実データ調査で変わる前提。
- **未確定**: 現時点で方針すら決まっていない、今後ユーザー判断が必要な事項。

## 1. システム方針 (確定)

- Webアプリとして開発する (デスクトップアプリにしない)。
- 「AIによる完全自動積算システム」ではなく、ユーザーが根拠を確認しながら
  確認・補完・確定する情報収集システムである。
- Detection(AI検出) → RuleEngine → EstimateItem の流れを分離し、
  AIクラスと積算コードを直接結合しない。
- 元図面・PDF・設計データ・共有フォルダ上のファイルは read-only。解析処理で
  上書き・削除・移動・リネームしない (Phase 1.5で実データ参照を実装した後も維持)。
- 積算結果から根拠図面・BBox・盤へ遡れる構造 (EstimateReference) を維持する。
- Phase 1/1.5では実YOLO推論・本番積算Rule・本番Parser・本番DB連携・本番認証・
  本番運用向けデプロイは実装しない (要件23)。
- 設定変更API (データ参照ルート) は必ずBackend側で管理者認証を検証する。
  通常の製番・図面参照には認証を要求しない (Phase 1.5, 要件12/18)。

## 2. 技術構成 (確定 / 一部暫定)

| 項目 | 内容 | 状態 |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite | 確定 (指示通り) |
| Backend | Python + FastAPI + Pydantic | 確定 (指示通り) |
| DB | SQLite (マイグレーション機構あり) | 確定 (指示通り) |
| 図面Viewer | PDF.js (`pdfjs-dist` 6.2.108) を採用し、Phase 1.5で実PDF表示を実装 | 確定 (Vite/React構成との相性を確認済み。`architecture.md` 10章) |
| AI推論 | Ultralytics YOLOを想定。Phase 1.5でも未接続 | 確定 (要件23で明示) |
| マイグレーション方式 | 自作の連番SQL + `schema_migrations` テーブル方式 (Alembic等未導入) | **暫定** (要件が求めるのは「schema migration可能な構成」であり、ツール選定は未確定) |
| データ参照ルート解決 | `app/services/data_source.py` による安全なパス解決 (Phase 1.5) | 確定 (パストラバーサル対策・root配下チェックを実装・テスト済み) |
| 管理者認証方式 | 環境変数からの平文パスワード比較 (定数時間比較) | **暫定** (PoC限定の簡易方式。本番認証方式は未確定) |

## 3. ドメインモデル (暫定 / 未確定)

`data-model.md` に詳細を記載。特に以下は **未確定**:

- 積算コード体系 (11xxx/18xxx/44xxx等の桁の意味・命名規則)
- AI検出クラス名・クラス構成 (AI対応リストシートの案は検討中資料であり確定候補ではない)
- PanelAttributeのkey命名 (baninf等実データ調査待ち)
- 「盤範囲」の表現方法 (矩形/多角形/複数ページ跨り)
- 積算Masterに価格・工数情報を持たせるか、別システム(Excel等)に留めるか
  → Phase 1.6で「持たせる」方向で価格内訳7列を追加したが、値が確認できない項目は
    NULLのままであり、価格計算ロジック自体は未実装 (**未確定のまま**)
- Detection.status / EstimateItem.status / AnalysisStatusの値候補は「暫定」
- Manual BBox (Detection.source_type='manual') のstatus既定値・panel_id自動推定
  方法は「暫定」(Phase 1.6で追加。data-model.md参照)

## 4. Phase 0 (完了)

- 参考資料確認: `20250707_積算情報収集システム_U概要.xlsx` (シート: UI案/作業/対象品目/
  AI対応リスト/プログラム対応リスト/保留/対象外 等) および提供画面案(スクリーンショット)を確認。
- 要件整理・アーキテクチャ設計: 本ドキュメント一式として整理。

## 5. Phase 1 (完了・本PoCの実装範囲)

### Backend
- FastAPIプロジェクト骨格 (`backend/app`)
- ドメインモデル (`domain/models.py`) と RuleEngineスケルトン (`domain/rule_engine.py`)
- SQLiteスキーマ (`db/migrations/0001_init.sql`) とマイグレーションランナー (`db/migrate.py`)
- ダミーデータ投入 (`db/seed.py`) — 参考資料の値を「例示データ」として一部借用
  (確定仕様として転記したわけではない旨をコード内コメントに明記)
- REST API: `/api/project`, `/api/drawing-pages`, `/api/panels`, `/api/detections`,
  `/api/estimate-items`, `/api/master-items`
- テスト: `tests/test_rule_engine.py` (RuleEngine単体), `tests/test_api_drawings.py`,
  `tests/test_api_estimates.py` (API結合)

### Frontend
- Vite + React + TypeScriptプロジェクト骨格 (`frontend/`)
- コンポーネント構成: `ProjectHeader` / `DrawingNavigator` / `DrawingViewer`
  (`DrawingCanvas` + `DetectionOverlay` + `PanelOverlay`) / `PanelProperties` /
  `EstimateTree` / `EstimateMasterPicker`
- APIクライアント (`api/client.ts`) と型定義 (`types/domain.ts`)
- 主要コンポーネントのテスト (Vitest + Testing Library)

### 実装できたユーザー操作
- 図面一覧から種類別グループを見てページを選択する
- 選択ページのDetection(ダミーBBox)を確認し、クリックして選択する
- 選択したDetectionに紐づく盤パラメータを確認する (属性の取得元も表示)
- 積算結果Treeをカテゴリ別に確認する
- 積算結果の根拠図面リンクから、対象ページ・対象BBoxへジャンプし一時強調表示させる
- 積算コードMasterをテキスト検索・品名絞り込みで確認する

## 6. Phase 1.5 (完了・実図面Viewer + 実データ参照)

目的: 積算業務仕様を確定する前に、実図面を使ってWeb UIの操作感を評価できる状態にする。
既存のPhase 1アーキテクチャ (Detection → RuleEngine → EstimateItem の分離等) は維持したまま、
以下を追加した。

### Backend
- `system_settings` テーブル (データ参照ルートの永続化)
- `app/services/data_source.py`: ルート+製番からの安全なパス解決 (パストラバーサル対策、
  root配下チェック、CCVサブディレクトリの探索とフォールバック)
- `app/services/admin_auth.py`: 管理者パスワード検証 (環境変数 `SEKISAN_NAVI_ADMIN_PASSWORD`
  または `backend/.env`。fail-closed、定数時間比較)
- API追加: `GET/PUT /api/settings/data-source`, `POST /api/settings/data-source/test`,
  `GET /api/products/{product_no}`, `GET /api/products/{product_no}/drawings`,
  `GET /api/products/{product_no}/drawings/{page_no}/file`,
  `GET /api/drawing-pages/{id}/file` (既存デモページの実PDF配信)
- `drawing_pages` に `source_type`/`product_no`/`source_page_no` を追加し、デモ用ページを
  実製番 `A1GV2421` (`docs/data-source.md` で実在確認済み) の実PDFへ差し替え
- `panel_areas` テーブル (盤範囲Overlay。Detectionと独立)
- Detection/PanelAreaの座標を「ページ絶対座標」から「0.0〜1.0正規化座標」へ意味変更

### Frontend
- `pdfjs-dist` (6.2.108) を導入し、`DrawingCanvas` を実PDF描画 + zoom/pan/fitに全面刷新
- `DetectionOverlay`/`PanelOverlay` を正規化座標ベースの%配置に変更、
  Detectionの状態表示に `needs_review` を追加
- `SystemSettings` (管理者向けデータ参照ルート設定画面) を追加
- `ProductViewer` (製番を指定した実データ参照画面) を追加
- `ProjectHeader` に「製番を開く」「システム設定」ボタンを追加

### 実データ調査
- `docs/data-source.md` に、実際の共有フォルダ構造・座標系・「CCV」の調査結果
  (見つからなかった旨) を記録

### 完了条件チェック
Phase 1.5完了条件 (指示書26章) 19項目のうち、ブラウザでの実PDF表示・zoom/pan/fitの
最終的な目視確認はユーザー側での操作を前提とする (完了報告メッセージ参照)。
それ以外の項目 (BBox/Panel Overlayの座標整合、データ参照ルートの永続化・初期値、
管理者認証、パス解決の安全性、テスト・ビルド成功等) はBackend/Frontend双方の
自動テストと実共有フォルダに対するAPI疎通確認で検証済み。

### 実機確認で発見・修正した不具合 (Phase 1.5 追加修正)

実際にブラウザで開いたところ、`Failed to fetch` により図面一覧・積算結果等が
表示されない不具合が発生した。調査の結果、以下が根本原因と判明した:

- **根本原因**: FastAPIの同期(`def`)依存関係・エンドポイントは内部で
  スレッドプール (`run_in_threadpool`) 経由で実行される。1リクエストの中でも
  `get_db()`依存関係(接続生成)とエンドポイント本体(接続使用)が異なる
  プールスレッドに割り当てられる場合があり、`sqlite3.connect()` の既定設定
  (`check_same_thread=True`) のままだと `sqlite3.ProgrammingError` が
  不定期に発生していた。
- この例外はハンドルされないままStarletteの既定エラーハンドラに到達し、
  結果として返る500レスポンスに `Access-Control-Allow-Origin` ヘッダが
  付与されていなかった。ブラウザの `fetch()` はこれを (500の中身を見る前に)
  CORSエラー = ネットワークエラーとして扱うため、JS側には `TypeError:
  Failed to fetch` としてしか見えなかった。
- Frontend側の複数コンポーネントが起動時に同時多発でAPIを呼び出す
  (`Promise.all`によるProject/DrawingPages/EstimateItems取得 +
  EstimateMasterPickerの独立取得 等) ため、実ブラウザではほぼ確実に
  再現する一方、pytestの逐次的なAPIテストでは再現しなかった。
- **修正**: `backend/app/db/connection.py` で `sqlite3.connect(..., check_same_thread=False)`
  を指定 (各リクエストは専用の新規接続を作成しスレッド間で同時共有はしないため安全)。
  実際に24並列×6エンドポイント×40回 = 240リクエストの負荷テストで、修正前234件エラー
  → 修正後0件エラーとなることを確認した。
- **回帰防止**: `backend/tests/test_concurrency.py` に、同様の並行アクセスを
  再現する自動テストを追加した (修正前のコードでは実際に失敗することを確認済み)。

あわせて、以下の恒久対策も実施した:

- **Frontend/Backendの接続先を1箇所に集約**: `frontend/vite.config.ts` に
  開発サーバーの `/api` プロキシを追加し、`frontend/.env.local` の
  `VITE_BACKEND_URL` のみでBackendの接続先を変更できるようにした
  (Frontendコードや個別のCORS設定を変更する必要がない)。開発時はブラウザから見て
  常に同一オリジンになるため、CORS起因の問題自体が発生しない構成にした。
- **エラー表示の改善**: `frontend/src/api/errors.ts` の `describeFetchError` で、
  ブラウザの生の例外メッセージ (`Failed to fetch` 等) をそのまま表示せず、
  「何の取得に失敗したか」が分かる日本語メッセージへ変換するようにした。
  また初期読込 (案件情報・図面一覧・積算結果) が失敗した場合は「再読み込み」ボタンを
  表示し、ユーザー操作で再試行できるようにした (従来は失敗すると永続的にエラー表示の
  ままになっていた)。

## 7. Phase 1.6 (完了・積算コードMaster刷新 + Manual BBox追加)

目的: 積算コードMasterを実際の積算作業に適した表示 (品名タブ + 価格内訳カラム) へ変更し、
選択した積算コードをDrawing Viewer上のドラッグ操作でBBox (Manual Detection) として
登録できるようにする。Phase 1.5までの責務分離 (Detection→RuleEngine→EstimateItem等) は
維持し、本番積算Rule・実YOLO推論・積算確定処理には進んでいない (要件23)。

### Backend
- `estimate_master_items` に価格・工数内訳7列を追加 (総合価格A/箱・部品価格/
  塗装価格/設A/板金/組立/検査)。元Excel資料で確認できた値のみ登録し、
  未確認の項目はNULLのまま (ダミー値・計算値は生成しない)
- `detections` に `source_type` (ai/manual) と `master_item_id` (nullable, FK) を追加
- `POST /api/detections`: Manual BBox登録API。drawing_page_id/master_item_idの実在確認、
  正規化座標 (0.0〜1.0、下限0.001) の検証、ページ範囲超過の検証を行う。
  source_type/statusはクライアントから指定させずBackend側で固定 (manual/reviewed)
- 既存のAI検出結果 (detections行) は一切変更しない (新規行の追加のみ)

### Frontend
- `EstimateMasterPicker` を全面刷新: Masterデータの `category` から動的にタブ生成、
  指定10カラムの表示 (3桁区切りフォーマット・NULL値は空欄)、行クリックでのManual BBox
  追加対象選択 (選択状態はApp.tsxが管理し、同じ行の再クリックで解除・別行クリックで
  切替・BBox追加後も維持)
- `DrawingCanvas` にBBox追加モードを実装: 積算コードMaster行選択中はドラッグが
  Pan操作からManual BBox作成に切り替わる (crosshairカーソル・ドラッグ中プレビュー・
  画面上6px未満の移動はクリックとみなし無視)。ドラッグで得た画面座標は
  zoom/pan状態から独立した0.0〜1.0正規化座標へ変換してから登録する
  (Phase 1.5のOverlay座標系を維持)
- `DetectionOverlay` にManual/AIの視覚的区別を追加 (紫破線枠+背景、ラベルに「✎」)。
  既存のselected/needs_review/excluded/flash等の状態表示はCSSの定義順により優先させる

### 完了条件チェック
指示書22章の17項目のうち、ブラウザでのタブ切替・行選択の目視・ドラッグ操作感は
ユーザー側での操作を前提とする (完了報告メッセージ参照)。それ以外の項目
(データ列マッピング・正規化座標変換・API検証・AI検出結果の不変性等) は
Backend/Frontend双方の自動テストとAPI疎通確認で検証済み。

## 8. Phase 1.7 (完了・実積算Master全面参照 + BBox削除・リサイズ編集)

目的: 積算コードMasterをダミーデータから正式なExcel資料へ全面差し替えし、
Drawing Viewer上のBBox (Manual/AI問わず) に削除・リサイズ編集を追加する。
Phase 1.6までの責務分離・座標系設計は維持し、実YOLO推論・本番積算Rule・
積算確定フローには進んでいない (要件28/29)。

### Backend
- `openpyxl` を新規依存として追加。`data/master/estimate_master_a.xlsx` (Sheet2) を
  正式な参照元として `app/db/master_importer.py` から読み込む
  (`architecture.md` 12章に詳細)
- `estimate_master_items` を再構築するマイグレーション (`0004_master_schema_v2.sql`):
  `item_name` 列を削除、`category` をnullable化 (PRAGMA foreign_keys OFF →
  再構築 → ON の手順でidを維持したまま実施)
- `code` を一意キーとしたUPSERT (`ON CONFLICT(code) DO UPDATE`) による
  初期投入・再取込 (idを変えないため、Manual DetectionのFK参照 `master_item_id` が
  再取込後も壊れない)
- `db/seed.py` からダミーMaster21件を削除 (Detection/Panel/EstimateItemのダミーは維持)
- `DELETE /api/detections/{id}`: Manual/AIどちらも削除可能。存在しなければ404。
  削除前に参照している`EstimateReference.detection_id`をNULL化 (行自体は削除しない)
- `PATCH /api/detections/{id}`: `bbox_x/y/w/h` のみ更新するBBoxリサイズ確定API
  (`DetectionBBoxUpdateIn` — 範囲外・過小サイズは422で拒否)

### Frontend
- `EstimateMasterPicker`: `category`がNULLの行を「未分類」タブへ振り分け表示 (後述の
  追加指示で廃止)、1タブ最大230件の表示に対応する内部スクロール実装、既存の検索・
  行選択は維持
- `utils/bbox.ts::resizeRect()`: 4隅ドラッグの正規化座標変換ロジックを純粋関数として実装
  (ズーム/パン/フィット状態に非依存。単体テストで4隅すべて・clamp・最小サイズを検証)
- `DetectionOverlay`: 選択中BBoxにのみ4隅ハンドルを表示し、ドラッグ中はライブプレビュー、
  mouseup確定時にのみ`onResizeDetection`を呼ぶ。ハンドルはBBoxボタンの兄弟`<button>`として
  実装し、既存のPan除外ガード (`closest('button')`) をそのまま利用できるようにした
- `DrawingCanvas`: ツールバー右端に「BBox削除」ボタンを追加 (選択有無でdisabled切替)、
  空白領域クリックでの選択解除 (`onBackgroundClick`) を追加
- `App.tsx`: Detection削除・リサイズのハンドラ、Deleteキーの`document`レベル監視
  (入力要素へのフォーカス時は無効化)、別ページ選択時の選択解除ロジックを追加

### 完了条件チェック
指示書31章の17項目のうち、ブラウザでのタブ切替・BBox選択/削除/リサイズの操作感は
ユーザー側での操作を前提とする (完了報告メッセージ参照)。それ以外の項目
(Excel全行インポート・列マッピング・UPSERTによるID維持・削除時のFK安全性・
リサイズの正規化座標変換・Pan/BBox追加/BBox編集の競合回避等) はBackend/Frontend
双方の自動テストと、Vite devサーバーのプロキシ経由でのAPI疎通確認 (実ブラウザが
辿るのと同一の経路) で検証済み。実ブラウザでのマウス操作そのものの目視確認は
本セッションの環境上実施できておらず、ユーザー側での確認を依頼する
(完了報告メッセージに明記)。

## 8.1. Phase 1.7 追加修正 (完了・使用品名の限定・表示順固定・取り消し線行の除外)

目的: Phase 1.7で全面参照するようにした実Excel (Sheet2) には、Sekisan Naviの
積算作業では使わない品名や、社内的に無効化された行 (取り消し線) が混在している
ことが判明したため、Master Importer側で以下を絞り込む。Frontendで隠すだけの
実装にはせず、DBへの取り込み自体を制御する。既存のMaster Importer/DB/API/Frontend
構造は維持したまま、必要最小限の修正に留めた。

### Backend
- `app/domain/master_categories.py` を新規追加: Sekisan Naviで使用する13品名と
  業務指定の表示順を定義する唯一の参照元 (`ALLOWED_CATEGORIES`)。Backend側の
  Importer・APIのみが参照し、Frontendへは値そのものをハードコードしない
  (二重管理の禁止)
- `master_importer.py`: セル書式(`cell.font.strike`)によるコード/品名の取り消し線
  判定を追加 (文字列内容からの推測はしない)。`ALLOWED_CATEGORIES` にない
  `category` の行 (品名NULL・文章形式の特殊行を含む) を取り込み対象から除外
- 既存Masterの安全な整理 (`_sync_remove_stale_master_items()`): 今回の条件で
  無効化された既存行のうち、どのDetectionからも参照されていないものは削除するが、
  既存のManual BBox (`detections.master_item_id`) が参照している行は削除せず
  `retained_invalid_referenced` として報告する (ユーザーデータの保護)
- `repositories/master.py::list_master_items()`: `ORDER BY` を `category, code`
  (五十音順相当) から `ALLOWED_CATEGORIES` の業務指定順 + `code` へ変更
  (`CASE category WHEN ... THEN <順位> ... END` によるSQL側での順序制御)
- スキーマ変更なし (`category` 列は従来通りnullableのまま。絞り込みはImporterの
  ロジックのみで実現し、DB制約は変更していない)

### Frontend
- `EstimateMasterPicker`: 「未分類」タブとその関連ロジックを削除。Backendが
  対象外品名・NULL品名の行を取り込まなくなったため、Frontend側の特別な分岐は
  不要になった。タブの並び順は「APIが返す順序をそのまま使う」ことで実現しており
  (`extractCategoryTabs()` は出現順で重複除去するのみ)、Frontendに品名一覧や
  順序を別途ハードコードしていない

### 完了条件チェック (追加指示14章、14項目)
実Excelでの再集計・自動テストにより全項目を確認済み (完了報告メッセージ参照)。
ブラウザでのタブ表示順の目視確認はユーザー側での操作を前提とする。

## 8.2. UIレイアウト追加修正 (完了・左右ペインのリサイズ対応 + 右ペイン全高化)

目的: 右ペイン(盤パラメータ+積算結果)をHeader直下から画面下端まで全高表示し、
積算コードMasterは右ペインの下へ潜り込ませず左ペイン+Viewer幅のみを使用するよう
レイアウトを変更する。あわせて左右ペインをマウスドラッグでリサイズできるようにする。
BBox編集・積算Master・PDF Viewer等の既存機能仕様は変更していない。

### Frontend
- `App.css`: `.app-layout` をCSS Gridから縦方向Flexboxへ変更し、Header直下を
  `.app-workspace` (横方向Flex: MainArea/RightPane) → `.app-workspace__main`
  (縦方向Flex: 上段(図面一覧+Viewer)/積算コードMaster) という2階層構造に整理。
  RightPaneとMainAreaを同階層のflexアイテムにすることで、右ペインの全高化と
  Masterの非重複を、overlayではなくCSSレイアウト構造そのもので実現した
- `hooks/usePaneWidth.ts`: ペイン幅の状態管理を1本のフックへ集約。ドラッグ量(px)を
  受け取り min〜(window.innerWidth×maxVwRatio) にclampしつつ、localStorageへ
  永続化 (`sekisan-navi:left-pane-width` / `sekisan-navi:right-pane-width`)。
  保存値が不正・範囲外の場合は初期値へフォールバックする
- `components/Layout/PaneSplitter.tsx`: 左右ペイン境界のResize Handle。
  windowレベルのmousemove/mouseupで直前位置からの差分(delta)のみを都度通知する
  (DrawingCanvasのPan実装と同じ設計パターン)。ドラッグ中は`document.body`に
  `cursor:col-resize`/`user-select:none`を適用
- `App.tsx`: 左右のペイン幅を`usePaneWidth`で管理し、`DrawingNavigator`/
  `PanelProperties`+`EstimateTree`をそれぞれ固定幅コンテナで包み、境界に
  `PaneSplitter`を配置。右ペイン用ハンドルは「右へドラッグ=狭く/左へドラッグ=広く」
  となるよう符号を反転して渡す
- Drawing Viewer側 (`DrawingCanvas.tsx`) は無変更。Fitボタンは呼び出し時点の
  `viewport.clientWidth/clientHeight`を読むため、ペインリサイズ後にFitを押せば
  新しい表示領域に対して正しく計算される (ウィンドウリサイズでも自動再Fitしない
  既存挙動をそのまま踏襲し、ペインリサイズでも自動再Fitは追加しなかった)
  **[2026-09 追加修正で仕様変更。末尾の該当章を参照]** この「自動再Fitはしない」
  という決定は、`viewMode`概念の導入により覆された。`viewMode==='fit'`中は
  ペインリサイズ・ウィンドウリサイズいずれでも自動的に再Fitするようになった。

### 完了条件チェック (追加指示23章、14項目)
自動テスト (DOM構造・リサイズ数値・min/max clamp・localStorage復元) で
1〜10, 12, 13を確認済み。11 (BBox追加・選択・リサイズ・削除に回帰がない) は
既存のBBox関連テスト (Phase 1.7時点の51件) がレイアウト変更後も全て無変更で
通過することで確認した。実ブラウザでのドラッグ操作・PDF Fit・BBox操作の目視確認は
本セッションの環境上実施できておらず (Vite devサーバーが新コードを配信している
ことはHTTP経由で確認済み)、ユーザー側での確認を依頼する (完了報告メッセージに明記)。

## 8.3. Phase 1.8 (完了・製番フォルダ参照・PNGサムネイル化・product_df盤領域Overlay)

目的: 製番選択と左ペインの図面表示を実データベースへ寄せる。指定ルート配下の
実製番フォルダを検索・参照できるようにし、左ペイン(DrawingNavigator)を実PNG
サムネイル表示へ変更、`product_df.csv`の盤領域を半透明赤色でサムネイル上へ
描画する。中央Drawing ViewerはPDF表示のまま維持し、Detection/RuleEngine/
EstimateItemの責務分離や、ダミーDBによる積算結果デモ (Phase 1〜1.7) は変更しない。

### 対象コンポーネントの確認 (実装前にユーザーへ確認)
「左ペイン」のPNGサムネイル化対象が、メイン画面の`DrawingNavigator`か、既存の
`ProductViewer`(製番を開くモーダル)内の図面一覧かが指示文だけでは一意に決まらな
かったため、事前にユーザーへ確認した。指示書24章が「Phase 1.7追加修正で実装した
左ペイン幅変更」(メイン画面のDrawingNavigatorにのみ存在する機能)を前提にしていた
ことから、**メイン画面のDrawingNavigator**が対象と確認された。あわせて、製番切替時に
既存のダミーDetection/PanelArea/EstimateTree/盤パラメータをどう扱うかも確認し、
「対応するダミーDB行がある場合のみそのまま表示し、無い場合は無理に紐付けない」
方針で合意した。

### Backend
- `app/services/data_source.py`: `resolve_page_file()`を拡張子選択式
  (`extension: "pdf"|"png"`) に一般化。`search_product_dirs()`を新規追加し、
  ルート直下の前方一致検索 (英数字のみ、大文字小文字無視、件数上限+truncated
  フラグ) を実装 (要件2/3)。ルート直下の全件送信は行わない
- `app/services/product_df.py` を新規追加。`product_df.csv` (cp932) をページごとに
  読み込み、盤領域を正規化座標へ変換する。列構成・変換式は実データ調査で確定
  (`docs/data-source.md` 5.1章)。SCALE_X/Y=0の行や必須値欠損行は診断ログへ記録して
  スキップし、Frontend全体をエラーにしない (要件7/32)
- `GET /api/products/search`: 製番の前方一致候補検索API (新規)
- `GET /api/products/{product_no}/drawings`: 応答を`ProductDrawingOut`
  (thumbnail_url/drawing_type/drawing_name/panels[]) へ拡張。Frontendへ
  product_dfの生データを渡さず、表示用モデルへ整形して返す (要件28)
- `GET /api/products/{product_no}/drawings/{page_no}/thumbnail`: PNGサムネイル
  配信API (新規)。任意ファイルパスをクエリで受け取る形式にはしていない (要件8/31)

### Frontend
- `DrawingNavigator`: ダミーDB由来のプレースホルダー表示から、実PNGサムネイル+
  盤領域Overlay+左上BAN情報を表示するカード形式へ全面刷新。図面種別グループ分けは
  維持。PNG読み込み失敗時はフォールバック表示 (要件5-27)
- `DrawingViewer`: propを`page: DrawingPage`から`productNo`/`pageNo`/`pageLabel`へ
  変更し、ダミーDB非依存で直接実PDFを参照するようにした (中央ViewerはPDF表示を維持)
- `ProductSelector` (新規、旧`ProductViewer`を置き換え): 製番の前方一致検索
  (デバウンス付き) + 完全一致での直接確認。選択するとメイン画面の参照製番を
  切り替える (旧ProductViewerが持っていた独立ページ一覧・PDF表示機能は、
  その役割をメイン画面のDrawingNavigator/DrawingViewerへ統合したため廃止)
- `App.tsx`: `activeProductNo`(既定`A1GV2421`)/`productPages`/
  `selectedProductPageNo`を追加。ダミーDB側の`drawing_pages`は
  Detection/PanelArea/EstimateTree/盤パラメータの紐付け専用として残し、
  「現在の製番+ページ番号」に一致する行がある場合のみそれらを取得する

### 完了条件チェック (指示書35章、15項目)
自動テスト (Backend: 製番検索・サムネイル配信・product_df解析の単体/API テスト、
Frontend: DrawingNavigator/ProductSelectorの表示・クリック・Overlay位置のテスト) で
1〜10, 13, 14を確認済み。11 (左ペインresize後もOverlay位置が崩れない) は
正規化座標(%指定)による構造上の保証と、Phase 1.7追加修正の既存ペインリサイズ
テストが無変更で通過することで確認した。12 (サムネイルクリックで中央Viewerへ移動)
はApp.test.tsxで確認済み。実ブラウザでのサムネイル目視・盤領域の実図面との
位置関係確認は本セッションの環境上実施できておらず、Vite devサーバーが新コードを
配信していることとBackend API疎通 (実製番A1GV2421) はHTTP経由で確認済み
(完了報告メッセージに詳細を記載)。

## 8.4. Phase 1.8 実画面未反映 調査・修正 (完了)

目的: Phase 1.8完了報告後、実ブラウザ上でUIの変化が確認できないという指摘を受け、
根本原因を調査・修正する。あわせて、盤領域Overlayの表示先・中央Viewerの表示基準に
関する仕様訂正 (2件) を反映する。

### 根本原因
Sekisan Naviのコード自体は正しく実装されていた。原因は環境側にあった:
`vite --port 5173` で起動したSekisan Navi用フロントエンドは、5173番が別プロジェクト
(`yolo_pipeline_studio/frontend`) のViteプロセスに既に使用されていたため、警告なしに
5174番へ自動フォールバックしていた。一方、実際に開かれていたブラウザは
`http://localhost:5173` に接続したままであり、これは**Sekisan Naviとは無関係の
別プロジェクトの画面**だった (`netstat`/`Get-CimInstance Win32_Process` でプロセスの
実行ディレクトリを特定して確認)。そのためPhase 1.8のコード変更は実際には正しく
デプロイされていたが、ユーザーが見ていた画面には一切反映されようがなかった。

### 対策
- 実際にSekisan Naviが待ち受けているポートをプロセスレベルで特定 (`netstat -ano`→
  `Get-CimInstance Win32_Process`でCommandLine/実行パスを確認)。
- 以降は `--strictPort` を付けて起動し、ポート競合時にフォールバックせず即座に
  エラーで気づける構成にした (`docs/implementation-plan.md` 12章に恒久的な注意事項として追記)。
- Backend/Frontendとも一度停止し、このリポジトリ (`SekisanNavi/`) から明示的に
  cwdを指定して再起動、`netstat`で実際の待受ポートを再確認した上でHTTP経由の
  最終確認を行った。

### 仕様訂正1: 盤領域Overlayの表示先を左ペインから中央Viewerへ変更
Phase 1.8時点では盤領域(赤色半透明)Overlayを左ペインのサムネイル上に表示していたが、
指示により「左ペインはPNG+PAGE/BAN情報のみ、盤領域Overlayは中央Viewerに表示する」
仕様へ訂正した。

- `DrawingNavigator.tsx`: 盤領域Overlayの描画コード (`drawing-navigator__panel-overlay`)
  を削除。PNGサムネイルとラベル表示のみに戻した
- `DrawingViewer/ProductPanelOverlay.tsx` (新規): product_df由来の盤領域を
  中央Viewer上に赤色半透明・全件描画するOverlayコンポーネント。DetectionOverlayと
  同じ0.0〜1.0正規化座標系を共有し、pointer-events:noneでBBox操作を阻害しない
- `App.tsx`: ダミーDB由来の`panelAreas`(旧PanelOverlay)の取得・表示を廃止し、
  product_df由来の`panels`をDrawingViewerへ渡すよう一本化 (二重表示の防止)

### 仕様訂正2: 中央ViewerをPDF表示からPNG表示へ変更
盤領域Overlayの正規化座標は`{page}.png`の実ピクセル寸法(`FRAME_MINI_X/Y`)を基準に
算出しているため、中央ViewerがPDFのままだと余白・原点の違いにより位置がずれる
可能性がある指摘を受け、中央Viewerも左ペインと同一の`{page}.png`を表示するよう
訂正した (`architecture.md` 10章/14章参照)。

- `DrawingCanvas.tsx`: `mode: 'pdf' | 'png'` propを追加。'png'モードでは
  非表示のプリロード`<img>`で`naturalWidth/naturalHeight`を取得してnativeSizeとし、
  表示用`<img>`をコンテンツ領域いっぱいに描画する。zoom/pan/fit/BBox作成・
  選択・リサイズの既存ロジックは「コンテンツ原寸×zoom」の座標系にのみ依存するため
  無変更で両モードに対応した。PDF描画機能・Backend PDF配信APIは削除していない
- `DrawingViewer.tsx`: `pageImageUrl`propを追加し、左ペインと**全く同じ**
  `thumbnail_url`をそのまま渡す (別々に構築せず、同一値を共有することで
  画像ソースの一致を保証する)

### 実データによる座標一致の視覚的検証
「normalized coordinateだから合うはず」という理屈だけで済ませず、実際に
A1GV2421の実PNG (page16外形図、page18基礎図) へ、product_dfから計算した
盤領域矩形をPython(Pillow)で描画したコンポジット画像を生成し、直接目視確認した。
結果、実際の盤外形線・基礎寸法表の区画と赤色矩形が正確に一致することを確認した
(page16: 5盤×正面/背面/側面の全12領域、page18: 5盤の基礎区画全て)。この検証により、
KITEN_X/Y・DETECT_AREA_X/Y・SCALE_X/Y・FRAME_MINI_X/Y・Y軸反転の座標変換式
(`data-source.md` 5.1章) が実データに対して正しいことを、計算上の整合性だけでなく
視覚的にも確認済み。

### 完了条件チェック (指示書18章、11項目)
自動テスト (DrawingNavigatorに盤領域Overlayが存在しないことの確認、
ProductPanelOverlay/DrawingCanvas pngモードの単体テスト、Appレベルでの
「中央Viewer側にのみOverlayが出る」統合テスト) で1〜8を確認済み。9
(Zoom/Pan/Fit/Resizeで盤領域がずれない) は正規化座標(%指定)がコンテンツ領域に
対して定義されている構造上の保証、および既存のzoom/pan/resize関連テストが
無変更のまま通過することで確認した。10 (BBox操作を阻害しない) は
`pointer-events:none`と既存のPan除外ガードで保証・テスト済み。11
(現在起動しているポートで確認できる) は、実際に待ち受けているポートを
プロセスレベルで特定した上でHTTP経由で確認した。実ブラウザでのマウス操作
そのものの目視確認は本セッションの環境上実施できていない。

## 8.5. 盤領域Overlay・サムネイルラベル表示の再修正 (完了)

目的: 前回報告した「PAGE/BAN_MENNO/BAN_NOラベル確認済み」が実UI上では確認できない
という指摘を受け、根本原因を特定・修正する。あわせて盤領域内へのproduct_df情報表示、
Overlay塗りつぶしの減光を行う。

### 根本原因: line-height継承によるテキストクリップ
`DrawingNavigator.css`の`.drawing-navigator__thumb-wrap`は、`<img>`直後に生じる
インライン要素特有の余白を消すため`line-height: 0`を指定していた。`line-height`は
CSSの継承プロパティであり、子要素の`.drawing-navigator__thumb-label`が自身の
`line-height`を明示していなかったため、この`0`をそのまま継承していた。
`line-height: 0`の行ボックスは高さがほぼ0になり、かつラベル自身が
`text-overflow: ellipsis`のために`overflow: hidden`を設定していたため、
テキストが実質的にクリップされていた。**DOM上には要素・テキストとも正しく
存在し、既存の自動テストは`screen.getByText(...)`でDOM内のテキストノードの
存在だけを確認していたため合格していたが、実際の描画結果としては見えなくなる**、
という「テストは通るのに画面には出ない」典型例だった。

`vite.config.ts`のvitest設定に`css: true`を追加し (既定ではCSSインポートは
スタブ化されテストに反映されない)、`getComputedStyle`で実際のCSSカスケード結果を
検証できるようにした。実際に、修正前は`line-height: 0`、修正後は明示的に指定した
値になることを、一時的に修正を無効化した状態と有効化した状態の両方で
`getComputedStyle`により実測して確認した (推測ではなく実測)。

### 修正1: 左ペインラベルのline-height明示化
`DrawingNavigator.css`の`.drawing-navigator__thumb-label`に`line-height: 1.4`を
明示的に指定し、親からの`0`の継承を断ち切った。

### 修正2: 盤領域Overlay内へのproduct_df情報表示
`ProductPanelOverlay.tsx`の各盤領域(`.product-panel-overlay__area`)内に、
`{BAN_MEISYOU} / {BAN_TYPE}` と `{BAN_MENNO} / {BAN_NO}` の2行ラベルを追加した。
- Backend: `app/services/product_df.py`の`PanelAreaFromDf`に`ban_meisyou`/
  `ban_type`を追加 (product_df.csvのBAN_MEISYOU/BAN_TYPE列。座標計算には
  使わないため欠損していても行はスキップしない)。`PanelPreviewOut`
  (`app/schemas/settings.py`)・`/api/products/{no}/drawings`のレスポンスへ反映
- Frontend: `PanelPreview`型に`ban_meisyou`/`ban_type`を追加。
  各`panel`オブジェクトはproduct_df.csvの1行にそのまま対応するため、
  `panels.map()`で個々の値をそのまま描画するだけで、複数盤があっても
  各領域に対応する値が自動的に個別表示される (代表値の使い回しにならない)
- ラベルは領域の左上を基準に`position: absolute; top:0; left:0`で配置しており、
  正規化座標(%)で位置決めされた親要素(`.area`)を基準にしているため、
  zoom/pan/fit/ペインリサイズが起きても領域との位置関係は崩れない
- ラベル自身にも`line-height: 1.3`を明示し、左ペインと同じクリップ不具合の
  再発を防いだ

### 修正3: Overlay塗りつぶしの減光
`.product-panel-overlay__area`の`background`を`rgba(255,0,0,0.2)`から
`rgba(255,0,0,0.08)`へ変更 (指示の目安レンジ0.06〜0.10内)。枠線
(`rgba(220,38,38,0.8)`)は変更せず、領域の判別性を維持した。

### 実データによる視覚的検証 (A1GV2421)
Pythonで実際のCSS計算値 (font-size/line-height/padding/color/opacity)を
忠実に再現したモックアップ画像を、実サムネイル寸法(200px幅)と実PDFページ(16.png)に
対して生成し、目視確認した。
- 左ペイン相当: `P16 / 1-1, 2-2, 3-3, 4-4, 5-5` が実サムネイル寸法で明瞭に判読できた
- 中央Viewer相当: 12領域それぞれに個別の`{BAN_MEISYOU} / {BAN_TYPE}`
  `{BAN_MENNO} / {BAN_NO}`が表示され、赤色の薄い塗りつぶし越しに寸法線・文字が
  読み取れることを確認した
- **観測された残課題**: 正面図・背面図のように盤が横に密集する行では、
  BAN_MEISYOUが長い場合にラベルが隣接する盤の領域へはみ出して見えることがある
  (領域自体は隠していないが、ラベル同士が近接して見づらい場合がある)。
  ラベル幅を領域幅に制限する対応は、情報の切り捨てにつながるため今回は見送り、
  既知の残課題として記録する

### 完了条件チェック
指示の完了条件のうち、左ペインラベルの視認性・中央Viewerの個別ラベル表示・
Overlay減光・図面視認性の確保は、実データに対する計算値再現モックアップの
目視確認で確認済み。実ブラウザでの操作確認は本セッションの環境上実施できておらず、
Vite devサーバー (`http://localhost:5175`) が最新コードを配信していることは
HTTP経由で確認済み。

## 8.6. Phase 1.9 UI改修: サムネイル情報整理・盤ラベル簡素化・盤選択・右ペイン連動 (完了)

目的: 左ペインサムネイル・中央Viewer盤ラベルの情報過多を整理し、中央Viewerの
盤領域をクリックで選択できるようにして、右ペイン(PanelProperties)へ選択盤の
product_df情報を表示する。実YOLO推論・本番積算ルール・積算確定フローはこれまで
通り対象外。

### 変更1: 左ペインサムネイルのラベル簡素化
`DrawingNavigator.tsx`の`thumbnailLabel()`(BAN_MEISYOU等を含む長い説明文を
1行連結していた関数)を廃止し、`uniqueBanPairs()`(旧`uniqueBanLabels`)が返す
`{BAN_MENNO}/{BAN_NO}`の配列を「・」区切りで2行目に並べるだけの表示に変更した。
1行目は`P{page_no}`のみ。CSS側は`.drawing-navigator__thumb-label`を
`flex-direction: column`にし、各行を`.drawing-navigator__thumb-label-line`
(個別に`text-overflow: ellipsis`)として分離した。

### 変更2: 中央Viewer盤ラベルの簡素化 + Tooltip化
`ProductPanelOverlay.tsx`の常時表示ラベルを`{BAN_MEISYOU} / {BAN_TYPE}`+
`{BAN_MENNO} / {BAN_NO}`の2行構成から、`{BAN_MENNO}/{BAN_NO}`の1行のみへ変更した。
BAN_MEISYOU/BAN_TYPE/PAGEの詳細情報は各領域(`<button>`)の`title`属性
(ブラウザ標準Tooltip)へ移し、値が空の項目は行ごと省略する
(`buildTooltip()`)。8.5章で残課題としていた「密集した盤でラベルが隣接領域へ
はみ出す」問題は、ラベルが1行化されたことで実質的に解消された。

### 変更3: 盤領域のクリック選択 (`selectedPanel`)
- Backend: `product_df.py`の`PanelAreaFromDf`/`PanelPreviewOut`/
  `/api/products/{no}/drawings`に`page_no`・`ban_h1`・`ban_h2`・`ban_w`・`ban_d`
  (右ペイン表示専用、座標計算には使わない)を追加した。欠損・非数値でも
  行全体はスキップせず`None`として保持し、表示側で「-」にする
  (`_parse_optional_float()`)。
- Frontend: `utils/panel.ts::panelKey(panel, index)`で
  `PAGE:BAN_MENNO:BAN_NO:BAN_TYPE:配列インデックス`を組み立て、盤の識別に
  生配列インデックス単体を使わないようにした。実データ検証で、同一PAGE/
  BAN_MENNO/BAN_NOに複数のBAN_TYPE(正面図/背面図/左側面図等)が実在すること
  (例: A1GV2421 page16のBAN_NO=5は3行)を確認しており、この設計が実際に必要な
  ケースであることを裏付けている。
- `App.tsx`に`selectedPanel: {key, panel} | null`のstateを追加した
  (Detection/BBoxの`selectedDetectionId`とは独立)。`handleSelectPanel`で
  クリック時に置き換え、`handleSelectPage`/`handleSelectProduct`/
  `handleDeselectDetection`(空白クリック)・`handleNavigateReference`
  (根拠図面ジャンプ)のいずれでも`null`にリセットする。
- 各盤領域は`<button type="button">`のまま(Phase 1.8から変更なし)にすることで、
  `DrawingCanvas`側の既存ガード(`closest('button')`)がPan開始・Manual BBox
  作成の対象から自動的に除外し、新たな分岐追加なしでBBox/リサイズハンドルとの
  優先順位を保っている(`ProductPanelOverlay`が`DetectionOverlay`より先にJSXへ
  描画されるペイント順のみで実現。z-index追加なし)。
- 視覚状態: 通常=細枠+`rgba(255,0,0,0.08)`、選択中=太枠(2px)+
  `rgba(255,0,0,0.18)`、非選択(他が選択中)=`opacity:0.55`(非表示にはしない)。

### 変更4: 右ペイン(PanelProperties)の連動
`PanelProperties.tsx`に`selectedProductPanel: PanelPreview | null`を追加し、
値がある間はPAGE/面番号/盤番号/盤名称/表示種別/H1/H2/W/Dを表示する
(`formatValue()`でnull/undefined/NaN/空文字を全て「-」にし、寸法値には
「mm」を付与)。従来の`panel`(ダミーDetection紐づけ)表示より優先する。
どちらも無い場合は「盤が選択されていません」を表示する(回帰: 何も選択して
いない状態のPhase 1.8までの挙動を維持)。

### 実データによる検証 (A1GV2421)
実ブラウザでのクリック操作・:hover Tooltip描画の確認は本セッションの環境上
実施できていない(未確認事項として明記する)。以下は実データ・実CSS計算値に
基づく代替確認:
- `GET /api/products/A1GV2421/drawings`(実際に起動したBackendへcurl)で、
  page16の12盤領域すべてに`page_no`/`ban_h1`/`ban_h2`/`ban_w`/`ban_d`が
  含まれ、実際のBAN_MEISYOU(例: 「高圧受電盤」「No.2-1低圧動力盤」)・
  BAN_TYPE(「正面図」「背面図」「左側面図」等)が実データとして返ることを確認した
- 実PNG(page16.png, 2077×1485px)に対し、`DrawingViewer.css`の実rgba値
  (通常0.08/選択中0.18/非選択時のopacity 0.55)をそのままPillow描画パラメータへ
  反映したコンポジット画像を生成し、選択盤(5/5・正面図)が他の11領域より
  明確に濃く表示され、かつ全領域が引き続き視認できる(非表示にならない)ことを
  ピクセル値の実測(選択中(255,210,210) vs 非選択(255,244,244))で確認した
- 同様の手法で左ペインサムネイル(実際のペイン初期幅220px)のモックアップを生成し、
  「P16」/「1/1・2/2・3/3・4/4・5/5」の2行ラベルが画像を過度に隠さず判読できる
  ことを確認した
- Backend再起動(コード変更前に起動していた古いuvicornプロセスを検知して
  再起動。8.4章の教訓を踏襲し、無反映を未然に防いだ)後、Frontend Vite
  devサーバー(`http://localhost:5175`、`--strictPort`起動)が生きていることを
  `curl`で確認した

### 完了条件チェック
指示書26章の完了報告項目のうち、実装・自動テスト・実データAPI応答・実CSS値による
モックアップ確認で検証できた項目は上記の通り。**実ブラウザでのクリック操作
(:hover Tooltipの実描画、マウスでのPanドラッグとの誤判定有無を含む)は
未確認のまま残っており、確認できた事実(自動テスト・実データ・モックアップ)と
未確認事項(実ブラウザでの目視・操作)を区別してこの通り記録する**。

## 8.7. Phase 1.9 実画面未達の修正 (完了。ただし実ブラウザでの最終確認は未実施)

目的: Phase 1.9完了報告後、実際のSekisan Navi画面では「盤領域をクリックしても
右ペインが更新されない」「hover詳細がtitle属性頼みで実用的に確認できない」
「左サムネイル文字が小さすぎる」という差異が報告された。実画面・実操作を基準に
根本原因を特定し修正する。

### 根本原因: `.detection-overlay`コンテナのpointer-events未指定によるクリック奪取
`DrawingViewer.tsx`は`ProductPanelOverlay`(盤領域)の後に`DetectionOverlay`(BBox)を
描画しており、「JSXの描画順(=paint順)だけでBBoxが盤領域より優先されるはず」という
設計だった。この設計自体はBBoxとの優先順位としては意図通り機能していたが、
見落としが1つあった: `.detection-overlay`は`position:absolute; inset:0`で
Viewer全域を覆う**コンテナ**であり、`pointer-events`を明示していなかったため
既定値`auto`のままだった。CSSの`pointer-events:auto`は要素に可視コンテンツが
無くても、その矩形範囲全体でクリックの対象(event.target)になる。結果として、
BBoxが1件も無い座標であっても、この透明なコンテナ自体がクリックを奪ってしまい、
paint順で下にある`.product-panel-overlay__area`(盤領域の`<button>`)へクリックが
一切到達しない状態になっていた。

`DrawingCanvas.tsx`の`handleMouseDown`は`(e.target as HTMLElement).closest('button')`
でbutton要素上のmousedownをPan/Manual BBox開始から除外しているが、
`e.target`が(奪われた結果)`.detection-overlay`という非button要素になっていたため
このガードも素通りし、クリックはPanのmousedown/mouseup経路(移動量僅少 → 空白クリック
=`onBackgroundClick`)として処理されていた。**単体テストはこの不具合を検出できなかった**:
`App.test.tsx`は`DrawingCanvas`全体をスタブ化しており実CSSを経由しておらず、
また仮に経由していたとしてもjsdomはレイアウトエンジンを持たず`fireEvent.click(el)`は
指定した要素へ直接dispatchされるため、実ブラウザ特有の「画面上の重なりによる
クリックの奪い合い」自体はそもそも自動テストで再現できない領域だった。

### 修正: レイヤーごとのpointer-events/z-indexを明示 (指示書15章/16章)
`DrawingViewer.css`に以下の契約を明示した (描画順への暗黙の依存を廃止):

| レイヤー | pointer-events | z-index |
|---|---|---|
| PNG本体 (`.drawing-canvas__canvas`) | (既定) | 0 |
| product_df盤領域コンテナ (`.product-panel-overlay`) | none (個々の`.area`はauto) | 10 |
| Detection/Manual BBoxコンテナ (`.detection-overlay`) | **none (修正)** (個々の`.bbox`/`.handle`はauto) | 20 |
| 選択中BBox (`.detection-overlay__bbox--selected`) | auto | 30 |
| リサイズハンドル (`.detection-overlay__handle`) | auto | 40 |
| hover Tooltip (`.product-panel-overlay__tooltip`) | none | 50 |

`.detection-overlay`をpointer-events:noneにしたことで、BBoxが無い座標のクリックは
コンテナを素通りして下の盤領域`<button>`へ届くようになった。BBoxがある座標では
`.detection-overlay__bbox`(pointer-events:auto)がそのまま最前面で受け取るため、
「BBox優先、BBoxが無ければ盤領域、どちらも無ければ背景」という要件17の優先順位は
維持される。

### 修正: hover Tooltipをtitle属性から独自DOM実装へ変更 (指示書5章/6章/7章)
`ProductPanelOverlay.tsx`に`hover`state(hoverしている盤のkey/panel/カーソル座標)を
追加し、`title`属性ではなく`position:fixed`の独自`<div>`をTooltipとして描画するよう
変更した。表示項目は指示書の表示例に合わせ「面番号/盤番号/盤名称/種別/PAGE」の順・
全角コロン表記とした。値の無い項目は行ごと省略する。`pointer-events:none`のため
Tooltip自体が下のクリックを奪わない。カーソル位置基準でviewport端に対して
クランプ計算し、画面外へはみ出さないようにしている(概算のサイズ見積もりによる
簡易クランプであり、実際のTooltip描画サイズを実測して厳密に位置決めする実装では
ない。POC範囲での簡易対応として明記する)。hover(`onMouseEnter`/`onMouseLeave`)と
click(`onClick`)は独立したイベントハンドラのため、Tooltip表示中でも盤選択クリックは
引き続き機能する(要件7)。

### 修正: 選択中盤ラベルの強調 (指示書10章)
通常表示`5/5`に対し、選択中は`[5/5]`という括弧付き表記+背景色(赤地に白文字)に
変更し、一目で選択中と分かるようにした。

### 修正: 左サムネイル・中央盤ラベルの文字サイズ (指示書3章/23章/24章)
ルートfont-size(index.css: 14px)を基準に、極小表示(5〜8px相当)だった箇所を
引き上げた:

| 箇所 | 旧 | 新 |
|---|---|---|
| 左サムネイル PAGE行 | 0.65rem (≈9.1px) | 0.95rem (≈13.3px) |
| 左サムネイル BAN行 | 0.65rem (≈9.1px、PAGE行と共通) | 0.88rem (≈12.3px) |
| 中央Viewer 盤ラベル | 0.68rem (≈9.5px) | 0.86rem (≈12.0px) |

左サムネイルのラベル背景も、図面線と重なっても読めるよう不透明度を
0.75→0.82へ引き上げた。

### 実データによる検証 (A1GV2421)
実ブラウザでのクリック操作そのものの確認は本セッションの環境上実施できていない
(Playwright等のE2Eツールは本プロジェクトに導入されておらず、指示書22章の
「新規に大規模なE2E環境を導入する必要はない」との方針に従い、今回も導入は見送った。
claude-in-chrome拡張の利用は別セッションでユーザーが利用しない方針としている)。
代わりに以下を実施した:

- 実際に起動しているVite devサーバー(`http://localhost:5175`)へ`curl`し、
  `ProductPanelOverlay.tsx`に`product-panel-overlay__tooltip`が、
  `DrawingViewer.css`に`z-index: 20`が実際に含まれた状態で配信されていることを
  直接確認した(devサーバーはソースを都度読み直して配信するため、ビルドキャッシュ
  由来の無反映は起こりえない)
- `DrawingViewer.test.tsx`(新規)で、`DrawingCanvas`をスタブ化せず実コンポーネントを
  レンダリングし、`.detection-overlay`のcomputed pointer-eventsが`none`、
  `.detection-overlay__bbox`/`.detection-overlay__handle`/
  `.product-panel-overlay__area`が`auto`であることを実際のCSSカスケード結果
  (`getComputedStyle`)で確認した。**ただし、これはCSS宣言が意図通りcascadeされている
  ことの確認であり、jsdomはレイアウトエンジンを持たないため実ブラウザの
  「画面上の重なりによるクリックの奪い合い」そのものを再現・証明するものではない**
- 実PNG(page16.png)にDrawingViewer.cssの実CSS値(font-size/line-height/padding/
  背景色/Tooltip書式)を忠実に反映したコンポジット画像を生成し、選択中ラベル
  `[5/5]`の強調表示、hover Tooltip(`面番号：4`等の全角コロン書式)の内容・位置、
  拡大された左サムネイルラベルの可読性を目視確認した

### 完了条件チェック (指示書25章、15項目)
実装・自動テスト・実データAPI応答・実CSS値によるモックアップ確認で検証できたのは
1〜3(左サムネイル文字サイズ・Tooltip実装・Tooltip項目)、9〜13(BBox優先/リサイズ/
Manual BBox追加/Pan/pointer-events・z-index契約の明示)、14〜15(テスト・build)。
**4〜8(実際にブラウザでクリックして選択状態になること、右ペインが実際に更新される
ことそのもの)は、今回特定・修正した根本原因(pointer-events)により解消される見込みが
高いという技術的な推論の域を出ておらず、実ブラウザでの目視確認は未実施のまま残る。
これを「確認済み」として報告しない。**

## 8.8. Phase 1.10 UI改修: 盤ホバー仕様変更・Masterタブ全角化・色分け・UI全体フォント改善 (完了)

目的: 後工程の積算コード選択・BBox作業を考慮し、盤領域Overlayの表示・操作仕様を
見直す。あわせてMasterタブの表記を全角統一・色分けし、UI全体のフォント/文字サイズを
見直す。実YOLO推論・本番積算Rule・積算確定フローは対象外。

### 盤領域Overlayの表示・操作変更 (指示書1章〜7章)
- **通常時は塗りつぶし無し**にした (`background-color: transparent`)。Phase 1.8〜1.9で
  常時表示していた半透明赤(`rgba(255,0,0,0.08)`)は、`:hover`疑似クラスへ移した。
  `:hover`は`--selected`修飾クラスの有無に関係なく同じベースクラスにマッチするため、
  追加のCSSなしで「selected+hover→太枠+薄赤」も自然に成立する。
- 選択中盤は境界線を太く(3px)するのみで、背景は通常時と同じtransparentのまま
  (hover時のみ薄赤が付く)。全面を濃く塗りつぶさずBBox作業を妨げない (3章)。
- **積算コード選択中はTooltipを出さない**(4章/5章)。条件は文字通り
  `selectedMasterItemId == null && hover`。`ProductPanelOverlay`に
  `masterItemSelected`propを追加し、`true`の間は`onMouseEnter`/`onMouseMove`が
  hover stateを更新しないようにした。既にhover中のままMaster行が選択された場合も
  (`onMouseLeave`が発火しないケース)、`masterItemSelected`の変化を検知する
  `useEffect`で即座にTooltipを閉じる。
- 積算コード選択中でも赤枠・BAN_MENNO/BAN_NOラベルは表示を維持し、盤の位置確認は
  妨げない (6章)。
- **積算コード選択中は盤領域のpointer-eventsをnoneにする**(7章)。`<button>`が
  マウスイベントのヒットテスト対象から外れるため、mousedownは直接背後の
  `DrawingCanvas`の描画領域に届き、`closest('button')`ガードにも引っかからず
  Manual BBox作成のドラッグを開始できる。クリックハンドラ自体も
  `masterItemSelected`の間は`undefined`にし、CSSとJSの二重の防御にしている。
  `masterItemSelected`は`bboxAddMode`(=ダミーDB側の対応ページがある場合のみ有効)
  とは独立させ、`selectedMasterItemId != null`のみで決まるようにした
  (指示書の条件式を文字通り実装するため)。

### Masterタブの全角化・色分け (指示書8章〜15章)
- Excel由来のcategory原文(半角カナ・半角中点混在。`backend/app/domain/
  master_categories.py`のALLOWED_CATEGORIES)はDB上で書き換えず、表示専用の変換を
  `frontend/src/domain/masterCategoryPresentation.ts`(新規)へ一元管理した
  (9章)。半角/全角の手打ちミスを避けるため、このファイルはbackend側の
  ALLOWED_CATEGORIESを直接読み込むスクリプト(`gen_category_presentation.py`、
  一時ファイルのため成果物のみ残置)で生成し、内部値(internal)がbackendと完全に
  一致することを保証している。
- 各エントリは`{ internal, label, colorKey, order }`を持つ。`colorKey`は
  具体的な色コードではなく系統名(blue/green/orange/purple/brown)とし、
  実配色は`EstimateMasterPicker.css`のCSS変数(`--tab-bg`/`--tab-border`/
  `--tab-fg`)で一元定義した。将来BBoxラベル・積算結果Tree等でも`colorKey`を
  再利用できる (15章)。
- 色分けは指示書11章の例に準拠 (箱・単独/箱・左右/箱・中=青系、内部パネル/底板/
  盤間の仕切・遮蔽=緑系、附属品加算価格/箱体価格倍率=橙系、パネル/OPA用アングル枠/
  金網=紫系、入力（主回路銅帯）/銅帯=茶系)。淡い背景色+境界線程度の差にとどめ、
  13色を虹色に割り当てるような派手さは避けた (12章)。
- 選択中タブは背景を白くしつつ系統色は維持し、上辺(border-top)を太くして
  font-weightを上げる (13章)。行選択の琥珀色(`master-picker__row--selected`)とは
  別クラス・別用途として完全に独立させ、意図的に茶系タブの配色を黄色系ではなく
  タン系にして視覚的な混同を避けた (14章)。

### UI全体のフォント見直し (指示書16章〜22章)
- `index.css`の`:root`フォントを`'Yu Gothic UI', 'Meiryo UI', 'Meiryo', 'Segoe UI',
  system-ui, 'Hiragino Sans', 'Yu Gothic', sans-serif`へ変更した。Webフォントの
  新規配信は行わず、Windows社内環境に既存のフォントのみを使う (17章)。
- 極小表示(9px前後相当)が残っていた箇所を中心に、ヘッダー/左図面一覧/サムネイル/
  盤ラベル/Tooltip/右ペイン/積算結果/Masterタブ/Master表を全面点検し、指示書20章の
  目安 (Header 12-14px、左PAGE 13-14px、左BAN 12-13px、盤ラベル11-12px、
  Tooltip 12-13px、Masterタブ12-13px、表11-12px、右ペイン11-13px) に沿って
  底上げした。ルートfont-sizeは14px (index.css) のまま変更していない
  (高密度UIの維持。19章)。
- 太字は「現在ページ・選択盤・選択Masterタブ・選択Master行・セクション見出し」等の
  限定的な対象にのみ使用する既存方針を継続した (21章。新規に追加した太字も
  選択中タブのみ)。
- 数値列の3桁区切り表示ロジック自体は変更していない (22章。`toLocaleString`は
  従来通り)。
- 左右ペイン幅・Viewer位置・右ペイン全高・下部Master位置等の大きなレイアウト構造は
  変更していない (23章)。

### 実データによる検証 (A1GV2421)
実ブラウザでの操作確認は本セッションの環境上実施できていない (Playwright等の
新規導入はしない方針を継続)。実データ・実CSS値による代替確認は以下の通り:
- 実PNG(page16.png)へ`DrawingViewer.css`の実rgba値を反映したコンポジット画像で、
  「通常=枠のみ」「hover=枠+薄赤」「selected=太枠のみ」「selected+hover=太枠+薄赤」の
  4状態が実データ上で意図通り区別できることを目視確認した。
- Masterタブの全角表示・色分け・選択中タブ強調を、実際のCSS変数値でPillow描画し
  目視確認した (13タブ全ての表示名が全角であること、系統色のグルーピングを含む)。
- `curl`で実際に起動中のVite devサーバーへ問い合わせ、`index.css`の
  `Yu Gothic UI`、`EstimateMasterPicker.css`の`tab--blue`等、
  `masterCategoryPresentation.ts`の全角ラベル、`DrawingViewer.css`の
  `noninteractive`クラスが実際に配信されていることを確認した。

### 完了条件チェック (指示書26章、14項目)
実装・自動テスト・実データAPI応答・実CSS値によるモックアップ確認で検証できたのは
1〜5、7〜14 (盤の通常/hover/selected表示、Tooltip表示条件、Masterタブ全角化・
色分け・選択中タブ、フォント改善、テスト・build成功)。**6(Master選択中でも
盤上からManual BBoxを実際にドラッグ作成できること)は、pointer-events:noneに
よりクリックが素通りするというCSSの仕組み上の裏付けと、`getComputedStyle`による
CSS宣言自体の確認はできているが、実ブラウザでのドラッグ操作そのものは
未確認のまま残る**。

## 8.9. Phase 1.11 UI・BBox表示編集改修 (完了)

目的: 積算コードMaster・Manual BBox・図面一覧・状態保持・Master領域リサイズを
改修する。積算コードに紐づくBBoxを「BBox=対象範囲を保持する内部・編集情報」
「引出線=通常時に図面上へ表示する積算情報」として明確に分離し、通常時はBBoxを
常時表示せずCAD図面の引出線に近い表示を基本とする。実YOLO推論・本番積算Ruleは
今回も対象外。

### Backend変更
- migration `0005_leader_line.sql`: `detections`テーブルへ`leader_label_x`/
  `leader_label_y` (nullable REAL) を追加。BBox本体とは独立した引出線ラベル位置。
- `app/repositories/detections.py`: `estimate_master_items`へのLEFT JOINを追加し、
  `master_item_category`/`master_item_model`をレスポンスへ含めた (色そのものは
  含めない。要件2)。`update_detection_bbox()`は`leader_label_x/y`を
  `COALESCE`で更新し、省略時は既存値を保持する。
- `DetectionOut`/`DetectionBBoxUpdateIn`スキーマへ上記フィールドを追加。

### Frontend変更 (詳細は`architecture.md` 15章、`ui-spec.md`「引出線」節を参照)
- `masterCategoryPresentation.ts`: 13カテゴリすべてに重複しない固有色を割り当て
  (HSLで色相を分散して算出するジェネレータスクリプトを新規作成)、
  `{tabBg, tabBorder, tabFg, bboxBorder, bboxFill, leaderColor, leaderTextColor}`
  の配色一式+`toCssVars()`を提供する構造へ拡張した。
- `LeaderLineOverlay.tsx` (新規): 積算Master Itemに紐づくManual BBoxの引出線
  (アンカー+斜線+ラベル帯) を描画する。ラベル帯のdrag移動・hover検知・
  クリックでの編集状態遷移を担当する。
- `DetectionOverlay.tsx`: 積算Master Item紐づきBBoxの通常非表示化 (選択中/
  hover中のみ表示)、カテゴリ色描画、BBox内部drag移動 (`utils/bbox.ts::moveRect`)
  を追加。AI Detectionの表示コードパスは変更していない (要件29)。
- `ProductPanelOverlay.tsx`: 同一PAGE/BAN_MENNO/BAN_NOの別矢視を連動ハイライトする
  機能を追加 (`utils/panel.ts::banGroupKey`)。
- `App.tsx`: Escキーによる状態解除 (BBox編集中→Master選択中→盤選択中の優先順位)、
  引出線ラベル位置の保存ハンドラ、URL query (`?product=&page=`) による状態復元
  (`utils/urlState.ts`)、Master領域高さリサイズ (`usePaneWidth`を
  `dimension:'height'`で再利用) を追加。
- `DrawingNavigator.tsx`: サムネイル複数BANの区切りを「・」→「、」へ変更、
  図面種別見出しへの短い説明文を追加。
- `PaneSplitter.tsx`: `axis: 'x' | 'y'`を追加し、縦方向Resize Handle
  (左右ペイン幅、既存) と横方向Resize Handle (Master高さ、新規) を共通化。

### 実データによる検証 (A1GV2421)
- 実行中のBackend(`http://127.0.0.1:8000`)へ実際にHTTPリクエストを送り、
  実在するMaster Item(`箱･単独`/`11001`/`OS2- 816`、`内部ﾊﾟﾈﾙ`/`18001`/`A1`)から
  Manual BBoxを2件作成し、レスポンスに`master_item_category`/`master_item_model`が
  正しくJOINされていること、`leader_label_x/y`をPATCHで更新してもBBox本体
  (`bbox_x/y/w/h`)が変化しないことを実際のAPI往復で確認した。
- 実PNG(page16.png)へ、上記の実データ+実CSS値(`masterCategoryPresentation.ts`の
  実HEX値)を反映したコンポジット画像を生成し、引出線(アンカー・斜線・ラベル帯・
  カテゴリ色)、hover時のBBox確認表示、通常時の非表示状態を目視確認した。
- Masterタブの13色パレットをPillowで並べて描画し、全色が視覚的に区別できることを
  確認した。
- 実ブラウザでのドラッグ操作 (BBox内部drag移動、引出線ラベルdrag、四隅resize)
  そのものは本セッションの環境上未実施 (Playwright等のE2E新規導入はしない方針を
  継続)。CSSのpointer-events/z-index宣言の存在と、実コンポーネントを介した
  jsdom上でのイベント配線 (mousedown/mousemove/mouseup) が期待通りcallbackを
  呼ぶことまでは自動テストで確認しているが、実ブラウザでの見た目の重なりによる
  ヒットテストそのものはPhase 1.9実画面未達修正時と同様に検証不可能な領域として
  残る。

### 完了条件チェック (指示書33章、21項目)
実装・自動テスト・実データAPI往復・実CSS値によるモックアップ確認で検証できたのは
1〜10、12〜21 (カテゴリ固有色、BBox/引出線の色継承、Esc解除、BBox内部drag移動、
四隅resize維持、通常時非表示、引出線通常表示、アンカーBBox右上角固定、
hover時BBox表示、editing時BBox/Handle表示、ラベル位置のnormalized座標保存、
同一盤別矢視の連動ハイライト、サムネイル読点化、図面一覧説明文追加、
テスト・build成功)。**11(引出線ラベル帯を実際にドラッグ移動できること)は、
コンポーネント単体テストでの座標計算・callback呼び出しの確認はできているが、
実ブラウザでのドラッグ操作そのものは未確認のまま残る**。

## 8.10. Phase 1.11 追加修正: 同一盤別矢視ハイライト条件修正・引出線形状/表示文字修正 (完了)

Phase 1.11完了報告後の実画面確認で、2点が仕様と一致していないという指摘を受け、
この2点に限定して修正した。

### 修正1: 同一盤別矢視の連動ハイライト条件
- **旧条件**: 同一PAGE+BAN_MENNO+BAN_NOを持つ別矢視を常にgroup化し、hover連動
  表示していた。
- **新条件**: ページ内に実在するBAN_MENNO/BAN_NOの組が2種類以上ある場合のみ
  連動ハイライトを有効にする (`enableGroupedHover = new Set(panels.map(p =>
  \`${p.ban_menno}:${p.ban_no}\`)).size > 1`。`ProductPanelOverlay.tsx`)。
  1種類しか無いページでは実際にhoverしている領域だけを塗りつぶす。
- 実データで確認: A1GV2421 page16 (外形図、BAN_MENNO/BAN_NOの組が5種類) は
  連動ハイライトが有効になる。page21 (内部機器配置図、正面図/側面図とも
  BAN_MENNO/BAN_NO=1/1のみ、組は1種類) は連動ハイライトが無効になり、実際に
  hoverした領域のみが塗りつぶされることを確認した。page21はユーザーが指示書中で
  挙げた例そのものであり、実データ上にも同型の状況が実在することを確認できた。

### 修正2: 引出線の形状・表示文字
- **旧SVG構造**: `<line>`(斜線)と`<circle>`(アンカー点)をSVGで描画し、
  ラベルのHTML要素(`border-bottom`)は別要素として独立配置していた。斜線の
  終点とラベルの下線の間に、固定オフセット(`LINE_TO_LABEL_Y_OFFSET`)を挟んで
  いたため、実画面では両者が繋がって見えず、矢印も単純な線端(circleのみ)で
  一般的なCAD引出線の矢印headには見えなかった。
- **新SVG/path構造**: `computeLeaderGeometry(anchor, label, text)`が
  アンカー・折れ点(elbow)・水平線のもう一方の端(end)の3点を計算し、
  `M end L elbow L anchor`という1つの`<path>`として斜線+水平線を連続描画する
  (`pathD()`)。折れ点とendは`label.x >= anchor.x`かどうかで入れ替え、ラベルが
  アンカーの右/左どちらにあっても線が破綻しないようにした。
- **arrow marker実装**: SVGの`<marker orient="auto">`を`marker-end`として
  経路の終点(anchor)へ取り付けた。`orient="auto"`が経路の進行方向
  (elbow→anchor)から矢印の向きを自動計算するため、矢印は常にBBox右上角を指す。
  マーカーの塗り色はカテゴリ色(`colors.leaderColor`)を使う。
- **anchor/elbow/end座標計算**: anchorは`utils/bbox.ts::topRightCorner(bbox)`
  (既存、変更なし)。elbow/endはラベル位置(`leader_label_x/y`または自動計算した
  初期位置)と、文字数に基づく概算幅(`estimateLabelWidthFraction`、実測ではなく
  簡易な概算値)から算出する。
- **label左右移動時の処理**: `label.x >= anchor.x`(ラベルが右側)なら
  折れ点=ラベルの左端・水平線はそこから右へ、`label.x < anchor.x`(左側)なら
  折れ点=ラベルの右端・水平線は左端(end)からそこへ、と入れ替えることで、
  ユーザーがラベルをBBoxのどちら側へドラッグしても線が破綻しないようにした。
- **hit area**: 見た目の引出線用`<path>`とは別に、同じ`d`属性を持つ透明な
  太い`<path>`を重ねている (座標計算を2箇所に重複させず、見た目とヒットエリアが
  常に一致することを保証する)。
- **code取得元 / model取得元**: `buildLabelText(detection)`が
  `detection.master_item_code ?? detection.class_name`をコード、
  `detection.master_item_model`を型式として組み立てる。Backend側は
  `estimate_master_items`へのJOINへ`mi.code AS master_item_code`を追加した
  (`app/repositories/detections.py`)。`class_name`(登録時点のコピー)への
  依存を減らし、Master Itemの現在の正式なcode/modelを優先する。
- 実データで確認: `箱･単独/11001/OS2- 816`、`内部ﾊﾟﾈﾙ/18001/A1`、
  `ﾊﾟﾈﾙ/18401/A2(ﾁｬﾝﾈﾙﾍﾞｰｽ含)`の3件のMaster Itemから実際にManual BBoxを
  作成し、レスポンスの`master_item_code`が正しくJOINされること、ラベルを
  BBoxの右側・左側それぞれへドラッグしても引出線が連続した1本の線のままである
  ことを、実PNG+実API応答によるコンポジット画像で確認した。

### 完了条件チェック (指示書21章、13項目)
全項目を実装・自動テスト・実データAPI往復・実CSS値によるモックアップ確認で
検証できた。1〜10(group hover条件変更、引出線形状・矢印・表示文字修正、
label drag後の接続維持、BBox move/resize後の追従、hover時BBox表示)、
11〜13(Frontend/Backendテスト成功、build成功)。実ブラウザでのhover/drag操作
そのものは、Phase 1.11本体と同様に本セッションの環境上未実施のまま残る
(下記テスト結果参照)。

## 8.11. Phase 1.11 追加修正 第2ラウンド: 矢印縮小・型式表示修正・BBox編集追従・Viewer自動Fit (完了)

前ラウンド(8.10)完了後、4点の追加指示を受けて対応した。「今回はこの修正のみ行い、
その他の積算ロジック・AI機能には進まないこと」という指示のとおり、スコープを
この4点に限定した。

### 修正1: 引出線の矢印head縮小 (指示1章〜4章)
- **旧**: `markerWidth`/`markerHeight = 0.018` (正規化座標)。BBox四隅の
  Resize Handle(10px, CSS固定)より大きく見え、図面の文字と重なりやすかった。
- **新**: `0.010`へ縮小 (約56%、指示の50〜65%の範囲内)。`markerUnits`は
  引き続き`"userSpaceOnUse"`のまま (線の太さのチューニングから矢印サイズを
  独立させるため)。矢印の向き(`orient="auto"`によるelbow→anchor方向の
  自動計算)・アンカー(BBox右上角)を指す仕組み自体は変更していない。
- 実データ(page16, Detection id=16)をPillowで合成し、旧11.4px相当→新6.4px相当
  (想定Viewer幅900pxの場合)で、Resize Handle(10px)より明確に小さくなることを
  視覚的に確認した。

### 修正2: 型式(model)がラベルに表示されない、という報告への対応 (指示5章〜10章)
「11526のみ表示され、`11526 IS2-922`にならない」という報告を受け、
「BackendのAPIが`master_item_code`/`master_item_model`を持っている」ことの
確認だけで完了と判断せず、Repository JOIN → Detection API応答 → Frontend型定義
(`types/domain.ts`) → `api/client.ts` → `App.tsx`のstate更新 → 各コンポーネントの
propsまで、パイプライン全体をコードレベルで追跡した。
- **調査結果**: 現在のコード上には型式を欠落させる不具合は見つからなかった。
  `api/client.ts`は生のAPIレスポンスをそのまま返しており、フィールドを個別に
  再構築して欠落させるような変換コードは無い。`App.tsx`の各更新ハンドラ
  (`handleResizeDetection`/`handleCreateManualBBox`/`handleMoveDetectionLabel`)も
  Backend応答オブジェクトをそのまま`detections` stateへ反映しており、
  部分的な再構築は行っていない。
- 実データでの直接確認: 稼働中のBackend(直前に再起動済み)へ`curl`で直接
  `GET /api/detections?drawing_page_id=1`を呼び、実在するDetection
  (`id=16`, `master_item_id=170`)が`master_item_code="11526"`,
  `master_item_model="IS2- 922"`を正しく返すことを確認した。対応する
  Master Item(`id=170`)自体も実データで`model="IS2- 922"`(空でない)であることを
  `GET /api/master-items`で確認した。
- **結論(root cause、確度は中: 実ブラウザの操作ログが残っていないため断定はできない)**:
  本プロジェクトはBackendを`--reload`無しで起動する運用のため、コード変更後は
  明示的なプロセス再起動が無いと反映されない(Phase 1.8/1.9でも同種の事象が
  繰り返し発生している既知の落とし穴)。報告された事象は、`master_item_code`の
  JOINコードが追加される前、または追加後にBackendを再起動する前の古い応答を
  ブラウザが取得していたタイミングの問題である可能性が高い。**現在のコードに
  対する追加の不具合修正は無い**が、指示書の擬似コードに沿った防御的
  ハードニングとして、`buildLabelText`の型式チェックに`.trim()`を追加した
  (空白のみの型式もコード単独表示として扱う。追加修正14章)。
- 表示ロジック自体は前ラウンド(8.10)で既に指示書の擬似コード通りに一本化
  済みであり (`code = master_item_code ?? class_name`, `model = master_item_model?.
  trim()`, `model ? \`${code} ${model}\` : code`)、今回変更していない。

### 修正3: BBox編集中のリアルタイム追従 (指示11章〜17章)
- **旧**: move/resizeドラッグ中の引出線アンカーは、mouseup確定後(=Backendの
  PATCH応答で`detections`配列が更新された後)にしか動かなかった。ドラッグ中は
  古いアンカー位置のまま表示されていた。
- **新**: ドラッグ中の未確定BBox(プレビュー)を`DetectionOverlay.tsx`の
  ローカルstateから、親の`DrawingViewer.tsx`が保持する
  `previewBBox: {detectionId, rect} | null` stateへ引き上げた (lift up)。
  `DetectionOverlay`は`onPreviewBBoxChange`経由でmousemove毎にこれを
  親へ通知するだけの役割になり、`LeaderLineOverlay`も同じ`previewBBox`を
  受け取ってアンカー計算に使うことで、mouseup前でもリアルタイムに
  引出線・矢印が追従するようになった。
- Backendへの保存(PATCH)は既存通りmouseup時のみで、mousemove毎には送らない
  (要件14。「mousemove→Frontend previewのみ更新、mouseup→Backend PATCH」という
  既存アーキテクチャは変更していない)。
- **ラベル自体の位置は追従の対象外**とし、常に確定済み(persisted)のBBoxのみから
  計算する (`resolveLabel`は`previewBBox`を見ない)。ドラッグ中にラベル位置が
  ジッターするのを防ぐための明示的な設計判断であり、「ラベル位置は固定、
  BBox右上=編集に追従」という要求をそのまま反映している。
- `onPreviewBBoxChange`が渡されない呼び出し(既存の単体テスト等)でも壊れない
  よう、その場合のみ`DetectionOverlay`内部にフォールバックのstateを持たせた
  (`onChange`を渡せばcontrolled、渡さなければuncontrolledという一般的な
  Reactの慣習と同じ考え方)。本番の`DrawingViewer`経由では常に両方渡すため
  常にcontrolledで動作する。

### 修正4: Viewer自動Fit仕様変更 (指示18章〜35章)
- **旧**: 初回ロード時に1度だけFitを適用する以外は、ペインリサイズ・
  ウィンドウリサイズがあっても自動再Fitしない仕様だった (8.2章で明示的に
  「既存挙動を踏襲し、自動再Fitは追加しなかった」と決定していた)。表示位置も
  Viewer領域内で中央寄せだった。
- **新**: `viewMode: 'fit' | 'manual'`というステートマシンを導入した
  (`DrawingCanvas.tsx`。旧`hasFitOnce`という一度きりのフラグを置き換えた)。
  - 基点を左上へ変更 (`translateX=0, translateY=0`。`.drawing-viewer__stage`の
    CSS `justify-content`も`center`から`flex-start`へ変更)。
  - `fitScale = min(viewportWidth/imageWidth, viewportHeight/imageHeight)`
    (安全マージン`FIT_MARGIN=0.98`込み)で計算する`applyFit()`を、
    `.drawing-canvas__viewport`要素に取り付けた**単一の`ResizeObserver`**から
    呼び出す。左右ペイン幅リサイズ・Master高さリサイズ・ウィンドウリサイズは
    いずれも最終的にこの1要素のサイズを変えるため、`window.innerWidth`から
    各ペイン幅を個別に差し引くような実装をせずに済んだ (指示書34章で
    明示的に推奨されていた方式)。
  - `viewMode==='fit'`中のみ上記の自動再Fitが働く。ツールバーの＋/−・
    マウスホイールズーム・実際のPan(`MIN_DRAG_PX`超のドラッグ)のいずれかを
    行うと`viewMode`が`'manual'`になり、以後は自動再Fitしない。単純な
    背景クリック(選択解除)は`MIN_DRAG_PX`未満のため、誤って`manual`へ
    落ちることはない。
  - Fitボタンは`viewMode`を明示的に`'fit'`へ戻し即座に再Fitする。ページを
    開いた直後・ブラウザリロード後の復元時も常に`viewMode='fit'`から始まる。
  - jsdomが`ResizeObserver`を実装していないため、`frontend/src/testUtils/
    mockResizeObserver.ts`に`.trigger()`で明示的にリサイズを再現できる
    `MockResizeObserver`を新規実装し、`setupTests.ts`のグローバル
    `beforeEach`で差し替えた。

### 完了条件チェック (指示書38章、18項目)
自動テスト・実データAPI往復・実PNG+実API応答によるPillow合成モックアップで
検証できた項目: 矢印縮小(50〜65%範囲内)、矢印がBBox右上角を指すこと(既存)、
BBox四隅ハンドルより矢印が小さいこと(想定Viewer幅での概算)、
code+model表示のパイプライン全体調査・実データでの確認、`.trim()`ハードニング、
previewBBoxのlift up・ドラッグ中(mouseup前)のアンカー追従(コンポーネントテストで
確認)、ラベル位置がpreviewBBoxの影響を受けないこと、mouseup時のみBackendへ
PATCHすること、`viewMode`ステートマシン・`ResizeObserver`による自動再Fit・
左上基点・手動zoom/pan後の自動再Fit抑止・Fitボタンでの復帰(いずれも
`DrawingCanvas.test.tsx`の新規12件で確認)。**実ブラウザでの実際のドラッグ操作・
実際のペインリサイズ操作・実際のマウスホイール操作そのものは、これまでの
ラウンドと同様に本セッションの環境上未実施のまま残る** (下記テスト結果参照)。

## 8.12. Phase 1.11 追加修正 第3ラウンド: 実行環境の根本原因調査 + ラベル背景/フォント/水平線調整 (完了)

前ラウンド(8.11)完了報告後、ユーザーから「実画面でまだ型式が出ない/色が合わない/
BBox追従が確認できない」という指摘を受けた。今回は同じ修正を重ねるのではなく、
まず「なぜ実画面に反映されていないのか」を実行経路から調査した。

### 根本原因: 実際にブラウザが参照しているBackendプロセスが古いコードのまま起動されていた
`frontend/.env.local`の`VITE_BACKEND_URL=http://127.0.0.1:8010`により、実際のVite
開発サーバー(port 5175)はport 8010のBackendへプロキシしていた。このプロセスは
2026/08/31 19:05:59に起動されたまま一度も再起動されておらず、Phase 1.11の引出線
機能そのものが実装される前の古いコードのままだった (実際にAPI応答を比較すると、
`leader_label_x/y`・`master_item_category`・`master_item_model`・
`master_item_code`のいずれも存在しなかった)。

セッション内でこれまで「実データ確認」として使っていたcurl先(port 8000)は、
動作確認用に別途起動していた"おとり"のBackendプロセスであり、`.env.local`の
設定を確認せずに検証していたことが調査不足だった (この点はユーザーへも
明示的に開示済み)。該当プロセスを再起動し、以降は実際にブラウザが使うport 8010
に対して検証している。

### 追加修正: 引出線ラベルの見た目調整 (第3ラウンド指示1章〜21章)
根本原因の解消(Backend再起動)に加えて、ユーザーからの新たな指示に基づき、
引出線ラベルの見た目を以下の通り調整した。

- **背景/枠の削除 (1章〜2章)**: 旧`.leader-line-overlay__label`は
  `background: rgba(255,255,255,0.85)` + `border-bottom: 2px solid`という
  「カード状」の見た目だった。この`border-bottom`は、SVG側で既に描画している
  引出線のpolyline(水平線部分)とは別に、CSS側で独自にもう1本水平線を重ねて
  表示しているのと実質同じ状態であり、SVG側は文字数概算・CSS側は実際のbutton幅
  (padding込み)で長さが一致しないため、「水平線が長すぎる/短すぎる」という
  見た目のズレの一因になっていた。今回`background: transparent; border: none;
  box-shadow: none;`とし、水平線はSVG側の1本のみに統一した。hover/selected状態も
  背景を出さず、`text-decoration: underline`(カテゴリ色)で示すよう変更した。
- **フォントサイズ拡大 (3章)**: `font-size: 0.82rem`(≒11.48px) →
  `1rem`(14px、ルート14pxと同じ)。約22%拡大 (指示の15〜25%の範囲内)。
  font-weight(600)・font-family(Phase 1.10のUIフォント方針、`index.css`の
  `:root`をそのまま継承)は変更していない。
- **水平線長の実測ベース化 (7章〜14章)**: 旧実装(`estimateLabelWidthFraction`)は
  文字数×固定係数の概算のみで、実際の文字幅とは無関係だった。
  `CanvasRenderingContext2D.measureText()`で実際の描画幅(px)を計測し、
  左右余白6px(指示書12章の4〜8px範囲の中間値)を加えた値を、`.leader-line-overlay`
  要素の現在の実表示px幅(`getBoundingClientRect().width`)で割って正規化割合へ
  変換するよう変更した(`computeLabelWidthFraction`)。文字自体はCSS上固定pxの
  ため、zoomでコンテナのpx幅が変わっても「文字幅px÷コンテナ幅px」の比は正しく
  再計算され、画面上の水平線の長さは常に実際の文字幅と一致する。この再計算を
  zoom/ペインリサイズ/Viewer Fit変更時にも正しく走らせるため、`.leader-line-overlay`
  要素へ`ResizeObserver`を新規に取り付けた (`DrawingCanvas.tsx`のViewer自動Fit
  機能と同じパターンを踏襲)。`overlayRef`がまだDOMへ未マウントの場合(初回
  レンダー1回のみ)や、`canvas` 2d contextが使えない環境(jsdomの単体テスト等)
  では、それぞれ専用のフォールバック値(旧来の文字数概算/文字数×8px概算)を使う。
- 実Master内で最も長い「コード 型式」表示は約27文字程度(特殊な長尺品名の一部)
  であり、極端な長さではないため、今回は最大幅制限(truncate)は導入しなかった
  (指示書21章・22章: 「通常データで問題なければ制限不要」の判断基準に基づく)。
- BBox move/resize中のリアルタイム追従・引出線ラベルのdrag・Viewer Fit・
  カテゴリ色の連動ロジック自体はこのラウンドでは変更していない(コード変更なし、
  既存テストが無変更のまま全て通過することで回帰なしを確認)。

### 完了条件チェック (第3ラウンド指示25章、13項目)
自動テスト・実データAPI往復(port 8010再起動後)・実PNG+実データによるPillow
合成モックアップで検証できた: ラベル背景/枠なし、フォント拡大(1rem)、
コード+型式表示、カテゴリ色の適用、水平線が実測文字幅に応じて伸縮すること
(短い/長いテキストでの相対比較、コンテナ幅を変えた際の比例関係)、
BBox move/resize追従・Viewer Fitに回帰がないこと(既存テスト無変更で通過)。
**実ブラウザでの実際のhover/クリック/ドラッグ操作そのものは、引き続き本セッションの
環境上ユーザー側での確認が必要である** (下記テスト結果参照)。

## 9. Phase 2以降の候補 (未確定・本Phaseでは未着手)

以下は次フェーズの候補であり、実施順序・要否は未確定:

- Manual BBoxの修正・除外操作
- Manual BBox / 積算結果からEstimateItem/EstimateReferenceを生成する昇格フロー
- 積算結果の確定・却下・数量修正等の編集API
- 実YOLO推論の接続、RuleEngineの本格実装
- baninf等の他の実設計データParser実装 (product_df.csv自体はPhase 1.8で
  盤領域Overlay用途に限り解析済み。それ以外の用途 (例: 盤属性/PanelAttributeの
  自動投入) への展開は未着手)
- 「CCV」の実体確認 (ユーザー・開発チームへの確認が必要)
- 選択中盤(`selectedPanel`, Phase 1.9)とManual BBox追加の自動紐付け
- 選択中盤とEstimateItemとの連携
- Detection/PanelAreaの座標を実CAD座標から機械的に算出する変換ロジック
  (切り出しオフセットの確認が必要)
- 案件切り替え・複数案件管理
- 本番向け認証・権限管理
- 本番デプロイ構成 (社内LAN配布・サービス化等)

## 10. テスト結果 (盤領域Overlay・サムネイルラベル表示 再修正時点)

- Backend: `pytest` — **110 passed** (108件 + 今回純増2件: `ban_meisyou`/`ban_type`が
  盤ごとに個別の値で保持・伝播されること、欠損時も座標計算行をスキップしないこと)
- Frontend: `vitest run` — **100 passed** (14 files。前回時点の95件に加え、
  今回純増5件: `DrawingNavigator.test.tsx`に「ラベルのline-heightが0でないこと」の
  回帰テスト1件 (`getComputedStyle`による実CSSカスケード検証)、
  `ProductPanelOverlay.test.tsx`に2行ラベル表示1件・複数盤への個別値割当1件・
  line-height回帰1件・塗りつぶし濃度(0〜0.1)1件を追加。既存テストは全て
  無変更ロジックのまま通過 = 回帰なし)
- **`vite.config.ts`にvitestの`css: true`を追加**: 既定ではCSSインポートがスタブ化され
  `getComputedStyle`に反映されないため、今回のような「DOM上には存在するが実際には
  見えない」CSS起因の不具合を自動テストで検知できなかった。有効化後も既存の
  ジオメトリ系モック手法 (`Object.defineProperty`によるclientWidth等の差し替え。
  jsdomはレイアウト計算自体は行わないため影響を受けない) との衝突がないことを
  全テスト実行で確認済み
- Frontend: `npm run build` (tsc -b && vite build) — 成功、型エラーなし
- **実画面未反映の根本原因調査**: `netstat -ano`でSekisan Naviの実際の待受ポートと
  プロセスIDを特定し、`Get-CimInstance Win32_Process`でCommandLine/実行パスを
  確認した結果、ユーザーのブラウザが接続していたポート5173は別プロジェクト
  (`yolo_pipeline_studio/frontend`) のVite プロセスであることが判明した (詳細は
  8.4章参照)。Sekisan Navi自身は5174/5175番で正しく起動・配信していたことを、
  served済みソース (`curl`で取得したApp.tsx/DrawingCanvas.tsx等) にPhase 1.8の
  変更が含まれていることを直接確認して立証した
- **盤領域座標の視覚的検証 (実データ)**: A1GV2421のpage16 (外形図)・page18 (基礎図)
  の実PNGに対し、product_dfから計算した盤領域矩形をPython(Pillow)で描画した
  コンポジット画像を作成し、目視で実際の盤外形線・基礎区画と一致することを確認した
  (「normalized coordinateだから合うはず」という理屈だけに頼らない実データ確認)
- Backend起動確認 (フレッシュDB、実データ`\\beans-f1\...\output`使用):
  `GET /api/products/search?q=A1GV242` が実在する`A1GV2421`/`A1GV2422`のみを
  返すこと、`GET /api/products/A1GV2421/drawings`が実12ページ・実`product_df.csv`
  由来の盤領域 (page16で12件、page18で5件、他ページも複数件を含む) を返すこと、
  `GET /api/products/A1GV2421/drawings/16/thumbnail`が実PNG (161,745 bytes、
  実ファイルと完全一致) を`image/png`で返すことを確認済み
- Vite devサーバー (`--strictPort`で明示的に起動しポート衝突を検出可能にした状態)の
  `/api` プロキシ経由 (実ブラウザが辿る経路と同一) で、製番検索・drawings取得・
  サムネイル配信 (左右で同一URL) の全経路が実データに対して問題なく動作することを
  確認 (回帰なし)
- 24並列×6エンドポイント×40回の負荷テストで、sqlite3スレッド不具合の修正前後
  (234エラー→0エラー) を比較・確認済み (Phase 1.5で実施、継続して回帰なし)

過剰なテストコード化はPoC段階では避け、Domain(RuleEngine)・データ参照サービス・
Master Importer・APIの主要経路、Frontendの主要表示ロジック(グループ化・クリック連携・
ステータス表示・Overlay座標変換・Master行選択・BBox追加/削除/リサイズ操作)に
絞っている(要件18/21/24)。

## 11. 起動方法

`README.md` を参照。

## 12. 環境上の注意 (今回の作業環境で判明した事項)

- 開発機のポート `8000` (バックエンド既定ポート) および `5173` (フロントエンド既定ポート)
  は、他プロジェクトのプロセスに使用されている場合がある。その場合はBackend起動時に
  別ポートを指定し (`uvicorn app.main:app --port <port>`)、Frontend側は
  `frontend/.env.local` の `VITE_BACKEND_URL` を実際のBackendポートに合わせて
  変更する (変更箇所はこの1つのみ。`vite.config.ts` の `/api` プロキシがこの値を読む)。
  なお開発時はプロキシ経由で常に同一オリジンになるため、CORS設定 (`backend/app/config.py`
  の `ALLOWED_ORIGINS`) は curl等での直接検証や将来プロキシを使わない構成のための
  保険的な設定であり、通常のブラウザ操作では実質的に関与しない。

- **重要 (Phase 1.8実装確認時に実際に発生した事例)**: `vite --port 5173` を指定して
  起動しても、5173番が別プロジェクトに使用中の場合、Viteは警告なしに次の空きポート
  (例: 5174) へ自動的にフォールバックする。この際、ブラウザ側が古いブックマーク等で
  `http://localhost:5173` を開いたままだと、**Sekisan Naviとは無関係の別プロジェクトを
  表示し続けてしまう**(この作業環境では `yolo_pipeline_studio/frontend` の別Vite
  プロセスが5173番を占有しており、ユーザーのブラウザがそちらを見ていたためPhase 1.8の
  変更が一切反映されて見えない、という事象が実際に発生した)。
  対策: 実際にSekisan Naviが待ち受けているポートは `netstat -ano` 等で明示的に確認し、
  疑わしい場合は `--strictPort` を付けて起動する (フォールバックせず、ポートが
  使用中ならエラーで即座に気づける)。ブラウザで確認する際は、起動ログに表示された
  実際のURLをそのまま開く。

- **Backendは`--reload`なしで起動しているため、Pythonコードの変更はサーバーの
  再起動をしない限り反映されない**。Phase 1.9作業時、数日前から起動したままの
  uvicornプロセスがproduct_df.py等の変更前のコードを配信し続けていたことを
  `Get-CimInstance Win32_Process`の`CreationDate`とソースの変更時刻を突き合わせて
  検知し、再起動して解消した。Backend側の変更を確認する際は、起動中プロセスの
  起動時刻を必ず確認する。

- **重要 (Phase 1.11 追加修正 第3ラウンドで実際に発生した事例)**: この作業環境では
  `frontend/.env.local`の`VITE_BACKEND_URL`が`http://127.0.0.1:8010`(既定の8000
  ではない)に設定されており、実際にブラウザが使うVite開発サーバーはport 8010の
  Backendへプロキシしていた。このport 8010のプロセスは長期間(前回のコード変更より
  何日も前)起動されたままになっており、上記の「`--reload`なし」問題と組み合わさって、
  「Backend側のコードは正しいのに実画面には反映されない」という事象を引き起こした。
  さらに、動作確認用に別途起動していたport 8000への"おとり"curl検証を、
  `.env.local`の設定確認を怠ったまま「実データ確認」として扱ってしまい、
  誤った検証結果(=port 8010は古いままなのに「確認済み」と誤認)を報告してしまった。
  **教訓**: 複数ポートでBackendが起動しうる環境では、`curl`で直接検証する前に
  必ず`frontend/.env.local`の`VITE_BACKEND_URL`を確認し、実際にブラウザ(Vite経由)が
  参照しているのと同じポートを対象に検証すること。ポート番号だけを見て
  「別プロジェクトではなく同じSekisanNaviのBackendだから大丈夫」と判断しない。

## 13. テスト結果 (Phase 1.9時点)

- Backend: `pytest` — **112 passed** (110件 + 今回純増2件:
  `page_no`/`ban_h1`/`ban_h2`/`ban_w`/`ban_d`がPanelPreviewOutへ個別の値で
  保持・伝播されること、欠損時にNoneとして扱われ行全体はスキップしないこと)
- Frontend: `vitest run` — **119 passed** (16 files。前回時点の100件に加え、
  今回純増19件:
  - `utils/panel.test.ts` (新規、4件): `panelKey`がpage/menno/no/type/indexの
    組み合わせで安定・一意なキーを生成すること
  - `DrawingNavigator.test.tsx`: ラベルを「P{page}」+「BAN組の・区切り」の
    2行表示へ変更したことに伴うテスト更新、長い説明文が出ないことの確認テスト追加
  - `ProductPanelOverlay.test.tsx` (12件へ全面書き換え): ラベルが
    BAN_MENNO/BAN_NOのみであること、詳細情報がtitle属性(Tooltip)に入ること、
    空項目がTooltipから省略されること、クリックで`onSelectPanel`が
    `(panelKey, panel)`付きで呼ばれること、選択中/非選択(dimmed)の視覚クラス、
    `<button>`要素であることの確認等
  - `PanelProperties.test.tsx` (新規、5件): 空状態表示、product_df項目表示
    (H1/H2/W/Dへの「mm」付与含む)、null安全表示(「-」。`null`/`undefined`/`NaN`
    という文字列を出さない)、選択中盤優先表示、ダミーPanelへのフォールバック
  - `App.test.tsx` (新規5件): 盤クリックで右ペインが空状態から表示へ切り替わる、
    別の盤クリックで即座に切り替わる、選択中/非選択(dimmed)の視覚クラスが
    実際のApp経由でも付与される、ページ切替で選択盤が解除される、
    空白クリック(Pan操作とは別経路のスタブボタン経由)で選択盤が解除される
  - 既存テストは全て無変更ロジックのまま通過 = 回帰なし (BBoxクリック/リサイズ/
    Manual BBox追加/Pan/Fit/ペインリサイズを含む)
- Frontend: `npm run build` (tsc -b && vite build) — 成功、型エラーなし
- 実データ・実CSS値による代替検証: 本章冒頭の「8.6. Phase 1.9 UI改修」の
  「実データによる検証」を参照。実ブラウザでの操作・Tooltip描画確認は
  本セッションの環境上未実施であり、その旨を完了報告に明記する。

## 15. テスト結果 (Phase 1.10時点)

- Backend: `pytest` — **112 passed** (本Phaseはbackendの変更なし)
- Frontend: `vitest run` — **157 passed** (19 files。前回時点(Phase 1.9実画面未達修正)の
  132件に加え、今回純増25件:
  - `ProductPanelOverlay.test.tsx`: 通常時=塗りつぶし無し、hover時の薄赤(CSSルール
    自体の存在確認)、積算コード選択中はTooltip非表示・hover中の選択開始でも即時
    非表示・クリック無効・pointer-events:none、というPhase 1.10の状態遷移を新規
    8件追加 (既存の「旧: 常時薄赤塗り」を検証していたテストは新仕様に合わせて
    書き換えた)
  - `masterCategoryPresentation.test.ts` (新規、8件): 13件の全角表示名・表示順・
    半角文字が残っていないこと・内部値(internal)が別フィールドとして保持される
    こと・色系統のグルーピング・色数が過剰でないこと・フォールバック
  - `EstimateMasterPicker.test.tsx`: 全角表示名でタブが描画されること(内部の半角値
    がそのまま画面に出ないこと)、colorKeyベースのクラス付与、選択中タブと行選択色の
    非衝突を新規3件追加。既存フィクスチャのcategory値も実際の半角混在の内部値
    (`masterCategoryPresentation.ts`経由で取得)へ差し替え、表示名変換を実際に
    経由するテストへ強化した
  - `index.css.test.ts` (新規、2件): `:root`のfont-familyに`Yu Gothic UI`/
    `Meiryo UI`/`Segoe UI`が含まれ`Yu Gothic UI`が先頭であること、ルート
    font-sizeが14pxのまま(高密度UI維持)であること
  - `App.test.tsx`: 積算コードMaster行選択中の盤領域Tooltip非表示・解除後の再表示・
    pointer-events:none・クリック無効化をApp全体の実配線で確認する新規4件を追加
  - 既存テストは全て無変更ロジックのまま通過 = 回帰なし (BBoxクリック/リサイズ/
    Manual BBox追加/Pan/Fit/ペインリサイズを含む)
- Frontend: `npm run build` (tsc -b && vite build) — 成功、型エラーなし
- 実データ・実CSS値による代替検証: 本章の「8.8. Phase 1.10 UI改修」の
  「実データによる検証」を参照。実ブラウザでのMaster選択中BBoxドラッグ操作の
  確認は本セッションの環境上未実施であり、その旨を完了報告に明記する。

## 16. テスト結果 (Phase 1.11時点)

- Backend: `pytest` — **116 passed** (前回時点の112件に加え、今回純増4件:
  `master_item_category`/`master_item_model`のJOIN結果確認、AI Detectionには
  categoryが付かないことの確認、`leader_label_x/y`更新がBBox本体を変更しないこと、
  `leader_label_x/y`省略時に既存ラベル位置を保持すること)
- Frontend: `vitest run` — **238 passed** (23 files。前回時点(Phase 1.10)の157件に
  加え、今回純増81件。主な内訳:
  - `masterCategoryPresentation.test.ts`: 13カテゴリすべて固有色であることの検証へ
    刷新 (旧: 5系統のグルーピング検証)
  - `utils/bbox.test.ts`: `moveRect`(8件)、`topRightCorner`(3件)を新規追加
  - `utils/panel.test.ts`: `banGroupKey`(4件)を新規追加
  - `utils/urlState.test.ts` (新規、11件): URL query解析・組み立ての純粋関数テスト
  - `hooks/usePaneWidth.test.ts`: `dimension:'height'`の挙動(4件)を新規追加
  - `components/Layout/PaneSplitter.test.tsx`: `axis="y"`の挙動(3件)を新規追加
  - `components/DrawingViewer/DetectionOverlay.test.tsx`: BBox内部drag移動(4件)、
    積算Master Item紐づきBBoxの通常非表示・hover表示・editing表示・カテゴリ色
    (5件)を新規追加
  - `components/DrawingViewer/LeaderLineOverlay.test.tsx` (新規、15件): アンカー
    計算、ラベル文字列、カテゴリ色、ラベル位置の保存・再取得・自動初期配置、
    hover/クリック、ラベルdrag(4件)
  - `components/DrawingViewer/ProductPanelOverlay.test.tsx`: 同一盤別矢視の
    連動ハイライト(4件)を新規追加
  - `components/DrawingNavigator/DrawingNavigator.test.tsx`: 区切り文字の読点化・
    図面種別見出しの説明文(4件)を新規追加
  - `components/EstimateMasterPicker/EstimateMasterPicker.test.tsx`: CSSカスタム
    プロパティ経由の固有色検証へ刷新
  - `App.test.tsx`: URL状態復元(4件)、Escキー優先順位(6件)、Master領域高さ
    リサイズ(7件)を新規追加
  - 既存テストは全て無変更ロジックのまま通過 = 回帰なし (BBoxクリック/リサイズ/
    Manual BBox追加/Pan/Fit/ペインリサイズ/盤選択/Tooltipを含む)
- Frontend: `npm run build` (tsc -b && vite build) — 成功、型エラーなし
- 実データ・実CSS値による代替検証: 本章「8.9. Phase 1.11 UI・BBox表示編集改修」の
  「実データによる検証」を参照。実ブラウザでのBBox内部drag移動・引出線ラベルdrag・
  四隅resizeの実操作確認は本セッションの環境上未実施であり、その旨を完了報告に
  明記する。

## 17. テスト結果 (Phase 1.11 追加修正時点)

- Backend: `pytest` — **116 passed** (前回時点と同数。`master_item_code`の
  JOIN確認を既存の2テストへ追加したのみで、テスト件数の純増は無い)
- Frontend: `vitest run` — **251 passed** (21 files。前回時点(Phase 1.11)の238件に
  加え、今回純増13件:
  - `components/DrawingViewer/ProductPanelOverlay.test.tsx`: ページ内のBAN_MENNO/
    BAN_NOが1種類のみの場合group hoverを無効化すること、2種類以上で有効化する
    こと、無効時もTooltipは実hover行のみを表示することの新規3件
  - `components/DrawingViewer/LeaderLineOverlay.test.tsx`: 25件へ拡張
    (前回15件から10件純増)。`master_item_code`優先のcode取得、
    異常系フォールバック、model欠落禁止の確認、1本のpolyline構成(3点)の確認、
    marker-endの矢印head存在・向きの確認、hit areaと見た目pathの`d`属性一致、
    ラベルが右側/左側それぞれの場合のelbow/end入れ替え、ラベルdrag中も
    接続が維持されることの確認
  - 既存テストは全て無変更ロジックのまま通過 = 回帰なし (BBoxクリック/リサイズ/
    Manual BBox追加/Pan/Fit/ペインリサイズ/盤選択/Tooltip/引出線の既存挙動を含む)
- Frontend: `npm run build` (tsc -b && vite build) — 成功、型エラーなし
- 実データ・実CSS値による代替検証: 本章「8.10. Phase 1.11 追加修正」を参照。
  実ブラウザでのhover/drag操作そのものの確認は本セッションの環境上未実施。

## 18. テスト結果 (Phase 1.11 追加修正 第2ラウンド時点)

- Backend: `pytest` — **116 passed** (前回時点と同数。今回のラウンドはBackendの
  コード変更を伴わず、既存のJOINロジック(`master_item_code`/`master_item_model`)を
  実データでcurl直接確認しただけであるため、テスト件数の増減は無い)
- Frontend: `vitest run` — **269 passed** (21 files。前回時点(Phase 1.11追加修正)の
  251件に加え、今回純増18件:
  - `components/DrawingViewer/LeaderLineOverlay.test.tsx`: 31件へ拡張
    (前回25件から6件純増)。型式が空白のみの場合にコード単独表示になること
    (`.trim()`ハードニング)、矢印headが旧サイズの50〜65%の範囲に縮小され
    Resize Handleより小さいこと、`previewBBox`によるアンカーのリアルタイム
    追従(3件: 追従する・ラベル位置は不変・他detectionのpreviewBBoxを無視する)、
    previewBBoxがnullへ戻った後は新しい確定BBoxを反映すること
  - `components/DrawingViewer/DetectionOverlay.test.tsx`: 22件へ拡張
    (前回20件から2件純増)。resize/move双方について、`onPreviewBBoxChange`が
    mouseup前のmousemove毎に呼ばれ、その時点でBBox本体の見た目(スタイル)も
    既に更新されていること、mouseup後に初めて`onResizeDetection`が呼ばれる
    ことを、`DrawingViewer.tsx`と同じ「previewBBoxをliftする」構成を再現する
    テスト用ラッパーコンポーネント(`ControlledPreviewHarness`)で検証
  - `components/DrawingViewer/DrawingCanvas.test.tsx`: 21件へ拡張
    (前回9件から12件純増)。`viewMode`の初期値がfitであること、Fit倍率計算、
    Fit後にscrollが(0,0)へリセットされること、右ペイン/左ペイン/Master高さ/
    ウィンドウのリサイズ相当(`MockResizeObserver.trigger()`)で再Fitすること、
    手動+/−zoom・wheel zoom・実際のPanドラッグの後は自動再Fitしないこと、
    単純な背景クリックはfitモードを抜けないこと、Fitボタンでfitモードへ復帰し
    即座に再Fitすること、Overlay(子要素)の位置がFitによるzoom変化の影響を
    受けないこと
  - 既存テストは全て無変更ロジックのまま通過 = 回帰なし (BBoxクリック/リサイズ/
    Manual BBox追加/Pan/Fit/ペインリサイズ/盤選択/Tooltip/引出線/BBox内部drag
    移動の既存挙動を含む)
- Frontend: `npm run build` (tsc -b && vite build) — 成功、型エラーなし
- 実データ・実CSS値による代替検証: 本章「8.11. Phase 1.11 追加修正 第2ラウンド」の
  各修正項目を参照。実データ(page16 PNG, Detection id=16, Master Item id=170)を
  Pillowで合成し、(a) 矢印headが旧11.4px相当→新6.4px相当(想定Viewer幅900pxの
  場合)へ縮小されBBox四隅Resize Handle(10px)より小さいこと、(b) 実際の
  code(`11526`)+model(`IS2- 922`)が引出線ラベルとして正しく表示されること、
  を視覚的に確認した(生成物は本セッションのスクラッチパッド配下)。**実ブラウザでの
  実際のマウスドラッグ操作(BBox move/resize中のアンカー追従)・実際のペイン/
  ウィンドウリサイズ操作・実際のズーム/パン操作そのものは、これまでのラウンドと
  同様に本セッションの環境上未実施のまま残る。** なお、`master_item_model`が
  実データで`"IS2- 922"`(ハイフンの後に半角スペースを含む)であるため、
  表示結果は指示書中の例`11526 IS2-922`とは1文字(スペース)分異なる
  `11526 IS2- 922`になる — これはExcel由来の実データそのものの値であり、
  今回の表示ロジック(`code + " " + model.trim()`)による不具合ではない。

## 19. テスト結果 (Phase 1.11 追加修正 第3ラウンド時点)

- Backend: `pytest` — **116 passed** (前回時点と同数。今回のラウンドはBackendの
  コード変更を伴わない。根本原因だった古いBackendプロセス(port 8010)を現在の
  コードで再起動したのみ)
- Frontend: `vitest run` — **276 passed** (21 files。前回時点(Phase 1.11追加修正
  第2ラウンド)の269件に加え、今回純増7件、いずれも`LeaderLineOverlay.test.tsx`
  (31件→38件):
  - ラベルのスタイル: 背景/border-bottom/box-shadowが無いこと、hover/selected時も
    背景が付かないこと、font-sizeが`1rem`であること、文字色に引き続き
    `--cat-leader-text`が使われること
  - 水平線長: 短い文字列より長い文字列の方が水平線が長くなること(同一コンテナ幅)、
    コンテナ幅を2倍にすると同一テキストの正規化水平線幅がおよそ半分になること
    (zoom時の整合性)、コンテナ幅が未確定(0)の初回レンダーでも線が破綻しない
    (フォールバック)こと
  - 既存の31件(previewBBox追従・矢印サイズ・code/model表示・ラベルdrag・
    Layer順序等)は全て無変更ロジックのまま通過 = 回帰なし
- Frontend: `npm run build` (tsc -b && vite build) — 成功、型エラーなし
- 実データによる代替検証: 本章「8.12. Phase 1.11 追加修正 第3ラウンド」参照。
  再起動後のport 8010から実際に取得したDetection(id=28、code=11526、
  model="IS2- 922")と実PNG(page16)をPillowで合成し、(a) ラベルに背景/枠が
  無いこと、(b) 旧デザイン(box幅とSVG概算幅が不一致)と新デザイン(実測幅と
  水平線が一致)の違い、を視覚的に確認した。**実ブラウザでの実際のhover/
  クリック/ドラッグ操作そのものは、これまでのラウンドと同様に本セッションの
  環境上ユーザー側での確認が必要である。**
