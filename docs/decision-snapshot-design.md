# decision-snapshot-design.md — Phase B: 積算確定snapshot 設計

> **この文書の位置付け**
> Issue #4 `Preserve decision history for future estimation automation` の
> Phase B(積算確定snapshot)について、**実装前の設計を確定するための文書**
> である。本文書自体はDB migration・API実装・UI追加のいずれも行っていない
> (設計のみ)。実装は別Issue/別作業として着手する。
>
> 前提となる調査・設計は以下を参照する。
> - `docs/decision-data-gap-analysis.md`(Gap分析。§7.2/§8/§13/§14で
>   Master Excel再インポートによる再現性リスクとFinal Snapshotの必要性を
>   既に指摘済み)
> - `docs/decision-event-design.md`(Phase A: event logging設計・実装済み)
> - 調査対象コミット: `77f6f832a9bd36ecf15bcb78a7349a9f730ce3e4`(main、
>   PR #7 squash merge後。Issue #6完了時点)

---

## 1. 対象範囲の確認(Issue #4最新コメントの非対象)

以下は本設計では扱わない(Issue #4最新コメントの指定通り)。

- Phase A-2読み出しAPI(別途判断済み。現時点では不要、Issue #4コメント参照)
- AI自動化
- confidence/auto-confirm
- 認証/actor
- 追加の理由入力
- event-sourcing化(Phase Aのevent historyとは責務を分離したまま維持する。
  §6参照)

## 2. 前提となる既存事実の再確認

- `project_info`テーブルはPoC用の単一レコード想定であり、実データの製番
  (`product_no`、例: `A1GV2421`)を正規化して管理する「Product/Project」
  テーブルはDBに存在しない(`docs/data-model.md` 2章、`0001_init.sql`)。
  実製番は`drawing_pages.product_no`(TEXT、nullable)と同じく、**外部ファイル
  システム/CSVに基づく生の文字列**として扱われている。
- 積算集約の実データ計算は、Backendの`estimate_items`/`estimate_references`
  テーブル(Phase 0/1のダミーデータ用に残置)を一切経由しない。実データは
  Frontend側`frontend/src/domain/estimateAggregationReal.ts::buildRealEstimateAggregation`
  が、`detections`(DB)×`estimate_master_items`(DB)×`product_df.csv`/
  `estcode_df.csv`(都度読み込みの外部ファイル)を組み合わせて**リクエストの都度
  計算**している。したがって、Phase Bのsnapshotは`estimate_items`テーブルを
  対象にしても意味を持たない(実データがそこを通らないため)。**snapshotが
  保存すべきは、`buildRealEstimateAggregation`が計算する`detailItems`
  相当の実データである**。
- `estimate_master_items`は`code`をキーとしたUPSERTで上書きされ、
  バージョン管理を持たない(`docs/data-model.md` 5章、gap-analysis §2.2/§7.2)。
  これがPhase Bの主動機(Master Excel再インポート後も過去の積算結果を再現する)
  である。
- 積算対象(`EstimateTarget`)は`product`(製品全体)/`panel`(個別盤)/
  `tie`(要確認)の3種で、`frontend/src/types/estimateAggregation.ts`に
  定義済み。`targetId`文字列は`'product'` / `'panel:{面番号}:{盤番号}'` /
  `'__tie__'`のいずれか(`estimateAggregationReal.ts`)。

## 3. snapshotの確定単位

**製番(`product_no`)単位とする。** 1回の確定操作 = その時点の製番全体の
積算結果一式(全対象・全明細)をまとめて1つのsnapshotとして保存する。

理由:
- Master Excel再インポートは製番を横断して価格・型式・定格へ影響する
  (gap-analysis §7.2)。「製番のどの部分が古い/新しいMaster値を参照している
  か」を混在させないためには、**製番全体を同じ瞬間に丸ごと固定する**方が
  安全である。
- 実運用として「個別の盤だけを確定し、他の盤は未確定のまま」という業務要件は
  Issue #4本文・関連コメントのいずれにも記載がなく、現状の`project_info.
  analysis_status`(未解析/解析中/確認待ち/確定)も**製番単位の1状態**として
  設計されている(`0001_init.sql`)。既存の粒度と一致させる。
- 対象別(盤/製品全体/要確認)の内訳は失われない。snapshot line item側に
  §5の`target_id`/`target_type`等を持たせることで、確定後も「対象で絞り込んだ
  表示」を保存データから再現できる(現在Frontendが`lineItems`/`totalLineItems`
  をdetailItems相当から都度集約しているのと同じ考え方を、保存済みのsnapshot行
  に対して適用するだけでよい。集約ロジック自体の再実装は不要)。

## 4. header / line item の最小schema

`estimate_items`/`estimate_references`(Phase 0/1のダミー専用テーブル)とは
別に、`decision_events`と同様**新規の独立テーブルを2つ追加する**方針とする
(既存`detections`/`estimate_master_items`等へのALTERは行わない)。

```sql
-- 0007_estimate_confirmations.sql (将来のmigration案。今回は作成しない)

-- 確定操作そのもの(1回の確定 = 1行)
CREATE TABLE estimate_confirmations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_no TEXT NOT NULL,          -- drawing_pages.product_noと同じ生の製番文字列
    confirmed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_estimate_confirmations_product_no
    ON estimate_confirmations(product_no);

-- 確定時点の明細行(Detection 1件 = 1行。detailItemsと同じ粒度)
CREATE TABLE estimate_confirmation_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    confirmation_id INTEGER NOT NULL REFERENCES estimate_confirmations(id),

    -- 歴史的参照(意図的にFK制約を付けない。理由は§6参照)
    detection_id INTEGER,
    drawing_page_id INTEGER,

    -- 対象(§3の対象別内訳を再現するための非正規化コピー)
    target_id TEXT NOT NULL,           -- 'product' / 'panel:{面番号}:{盤番号}' / '__tie__'
    target_type TEXT NOT NULL,         -- 'product' / 'panel' / 'tie'
    ban_menno INTEGER,                 -- target_type='panel'の場合のみ非NULL
    ban_no INTEGER,                    -- 同上
    panel_name TEXT,                   -- 確定時点のestcode_df.csv由来の盤名称(同上)

    -- 積算コード(確定時点の値を非正規化コピー。Master再UPSERTの影響を受けない)
    master_item_id INTEGER,            -- 参考程度のFKなし参照(コード変更追跡には使わない)
    code TEXT NOT NULL,
    category TEXT,
    model TEXT,
    rating TEXT,

    source TEXT NOT NULL,              -- 'ai' / 'manual'(確定時点のDetection.source_type)
    quantity REAL NOT NULL DEFAULT 1,  -- Detection単位の行のため常に1(将来の拡張余地として列は残す)
    unit_price REAL,                   -- 確定時点のestimate_master_items.total_price_a
    amount REAL,                       -- quantity(=1) * unit_price相当。unit_priceがNULLならNULL
    status TEXT NOT NULL,              -- 確定時点のDetection.status(○/△/×の元値)

    -- 確定時点のBBox(座標そのものを非正規化コピー。detection_idの参照に依存しない)
    bbox_x REAL,
    bbox_y REAL,
    bbox_w REAL,
    bbox_h REAL,
    page_no INTEGER                    -- 確定時点のページ番号(表示・図面ナビゲーション参考用)
);

CREATE INDEX idx_estimate_confirmation_items_confirmation_id
    ON estimate_confirmation_items(confirmation_id);
```

**保存粒度をDetection単位(detailItems相当)にする理由**: `EstimateLineItem`
(対象別・数量集約済み)や`totalLineItems`(総合計・対象横断集約済み)は、いずれも
`detailItems`から機械的に再集約できる**派生データ**である(§2、
`estimateAggregationReal.ts`のコメント参照)。集約済みの形で保存すると、
将来「対象別の見せ方」を変更した場合に過去snapshotとの整合が取れなくなる
リスクがある。最も粒度の細かいDetection単位で保存しておけば、対象別・総合計
いずれの表示も**保存後にいつでも同じ集約ロジックで再現できる**ため、
情報を失わない最小の保存単位として妥当である。

## 5. 何を値として固定保存するか

| 項目 | 保存する値 | 理由 |
|---|---|---|
| master item識別子 | `master_item_id`(FKなし、参考情報) | IDだけでは再現性を保証できない(Master側の値が変わりうるため)。あくまで「当時どのMaster行を参照していたか」を辿るための補助情報。 |
| 表示コード/内容 | `code`/`category`/`model`/`rating` | Master再UPSERTで値が変わっても、確定時点の表示がそのまま残るようにする(gap-analysis §7.2で確認した最大の再現性リスクへの直接対応)。 |
| source | `source`(ai/manual) | Detection.source_typeは不変のため参照でも良いが、Detection行自体が削除されうる(§6)ためコピーする。 |
| quantity | `quantity`(常に1) | Detection単位保存のため。対象別・総合計の数量集約は読み出し時に再集計する(§4)。 |
| unit/price系 | `unit_price` | `estimate_master_items.total_price_a`の確定時点コピー。現状の実データモデルに「unit(単位)」列自体が存在しない(`EstimateLineItem`/`EstimateDetailItem`いずれにも無い)ため、存在しない項目を捏造して追加しない。 |
| amount | `amount` | `unitPrice`が算出できた場合のみ非NULL(既存の「金額不明をnullで表す」規則を踏襲)。 |
| target/盤所属 | `target_id`/`target_type`/`ban_menno`/`ban_no`/`panel_name` | 確定時点のBBox所属判定結果を固定する。`product_df.csv`(盤領域)が将来変わっても、確定済みsnapshotの所属は変化しない。 |
| drawing/BBox参照 | `detection_id`/`drawing_page_id`(歴史的参照、FKなし)+ `bbox_x/y/w/h`/`page_no`(値そのものを非正規化コピー) | 参照先が削除・移動されても、snapshot行単体でBBox位置を再現できるようにする。図面への逆参照(Viewerナビゲーション)は`detection_id`/`drawing_page_id`が現存する場合のベストエフォートとし、削除後は使えなくなっても`decision_events`と同様に許容する(§6)。 |

## 6. current state / event historyとの関連付け

- **`decision_events`への外部キー・逆参照は持たせない。** confirmationと
  eventは目的が異なる(`docs/decision-data-gap-analysis.md` §13で既に
  「案Bと案C(確定スナップショット)は目的が異なるため、どちらか一方で
  足りるという結論にはならない」と整理済み)。「いつ確定されたか」と
  「その前後にどんな編集イベントがあったか」を突き合わせたい場合は、
  `estimate_confirmations.confirmed_at`と`decision_events.occurred_at`を
  時系列で比較すれば十分であり、専用の結合キーを設けてテーブル間の依存を
  増やす必要はない。
- **`detection_id`/`drawing_page_id`にFK制約を付けない**理由は
  `decision_events.detection_id`と同じ(`docs/decision-event-design.md` 6章)。
  `PRAGMA foreign_keys = ON`環境で、確定後にDetectionが削除されると
  自己参照でDELETEが失敗する構造になるため、歴史的参照として扱う。
  `confirmation_id`(`estimate_confirmation_items` → `estimate_confirmations`)
  は同一トランザクション内でheader行を先にINSERTしてから明細行を
  INSERTする設計とするため、この参照には安全にFKを付けられる
  (header行が常に先に存在することが保証されるため、decision_eventsのような
  自己参照削除の問題が起きない)。

## 7. Estimate Master変更後の再現性をどう保証するか

§5の非正規化コピー(`code`/`category`/`model`/`rating`/`unit_price`/`amount`)
により、確定後に`estimate_master_items`が再UPSERTされても、
`estimate_confirmation_items`の値は一切変化しない。読み出し時
(将来のPhase B-2/B-3)は`estimate_master_items`へJOINし直さず、
snapshot行が持つ値をそのまま表示する設計とする(現在の`detections`側が
「毎回JOINして最新値を見る」設計になっているのとは意図的に逆の方針であり、
「confirmation = 過去の凍結された事実」「detections = 今この瞬間の状態」
という責務の違いをスキーマ上でも明確にする)。

## 8. 確定日時

`estimate_confirmations.confirmed_at`(header単位で1つ)とする。同一確定操作に
属する明細行はすべて同じ確定操作の一部であり、行ごとに個別の確定日時を
持たせる必要はない(1回の確定 = 1つの時刻、という単純な対応関係を保つ)。

## 9. 再確定時の扱い

**上書き禁止。再確定のたびに新しい`estimate_confirmations`行を追加する
(append-only)。** 既存のsnapshot行を`UPDATE`・`DELETE`する操作はPhase Bの
設計に含めない。

理由:
- `decision_events`と同じapp-onlyの哲学を踏襲し、一貫性を保つ。
- 「いつ確定し直したか」という履歴自体にも将来価値がある(複数回確定した
  場合、確定間の差分を後から比較できる)。上書き型にすると、この推移が
  失われる。
- 「最新のconfirmationをどう見せるか」(例: 同一`product_no`で最新の
  `confirmed_at`を持つ行をデフォルト表示する)は読み出しAPI/UIの設計論点
  であり、書き込み側のschemaに版管理用の特別な列(`version`等)を今追加する
  必要はない。`confirmed_at`の降順で最新行を判定できるため、追加の連番列は
  不要と判断する。

## 10. snapshot作成APIをPhase B-1に含めるか

**含めない。schema/migrationとAPI実装を分ける。**

理由(Phase A-1/A-2分割時と同じ考え方):
- 「確定」操作は現状のSekisan Naviに全く存在しない新しい操作であり
  (`project_info.analysis_status`に対応する更新APIも無い)、Phase A-1の
  「既存操作に相乗りするだけ」のリスクの低さとは性質が異なる。
- 確定時点のデータをどう集めるか(a. Frontendが`buildRealEstimateAggregation`
  で計算済みの`detailItems`をそのままPOST bodyとして送る、b. Backend側で
  同等の集計ロジックを再実装し、`product_no`だけを受け取ってBackendが
  `product_df.csv`/`estcode_df.csv`/DBを都度読み直して計算する)という、
  API設計の根幹に関わる論点がまだ決着していない。これをschema設計と同時に
  決めると、どちらか一方の決定が遅れた場合に両方が手戻りする。
- まずschema(本文書)をレビュー・確定させ、次のIssue #4作業としてAPI設計
  (a/bどちらの方式を採るか、確定操作の入力・認可・エラーハンドリング)を
  別途行う方が、Phase A同様に手戻りが少ない。

## 11. UI追加をこの段階で行うかどうか

**行わない。** 本文書はschema設計のみであり、「確定」ボタン・過去snapshot
一覧画面等のUIはいずれも将来のPhase B-2/B-3(または別Issue)で検討する
(Issue #4最新コメントの非対象指定と整合)。

## 12. 既存Docsとの整合性

- `data-model.md`/`architecture.md`は今回変更していない(本文書はあくまで
  設計案であり、`estimate_confirmations`/`estimate_confirmation_items`は
  未実装のため、実装済みであるかのように記載しない)。
- `docs/decision-data-gap-analysis.md`で指摘したGapのうち、Phase Bが
  **解消を目指すもの**: 「Master Excel由来の価格・型式・定格が保持されない」
  「積算確定イベント自体が存在しない」(いずれもgap-analysis §8で
  **High**優先度と評価済み)。
- **Phase Bが解消しないもの**: 外部CSV(`product_df.csv`/`estcode_df.csv`)
  自体の当時値スナップショット(§5で`target`/`panel_name`は確定時点の
  **解決結果**をコピーするが、CSVファイル自体の全体スナップショットは
  取らない。盤領域・盤名称の生データが変わった場合の「なぜその盤に
  割り当てられたか」の再現は依然としてできない。gap-analysis §8で
  **Medium**優先度と評価済みであり、本Phaseのスコープ外とする)。

## 13. 次のステップ

1. 本設計のレビュー。
2. (レビュー後、別作業として)Phase B-1: migrationのみ実装
   (`0007_estimate_confirmations.sql`。書き込み/読み出しAPI・UIは含めない)。
3. (レビュー後、別作業として)Phase B-2: 確定操作のAPI設計・実装
   (§10のa/b方式の決定を含む)。
4. (レビュー後、別作業として)Phase B-3: 読み出しAPI・UI(過去snapshot参照)。

今回は設計確定までで、実装(migration/API/UI)には進んでいない。
