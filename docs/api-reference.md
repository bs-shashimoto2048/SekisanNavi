# api-reference.md — API Reference

現在mainに存在するREST APIエンドポイントの一覧。`backend/app/api/routers/*.py`から
機械的に洗い出したもので、未実装のエンドポイントは記載しない。スキーマの詳細は
`backend/app/schemas/*.py`を正としてこの文書は要約する。起動後は
`http://localhost:8000/docs`(Swagger UI、ポートは起動時の指定に依存)でも
同じ内容をインタラクティブに確認できる。

認証: 通常のGETエンドポイント(製番・図面参照等)は認証不要。`/api/settings/data-source`の
書き込み系2エンドポイントのみ管理者パスワード(`SEKISAN_NAVI_ADMIN_PASSWORD`)による
検証を要する(リクエストボディに含めて送る。HTTPヘッダ認証ではない)。

## project — `/api/project`

| Method | Path | 説明 | レスポンス |
|---|---|---|---|
| GET | `/api/project` | ダミー案件情報を1件返す(PoCでは常に単一レコード) | `ProjectInfoOut` |

`ProjectInfoOut`: `id`, `seiri_no`, `seiban`, `panel_name`, `analysis_status`
(`not_analyzed / analyzing / needs_review / confirmed`)。

## drawing-pages — `/api/drawing-pages`

| Method | Path | 説明 | レスポンス |
|---|---|---|---|
| GET | `/api/drawing-pages` | ダミーDrawingPage全件 | `list[DrawingPageOut]` |
| GET | `/api/drawing-pages/{page_id}` | 1件取得(無ければ404) | `DrawingPageOut` |
| GET | `/api/drawing-pages/{page_id}/file` | PDF実ファイル配信(`source_type='product_file'`のみ、無ければ404/500) | `application/pdf` |

`DrawingPageOut`: `id`, `drawing_file_id`, `page_no`, `drawing_type`, `drawing_name`,
`thumbnail_url`, `image_url`, `page_width`, `page_height`, `display_order`,
`source_type`(`placeholder`/`product_file`), `product_no`, `source_page_no`。

## panels — `/api/panels`

| Method | Path | 説明 | レスポンス |
|---|---|---|---|
| GET | `/api/panels` | ダミーPanel全件(可変属性`attributes[]`込み) | `list[PanelOut]` |
| GET | `/api/panels/{panel_id}` | 1件取得(無ければ404) | `PanelOut` |

`PanelOut`: `id`, `panel_no`, `name`, `primary_drawing_page_id`,
`attributes: PanelAttributeOut[]`(`key`/`label`/`value`/`unit`/`source`/`display_order`)。

## panel-areas — `/api/panel-areas`

| Method | Path | 説明 | レスポンス |
|---|---|---|---|
| GET | `/api/panel-areas` | ダミー盤範囲Overlay全件(`drawing_page_id`クエリで絞り込み可) | `list[PanelAreaOut]` |

`PanelAreaOut`: `id`, `panel_id`, `drawing_page_id`, `area_x/y/w/h`, `label`。

## detections — `/api/detections`

| Method | Path | 説明 | レスポンス |
|---|---|---|---|
| GET | `/api/detections` | Detection一覧(`drawing_page_id`クエリで絞り込み可) | `list[DetectionOut]` |
| POST | `/api/detections` | Manual BBoxを新規登録(`source_type='manual'`固定) | `DetectionOut`(201) |
| PATCH | `/api/detections/{id}` | BBox座標・引出線ラベル位置を更新(他フィールドは不変) | `DetectionOut` |
| DELETE | `/api/detections/{id}` | Detection削除(Manual/AI問わず) | 204 No Content |

`DetectionOut`: `id`, `drawing_page_id`, `panel_id`, `class_name`, `bbox_x/y/w/h`,
`confidence`, `status`(`pending/reviewed/needs_review/excluded`),
`source_type`(`ai/manual`), `master_item_id`, `leader_label_x/y`,
`master_item_category/model/code`(`estimate_master_items`からのJOIN、表示専用)。

`POST`リクエスト(`ManualDetectionCreateIn`): `drawing_page_id`, `master_item_id`,
`bbox_x/y/w/h`(0.0〜1.0、`bbox_w/h`は0.001以上、ページ範囲超過は422)。

`PATCH`リクエスト(`DetectionBBoxUpdateIn`): `bbox_x/y/w/h`(必須)、
`leader_label_x/y`(任意。省略時は既存値を保持)。

いずれの書き込み(POST/PATCH/DELETE)も、`decision_events`テーブルへ
create/bbox_edit/deleteイベントを同一トランザクションで記録する(読み出しAPIは
無い。詳細は`docs/decision-event-design.md`)。

## estimate-items — `/api/estimate-items`

| Method | Path | 説明 | レスポンス |
|---|---|---|---|
| GET | `/api/estimate-items` | ダミーEstimateItem全件(`references[]`込み) | `list[EstimateItemOut]` |

`EstimateItemOut`: `id`, `code`, `category`, `item_name`, `model`, `rating`,
`quantity`, `unit`, `source_type`(`program/ai/manual`),
`status`(`auto/confirmed/needs_review/excluded`), `confidence`,
`references: EstimateReferenceOut[]`。

**注意**: 実データ(A1GV2421等)の積算集約・積算明細画面はこのテーブルを経由しない。
Frontend側`estimateAggregationReal.ts`が`detections`×`estimate_master_items`×
外部CSVから都度計算して表示する(`docs/decision-snapshot-design.md` 2章参照)。

## master-items — `/api/master-items`

| Method | Path | 説明 | レスポンス |
|---|---|---|---|
| GET | `/api/master-items` | 積算コードMaster一覧。`q`(code/model/ratingの部分一致)・`category`でフィルタ可 | `list[EstimateMasterItemOut]` |

`EstimateMasterItemOut`: `id`, `code`, `category`, `model`, `rating`, `note`,
`total_price_a`, `box_parts_price`, `painting_price`, `setup_a`,
`sheet_metal_price`, `assembly_price`, `inspection_price`(価格系はいずれも
`float | null`。Excel側に値が無い項目はnullのまま、0や推測値で埋めない)。

## settings — `/api/settings`

| Method | Path | 説明 | 認証 | レスポンス |
|---|---|---|---|---|
| GET | `/api/settings/data-source` | 現在のデータ参照ルートと接続可否 | 不要 | `DataSourceOut` |
| PUT | `/api/settings/data-source` | データ参照ルートを変更 | 必要(`admin_password`) | `DataSourceOut` |
| POST | `/api/settings/data-source/test` | 接続テスト(`root`省略時は保存済み値をテスト) | 必要(`admin_password`) | `DataSourceTestOut` |

`DataSourceOut`: `root`, `exists`。`DataSourceTestOut`: `success`, `message`。
管理者パスワードは環境変数`SEKISAN_NAVI_ADMIN_PASSWORD`と定数時間比較され、未設定時は
常に認証失敗(fail-closed)。

## products — `/api/products`

実製番(共有フォルダ配下)を参照するエンドポイント群。`product_no`はいずれも
`^[A-Za-z0-9]{4,20}$`で検証され、パス解決は必ずBackend側(`app/services/data_source.py`)
で行う(Frontendは実パスを組み立てない)。

| Method | Path | 説明 | レスポンス |
|---|---|---|---|
| GET | `/api/products/search` | 製番の前方一致検索(`q`必須、`limit`任意) | `ProductSearchOut` |
| GET | `/api/products/{product_no}` | 製番の存在確認 | `ProductInfoOut` |
| GET | `/api/products/{product_no}/drawings` | ページ一覧(サムネイルURL・盤領域`panels[]`込み) | `list[ProductDrawingOut]` |
| GET | `/api/products/{product_no}/drawings/{page_no}/file` | PDF実ファイル配信 | `application/pdf` |
| GET | `/api/products/{product_no}/drawings/{page_no}/thumbnail` | PNGサムネイル配信 | `image/png` |
| GET | `/api/products/{product_no}/drawings/{page_no}/detected-preview` | YOLO検出結果プレビュー(該当データが無ければ空配列) | `list[DetectedPreviewItemOut]` |
| GET | `/api/products/{product_no}/estimate-panels` | 盤情報一覧(`estcode_df.csv`由来、製番単位) | `list[EstimatePanelInfoOut]` |
| POST | `/api/products/{product_no}/estimate-confirmations` | **積算確定snapshotを新規作成**(Issue #4 Phase B-2) | `EstimateConfirmationOut`(201) |

`ProductSearchOut`: `matches: string[]`, `truncated: bool`。
`ProductInfoOut`: `product_no`, `exists`, `ccv_resolved`。
`ProductDrawingOut`: `page_no`, `thumbnail_url`, `drawing_type`, `drawing_name`,
`panels: PanelPreviewOut[]`(`page_no`/`ban_menno`/`ban_no`/`ban_meisyou`/`ban_type`/
`ban_h1/h2/w/d`/`normalized_rect`)。
`DetectedPreviewItemOut`: `id`(YOLO_INDEX、DBのDetection.idとは別体系)、`page_no`,
`class_name`, `confidence`, `normalized_rect`, `source`(常に`"detected_csv"`)。
`EstimatePanelInfoOut`: `model`, `ban_menno`, `ban_no`, `ban_meisyou`, `ban_h/w/d`,
`ban_connect`, `sort_order`。

### `POST /api/products/{product_no}/estimate-confirmations` (積算確定)

リクエストボディは無し。Frontendから計算済みの値を受け取らず、Backend自身が
その時点の`detections`×`estimate_master_items`×`product_df.csv`/`estcode_df.csv`から
組み立てて保存する(`app/services/estimate_confirmation_builder.py`)。積算コードに
紐づくDetectionが1件も無い製番でも、明細0件のconfirmationとして保存できる
(0件確定を許可)。再確定は上書きせず新しいconfirmationを都度追加する
(append-only)。詳細設計は`docs/decision-snapshot-design.md`参照。

`EstimateConfirmationOut`:

```json
{
  "id": 1,
  "product_no": "A1GV2421",
  "confirmed_at": "2026-09-04 07:28:06",
  "item_count": 15,
  "items": [
    {
      "id": 1,
      "detection_id": 101,
      "drawing_page_id": 1,
      "target_id": "panel:5:5",
      "target_type": "panel",
      "ban_menno": 5,
      "ban_no": 5,
      "panel_name": "No.2-1低圧動力盤",
      "master_item_id": 10,
      "code": "11002",
      "category": "箱･単独",
      "model": "OS2- 916",
      "rating": null,
      "source_type": "manual",
      "quantity": 1,
      "unit_price": 322000.0,
      "amount": 322000.0,
      "status": "reviewed",
      "bbox_x": 0.1, "bbox_y": 0.1, "bbox_w": 0.05, "bbox_h": 0.05,
      "page_no": 16
    }
  ]
}
```

**読み出しAPIは無い**(このエンドポイントのレスポンス以外に、過去のconfirmationを
一覧・詳細取得する手段は現時点で存在しない)。

## health

| Method | Path | 説明 | レスポンス |
|---|---|---|---|
| GET | `/api/health` | 死活確認(`app/main.py`直書き、専用routerを持たない) | `{"status": "ok"}` |

## エラーレスポンスの共通方針

- 実在しないリソースへのアクセスは`404`(`{"detail": "..."}`)。
- 入力バリデーション失敗(`bbox_w`が0.001未満、ページ範囲超過等)はPydanticの
  `422 Unprocessable Entity`。
- データ参照ルートに関するエラー(`DataSourceError`のサブクラス)は、
  `InvalidProductNo`→400、`ProductNotFound`/`PageNotFound`→404、
  `RootUnavailable`→503へ変換され、内部のスタックトレースを含まない日本語メッセージを
  `detail`として返す(`app/api/routers/products.py::_error_to_http`)。
