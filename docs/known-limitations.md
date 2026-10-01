# known-limitations.md — 既知の制約・未実装事項

コード・既存docsから確認できる制約のみを記載する(将来実装予定を実装済みのように
書かない)。詳細な調査根拠は各リンク先を参照。

## AI検出データの永続化

- `detected_df.csv`(YOLO推論の出力)は`GET /api/products/{no}/drawings/{page}/detected-preview`が
  都度読み込んで返す表示専用データであり、DBの`detections`テーブルへは
  一切コピー・同期されない(`app/services/detected_df.py`)。
- 実データ経路で`detections`テーブルへ行が作られるのはManual BBox追加
  (`POST /api/detections`, `source_type='manual'`)のみ。そのため実運用上、
  `decision_events`/`estimate_confirmation_items`に記録される`create`イベント・
  明細は事実上すべて`source_type='manual'`になる
  (`docs/decision-event-design.md` 9章)。
- AIが最初に検出したBBoxと、人が補正した後のBBoxを比較する仕組みは無い
  (実データではAI由来のDetection行自体がほぼ存在しないため)。

## 認証・actor

- ユーザー単位の認証・ログイン機能は無い。存在するのは管理者パスワード
  (`SEKISAN_NAVI_ADMIN_PASSWORD`)による、データ参照ルート変更専用の
  fail-closedな検証のみで、一般利用者の識別・ロールは実装していない。
- `decision_events`/`estimate_confirmations`のいずれにも「誰が操作したか」を
  記録する列は無い。将来追加する場合も「既存行はNULL扱いで後から`actor_id`列を
  追加できる」設計を前提にしている(`docs/decision-data-gap-analysis.md` 10章)。
- **[2026-09 Issue #31]** 社内LAN上の他端末からアクセスできるようにする設定
  (`README.md`「社内LAN上の他端末から画面を確認する」参照)は、この
  認証未実装という制約をそのまま引き継ぐ。URLへ到達できる端末・利用者は
  誰でも同じ権限でアクセスできてしまうため、レビュー・作業者評価等の
  限定的な用途に限り、社外・不特定多数がアクセスできるネットワークでは
  使用しないこと。

## decision history(判断履歴)の読み出し

**[2026-09 訂正]** 本節はIssue #4 Phase A-2着手前の記述だったが、Phase A-2は
その後実装済みになった。

- `GET /api/products/{product_no}/decision-events`(Issue #4 Phase A-2、
  `backend/app/api/routers/products.py`)が、製番`product_no`の判断履歴
  (`decision_events`、作成/削除/BBox編集イベント)を発生順(古い順)で返す。
  保存済みの値をそのまま返す読み取り専用のエンドポイントで、書き込みは行わない。
- Frontend側にも一覧表示UI(`components/DecisionEventHistory/`、画面上部の
  編集ツールバー「操作履歴を見る」ボタン)がある。

## 積算確定snapshotの履歴閲覧

**[2026-09 訂正]** 本節はIssue #4 Phase B-4着手前の記述だったが、Phase B-4は
その後実装済みになった。

- `POST /api/products/{product_no}/estimate-confirmations`(Issue #4 Phase B-2)で
  確定snapshotを作成できる。加えて`GET /api/products/{product_no}/estimate-confirmations`
  (過去のconfirmationを新しい順の一覧で返す)・
  `GET /api/products/{product_no}/estimate-confirmations/{confirmation_id}`
  (1件の詳細=header+明細一式を返す)がIssue #4 Phase B-4で実装済み
  (`backend/app/api/routers/products.py`)。いずれも保存済みの値をそのまま返す
  読み取り専用で、確定時点の再現性を保つため現在のMaster価格等での再計算はしない。
- Frontend側にも確定履歴の一覧・詳細閲覧UI(`components/EstimateAggregation/
  EstimateConfirmationHistory.tsx`、積算集約(現在はViewer上のfloating panel、
  `docs/ui-spec.md` 1.7章)内の「履歴」ボタン、旧「確定履歴を見る」から
  Issue #36で短縮)がある。

## CI / GitHub Actions

- リポジトリ直下に`.github/`ディレクトリは存在しない。GitHub Actions等のCI設定は
  無い。テスト・lint・buildはいずれもローカルで手動実行する運用
  (`README.md`「起動・テストの最短導線」参照)。

## 単価(暫定)の扱い

- 積算集約・積算明細の「単価(暫定)」列は`estimate_master_items.total_price_a`
  (Excelの「総合価格A」)をそのまま表示しているだけで、業務上正式な「単価」として
  確定した値ではない(画面上にも「(暫定)」と明記、`docs/ui-spec.md` 5.5章)。
- `estimate_master_items`はExcel再インポートのたびに`code`をキーとした
  UPSERTで上書きされ、バージョン管理を持たない。過去に確定した積算金額を
  Master再インポート後も再現したい場合は、Phase B-2で追加した積算確定snapshot
  (確定時点の値を非正規化コピー)を使う必要がある(通常の`detections`/
  `estimate_master_items`参照だけでは、再インポート後に過去の金額が変わりうる。
  `docs/decision-data-gap-analysis.md` 7.2章)。

## EstimateResultの正本化 (Issue #40 Phase 5) に伴う未確定事項・既知の制約

- **新旧同一コード衝突のdedupe方針は未確定**: 新方式(ルール評価)・旧方式
  (`legacy_detection_adapter.py`、master_item_id直結の旧Manual/AI BBox)が
  同一(対象盤/コード)を算出した場合、どちらを正として採用すべきか、あるいは
  別結果として両方残すべきかの業務ルールが確定していない。Phase 5では
  推測でdedupeせず、両方を`status=needs_review`として残す暫定対応にとどめて
  いる(`docs/architecture.md` 33章、`docs/data-model.md` 6.7章)。
- **[2026-10時点で解消済み] 積算確定(EstimateConfirmation)は未移行**:
  本節はPhase 5時点の記述だったが、Phase 6-Aで`estimate_confirmation_builder.py`
  を`estimate_results`から直接組み立てる方式へ移行済み
  (`docs/architecture.md` 34章)。
- **[2026-10時点で解消済み] 設計データ根拠の判定値は表示していない**:
  本節はPhase 5時点の記述だったが、Phase 6-Bで`design_data_ref`を拡張し、
  判定に実際に使った条件(field/operator/expected_value/actual_value)を
  日本語の条件式として表示するようになった(`docs/architecture.md` 34章)。
- **[2026-10時点で解消済み] 数量の手修正は未実装**: 本節はPhase 5時点の
  記述だったが、Phase 6後半で`initial_quantity`/`current_quantity`/
  `quantity_overridden`/`quantity_override_reason`/`quantity_updated_at`/
  `quantity_updated_by`を実装し、係数と同じ考え方の手修正UIを提供する
  ようになった(`docs/architecture.md` 34章)。
- **積算明細の「明細行クリックで対象ページへ自動遷移する」機構は廃止**:
  EstimateResultは複数ページ/複数BBoxにまたがる根拠を持ちうるため(旧
  「1行=1 Detection=1ページ」という前提が成り立たなくなったため)、Phase 4
  以前にあった明細行クリックでの自動ページ遷移は実装していない。ページ移動は
  左のDrawingNavigatorから行う(`docs/ui-spec.md` 5.6章)。
- **編集直後の積算明細行の一時強調(edit-follow)は廃止**: BBox移動直後に
  Viewer側のBBoxを一時強調する機構(`flashDetection`)はPhase 5でも維持して
  いるが、積算明細側の対応する行を同時に一時強調していた旧機構(1行=1
  Detection前提)は、明細行の全面書き換えに伴い実装していない。

## 新ワークフローUI統合 (Issue #40 Phase 6-C) に伴う既知の制約

- **図面情報マスタ(`drawing_evidence_types`)は本番データで未投入**: 本番DB
  (`backend/data/sekisan_navi.db`)を調査した時点(2026-10)で
  `GET /api/drawing-evidence-types`は空配列を返す(テーブル自体は0007/0008の
  migrationで作成済みだが、行が1件も投入されていない)。そのため、現状の
  本番データでは「図面情報」floating panelを開いても選べる項目が無く、
  新ワークフローの主導線を実際に使うには、別途`drawing_evidence_types`・
  対応する`estimate_rule_masters`へ実データを投入する運用作業が必要になる
  (投入手順・投入すべきマスタデータの確定自体は今回のスコープ外)。
- **新旧同一コード衝突のdedupe方針は引き続き未確定**: 33章の暫定対応
  (dedupeせず両方をneeds_reviewとして残す)は本フェーズでも変更していない。
  「要確認」件数の可視化(積算集約の小表示)は改善したが、解消すべき
  判定自体の業務ルールは確定していない。
- **行クリックの持続選択・BBox導線はタブ横断では機能しない**: 積算明細の
  行クリック選択(`detailSelectedResultId`)・BBoxからの逆引き強調
  (`relatedToSelectedBboxResultIds`)は、いずれも現在表示中のタブに対象行が
  含まれている場合のみ見える。タブを自動的に切り替える・該当行まで
  自動スクロールする機能は意図的に実装していない(既存のタブ・対象絞り込みの
  挙動を変えないため)。
- **部品台帳の既定非表示は実ブラウザ確認の結果による判断**: 1024px/1600pxの
  実ブラウザ確認で作業性を損なわないことを確認したうえで採用したが、
  実際の長期運用での使用感(部品台帳を頻繁に使う作業者がいるか等)は
  未検証。

## その他、コードから確認できる制約

- 積算コードの体系(11xxx/18xxx/44xxx等の桁の意味)は未確定
  (`docs/data-model.md` 9章)。
- Manual BBoxの`panel_id`は自動推定しない(常にNULL)。実際の盤所属判定は
  Frontend側で毎回BBox交差計算により導出する(`estimateAggregationReal.ts`)。
- AI Detection削除の「削除履歴」を再推論結果から除外する仕組みは無い
  (削除しても、将来実推論を再実行すると同じ検出が復活しうる。
  `docs/architecture.md` 13章)。
- 「CCV」という名称のディレクトリ/ファイルは実データ調査で確認できていない
  (`docs/data-source.md`、`app/config.py::CCV_SUBDIR_CANDIDATES`は見つかれば
  使う暫定フォールバック)。
- `TODO`/`FIXME`/`HACK`/`Deprecated`等のコードコメントマーカーは、
  Backend/Frontendのソース(`backend/app/`, `frontend/src/`、テストファイル除く)
  いずれにも存在しない(2026-09時点でgrep確認済み)。未確定事項は
  `docs/implementation-plan.md`の確定/暫定/未確定分類、および各docsの
  「未確定」の記述として管理されている。
- 元図面・PDF・設計データは read-only 前提で、書き込み・削除・移動・リネームに
  相当するAPI/関数は実装していない(`docs/architecture.md` 6章)。

## 積算資料PDF Helpの配信最適化 (Issue #19 Phase 3)

- `GET /api/help/estimate-pdf/file`(`app/api/routers/help_pdf.py`)は
  Starletteの`FileResponse`をそのまま返すのみで、HTTP Range Requestへの
  明示的な対応・chunked配信・キャッシュ制御ヘッダの意図的な付与は行っていない
  (`FileResponse`のデフォルト動作に依存)。実際の積算資料PDFの想定ファイル数・
  サイズ(数MB/複数ページ程度を想定)であれば、開発環境での動作確認では
  UIが固まる等の問題は見られなかったが、より大きなファイルや低速回線での
  挙動、Range Requestが必要かどうかは今回調査・実装していない(要調査)。
- 積算資料PDFの表示は`<iframe>`によるブラウザ標準PDF表示に委譲しており、
  ページ数・サイズに応じた独自の遅延読み込み(プログレッシブ表示等)は
  実装していない(ブラウザのPDF viewer自体の挙動に依存する)。
