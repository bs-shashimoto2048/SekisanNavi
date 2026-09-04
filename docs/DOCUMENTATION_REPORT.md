# DOCUMENTATION_REPORT.md — ドキュメント整備レポート (Issue #11)

Issue #11「Reorganize README and GitHub documentation for internal sharing and
AI coding」対応の記録。

- 1回目の作業対象コミット: 最新main `ee5c24c9acdfb78274abfab00105ce7f9b123fd0`
  (Issue #9 / PR #10 squash merge直後)。README/docsの新規作成・再編を実施
  (1〜8章)。スクリーンショットは実在企業名・実製番の露出懸念のため掲載を
  見送った(PR #12としてsquash merge済み、merge commit `13e06fa2b343146f1766806ce850486c6cb4ee39`)。
- 2回目の作業対象コミット: 上記merge後の最新main `13e06fa2b343146f1766806ce850486c6cb4ee39`。
  「通常データを壊さない撮影専用サンプル」の設計・実装可能性をあらためて確認した
  結果、安全に分離できると判断し、実システムのスクリーンショットを追加した。
  ASCIIアートの罫線図をMermaid/実スクリーンショット/プレーンな文章へ置き換えた
  (9〜11章)。

## 1. 既存docsの棚卸し(作業開始時点)

| ファイル | 分類 | 判断 |
|---|---|---|
| `product-vision.md` | 現在仕様と一致(思想文書) | 変更なし。責務は維持し、README/CLAUDE.mdから導線を追加 |
| `architecture.md` | 一部古い | Phase 1.11までしか反映されておらず、Issue #4 Phase A/B・Issue #6・Issue #9が未反映だった。ディレクトリ構成の一部(`ProductViewer`表記等)も現状と不一致。**更新した**(4章参照) |
| `data-model.md` | 現在仕様と一致 | `decision_events`/`estimate_confirmations`まで既に反映済み(前回作業ラウンドで維持)。ER図に両テーブルを追記する軽微な更新のみ |
| `data-source.md` | 実装履歴として残すべき | 実データ調査結果(座標変換式の検算等)という性質上、そのまま維持。更新なし |
| `decision-data-gap-analysis.md` | 実装履歴として残すべき | 「実装前の棚卸し」という調査時点のスナップショットとしての価値があるため、内容は変更しない(文書自体が「今後変わりうる」と明記済み) |
| `decision-event-design.md` | 実装履歴として残すべき | Phase A実装前設計+実装完了の追記まで含む完結した文書。変更なし |
| `decision-snapshot-design.md` | 現在仕様と一致 | Phase B-1/B-2/B-3の実装完了まで反映済み(前回作業ラウンドで維持)。変更なし |
| `ui-spec.md` | 現在仕様と一致 | Issue #9までの変更を含め最新。冒頭の説明文のみ古かったため更新 |
| `implementation-plan.md` | 実装履歴として残すべき | 各Phaseの実施記録・確定/暫定/未確定分類のログとして機能しており、そのまま維持(2138行と大きいが、時系列の実装履歴という性質上分割しない) |
| `README.md` | 現在仕様と一致していない | Phase 1.8時点の記述のまま、Issue #4/#6/#9の内容が一切反映されていなかった。**全面的に再編した**(2章参照) |

**新規作成が必要と判断したもの**: API Reference・Tech Stack・Configuration・
Coding Conventions・Known Limitations・Claude Code向けCLAUDE.md・本レポート
(いずれも既存docsに同等の文書が無いことを確認した上で新規作成した。3章参照)。

## 2. 作成/更新したファイル一覧

### 新規作成

| ファイル | 責務 |
|---|---|
| `docs/api-reference.md` | 現在存在するAPIエンドポイントのmethod/request/response一覧 |
| `docs/tech-stack.md` | 使用ライブラリ・バージョン・用途の一覧(表形式) |
| `docs/configuration.md` | 環境変数・設定値・ポート番号の一覧 |
| `docs/coding-conventions.md` | 命名・層構成・テスト方針・Git運用の実態 |
| `docs/known-limitations.md` | コード/docsから確認できる制約・未実装事項 |
| `CLAUDE.md`(リポジトリ直下) | Claude Code向け開発ガイド(編集可否・回帰注意点・Git/Issue運用) |
| `docs/DOCUMENTATION_REPORT.md` | 本ファイル |

### 新規作成(2回目のラウンド)

| ファイル | 責務 |
|---|---|
| `docs/assets/screenshot-main.png` | README掲載の実システムスクリーンショット(安全なサンプルデータ、9章参照) |

### 更新

| ファイル | 更新内容 |
|---|---|
| `README.md` | 社内共有向けトップページとして全面再編(3章参照)。2回目のラウンドで実スクリーンショット+「画面の見方」表を追加し、指示の冒頭構成順(タイトル→概要→スクリーンショット→画面の見方→課題→機能→操作の流れ→Documentation導線)へ並べ替えた |
| `docs/architecture.md` | ディレクトリ構成をProductSelector改名・新規ファイル(decision_events/estimate_confirmations関連)に追従させ、16〜19章としてIssue #4 Phase A/B・Phase 1.12/1.14・Issue #6の概要を追記。冒頭の対象Phase説明を更新。2回目のラウンドでASCII罫線図9箇所をMermaid `flowchart`/`sequenceDiagram`へ置換し、decision_events/confirmation snapshotの位置付けを示す新規図を追加(10〜11章参照) |
| `docs/data-model.md` | ER図へ`decision_events`/`estimate_confirmations`を追記。2回目のラウンドでER図全体をMermaid `erDiagram`へ置換(10章参照) |
| `docs/ui-spec.md` | 冒頭の対象Phase説明を更新。2回目のラウンドで1章の画面レイアウトASCII箱図を削除し、実スクリーンショット(README)への参照+領域構成の箇条書きへ置換(10章参照) |

## 3. 根拠にした主要ファイル

- API: `backend/app/api/routers/*.py`(`grep`で全endpoint定義を機械的に抽出)、
  `backend/app/schemas/*.py`
- Tech Stack: `frontend/package.json`, `backend/requirements.txt`
- Configuration: `backend/app/config.py`, `backend/.env.example`,
  `frontend/.env.example`, `frontend/vite.config.ts`, `.gitignore`
- Directory Structure: `find`によるディレクトリ走査(`backend/app/`, `frontend/src/`)
- Coding Conventions: 既存ソースコードそのもの(命名・型ヒント・dataclass・
  repository関数のシグネチャパターン)、既存テストファイルとその内部コメント
  (jsdomの既知の制約等)
- Known Limitations: `grep`による`TODO/FIXME/HACK/Deprecated`の全文検索(該当0件)、
  `docs/decision-event-design.md`・`docs/decision-snapshot-design.md`・
  `docs/decision-data-gap-analysis.md`の該当箇所、`.github/`ディレクトリの不在確認
- テスト件数: `python -m pytest -q`(175 passed)、`npx vitest run`(602 passed,
  28 test files)を最新main上で実行して確認(2026-09-04時点)

## 4. 情報不足だった項目・推測せず「不明」とした事項

- Python本体の要求バージョン: `requirements.txt`・リポジトリ内に明示的な
  バージョン指定ファイル(`.python-version`等)が無いため「不明」と記載した
  (`docs/tech-stack.md`)。
- Node.js本体の要求バージョン: `package.json`に`engines`指定・`.nvmrc`が無いため
  「不明」と記載した(同上)。
- 本番デプロイ構成・リバースプロキシ・HTTPS化の方針: リポジトリ内に記載が無く、
  `docs/architecture.md`が既に「今回のスコープ外」と明記している内容を踏襲し、
  新しい記述は追加していない。
- 「CCV」ディレクトリの実体: 既存の`docs/data-source.md`が「未確認事項」と
  明記済みの内容をそのまま引き継ぎ、新たに断定する記述は加えていない。

## 5. 古い記述を修正した箇所

- `README.md`: 「Phase 1.8時点」という古い前提を削除し、Issue #4 Phase B(積算確定
  snapshot)・Issue #6(折りたたみ・視認性)・Issue #9(ヘッダー/配色)までの機能を
  「現在実装済みの主要機能」へ反映した。
- `docs/architecture.md`: Frontendディレクトリ構成の`ProductViewer/`を、実際の
  ディレクトリ名`ProductSelector/`へ修正した(Phase 1.8で改名済みだった箇所が
  未反映だった)。
- `docs/architecture.md`/`docs/ui-spec.md`: 冒頭の「対象Phase」記述を、
  実際にmainへ反映済みの最新状態(Issue #4/#6/#9まで)に合わせて更新した。
- `docs/ui-spec.md` 1章: ASCII箱図が「PanelProperties」「EstimateTree」という
  旧コンポーネント名のまま残っていた(実際は`PanelInfo`/`EstimateAggregation`+
  `EstimateDetail`へ改名・再構成済み)。図自体を削除し、現在の正しいコンポーネント名で
  領域構成を書き直した(2回目のラウンド、10章参照)。

## 6. 重複を統合した箇所

- API仕様: 従来`architecture.md`内に断片的に記載されていたエンドポイント情報
  (例: 7章のデータ参照ルート解決フロー内の`/api/products/*`言及)は、
  新設した`docs/api-reference.md`を正本とし、`architecture.md`側は「どういう
  仕組みでそのAPIが安全か」という設計判断の説明に役割を絞った(パスの再掲は
  最小限に留めた)。
- セットアップ手順: `README.md`(利用者向けの実行手順)と`CLAUDE.md`
  (AIエージェント向け)の両方にコマンドを重複して書かず、`CLAUDE.md`側は
  README を参照するだけに留めた。

## 7. 今後追加するとよい文書(未着手、実装済みと混同しないこと)

以下はいずれも**今回作成していない**。将来必要になった際の候補として記録するのみ。

- `docs/decision-events-read-api-design.md`相当(Phase A-2着手時): 現時点で
  読み出しAPI自体が存在しないため、設計文書も意図的に作成していない。
- confirmation履歴の一覧/詳細閲覧UI設計文書(Phase B-4相当、仮称): 同上の理由で未着手。
- 本番デプロイ手順書: 本番運用構成自体が未確定のため、現時点では作成しない。

## 8. 検証結果

- README内リンク: 相対パスで記載した`docs/*.md`・`CLAUDE.md`へのリンクは、
  いずれも本コミットで存在するファイルへのパスであることを確認した。
- docs相互リンク: 新規作成ファイルから既存ファイルへの参照(例:
  `api-reference.md`から`decision-snapshot-design.md`等)は、いずれも
  実在するファイル名を指していることを確認した。
- 記載コマンドの一致: `README.md`/`CLAUDE.md`に記載した
  `python -m pytest -q`/`npm run test`/`npx tsc -b tsconfig.app.json --noEmit`/
  `npm run lint`/`npm run build`は、いずれも`backend/pytest.ini`・
  `frontend/package.json`の`scripts`・既存の実行実績と一致することを確認した。
- API/DB記述の一致: `docs/api-reference.md`は最新mainの
  `backend/app/api/routers/*.py`から機械的に抽出したエンドポイント一覧と
  突き合わせ、記載漏れ・記載過多が無いことを確認した。
- スクリーンショット: 1回目のラウンドでは、既存の`project_info`(seed.py由来の
  ダミー案件情報)を使う限り実在企業名・実製番の露出を避けられないと判断し
  掲載を見送った。2回目のラウンドで「通常データを壊さない撮影専用サンプル」の
  設計・実装可能性を再検討し、**アプリの既存機能(system_settingsによる
  データ参照ルート切替、通常のManual BBox登録API)だけを使い、通常運用データを
  一切変更しない撮影用の一時データを組み立てられる**ことを確認したため、
  `docs/assets/screenshot-main.png`として追加した。手順・安全性の根拠は
  9章を参照。
- コード変更を伴わないため、Backend/Frontendの全テストは本ラウンドでは
  再実行必須ではないが、2回目のラウンド作業中にBackend 175 passed / Frontend
  602 passed(28 files)を再確認した(回帰なし)。
- Markdown表示崩れ確認: 2回目のラウンドで変更した全ファイルのコードフェンス
  (```)が偶数個(=開閉が対応している)であることをスクリプトで確認した。
  Mermaidの実レンダリング結果はGitHub上での表示確認に依存するため、
  記法上の対応関係(ノード定義・矢印構文・`erDiagram`のカーディナリティ記法)を
  目視で再確認した。
- secret/業務データ/不要ファイル混入チェック: 2回目のラウンドで追加した
  `docs/assets/screenshot-main.png`および本レポートの追記内容に、実在企業名・
  実製番・個人情報・ローカル絶対パスが含まれていないことを確認した
  (9章のサンプルデータの安全性根拠を参照)。

## 9. README実システムスクリーンショット (2回目のラウンド)

### 9.1 撮影に使ったデータが安全である根拠

`docs/assets/screenshot-main.png`は、以下の**安全なサンプルデータのみ**を使って
撮影した。実在の企業名・実在の製番(`A1GV2421`)・実図面はいずれも画面内に
含まれない。

| 項目 | 値 | 実在データとの関係 |
|---|---|---|
| 製番 | `DEMO0001` | 実在しない、撮影専用の製番文字列 |
| 整理番号/盤名称 | `DEMO` / 「サンプル盤(デモ用データ)」 | 実在企業名を含まない、明確にデモと分かる文言 |
| 図面画像(`1.png`) | Pillowで生成した2つの矩形+ラベルのみの図(「サンプル図面(デモ用・実図面ではありません)」と明記) | 実図面ファイルを一切使用・コピーしていない(架空の図形を新規描画。捏造した「実データ」ではなく、それ自体がデモ用と明示された図) |
| 盤情報(`estcode_df.csv`相当) | 「サンプル盤A」「サンプル盤B」、型式`DEMO-A`/`DEMO-B` | 実在の盤名称・型式を使用していない |
| 積算コード | 実Excel(`estimate_master_a.xlsx`)のコード`11001`/`11002` | Master ExcelはSekisan Naviが参照する汎用の電気設備部材カタログ価格表であり、特定の顧客・案件と紐づく情報ではない(通常のセットアップでも各自が配置する同一データ) |

### 9.2 撮影専用データを追加した場合の、通常運用への影響がない根拠

撮影用データはすべて**リポジトリにコミットしない一時データ**として作成し、
撮影後に元の状態へ復元した。`backend/app/db/seed.py`・アプリのソースコードは
一切変更していない。

1. `system_settings.data_source_root`を、撮影用に用意した一時ディレクトリ
   (製番`DEMO0001`のCSV/PNG/PDFダミーファイルを配置)へ一時的に変更した
   (既存のシステム設定機能そのもの。管理者パスワードによるAPI経由ではなく、
   ローカル開発DBへの直接SQL実行で行った)。
2. `project_info`(id=1の1行のみ存在するPoC用ダミー行)の`seiri_no`/`seiban`/
   `panel_name`を一時的に安全な値へUPDATEした。
3. 既存の`drawing_pages`テーブルへ、製番`DEMO0001`用の1行をINSERTした
   (既存スキーマ・既存の紐付け方式(`product_no`+`source_page_no`)をそのまま
   使用。新しい列・新しいテーブルは追加していない)。
4. 既存の`POST /api/detections`相当のINSERT文で、実際のMaster Item(コード
   `11001`/`11002`、既存の一般的な電気設備部材カタログデータ)を参照する
   Manual BBoxを2件作成した(通常のユーザー操作と同じデータ形状)。
5. 上記の状態でFrontendを実際に起動し(`http://localhost:5175/?product=DEMO0001&page=1`)、
   Playwrightで実ブラウザスクリーンショットを撮影した(画像生成での代替はしていない)。
6. 撮影後、作成した`drawing_pages`/`detections`行を削除し、`project_info`・
   `system_settings.data_source_root`を撮影前の値へ正確に復元した(復元後の値が
   撮影前のバックアップと完全に一致することをスクリプトで比較確認済み)。
   一時ディレクトリ(CSV/PNG/PDF)はリポジトリ外(作業用の一時フォルダ)に
   作成しており、リポジトリには一切含まれない。

**通常運用データ(製番`A1GV2421`のManual BBox 15件等)・`decision_events`・
`estimate_confirmations`・`data/master/estimate_master_a.xlsx`はいずれも
変更していない。** 復元後に実際に製番`A1GV2421`を再表示し、案件情報・
積算集約の合計金額(1,930,200円)が撮影前と完全に一致することを確認した。

### 9.3 再現手順(将来の再撮影用)

上記2.〜4.に相当する最小限のSQLは概ね以下の形になる(実際に使ったスクリプトは
一時ファイルのためリポジトリには含めていない。再現する際は`backend/data/`の
バックアップを取ってから行うこと)。

```sql
-- 1. データ参照ルートを一時変更 (root配下に DEMO0001/ フォルダを用意しておく)
UPDATE system_settings SET value = '<一時ディレクトリのパス>' WHERE key = 'data_source_root';

-- 2. 案件情報を安全な値へ一時変更
UPDATE project_info SET seiri_no = 'DEMO', seiban = 'DEMO0001', panel_name = 'サンプル盤(デモ用データ)' WHERE id = 1;

-- 3. ダミーDrawingPage行を追加 (drawing_file_idは既存の1を流用)
INSERT INTO drawing_pages
    (drawing_file_id, page_no, drawing_type, drawing_name, page_width, page_height,
     display_order, source_type, product_no, source_page_no)
VALUES (1, 1, 'サンプル外形図(デモ)', 'サンプル外形図(デモ)', 1600, 1000, 0, 'product_file', 'DEMO0001', 1);

-- 4. Manual BBoxを2件追加 (master_item_idは既存の一般カタログコードを使用)
INSERT INTO detections
    (drawing_page_id, class_name, bbox_x, bbox_y, bbox_w, bbox_h, status, source_type, master_item_id)
VALUES (<3.のid>, '11001', 0.1, 0.3, 0.1, 0.12, 'reviewed', 'manual', 1);
```

`DEMO0001/`フォルダには`1.pdf`(ページ存在確認用のダミーファイル)・`1.png`
(実図面を使わない合成のサンプル図)・`product_df.csv`・`estcode_df.csv`
(いずれも架空のサンプル盤2件分の座標・寸法データ)を配置する。撮影後は
2.〜4.で変更・追加した行を撮影前の値へ戻す(3./4.で追加した行は削除する)。

## 10. ASCIIアート罫線図の棚卸し・置換一覧

`README.md`/`CLAUDE.md`/`docs/*.md`を対象に、ASCII/Unicode罫線文字
(`+---`, `┌└├┐┘`, `▼`等)を用いた図をgrepで機械的に洗い出した。

| ファイル | 検出結果 | 対応 |
|---|---|---|
| `docs/ui-spec.md` 1章「画面全体レイアウト」 | `+------+`形式の画面レイアウト箱図(ユーザー指摘の実例そのもの) | **削除し、実スクリーンショット(README)への参照+領域構成のプレーンな箇条書きへ置換** |
| `docs/architecture.md` 1章 全体像 | 矢印(`│▼`)によるBrowser→Frontend→Backend→SQLiteの箱図 | **Mermaid `flowchart`へ置換**(社内共有フォルダ・Master Excelも追加して拡張) |
| `docs/architecture.md` 4章 AIとルールの分離 | Detection→RuleEngine→EstimateItem候補の矢印図 | **Mermaid `flowchart`へ置換** |
| `docs/architecture.md` 7章 データ参照ルート解決 | system_settings→data_source.py→APIの矢印図 | **Mermaid `flowchart`へ置換**、箇条書き説明を追加 |
| `docs/architecture.md` 12章 Master Importer | Excel→importer→テーブル→APIの矢印図 | **Mermaid `flowchart`へ置換** |
| `docs/architecture.md` 14章 製番検索フロー | search_product_dirs→API→Frontendの矢印図 | **Mermaid `flowchart`へ置換** |
| `docs/architecture.md` 14章 図面一覧+盤領域Overlayフロー | App.tsx→API→Navigator/Viewerの分岐矢印図(`├─`/`└─`) | **Mermaid `flowchart`へ置換** |
| `docs/architecture.md` 14章 盤選択フロー | クリック→state更新→2箇所反映の分岐矢印図 | **Mermaid `flowchart`へ置換** |
| `docs/architecture.md` 16章 decision_events記録フロー | API→repository→record_event→テーブルの矢印図 | **Mermaid `flowchart`へ置換** |
| `docs/architecture.md` 17章 積算確定snapshotフロー | ボタン→API→builder→save→テーブルの矢印図 | **Mermaid `flowchart`へ置換** |
| `docs/data-model.md` 1章 全体ER概要 | `──`/`│`/`▼`によるER関係図 | **Mermaid `erDiagram`へ置換** |
| `README.md` / `CLAUDE.md` / `docs/product-vision.md` / `docs/data-source.md` / `docs/decision-event-design.md` / `docs/decision-snapshot-design.md` / `docs/api-reference.md` / `docs/tech-stack.md` / `docs/configuration.md` / `docs/coding-conventions.md` / `docs/known-limitations.md` | 該当なし(罫線図・箱図は元々存在しない) | 対応不要 |
| `docs/implementation-plan.md` | 該当なし(grep確認: 罫線文字によるASCII図は0件。矢印付き箇条書きはあるが「箱図」ではない) | 各Phaseの実施記録という時系列ログの性質上、対応不要と判断 |

ディレクトリツリー(`docs/architecture.md` 2章/3章のBackend/Frontend構成)は
「単純なDirectory Tree」に該当するため、コードブロックのtree表現のまま維持した
(置換対象外)。

## 11. 新規/更新したMermaid・画像一覧

### 画像

- `docs/assets/screenshot-main.png`(新規): README掲載の実システムスクリーンショット。9章参照。

### Mermaid図(すべて`docs/architecture.md`、1件のみ`docs/data-model.md`に新規追加。文章だけより理解が速くなる箇所のみ採用し、図を増やすこと自体を目的にしていない)

| 図 | 種類 | 内容 |
|---|---|---|
| architecture.md 1章 | `flowchart` | Frontend/Backend/SQLite/社内共有フォルダ/Master Excelの全体構成 |
| architecture.md 1章 (新規) | `sequenceDiagram` | Browser操作(BBox作成)からAPI/DB(decision_events含む)への主要データフロー例 |
| architecture.md 4章 | `flowchart` | Detection→RuleEngine→EstimateItem候補(Module関係) |
| architecture.md 7章 | `flowchart` | データ参照ルート解決の経路 |
| architecture.md 12章 | `flowchart` | Master Excelインポートの経路 |
| architecture.md 14章 (3件) | `flowchart` | 製番検索/図面一覧・盤領域Overlay/盤選択の各フロー |
| architecture.md 16章 | `flowchart` | decision_events記録の経路 |
| architecture.md 17章 | `flowchart` | 積算確定snapshot保存の経路 |
| architecture.md 17章 (新規) | `flowchart` | **decision_eventsとestimate confirmation snapshotの位置付け**(current state/event history/confirmed snapshotの3層関係。指示5章の明示項目) |
| data-model.md 1章 | `erDiagram` | DB関係全体(DB関係。指示5章の明示項目) |

「現在の積算処理の大まかな流れ」「UI主要領域の関係」(指示5章の候補)は、
それぞれarchitecture.md 1章の新規sequenceDiagram、およびREADMEの実スクリーンショット
+「画面の見方」表(README.md参照)で文章・図より理解が速い形にできたと判断し、
別途新規のMermaid図は追加していない(図を増やすこと自体を目的にしない方針)。
