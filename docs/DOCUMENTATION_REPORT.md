# DOCUMENTATION_REPORT.md — ドキュメント整備レポート (Issue #11)

Issue #11「Reorganize README and GitHub documentation for internal sharing and
AI coding」対応の記録。作業対象コミット: 最新main `ee5c24c9acdfb78274abfab00105ce7f9b123fd0`
(Issue #9 / PR #10 squash merge直後)。

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

### 更新

| ファイル | 更新内容 |
|---|---|
| `README.md` | 社内共有向けトップページとして全面再編(3章参照) |
| `docs/architecture.md` | ディレクトリ構成をProductSelector改名・新規ファイル(decision_events/estimate_confirmations関連)に追従させ、16〜19章としてIssue #4 Phase A/B・Phase 1.12/1.14・Issue #6の概要を追記。冒頭の対象Phase説明を更新 |
| `docs/data-model.md` | ER図へ`decision_events`/`estimate_confirmations`を追記 |
| `docs/ui-spec.md` | 冒頭の対象Phase説明を更新(内容自体は前回作業ラウンドまでに最新化済み) |

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
- スクリーンショット: 取得元・保存先・機密確認結果は`README.md`内のコメントおよび
  Issue #11への完了報告を参照(掲載可否はユーザー確認待ち、本コミットには
  画像ファイルを含めていない)。
- コード変更を伴わないため、Backend/Frontendの全テストは本ラウンドでは
  再実行必須ではないが、直近(本ラウンド開始前)の最新mainで
  Backend 175 passed / Frontend 602 passed(28 files)を確認済み(3章参照)。
