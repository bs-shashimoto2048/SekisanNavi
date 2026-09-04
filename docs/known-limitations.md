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

## decision history(判断履歴)の読み出し

- `decision_events`テーブル(Issue #4 Phase A-1)は書き込み専用。作成/削除/BBox編集
  イベントを記録するが、これを返す読み出しAPIエンドポイントは存在しない
  (`docs/decision-event-design.md` 10章のPhase A-2は未実装と判断済み。
  Issue #4コメント参照)。
- 履歴を確認する手段は、現時点ではDBファイルへ直接SQLを実行する以外に無い。

## 積算確定snapshotの履歴閲覧

- `POST /api/products/{product_no}/estimate-confirmations`(Issue #4 Phase B-2)で
  確定snapshotを作成できるが、過去のconfirmationを一覧・詳細取得する読み出しAPIは
  無い。作成直後のレスポンス(`EstimateConfirmationOut`)でしか内容を確認できない。
- Frontend側にも確定履歴の一覧・詳細閲覧UIは無い(`EstimateConfirmationAction`は
  「確定する」ボタンのみを提供する最小UI。`docs/decision-snapshot-design.md` 13章)。

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
