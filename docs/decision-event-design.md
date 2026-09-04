# decision-event-design.md — Phase A: 最小event logging 設計

> **この文書の位置付け**
> Issue #4 `Preserve decision history for future estimation automation` の
> Phase A(最小event logging)について、**実装前の設計を確定するための文書**
> である。本文書自体はDB migration・API実装・event logging実装・UI追加の
> いずれも行っていない(設計のみ)。実装は別Issue/別作業として着手する。
>
> 前提となる棚卸しは `docs/decision-data-gap-analysis.md`
> (branch `docs/decision-data-gap-analysis`, commit `184e403`) を参照する。
> 調査対象コミットはgap-analysis作成時と同じ`e798c0d7d69572bf4c4342f4641f5bb92b1b571b`
> (main)で、その後mainに変更が無いことを確認済み(2.1参照)。

---

## 1. `docs/decision-data-gap-analysis.md` の再確認

現在のmain (`e798c0d7d69572bf4c4342f4641f5bb92b1b571b`) と、gap-analysis作成時の
調査対象コミットは同一であり、`backend/app/repositories/detections.py` /
`backend/app/db/migrations/` / `frontend/src/domain/editHistory.ts` のいずれも
差分が無いことを`git diff`で確認済み。したがって gap-analysis.md の内容は
そのまま設計の前提として使用できる(再調査による修正は不要)。

Phase A設計で直接前提とする既存事実(gap-analysis.md該当章):

- `detections`テーブルに`created_at`/`updated_at`が無い(gap-analysis 2.1)。
- `update_detection_bbox`は単純UPDATE、`delete_detection`はハードDELETE。
  いずれも変更前の値をDBのどこにも残さない(同上)。
- Undo/Redo(`editHistory.ts`)はReact stateのみで、DBへ一切書き込まない
  (gap-analysis 2.5)。
- 実データ経路で`detections`行が作られるのはManual BBox作成のみ。
  `detected_df.csv`(AI検出)は`detections`テーブルへ一切コピーされない
  別データ源(gap-analysis 2.1, 2.6)。
- `PATCH /api/detections/{id}`は`bbox_x/y/w/h`(必須)と`leader_label_x/y`
  (任意)を1回のリクエストで受け付ける。BBox本体の移動/リサイズと引出線
  ラベル移動が同一エンドポイントを共有する(`data-model.md` 4章)。

---

## 2. Phase Aのスコープ確認

Issue #4本文のPhase A対象は次の4種の「事実」に限定される。

- create(Manual BBox作成)
- delete(Detection削除)
- bbox move(移動)
- bbox resize(リサイズ)

**leader_label(引出線ラベル)の移動は対象外**とする。理由: Issue #4本文の
Phase A対象一覧に明記されておらず、また現在のUndo/Redo(`editHistory.ts`)も
leader_label移動をcommand種別に含めていない(既存の対象範囲と揃える)。
将来必要になれば、本設計と対称な形で`event_type`を1種追加すればよい
(§4参照)。

同様に、積算コード変更・盤所属変更・要確認確定・状態変更は、gap-analysis
2.1/2.3/2.4で確認した通り**そもそも実行するAPIが現状存在しない**ため、
Phase Aで記録しようがない(該当なし)。これらは将来別APIを追加する段階で
改めて設計する。

---

## 3. Event table schema

新規テーブル `decision_events` を追加する(既存`detections`/
`estimate_master_items`等へのALTERは行わない。完全に独立した追加テーブル)。

```sql
-- 0006_decision_events.sql (将来のmigration。今回は作成しない)
CREATE TABLE decision_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
    event_type TEXT NOT NULL,          -- 'create' | 'delete' | 'bbox_edit'
    detection_id INTEGER NOT NULL,     -- 意図的にFK制約を付けない(§6参照)
    drawing_page_id INTEGER NOT NULL,  -- 非正規化コピー(削除後もページ文脈を保つ)
    source_type TEXT NOT NULL,         -- 非正規化コピー('ai'/'manual'。イベント発生時点の値)
    master_item_id INTEGER,            -- 非正規化コピー(nullable。Manual BBoxのみ非null)
    before_bbox_x REAL,
    before_bbox_y REAL,
    before_bbox_w REAL,
    before_bbox_h REAL,
    after_bbox_x REAL,
    after_bbox_y REAL,
    after_bbox_w REAL,
    after_bbox_h REAL
);

CREATE INDEX idx_decision_events_detection_id ON decision_events(detection_id);
CREATE INDEX idx_decision_events_drawing_page_id ON decision_events(drawing_page_id);
```

**JSON列を使わず、既存スキーマと同じ「フラットな型付き列」方針を踏襲する**
(このSQLiteスキーマ全体でJSON列を使っている箇所は無く、`detections`自体も
`bbox_x/y/w/h`を個別列として持つ。一貫性を優先する)。Phase Aの対象が
bbox関連の3操作に限定されているため、列が過度に疎(常にNULLの列だらけ)には
ならない。

`before_bbox_*`/`after_bbox_*`は event_type ごとに次のように埋める。

| event_type | before_bbox_* | after_bbox_* |
|---|---|---|
| create | すべてNULL(作成前は何も無い) | 作成されたbbox |
| delete | 削除直前のbbox | すべてNULL(削除後は何も無い) |
| bbox_edit | 更新前のbbox | 更新後のbbox |

## 4. create/delete/bbox move/resize の記録方法

### 4.1 moveとresizeを区別するか → **区別しない(1つの`event_type='bbox_edit'`に統合)**

現在の実装(`DetectionOverlay.tsx`のBBox本体drag、四隅ハンドルdrag)は、
いずれも最終的に**同一の**`onResizeDetection(detectionId, rect)`
→ `PATCH /api/detections/{id}`を呼ぶだけで、Frontend側の
`editHistory.ts`自身も`kind: 'bbox'`という1種類のcommandしか持たない
(move/resizeを区別する情報がそもそも存在しない)。Backend側で
move/resizeを区別するには、Frontend側に新しいシグナル(操作種別)を
追加する必要があり、これは「今回はAPI/UI実装をしない」という
Phase Aの原則、および「通常操作に余計な入力を要求しない」という
product-visionの原則の観点からも過剰である。

代わりに、`before_bbox_w/h`と`after_bbox_w/h`を比較することで、
**分析時(Phase C)に**「w/hが変化していなければmove、変化していれば
resize」と機械的に判定できる。記録時点では単一の`bbox_edit`イベントで
十分であり、これが最小の記録方法である。

### 4.2 create

`repositories/detections.py::create_manual_detection`が新しい`detections`行を
INSERTした直後、同じ`conn`で`decision_events`へ1行追加する。

- `event_type='create'`
- `detection_id`= 直前にINSERTされたid
- `drawing_page_id`/`source_type`(='manual'固定)/`master_item_id`= 渡された引数そのまま
- `before_bbox_*`= NULL
- `after_bbox_*`= 渡された`bbox_x/y/w/h`

### 4.3 delete

`repositories/detections.py::delete_detection`が実際に`DELETE`する**前**に、
対象行を`get_detection(conn, detection_id)`で取得し(既に呼び出し元の
router `remove_detection`は404判定のために取得していないため、
repository関数内で1回読む必要がある)、その内容を`decision_events`へ
記録してから`DELETE`を実行する。

- `event_type='delete'`
- `detection_id`= 削除対象のid
- `drawing_page_id`/`source_type`/`master_item_id`= 削除直前の行の値
- `before_bbox_*`= 削除直前のbbox
- `after_bbox_*`= NULL

### 4.4 bbox_edit (move/resize)

`repositories/detections.py::update_detection_bbox`の**現在の実装は
UPDATE文のみで、更新前の値を読んでいない**。Phase Aでは、Router層
(`api/routers/detections.py::update_detection`)が既に404判定のために
`get_detection(conn, detection_id)`を呼んでいる点を利用し、**この
既存の取得結果をそのまま「before」として repository層へ渡す**設計とする
(追加のSELECTを増やさない)。

- `event_type='bbox_edit'`
- `detection_id`= 対象id
- `drawing_page_id`/`source_type`/`master_item_id`= 更新後も不変のため、
  before/after共通で良い(取得済みの行の値を使う)
- `before_bbox_*`= router層が事前取得した更新前のbbox
- `after_bbox_*`= リクエストで渡された更新後のbbox

**leader_label_x/yのみを変更するPATCH呼び出し(bbox自体は不変)では、
`bbox_edit`イベントを記録しない**。before/afterのbbox 4値がすべて
一致する場合はイベントをINSERTしない(before==afterの無意味なイベントを
機械的に量産しないため)。この判定はrepository層で
`before_bbox_x/y/w/h == after_bbox_x/y/w/h`かどうかを比較するだけの
単純な条件分岐で実現できる。

## 5. before/afterの持ち方

§3の通り、bbox 4値(x/y/w/h)をbefore/after双方に個別列として持つ。
JSON化・差分のみ保存(diffだけ持つ)のいずれも採用しない。理由:

- 個別列の方が既存スキーマの流儀(flatな型付き列)と一致し、
  SQLiteでの型チェック・インデックスの恩恵を受けられる。
- Phase Aの対象がbboxの4値のみに限定されているため、列数が
  非現実的に増えることはない(before4列+after4列の計8列)。
- 差分のみの保存は「その時点の絶対値」を失うため、複数回の編集を
  跨いだ再現(例: 3回移動した後の元の位置)に弱い。個別値を毎回
  独立して記録する方が、後からの分析が単純になる。

## 6. Detection削除後の参照方法

`decision_events.detection_id`には**意図的に外部キー制約を付けない**
(`REFERENCES detections(id)`を書かない、単なる`INTEGER NOT NULL`とする)。

理由: `backend/app/db/connection.py`は`PRAGMA foreign_keys = ON`を
全接続で有効化している。もし`detection_id`にFK制約を付けた場合、
delete eventを記録した直後に本体の`DELETE FROM detections`を実行しようと
すると、**まさにそのevent行自身が参照しているために外部キー違反で
削除が失敗する**(SQLiteの既定動作はON DELETE NO ACTION相当)。
これは「削除の事実を記録する」というevent logの目的そのものと矛盾する。

既存コードの類似パターン(`estimate_references.detection_id`)は
「削除前にNULLへ更新してから削除する」方式を採るが、これは
「参照先が消えても構造上困らないよう緩める」設計であり、
`decision_events`のように「消えたという事実そのものを保持したい」
用途には合わない。よって`decision_events`では**FK制約を持たない
歴史的参照(historical reference)として`detection_id`を扱う**方針とする。

この結果、あるDetectionが削除された後にその`decision_events`を見る際は、
`detections`テーブルとJOINしても該当行は無い(または再作成された全く別の
idの行がヒットしうる、§8参照)。**削除後の解釈は、`decision_events`
自身が持つ非正規化コピー列(`drawing_page_id`/`source_type`/
`master_item_id`/`before_bbox_*`)だけで完結させる**設計とし、
現在の`detections`/`estimate_master_items`への依存を前提にしない。

## 7. current state更新とevent insertのtransaction境界

`backend/app/api/deps.py::get_db`は`get_connection()`のcontextマネージャを
そのままFastAPIの依存関係として使っており、**1リクエスト = 1コネクション
= 1トランザクション**(正常終了時に1回だけcommit、例外発生時はrollback)
という構造が既に確立している。個々のrepository関数(`create_manual_detection`
/`update_detection_bbox`/`delete_detection`)は自前でcommit/rollbackを
呼ばない。

Phase Aでは、この既存の構造にそのまま乗せる。event記録用の
`decision_events`へのINSERTは、**同じ`conn`引数を使い、状態変更のSQL
(INSERT/UPDATE/DELETE)と同一のrepository関数内・同一トランザクションで
実行する**。新しいtransaction管理コードは一切追加しない。

これにより:

- 状態変更が成功したのにevent記録だけ失われる、あるいはその逆、という
  不整合は原理的に発生しない(両方成功するか、両方rollbackされるかの
  いずれかしかない)。
- event記録のためだけに新しいAPI呼び出し・別リクエストを増やさない
  (Frontend側の呼び出し方は一切変更不要)。

## 8. Undo/Redo実行時のeventの扱い

**方針: Undo/Redoを特別扱いしない。通常の操作と全く同じAPI呼び出しとして、
そのまま`decision_events`へ記録する。**

現在の`editHistory.ts`のUndo/Redoは、いずれも「既存のAPIをもう一度、
別の引数で呼ぶだけ」で実現されている(`App.tsx`のUndoハンドラ/Redo
ハンドラを参照)。

- bbox editのUndo = 「afterからbeforeへ戻すPATCH」を送るだけ
  → これは新しい`bbox_edit`イベントとして自然に記録される
  (before=直前のafter値、after=元のbefore値)。**detection_idは
  変わらないため、この種別のUndo/Redoは event履歴上も連続した
  1つの`detection_id`の時系列として素直に追える。**
- createのUndo = `delete_detection`を呼ぶ → 新しい`delete`イベントとして記録される。
- deleteのUndo = `create_manual_detection`をもう一度呼ぶ
  → SQLiteの`AUTOINCREMENT`により**新しいdetection_idが払い出される**
  ため、新しい`create`イベントは元の`delete`イベントとは
  **別のdetection_id**を持つことになる。Frontend側は既に
  `rebaseDetectionId`でUndo/Redoスタック内の参照を新IDへ付け替えて
  いるが、これは**Frontendのメモリ内でのみ**行われる処理であり、
  `decision_events`テーブル上の`detection_id`列を後から書き換えたり、
  新旧IDを紐づけたりする処理は**Phase Aでは行わない**。

この結果として生じる制約を明記する: **create/deleteのUndo/Redoを挟むと、
「同じ物理的なBBox」のevent履歴が`detection_id`をまたいで分断される**
(旧id→delete eventで終わり、新id→create eventから始まる、という
2本の別系列になる)。これは新しい問題ではなく、`editHistory.ts`の
`DeleteEditCommand`コメントが既に開示している既存の制約
(「AI Detectionの削除をUndoした場合、元がAIでも復元後はManual表示に
なる」)と同根であり、Phase Aはこれを解決しない。将来、新旧IDの
連続性を残したい場合は、API呼び出しに「これは何idの再作成/Undoか」を
示す追加情報を持たせる設計が必要になるが、これはAPI形状の変更を
伴うため今回のスコープ外とする。

**"これはUndo操作である"というフラグは付与しない。** 理由:

- フラグを追加するには、Frontend→BackendのAPIリクエスト形状を変更する
  必要があり(「今回はAPI実装をしない」設計フェーズの範囲を超える)、
  Phase A実装時に持ち越す判断とする。
- event logは「実際にDBへ何が起きたか」を素直に記録する場としての
  役割に徹し、「ユーザーの意図がUndoだったかどうか」という解釈は
  Phase C(分析)側で、時系列パターン(A→B→Aのような往復)から
  後付けで推測可能である。フラグに頼らず生の事実だけを残す方が、
  記録の単純さ・正直さを優先するproduct-visionの原則に合う。

## 9. AI `detected_df.csv` とのGap

gap-analysis 2.1/2.6で確認した通り、`detected_df.csv`(YOLO推論結果)は
リクエストの都度読み込まれる表示専用データであり、`detections`テーブルへ
一切コピーされない。したがって:

- Phase Aのevent loggingは`detections`テーブルへのINSERT/UPDATE/DELETEを
  対象とするため、`detected_df.csv`由来のプレビュー項目
  (`DetectedPreviewItem`)には**一切適用されない**。これらは
  そもそも「イベントを記録すべき対象操作」自体が存在しない
  (作成も更新も削除もされない、読み取り専用の表示)。
- 結果として、Phase A導入後も**実データにおいて`decision_events`へ
  記録される`create`イベントは、事実上すべて`source_type='manual'`
  になる**(現状の`detections`行の実態と完全に一致する。gap-analysis
  2.1で確認済みの制約がそのまま引き継がれる)。
- 将来、AI推論結果を`detections`テーブルへ正式に取り込む
  インポート処理を実装する場合、その処理も**同じ`decision_events`
  記録経路(`event_type='create'`, `source_type='ai'`)を使うだけで
  対応できる**設計になっている(スキーマ変更は不要)。ただし
  そのインポート処理自体は本Issueのスコープ外である。

この非対称性(Manualは記録されるが、AI取り込みは経路自体が無いため
記録されようがない)は、Phase Aが**新たに生む**Gapではなく、
**既存のGapをそのまま引き継ぐ**ものであることを明記しておく。

## 10. Phase A-1 / A-2への分割

**分割を推奨する。**

### Phase A-1(書き込み専用・最小リスク)

- `0006_decision_events.sql` マイグレーション追加(新規テーブルのみ、
  既存テーブルへのALTER無し)。
- `repositories/decision_events.py`(新規)に、INSERT専用の
  `record_event(...)`関数を実装する。
- `repositories/detections.py`の3関数(`create_manual_detection`/
  `update_detection_bbox`/`delete_detection`)から、それぞれ
  §4の記録方法に従って`record_event`を呼び出す。
- **読み出し用のAPIエンドポイントは追加しない**。既存の
  Router/Frontendの呼び出し方・戻り値は一切変更しない
  (関数シグネチャも変えない。内部で1行追加INSERTするだけ)。
- 目的: 「まずデータを蓄積し始める」ことを、既存機能への
  回帰リスクを最小にした形で先行させる。Undo/Redo・BBox所属判定・
  積算集約・Viewerの既存動作は一切変更されないため、
  Issue #4の完了条件のうち「既存実装への回帰がない」を
  最も検証しやすい単位になる。

### Phase A-2(読み出し・検証)

- `decision_events`を参照する最小限のAPI(例:
  `GET /api/detections/{id}/events`、または
  `GET /api/decision-events?drawing_page_id=...`)を追加する。
- 蓄積されたデータが期待通りの形で記録されているかを、
  実際のリクエストを通して検証できるようにする。
- この段階ではUIへの表示は行わない(Phase Cの分析、または
  将来のUI検討で改めて設計する)。

分割理由: Issue #4の完了条件は「browser reload後も履歴が残る」
「create/delete/bbox editの履歴を通常操作から自動記録できる」
「回帰がない」であり、これらはA-1だけで満たせる。読み出しAPIの
形状(フィルタ条件・ページネーション・レスポンス項目)は、
実際に貯まったデータを見てから決めた方が手戻りが少ない。
書き込みと読み出しを同時に設計・実装するよりも、
段階を分けてA-1を先にレビュー・mergeする方が安全である。

---

## 11. 既存Docsとの整合性

- `data-model.md`/`architecture.md`は今回変更していない
  (本文書はあくまで設計案であり、`decision_events`は未実装のため、
  実装済みであるかのように記載しない)。
- `docs/decision-data-gap-analysis.md`で指摘したGapのうち、Phase Aが
  **部分的に解消するもの**: 「Detectionにcreated_at/updated_atが無い」
  (→対応するevent の occurred_at で代替可能)、「BBox編集前後が
  永続化されない」(→bbox_editイベントのbefore/afterで解消)、
  「Detection削除の履歴が残らない」(→deleteイベントで解消)。
- **Phase Aが解消しないもの**(gap-analysis通りPhase B/Cの領域):
  Master Excel再インポートによる過去結果の変化、積算確定snapshot、
  積算コード変更・盤所属変更・要確認確定・状態変更の履歴
  (対応するAPIが無いため)。

## 12. 次のステップ

1. ~~本設計のレビュー。~~ **完了**。
2. ~~Phase A-1の実装(migration + repository層のみ、API/UI変更なし)。~~
   **完了**。`0006_decision_events.sql` + `repositories/decision_events.py` +
   `repositories/detections.py`の3関数への組み込みとして実装した
   (詳細は`docs/implementation-plan.md` 8.17章参照)。
3. ~~Phase A-1のtests~~ **完了**。`backend/tests/test_decision_events.py`
   (12件)で、create/delete/bbox_editそれぞれの記録内容・削除後もevent行が
   残ること・leader_label-only更新で記録されないこと・Undo相当操作の
   記録され方・transaction共有(rollback時にevent単独で残らないこと)を検証。
4. ~~実ブラウザでの回帰確認~~ **完了**。実際にA1GV2421へManual BBoxを作成→
   移動→Ctrl+Zで元へ戻す(通常のbbox_editイベントとして記録されることを
   確認)→削除、という一連の操作を行い、`decision_events`が設計通り
   `create→bbox_edit→bbox_edit(Undo)→delete`の順で記録されること、
   積算集約(製番合計)・積算明細の面/盤列(BBox所属判定)・Undo/Redoボタンの
   状態がいずれも操作前後で一致すること(回帰なし)を確認した。
5. **今回はここまで(Phase A-1)。** Phase A-2(読み出しAPI)は別Issue/別作業
   として着手する(今回のIssue #4本文の作業順序どおり、まだcloseしない)。
