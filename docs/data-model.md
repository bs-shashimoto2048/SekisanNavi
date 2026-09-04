# data-model.md — Sekisan Navi データモデル

参考資料 `20250707_積算情報収集システム_U概要.xlsx` の内容を土台にしつつ、
「確定仕様ではなく検討中の情報を整理するための参考資料」として扱った上での
PoC向けデータモデル定義。各項目のステータス(確定/暫定/未確定)は
`implementation-plan.md` にまとめている。ここでは構造そのものを説明する。

## 1. 全体ER概要

```
DrawingFile 1 ── n DrawingPage
                     │ 1
                     │
                     n
Panel 1 ── n PanelAttribute
  │ 1                    │ 1
  │ n (primary_...)       │ n
  │                       ▼
  │                  PanelArea ── n DrawingPage (盤範囲Overlay。Phase 1.5で追加)
  │
DrawingPage 1 ── n Detection ── n Panel (nullable)
                     │
                     └── n Detection.master_item_id ──> EstimateMasterItem (nullable。Phase 1.6で追加。Manual BBoxの紐付け先)

EstimateMasterItem  (積算コードの辞書。EstimateItemとは別テーブル)

EstimateItem 1 ── n EstimateReference ── (DrawingPage, Detection?, Panel?)

system_settings (key-value。Phase 1.5で追加。データ参照ルート等)

decision_events (Issue #4 Phase A-1で追加。detection_idへのFKなし=歴史的参照。
                  6.5章)

estimate_confirmations 1 ── n estimate_confirmation_items
  (Issue #4 Phase B-1で追加。confirmation_idはFKあり、detection_id等はFKなし。
   6.6章)
```

**実データ経路の注意**: 上記ERは主にPhase 0/1のダミーデータ向けテーブル構成を
表す。実製番(例: A1GV2421)の積算集約・積算明細は`EstimateItem`/
`EstimateReference`を経由せず、Frontend側`estimateAggregationReal.ts`が
`Detection`×`EstimateMasterItem`×外部CSV(`product_df.csv`/`estcode_df.csv`)から
都度計算する(`decision-snapshot-design.md` 2章)。

## 2. Drawing (図面)

### DrawingFile
元PDFファイル1つに対応する。read-only前提(要件5)。

| 列 | 説明 |
|---|---|
| id | PK |
| original_filename | 元ファイル名 |
| source_path | 共有フォルダ等の参照パス (書込み禁止・参考情報のみ) |

### DrawingPage
PDFを **ページ単位** で扱う(要件10)。図面種類ごとのグループ表示に使う
`drawing_type` を持つ。

**Phase 1.8での役割変化**: 左ペイン(DrawingNavigator)の表示自体は、Phase 1.8以降
このテーブルを直接使わなくなった (下記「ProductDrawing」参照。実製番のPNG
サムネイル一覧を都度取得して表示する)。このテーブルは、ダミーDetection/
PanelArea/EstimateItem/EstimateReference (Phase 1〜1.7で投入した検証用データ) が
`drawing_page_id` で参照する対象として残しており、Frontend側は「現在閲覧中の
実製番+実ページ番号」に一致する行があれば、その `id` を介してのみ
Detection/PanelArea/盤パラメータを取得する (一致する行が無い実製番を閲覧している
間は、単にこれらの表示が空になるだけで、無理に紐付けは行わない)。

| 列 | 説明 | 状態 |
|---|---|---|
| id | PK | 確定 |
| drawing_file_id | FK | 確定 |
| page_no | ページ番号 | 確定 |
| drawing_type | 外形図/内部機器配置図/基礎図 等 | **暫定** (Phase 1.5では実データのZUMEI列の値を元にした表示上のグルーピングであり、分類方法自体は未確定) |
| drawing_name | 表示名 | 確定 |
| thumbnail_url / image_url | サムネイル・ページ画像参照 | **未使用** (Phase 1.5ではPDF.jsが直接ファイルを読み込むため未使用のまま残置。将来サムネイル一覧を作る際に再検討) |
| page_width / page_height | PDFロード前のフォールバック表示サイズ (pt単位)。実際のOverlay座標系の基準は、PDF.jsがロード時に返す実サイズを優先する | 暫定 |
| source_type | `placeholder` (実ファイルなし) / `product_file` (実PDF参照)。Phase 1.5で追加 | 確定 (要件2の通り将来また値が増える可能性はある) |
| product_no / source_page_no | `source_type='product_file'` の場合の参照先 (データ参照ルート配下の製番・ページ番号)。Phase 1.5で追加 | 暫定 (CCVの実体が未確認のため、参照先解決ロジック自体が暫定。`data-source.md`参照) |

## 3. Panel (盤)

要件6の通り、基本情報と可変属性を分離する。

### Panel (基本情報)
| 列 | 説明 |
|---|---|
| id | PK |
| panel_no | 盤番号 |
| name | 盤名称 |
| primary_drawing_page_id | 代表的に表示する図面ページ (**暫定**。1盤が複数ページに跨る場合の扱いは未確定) |

### PanelAttribute (可変属性)
W/D/H/BAN_NOなど「将来変わりうる属性」をテーブル行として持つ。
UIコンポーネントに属性名をハードコードしないための構造(要件12)。

| 列 | 説明 | 状態 |
|---|---|---|
| key | 内部キー (例: W, D, H1, BAN_NO) | **未確定** (baninf等の実データ調査後に確定) |
| label | 画面表示名 | 暫定 |
| value | 値 (文字列で保持) | 暫定 |
| unit | 単位 (nullable) | 暫定 |
| source | design_data / ai / manual | **暫定** (値の候補自体が未確定) |
| display_order | 表示順 | 暫定 |

### PanelArea (盤範囲Overlay。Phase 1.5で追加)

「盤範囲」をPanel自体の属性として持つか、別テーブルにするかは検討した結果、
**Detectionとは独立したOverlay Layerとして扱うため別テーブル (`panel_areas`) とする**
方針にした。ただし範囲の定義方法自体は **未確定** のまま (下記参照)。

| 列 | 説明 | 状態 |
|---|---|---|
| id | PK | 確定 |
| panel_id | 対象の盤 | 確定 |
| drawing_page_id | どのページ上の範囲か | 確定 |
| area_x/y/w/h | 0.0〜1.0 の正規化座標 (architecture.md「Overlay座標系」参照) | **未確定** (実座標変換ではなく目視配置の近似値。data-source.md参照) |
| label | 表示ラベル (例: 「正面図」「背面図」) | 暫定 |

1つの盤が同一ページ内に複数の範囲 (正面/背面/側面等) を持つ実例を確認したため
(`docs/data-source.md`)、`panel_id`×`drawing_page_id` に対して複数行を許容する設計とした。

## 4. Detection (AI検出)

| 列 | 説明 | 状態 |
|---|---|---|
| id | PK | 確定 |
| drawing_page_id | 検出元ページ | 確定 |
| panel_id | 関連する盤 (nullable) | 暫定 |
| class_name | YOLO等のクラス名 | **未確定** (AI対応リストシートのクラス案は検討中) |
| bbox_x/y/w/h | 0.0〜1.0 の正規化座標 (Phase 1.5より。architecture.md「Overlay座標系」参照) | **未確定** (実座標変換ではなく目視配置の近似値) |
| confidence | 信頼度 (nullable) | 確定 (実推論未接続のため常にダミー値) |
| status | pending / reviewed / needs_review / excluded | **暫定** (Phase 1.5でneeds_reviewを追加) |
| source_type | ai / manual (Phase 1.6で追加) | 確定 (要件10で明示。Detectionは必ずai/manualのいずれか) |
| master_item_id | Manual追加時に選択されていたEstimateMasterItemへの参照 (nullable, Phase 1.6で追加) | 暫定 (要件11: 表示名称・価格情報はコピーせず参照のみ保持) |
| leader_label_x/y | 引出線ラベル帯(「コード 型式」)の表示位置。BBox本体(bbox_x/y/w/h)とは独立した0.0〜1.0正規化座標 (Phase 1.11で追加。migration `0005_leader_line.sql`) | 暫定 (未設定=NULLの場合、Frontend側がBBox右上角基準で初期位置を都度計算する。指示書10章/12章/13章) |
| master_item_category | master_item_idからJOINして得るcategory (永続化カラムではなく、APIレスポンス組み立て時に都度取得する表示専用フィールド。Phase 1.11で追加) | 暫定 (色そのものはここに含めず、Frontend側で`masterCategoryPresentation.ts`経由に都度解決する。要件2: 色の固定値コピー禁止) |
| master_item_model | 同上、master_item_idからJOINして得るmodel。引出線ラベル「コード 型式」の型式部分に使う (Phase 1.11で追加) | 暫定 (class_nameは登録時のcode固定値のため、型式は別途JOINで取得する必要がある) |
| master_item_code | master_item_idからJOINして得るcode (Phase 1.11 追加修正)。引出線の「コード」部分は`class_name`(登録時点のコピー、Master Item側のcodeが後から変わっても追従しない)より、こちらのライブJOIN結果を優先して使う | 暫定 (class_nameへ依存しすぎないための追加フィールド。異常系のみclass_nameへフォールバックする) |

Detectionは積算結果そのものではない(要件6)。EstimateItemへの変換は必ず
RuleEngine(`app/domain/rule_engine.py`)を経由する。

**Phase 1.11: BBox = 内部・編集情報 / 引出線 = 通常表示、という表示上の役割分離**。
積算Master Itemに紐づくManual BBox (`master_item_id != null`) は、中央Viewerの
通常表示ではBBox矩形を出さず、代わりに「引出線」(BBox右上角のアンカー+斜線+
水平帯+「コード 型式」の文字列) を表示する。BBox矩形自体は選択中(編集中)、
または引出線hover中にのみ一時的に表示される。この表示切替はDBスキーマの変更を
伴わない、Frontend側の表示ロジックの変更のみで実現している (`DetectionOverlay.tsx`/
`LeaderLineOverlay.tsx`参照)。AI Detection (`master_item_id === null`) の表示方式は
Phase 1.5〜1.10までと変更していない (指示書29章)。

Manual BBox (Phase 1.6) はこのDetectionテーブルへ `source_type='manual'` として
追加登録される。AI検出結果 (`source_type='ai'`) の行は一切変更しない
(`POST /api/detections` は新規行の追加のみを行う)。追加時のstatusは
「ユーザーが手動配置した時点で確認済み」という扱いで `reviewed` を既定値とする
(**暫定**。ステータス運用は今後の検討事項)。panel_idは現時点では自動推定しない
(**未確定**)。

**Phase 1.7で追加した編集操作 (削除・リサイズ)**: `source_type` による区別なく
Manual/AIどちらのDetectionも対象にできる。

- `DELETE /api/detections/{id}`: 行そのものを削除する。参照している
  `EstimateReference.detection_id` はNULLへ更新してから削除する (**暫定**:
  AI Detectionの削除を許可しているため、将来実YOLO推論を再実行すると同じ検出が
  再生成されうる。削除履歴を記憶して再推論結果から除外する仕組みは未実装)。
- `PATCH /api/detections/{id}`: `bbox_x/y/w/h` (必須)、`leader_label_x/y` (Phase 1.11
  で追加、任意) を更新可能 (他の列は変更不可)。`class_name`/`source_type`/
  `confidence`/`master_item_id` は一切変更されないため、AI Detectionをリサイズ/
  移動しても「元のAI推論結果を書き換える」ことにはならず、Sekisan Navi独自のDB上の
  座標を補正するだけの操作として扱う。`leader_label_x/y`を省略した場合は既存の
  ラベル位置を保持する (`COALESCE`。BBoxのmove/resizeがラベル位置に影響しないように
  するため)。Phase 1.11でBBox内部drag=移動 (幅・高さ不変) の保存にも同じ
  エンドポイントを流用している。詳細は `architecture.md` 13章/17章参照。

## 5. EstimateMasterItem (積算コードMaster)

Excelの「対象品目」シート等の列をそのまま持たず、必要最小限の項目に絞っている(要件14)。

**Phase 1.7で正式な参照元データへ切替**: `data/master/estimate_master_a.xlsx`
(Sheet2, 912行) を単一の正式参照元とし、`db/seed.py` にあったダミーの21件は廃止した。
インポート方法は `architecture.md` 12章 (`app/db/master_importer.py`) を参照。

| 列 | 説明 | 状態 |
|---|---|---|
| code | 積算コード。**一意キーとして採用** (Phase 1.7でUPSERTの対象キーに決定。実Excelで重複がないことを確認済み) | 実データを使用 (コード体系自体の意味は依然**未確定**) |
| category | 品名。Master Picker下部のタブ生成元として使用。列自体はnullableのままだが、**Phase 1.7追加指示でMaster Importerが対象13品名 (`app/domain/master_categories.ALLOWED_CATEGORIES`) 以外の行を取り込まなくなったため、実運用上NULLの行やこの13種類以外の値がDBに入ることはない** (品名NULLの行1件・文章形式の特殊行4件は取り込み対象外) | 確定 (13品名限定は業務指定の確定仕様) |
| ~~item_name~~ | **Phase 1.7で列自体を削除**。実Excel調査の結果、`item_name`に相当する独立列は存在せず(Phase 1.6のダミースキーマ設計時の想定違いと判明)、`model`/`rating`列で表現の役割を兼ねていたため | — |
| model | 型式 | 実データ |
| rating | 定格 | 実データ (NULLの行あり) |
| note | 備考 | 実データ (NULLの行あり) |
| total_price_a | 総合価格A | 実データ (元Excelの値をそのまま使用。値が確認できない項目はNULL) |
| box_parts_price | 箱・部品価格 | 実データ (同上) |
| painting_price | 塗装価格 | 実データ (同上) |
| setup_a | 設A | 実データ (同上) |
| sheet_metal_price | 板金 | 実データ (同上) |
| assembly_price | 組立 | 実データ (同上) |
| inspection_price | 検査 | 実データ (同上) |

**カテゴリ色 (Phase 1.10/1.11、Frontend専用・DBスキーマ変更なし)**: `category`は
DB上ではExcel由来の半角カナ・半角中点混在の原文のまま保持する。全角統一表示名・
色分けは`frontend/src/domain/masterCategoryPresentation.ts`(生成スクリプト
`gen_category_presentation_v2.py`により`ALLOWED_CATEGORIES`から生成)で一元管理する
表示専用の変換であり、DBへの書き戻しは行わない。Phase 1.10では5系統の共有色
だったが、Phase 1.11で13カテゴリすべてに重複しない固有色 (HSLで色相を分散して
算出) を割り当てた。各カテゴリは`{tabBg, tabBorder, tabFg, bboxBorder, bboxFill,
leaderColor, leaderTextColor}`の配色一式を持ち、Master Tab・Manual BBox・引出線
(`LeaderLineOverlay`)がCSSカスタムプロパティ経由で共通のこのデータを参照する
(色のHEX/RGBA値をCSSへ重複記述しない。指示書30章)。

価格・工数内訳列は、元Excel資料(Sheet2)で実際に確認できた値のみを登録し、
確認できていない項目 (例: 一部コードの価格欄) は計算値・ダミー値を生成せず
NULLのまま保持する(要件3)。将来、本格的な価格計算ロジックを実装する際は、
これらの列だけで十分か、別途「積算単価・工数マスタ」として設計し直す必要が
あるかを再検討する想定 (**未確定**)。

**使用品名の限定・取り消し線除外 (Phase 1.7 追加指示)**: 実Excel (Sheet2) の912行には
Sekisan Naviで使わない品名や、社内的に無効化された行 (コード or 品名セルに
取り消し線) が含まれることが判明したため、Master Importer側 (DB取り込み前) で
以下を除外している (Frontendで隠すだけの実装にはしていない)。
- **取り消し線行 (3件)**: コード19957/19958/19960 (いずれもコード・品名の両方に
  `cell.font.strike=True` が設定されている。文字列内容からの推測ではなく実際の
  Excelセル書式で判定)
- **対象外の品名 (4件)**: category が文章になっている特殊行4件、および
  category が空欄(NULL)の行1件のうち、取り消し線と重複していない残り分
  (19957は取り消し線でも対象外品名でも除外対象だが二重カウントはしない)

**採用する13品名と表示順** (`app/domain/master_categories.ALLOWED_CATEGORIES`。
Excel出現順・五十音順ではなく業務指定の固定順): 箱･単独 / 箱･左右 / 箱･中 /
内部ﾊﾟﾈﾙ / 底板 / 盤間の仕切・遮蔽 / 附属品加算価格 / 箱体価格倍率 / ﾊﾟﾈﾙ /
OPA用ｱﾝｸﾞﾙ枠 / 金網 / 入力（主回路銅帯） / 銅帯。

**最終取込件数・品名別内訳 (2026-08時点)**: 912行中905件を取込 (取り消し線3件・
対象外品名4件を除外)。箱･単独=230 / 箱･左右=230 / 箱･中=230 /
入力（主回路銅帯）=66 / 附属品加算価格=29 / 箱体価格倍率=19 (元21件のうち
コード19958/19960の2件が取り消し線のため除外) / 金網=21 / 銅帯=19 /
内部ﾊﾟﾈﾙ=16 / 底板=15 / 盤間の仕切・遮蔽=14 / ﾊﾟﾈﾙ=10 / OPA用ｱﾝｸﾞﾙ枠=6。

半角中点「箱･単独」(U+FF65) と全角中点「・」(U+30FB) が実データ内で混在しており、
表記ゆれとして正規化はせず元の文字をそのまま保持している (実データ忠実性を優先)。

## 6. EstimateItem / EstimateReference (積算結果 / 根拠)

| 列 (EstimateItem) | 説明 | 状態 |
|---|---|---|
| code / category / item_name / model / rating | Masterと同様の表示情報 | 暫定 |
| quantity / unit | 数量 | 暫定 (単位の扱いは未確定) |
| source_type | program / ai / manual | 確定 (要件6で明示) |
| confidence | AI由来の場合の信頼度 | 暫定 |
| status | auto / confirmed / needs_review / excluded | 確定 (要件6で明示) |

| 列 (EstimateReference) | 説明 |
|---|---|
| estimate_item_id | 対象の積算結果 |
| drawing_page_id | 根拠となる図面ページ |
| detection_id | 根拠となったDetection (nullable。programソースの場合はnullもありうる) |
| panel_id | 関連する盤 (nullable) |
| reason | 根拠の説明文 (自由記述・暫定) |

積算結果から根拠図面へ戻れる構造(要件13)を、この `EstimateReference` テーブルで実現する。

**Phase 1.7**: 参照先のDetectionが削除された場合、`detection_id` はNULLへ更新される
(EstimateItem/EstimateReference自体の行は削除しない)。UIは `detection_id` がNULLの
参照を「Detection未紐付け」として扱う (既存の `reason` 文言で表現するのみで、
専用の警告表示は今回追加していない。**暫定**)。

## 6.5. DecisionEvent (判断・修正データの最小event記録、Issue #4 Phase A-1で追加)

`detections`テーブルへのcreate/delete/bbox move・resizeの事実だけを
append-onlyで記録する専用テーブル。設計の詳細・理由付けは
`docs/decision-event-design.md`を参照。current state(`detections`本体)とは
完全に独立しており、既存の`detections`/`estimate_master_items`等への
ALTERは行っていない。

| 列 | 説明 | 状態 |
|---|---|---|
| id | PK | 確定 |
| occurred_at | イベント発生日時(`detections`テーブル自体には`created_at`/`updated_at`が無いため、対応するcreateイベント・直近のbbox_editイベントのこの値が事実上のcreated_at/updated_at相当として機能する) | 確定 |
| event_type | `create` / `delete` / `bbox_edit`(move/resizeは記録時に区別せず`bbox_edit`へ統合。前後のw/h比較で分析時に判別可能) | 確定(Phase Aの対象はこの3種のみ。積算コード変更・盤所属変更・要確認確定・状態変更・leader_label移動は対応するAPIが無い、またはPhase Aの対象外のため記録されない) |
| detection_id | 対象のDetection id | **意図的に外部キー制約を持たない**(`PRAGMA foreign_keys=ON`環境で、delete記録時に自己参照によりFK違反が発生するのを避けるため。削除後は下記の非正規化コピー列だけで解釈する) |
| drawing_page_id / source_type / master_item_id | いずれもイベント発生時点の値の非正規化コピー(Detectionが削除された後もこのイベント単体で解釈できるようにするため、現在の`detections`/`estimate_master_items`へは依存しない) | 確定 |
| before_bbox_x/y/w/h | 変更前のBBox。createイベントではNULL(作成前は何も無い) | 確定 |
| after_bbox_x/y/w/h | 変更後のBBox。deleteイベントではNULL(削除後は何も無い) | 確定 |

**bbox自体が実際に変化しない更新は記録しない**: `PATCH /api/detections/{id}`
はBBox本体と引出線ラベル位置(leader_label_x/y)を同一リクエストで更新できるが、
leader_label_x/yのみを変更しbbox_x/y/w/hが更新前と同一値のまま送られてきた
場合は、before==afterの無意味な`bbox_edit`イベントを記録しない。

**Undo/Redoは特別扱いしない**: Frontend側(`editHistory.ts`)のUndo/Redoは
既存のAPI(create/delete/PATCH)をもう一度呼ぶだけで実現されているため、
通常の操作と全く同じイベントとしてそのまま記録される。ただし
create/deleteのUndo/RedoはSQLiteの`AUTOINCREMENT`により新しい`detection_id`が
払い出されるため、同じ物理的なBBoxのevent履歴が`detection_id`をまたいで
分断される(bbox_editのUndo/Redoは同一`detection_id`のまま連続する)。

**読み出しAPIは無い(Phase A-1時点)**: このテーブルを返すAPIエンドポイントは
今回追加していない。Phase A-2で検討する。

## 6.6. EstimateConfirmation / EstimateConfirmationItem (積算確定snapshot、Issue #4 Phase B-1で追加)

製番(`product_no`)単位で、確定操作を行った時点の積算結果一式を丸ごと
コピー保存する専用テーブル。設計の詳細・理由付けは
`docs/decision-snapshot-design.md`を参照。current state(`detections`/
`estimate_master_items`)・event history(`decision_events`)のいずれとも
完全に独立しており、既存テーブルへのALTERは行っていない。

`estimate_items`/`estimate_references`(Phase 0/1のダミー専用テーブル)は
対象にしない。実データの積算集約はこれらを経由せず、Frontend側
`estimateAggregationReal.ts::buildRealEstimateAggregation`が`detections`×
`estimate_master_items`×外部CSVから都度計算しているため、snapshotも
Detection単位(積算明細`detailItems`相当)の粒度で保存する。

### estimate_confirmations (header)

| 列 | 説明 | 状態 |
|---|---|---|
| id | PK | 確定 |
| product_no | 製番。`drawing_pages.product_no`と同じ、正規化テーブルを持たない生の文字列 | 確定 |
| confirmed_at | 確定日時 | 確定 |

1回の確定操作 = 1行。**再確定は上書きせず、都度新しい行を追加する
(append-only)**。既存行を更新・削除する操作は実装していない。

### estimate_confirmation_items (明細、Detection単位)

| 列 | 説明 | 状態 |
|---|---|---|
| id | PK | 確定 |
| confirmation_id | 対象の`estimate_confirmations.id`。header行が常に先にINSERTされる設計のため、**FK制約あり**(decision_eventsのような自己参照削除の問題が起きないため) | 確定 |
| detection_id / drawing_page_id | 歴史的参照。`decision_events`と同じ理由で**意図的にFK制約を持たない**(確定後にDetectionが削除されてもsnapshot行自体は残す) | 確定 |
| target_id / target_type / ban_menno / ban_no / panel_name | 確定時点のBBox所属判定結果の非正規化コピー(`product_df.csv`/`estcode_df.csv`が将来変わっても所属は固定される) | 確定 |
| master_item_id | 参考情報のみ(FKなし)。表示・金額の再現は下記の非正規化コピー列自体を使う | 確定 |
| code / category / model / rating | 確定時点の積算コード表示情報の非正規化コピー(`estimate_master_items`の再UPSERT後も変化しない) | 確定 |
| source_type | 確定時点のDetection.source_type(ai/manual) | 確定 |
| quantity | Detection単位の行のため常に1(将来の拡張余地として列を残す) | 確定 |
| unit_price / amount | 確定時点の`estimate_master_items.total_price_a`のコピー、およびその金額。値が無い場合はNULL(0円へ捏造しない) | 確定 |
| status | 確定時点のDetection.status(○/△/×の元値) | 確定 |
| bbox_x/y/w/h / page_no | 確定時点のBBox座標・ページ番号の非正規化コピー(図面参照はベストエフォート) | 確定 |

**確定操作を呼び出すAPI(Phase B-2で追加)**: `POST /api/products/{product_no}/
estimate-confirmations`。リクエストボディは受け取らず、Backend自身が
その時点の`detections`×`estimate_master_items`×`product_df.csv`/
`estcode_df.csv`から確定snapshotを組み立てて保存する
(`app/services/estimate_confirmation_builder.py`。Frontendから計算済みの値を
信頼して丸ごと受け取る方式は採用しなかった)。0件確定(積算コードに紐づく
Detectionが1件も無い製番の確定)も許可する。

**読み出しAPIは無い(Phase B-2時点)**。過去snapshotの一覧・詳細を返す
APIエンドポイントは今回追加していない。Phase B-3で検討する
(`docs/decision-snapshot-design.md` 11章/13章)。

## 7. system_settings (Phase 1.5で追加)

管理者が変更可能なシステム共通設定を key-value で保持する。

| 列 | 説明 |
|---|---|
| key | 設定キー (現状は `data_source_root` のみ) |
| value | 設定値 (文字列) |
| updated_at | 更新日時 |

管理者パスワード等の認証情報はこのテーブルに **含めない** (要件13)。
環境変数 (`SEKISAN_NAVI_ADMIN_PASSWORD`) のみで管理する。

## 8. ProductDrawing / PanelPreview (Phase 1.8で追加。DB永続化なしのAPIモデル)

製番配下の実PNGサムネイル・盤領域Overlayを表すモデル。SQLiteへ永続化するテーブルは
なく、`GET /api/products/{product_no}/drawings` が都度、実ファイル一覧と
`product_df.csv` から組み立てて返す (`architecture.md` 参照)。

### ProductDrawing (1ページ相当)
| 項目 | 説明 | 状態 |
|---|---|---|
| page_no | ページ番号 (`{page_no}.png`/`.pdf` のファイル名由来) | 確定 |
| thumbnail_url | サムネイル取得API (`/api/products/{product_no}/drawings/{page_no}/thumbnail`) | 確定 |
| drawing_type | product_df.csvのZUMEI列から、末尾の連番接尾辞 (`(1-1)`等) を除いたグループ名。左ペインのグループ見出しに使用 | 暫定 (ZUMEIの命名規則自体は今後変わりうる) |
| drawing_name | ZUMEI列そのもの (接尾辞を除去しない)。中央Viewerの見出しに使用 | 暫定 (同上) |
| panels | このページに属するPanelPreviewの配列。**1ページに複数存在する場合は全件を保持し、先頭1件へ削減しない** (要件11) | 確定 |

drawing_type/drawing_nameは、対応するproduct_df.csvの行が無いページ (稀なケース) では
`null` になる。この場合、左ペインは「その他」グループへ分類する (ダミー値を捏造しない)。

### PanelPreview (盤領域1件、product_df.csvの1行相当)
| 項目 | 説明 | 状態 |
|---|---|---|
| page_no | PAGE列 (Phase 1.9追加。右ペイン盤パラメータ表示・盤の識別キー`panelKey`用) | 確定 (実データそのまま) |
| ban_menno | BAN_MENNO列 | 確定 (実データそのまま) |
| ban_no | BAN_NO列 | 確定 (実データそのまま) |
| ban_meisyou | BAN_MEISYOU列。Phase 1.9で常時表示ラベルからは外し、盤領域のTooltip・右ペインへ表示先を変更した | 暫定 (座標計算には使わないため欠損していても行はスキップしない。空文字列で保持) |
| ban_type | BAN_TYPE列 (正面図/背面図/側面図/基礎図等)。Tooltip・右ペイン・`panelKey`の一意性確保に使用 (同一PAGE/BAN_MENNO/BAN_NOに複数view=複数行が実在するため) | 暫定 (同上) |
| ban_h1 / ban_h2 / ban_w / ban_d | BAN_H1/BAN_H2/BAN_W/BAN_D列 (Phase 1.9追加)。右ペイン盤パラメータの寸法表示用 | 暫定 (座標計算には使わない表示専用項目。欠損・非数値は`null`として保持し、行全体はスキップしない) |
| normalized_rect | 0.0〜1.0正規化座標 (`{x, y, w, h}`、DOM/画像の左上原点)。`data-source.md` 5.1章の変換式で算出済み | 確定 (変換式は実データ検算により確定。座標算出の元データ自体(KITEN_X/Y等)の意味は`product_df.csv`のドキュメント化が今後の課題) |

**Phase 1.9でのラベル/Tooltip/選択の扱い変更**: 盤領域Overlay内の常時表示ラベルは
`{ban_menno}/{ban_no}` の1行のみとし (旧: `{ban_meisyou} / {ban_type}` +
`{ban_menno} / {ban_no}` の2行)、`ban_meisyou`/`ban_type`/`page_no`は各領域の
`title`属性 (Tooltip) へ移した (値が空の項目は行ごと省略)。各`PanelPreview`は
product_df.csvの1行にそのまま対応するため、1ページに複数の盤がある場合も
Tooltip・右ペインには対応する行の値が個別に表示され、代表値の使い回しにはならない。
盤のクリック選択時の識別キーは `panelKey(panel, index)` =
`${page_no}:${ban_menno}:${ban_no}:${ban_type}:${index}` で、生配列インデックス
単体には依存しない (`utils/panel.ts`)。

Backend内部 (`app/services/product_df.py`) では、診断用にKITEN_X/Y・SCALE_X/Y等の
元の値も `PanelAreaFromDf` dataclass として保持しているが、API応答には含めていない
(Frontendは正規化座標+表示専用項目のみを使えばよいため。要件28: Frontendへ生データを
渡さない)。

### 8.5. DetectedPreviewItem (Phase 1.12で追加。DB永続化なしのAPIモデル)

`detected_df.csv` (実行済みYOLO推論の出力) 由来の検出BBoxプレビュー。
DrawingPageと同じくSQLiteへの永続化テーブルは持たず、
`GET /api/products/{product_no}/drawings/{page_no}/detected-preview` が
都度、`detected_df.csv` + `product_df.csv`のSCALE_X/SCALE_Yから組み立てて返す
(`architecture.md`参照)。

| 項目 | 説明 | 状態 |
|---|---|---|
| id | ページ内のYOLO_INDEXそのもの。**DBの`Detection.id`とは別体系**であり、混同しない | 確定 |
| page_no | PAGE列 | 確定 (実データそのまま) |
| class_name | DEVICE列 (例: roof_fan, panel, transformer) | 確定 (実データそのまま) |
| confidence | SCORE列 (0.0〜1.0) | 確定 (実データそのまま) |
| normalized_rect | 0.0〜1.0正規化座標。detected_df.csvの4隅座標をSCALE_X/SCALE_Yで
  補正しY軸反転した後、`{page}.png`の実px原寸(product_df.csvのFRAME_MINI_X/Y)で
  正規化して算出 (`docs/implementation-plan.md` 8.13章に実データでの検算・
  Pillow合成による目視確認の記録あり) | 確定 (座標変換式は実データ検算により確定) |
| source | 常に`"detected_csv"`固定。既存`Detection.source_type`('ai'/'manual')とは
  別の体系であることを明示するための識別値 | 確定 |

**既存`detections`テーブルとの関係 (要件15/16)**: このモデルはDBの`detections`
テーブルとは完全に独立した別データ源であり、今回のPhaseではDBへのコピー・
同期は行わない (読み取り専用の都度計算)。Phase 1.5由来のseedデータ(page16の
ダミーAI Detection)と、実データのdetected_df.csvが同じページで概念上重複しうる
既知の残課題があり、詳細は`implementation-plan.md` 8.13章に記載している。

### 8.6. EstimatePanelInfo (Phase 1.14で追加。DB永続化なしのAPIモデル)

`estcode_df.csv` (盤ごとの積算コード基本情報) 由来の盤情報。DrawingPage/
DetectedPreviewItemと同じくSQLiteへの永続化テーブルは持たず、
`GET /api/products/{product_no}/estimate-panels` が都度、`estcode_df.csv`から
組み立てて返す。**PAGE列を持たない製番単位のデータ**であるため(1つの盤は複数
ページ(矢視違い)に登場しうるが、estcode_df上の盤情報行は1つだけ)、他のAPI
(drawings/detected-preview等)と異なりページ番号は受け取らず、製番配下の全盤を
まとめて返す。

| 項目 | 説明 | 状態 |
|---|---|---|
| model | MODEL列 (例: "IS2") | 確定 (実データそのまま) |
| ban_menno | BAN_MENNO列。product_df.csvの同名列と値・意味とも完全に一致することを
  実データ(A1GV2421)で確認済み (盤情報の紐付けキー) | 確定 |
| ban_no | BAN_NO列。CSV上は"5.0"のようなfloat表記だが、product_df.py/
  detected_df.pyと同じくfloat経由でintへ丸めて保持する | 確定 |
| ban_meisyou | BAN_MEISYOU列 (盤名称) | 確定 (実データそのまま) |
| ban_h / ban_w / ban_d | BAN_H/BAN_W/BAN_D列 (盤寸法、単位mm)。表示専用の数値
  項目のため、欠損・非数値でも行全体はスキップせず個別に`null`として保持する | 確定 |
| ban_connect | BAN_CONNECT列 (接続情報。例: "箱･左右(L)") | 確定 (実データそのまま) |
| sort_order | SORT_ORDER列 (並び順) | 確定 (実データそのまま。欠損時は`null`) |

Backend内部 (`app/services/estcode_df.py`) では、estcode_df.csvが持つ他の列
(PANEL/TRANS/IN_PANEL/...INPUT_CU_COEFF等、盤の内訳フラグ・係数と見られる列)は
今回未使用であり、API応答にも含めていない。将来の積算集約ロジック実装時に
必要になれば追加検討する。

**紐付けキーの一意性**: `A1GV2421/estcode_df.csv`(実データ全5行)で
`ban_menno + ban_no`の組み合わせに重複は無いことを確認済み。同一製番内であれば
盤ごとに1行のみ存在する構造であり、`sort_order`等の追加キーは不要と判断した。

**既存表示との関係 (指示書13章)**: 実製番表示中の右ペイン上部(`PanelInfo`)は
このモデルを正とし、product_df.csv由来の旧盤パラメータ表示(表示種別・H1/H2個別
行等)とは二重に出さない。

## 9. 未確定・今後の検討事項まとめ

- 積算コード体系そのもの (11xxx/18xxx/44xxx 等の桁の意味) は未確定。
- AI検出クラス名・クラス構成は検討中 (AI対応リストシート・参考資料PDF参照。
  クラスごとに「保留」「対応困難」等の注記があり確定していない)。
- 盤の「範囲」をどう表現するか: `panel_areas` テーブルとして分離したが、座標算出方法
  (実CAD座標からの変換か、目視配置か) は未確定。
- PanelAttributeのkey命名規則 (baninf等の実データ形式に合わせるか、独自定義にするか)。
- 価格・工数計算そのものをシステムに含めるか、外部Excelとの連携に留めるか。
- 「CCV」の実体 (`docs/data-source.md` 参照・最重要の未確認事項)。
- Detection/PanelAreaの座標を実際のAI検出結果 (CAD実座標系) から機械的に算出する方法
  (切り出しオフセットが不明なため未確立。`docs/data-source.md` 5章)。
- Manual BBox追加時のstatus既定値 ('reviewed' 固定としているが運用上適切か未検討)。
- Manual BBoxのpanel_id自動推定方法 (現状は常にnull)。
- Manual BBoxをEstimateItem/EstimateReferenceへどう昇格させるか (Phase 1.6では
  「積算コードを選択して図面上へBBoxを登録する」ところまでで、EstimateItemの
  自動生成・数量/価格確定ロジックは未実装。要件19)。
- AI Detection削除の「削除履歴」を再推論時にどう扱うか (Phase 1.7では削除操作自体は
  実装したが、再推論で同じ検出が復活する可能性についての対策は未実装。要件28)。
- EstimateReference.detection_idがNULLになった行をUI上でどう明示するか
  (Phase 1.7では専用の警告表示までは実装していない)。
- 使用13品名リスト自体の妥当性・将来の追加/削除方針 (Phase 1.7追加指示では
  「現時点でこの13種類のみ使用する」という業務指定を確定事項として反映したが、
  リストの変更が今後発生するかどうかは未確定。変更時は
  `app/domain/master_categories.py` を直接編集する運用を想定している)。
- 既存Manual BBoxが対象外化されたMaster Itemを参照している場合の扱い
  (Phase 1.7追加指示では「削除せず残す」対応のみ実装。inactiveフラグ等による
  明示的な無効化表示は未実装 — 該当があれば起動時ログ・完了報告で個別に周知する運用)。
- 製番検索でメイン画面の参照製番を切り替えた際、ダミーDetection/PanelArea/
  盤パラメータ/Manual BBox追加は「対応するダミーDrawingPage行がある場合のみ」
  有効になる仕様とした (Phase 1.8)。デモ製番(A1GV2421)以外を閲覧する場合、
  これらの機能が使えないのは意図した挙動であり不具合ではない。
- product_df.csvのBAN_TYPE (正面図/背面図/側面図/基礎図等) ごとの
  DETECT_AREA_X/Yの意味の厳密な定義 (実データ検算で推定した内容は
  `docs/data-source.md` 5.1章に記載したが、公式な列定義書は未入手のため
  「未確認だが実データと矛盾しない」という位置づけに留まる)。
