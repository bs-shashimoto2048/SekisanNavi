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

## 実データ検証準備・評価器基盤補完 (Issue #40 Phase 6-D/6-E) に伴う既知の制約

- **`drawing_evidence_types`/`estimate_rule_masters`の実マスタは依然未投入**:
  Phase 6-Dで候補一覧・代表検証ケースを整理し、検証用DBコピー限定の投入
  スクリプト(`backend/tools/seed_verification_evidence_fixtures.py`)で動作
  確認を行ったが、本番DBへは一切投入していない(上記「図面情報マスタは
  本番データで未投入」の状況は変わらない)。
- **[2026-10 Phase 6-Fで解消済み] `StandardCondition`のOR結合は未対応だった**:
  本節はPhase 6-E時点の記述だったが、Phase 6-Fで`design_data_any_of`
  (ANDグループのリスト、いずれか1グループが成立すればよいOR表現)を追加した。
  「IS系**または**OS系」を1つの`StandardCondition`で正確に表現でき、
  18322(盤内通路IS/OS系)の検証fixtureも`model starts_with "IS"`固定から
  `design_data_any_of`によるOR表現へ置き換えた(`docs/architecture.md`参照)。
  ただしOR結合は「ANDグループのOR」という1段のみで、それ以上複雑な
  OR/NOTの組合せ・ネストは引き続き持たない。
- **estcode_df.csvの追加19列は「読み込めるだけ」で業務ロジックには未接続**:
  Phase 6-Eで`PANEL`/`TRANS`/`IN_PANEL`/`SHIELD`/`DOOR_FRONT`/`DOOR_BACK`/
  `DOOR_STACK`/`DOOR_SIDE`/`DOOR_SMALL`/`FAN_ROOF`/`FAN_DOOR`/`MAIN_LINE`/
  `WIRE_MESH`/`STACK_PLATE`/`DRAWER_DEVICE`/`VCT_STAND`/`BUS_DUCT`/`PASSAGE`/
  `INPUT_CU_COEFF`を`EstimatePanelInfo`/`DesignDataContext`まで接続し、
  `StandardCondition`の設計データ条件から参照できるようにしたが、各列が
  「0/1のフラグ」なのか「枚数等のカウント」なのかの意味づけ、どの積算コードに
  対応するか、という業務ルールの確定・実マスタへの接続は行っていない
  (値をそのまま保持するだけに留める)。
- **判定範囲`JudgmentScope.POSITION`/`RANGE`は引き続き未実装**:
  `app.domain.geometry`にBBox同士の上下・左右・重なり判定(`is_above`/
  `is_below`/`is_left_of`/`is_right_of`/`overlaps`)を純粋関数として追加したが、
  どの実ルールへも接続していない。18323(VCT架台)の「CHがVCTの上にあれば
  成立」という条件を含め、相対位置判定が必要な実ルールは引き続き
  `needs_confirmation`扱いのまま。
- **判定範囲`JudgmentScope.DRAWING`/`PRODUCT`は「図面情報の存在判定のみ」に
  限定したサポート**: Phase 6-Eで追加したが、設計データ条件
  (`design_data_conditions`)との組合せは評価せず`skipped_rule_master_ids`
  へ回す(設計データは本来盤単位のデータであり、図面単位・製番単位への
  集約方法が業務的に未確定なため)。
- **`.boxspec`/`.baninf`ファイルは現行のデータ参照ルートには存在しない**:
  18101〜18115(底板)の「設計データのみで判定可能」という分類の根拠資料
  (「対応仕分け」Excelのプログラム対応リストシート)は、`.boxspec`
  (`STEEL-BOTTOM`列)・`.baninf`(`ZUMEI`列)というファイル形式を前提にしている
  が、Sekisan Naviが実際に参照している`data_source_root`
  (`\\beans-f1\ShareData\estimatic\a_product\output\<製番>\`)配下には
  これらの拡張子のファイルが1件も見つからなかった(Phase 6-E調査、
  実製番A1GV2421で確認)。別のデータパイプライン(CAD/積算システム側の
  内部ファイル)の可能性が高く、新しいデータソースへの接続自体が必要になる
  ため、18101〜18115の設計データのみ判定は実装していない。
- **`QuantityMethod`/`CalcType`の大半はenum定義のみ**: `PER_EVIDENCE`/
  `PER_CONDITION_GROUP`(quantity)と`DIRECT`(calc)以外は、値は定義されて
  いるが評価器は未実装で、該当ルールは常に`skipped_rule_master_ids`へ
  回る(`PER_FACE`/`PER_UNIT`/`PER_PRODUCT`/`PER_COMBINATION_SET`/
  `DIFF_FROM_STANDARD`/`CUSTOM`、`ADD`/`SUBTRACT`/`MULTIPLY_PRICE`/
  `MULTIPLY_LABOR`/`MULTIPLY_BOTH`/`CUSTOM`)。詳細な対応状況は
  `docs/rule-engine-support.md`を参照。

## 評価器基盤補完 (Issue #40 Phase 6-G) に伴う既知の制約

- **位置関係条件(`evidence_relations`)はPANEL scope限定、match_modeは
  `any_pair`のみ**: `app.domain.estimate_rules.EvidenceRelation`/
  `MatchMode`、`app.services.estimate_rule_evaluator`の`is_standard_rule_
  supported`/`_rule_shape_supported`参照。`DESIGN_DATA`/`DRAWING`/
  `PRODUCT` scopeとの組合せ、`EVERY_PAIR`/`ONE_TO_ONE`/`NEAREST_PAIR`
  match_modeは未実装のまま(複数BBoxがある場合のペアリング規則を業務的に
  決めていないため)。
- **`relation=overlaps`は`tolerance=0.0`のみサポート**(PR #51レビュー指摘
  対応): `app.domain.geometry.overlaps`はtolerance引数を持たないため、
  `tolerance!=0`を指定しても評価時にsilent ignoreされてしまう。この組合せ
  自体を`is_standard_rule_supported`で明示的にunsupportedとし、評価器
  (`evaluate_product`)・候補マニフェストvalidatorの両方がskip/NGとする。
  「overlapに対するtolerance」の業務的な意味(矩形を膨張させる、等)は
  資料から確認できないため、今回は意味を定義せず未対応のままにしている。
  `above`/`below`/`left_of`/`right_of`は引き続き任意のtoleranceを
  サポートする。`EvidenceRelation.tolerance`自体もNaN/+Infinity/-Infinityを
  `math.isfinite`で拒否する(DSL/JSON境界として有限値のみ許可)。
- **18323(VCT架台)はまだ投入できない**: 位置関係(CHがVCTの上にあれば成立)
  自体を表現する技術基盤はPhase 6-Gで実装・テスト済みだが、実ルールへは
  まだ接続していない。加えて資料にある「発注者区分(東電のみ等)」を設計
  データとして参照する手段が無く、「盤内/盤外」判定もabove/below関係とは
  別の概念のため表現方法が未定義。`docs/master-candidate-status.md`参照。
- **18321(盤内通路IA/OA系)はPhase 6-Gで技術検証済みへ更新したが、本番投入
  可能という意味ではない**: 18322(IS/OS系)と同じOR engineで
  `model starts_with "IA"`/`"OA"`を合成データ(IA2/OA1)で評価できることを
  確認したが、実データでのIA/OA型式パターンは未確認。型式だけで盤内通路
  スペースの有無を断定してよいかという業務確認(18322と共通)も残っている。
- **18302の標準含有枚数差分(`QuantityMethod.DIFF_FROM_STANDARD`)は実装
  しない**: 標準枚数の参照先として`Ａ製品標準工数計算手順NNメモ追加.xlsx`
  の「箱体コードに含む」シートが実在することをPhase 6-Gで確認したが、
  記載は「正面」「正面両開」等の構成ラベルのみで、積算可能な数値カウント
  ではない。「正面両開=2枚」等への変換規則(カウント規約)が資料から
  確定できないため、標準枚数を推測せず、評価器実装を見送った。
- **AI class alias mapping基盤(`backend/tools/ai_class_alias.py`)は
  本番runtimeへ未接続**: `roof_fan`/`roof_fan_l`/`roof_fan_r`→
  `roof_fan_top`のような複数AI class統合が技術的に可能なことを、
  候補マニフェストの`ai_class_keys`を使った純粋なmapping関数として
  確認したが、`class_name`→`evidence_type_key`の実際の書き込み経路
  (いつ・どこで解決するか)は未実装・未確定のまま(同モジュールの
  docstring「調査結論」参照)。
- **19959-19962(箱体価格倍率)の`multiply_price`等は実装しない**:
  倍率の基準となる金額・複数倍率の適用順序・`factor`(既存の係数)との
  関係のいずれも資料から確定できないため、Phase 6-Gでも評価器実装を
  見送った(`docs/master-candidate-status.md`の本番投入判定表参照)。

## 本番投入候補マニフェスト (Issue #40 Phase 6-F) に伴う既知の制約

- **候補マニフェストは本番seedではなく、`ready`判定の候補も0件**:
  `backend/data_candidates/phase6f_drawing_evidence_types.json`(16件)・
  `phase6f_estimate_rules.json`(11件)は、Phase 6-Dで整理した候補を機械可読な
  形へ整理したレビュー専用ファイルであり、アプリ起動パスから自動ロードされ
  ない。2026-10時点で`status=ready`の候補は1件も無く、全候補が
  `needs_business_confirmation`または`blocked`である(詳細は
  `docs/master-candidate-status.md`参照)。
- **design_data_ref/confirmation snapshotはOR条件を説明可能だが、UI表示は
  テキスト(`title`属性)のみ**: `app.services.estimate_rule_evaluator.
  _build_design_data_ref`が出力するJSONに`any_of`(各OR枝の成立有無・実際値)
  を追加し、`estimate_confirmation_result_evidence.design_data_ref`への
  snapshotコピー(確定時、文字列をそのままコピーするだけの既存機構)でも
  問題なく保持されることを検証済み。Frontend側(`drawingEvidencePresentation.ts::
  formatDesignDataAnyOfGroups`)も日本語化に対応したが、`EstimateDetail`の
  根拠詳細表示(ボタンの`title`属性)への追加のみで、専用のビジュアルUIは
  作っていない(指示「UIは今回大きく変えなくてよい」のため)。

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
