// ドメイン型定義 (PoC)
//
// backend/app/schemas/common.py のAPIレスポンスと対応する。
// ステータス等の値候補は暫定であり、確定仕様ではない。
// (docs/data-model.md 参照)

export type AnalysisStatus = 'not_analyzed' | 'analyzing' | 'needs_review' | 'confirmed'
export type AttributeSource = 'design_data' | 'ai' | 'manual'
export type DetectionStatus = 'pending' | 'reviewed' | 'needs_review' | 'excluded'
export type EstimateSourceType = 'program' | 'ai' | 'manual'
export type EstimateStatus = 'auto' | 'confirmed' | 'needs_review' | 'excluded'
export type DrawingPageSourceType = 'placeholder' | 'product_file'
export type DetectionSourceType = 'ai' | 'manual'

export interface ProjectInfo {
  id: number
  seiri_no: string
  seiban: string
  panel_name: string
  analysis_status: AnalysisStatus
}

export interface DrawingPage {
  id: number
  drawing_file_id: number
  page_no: number
  drawing_type: string
  drawing_name: string
  thumbnail_url: string | null
  image_url: string | null
  page_width: number
  page_height: number
  display_order: number
  source_type: DrawingPageSourceType
  product_no: string | null
  source_page_no: number | null
}

// 盤範囲 (Panel Overlay)。仕様未確定 (docs/data-model.md 参照)。
// 座標は Detection と同じく 0.0〜1.0 の正規化座標。
export interface PanelArea {
  id: number
  panel_id: number
  drawing_page_id: number
  area_x: number
  area_y: number
  area_w: number
  area_h: number
  label: string | null
}

export interface PanelAttribute {
  id: number
  key: string
  label: string
  value: string
  unit: string | null
  source: AttributeSource
  display_order: number
}

export interface Panel {
  id: number
  panel_no: string
  name: string
  primary_drawing_page_id: number | null
  attributes: PanelAttribute[]
}

export interface Detection {
  id: number
  drawing_page_id: number
  panel_id: number | null
  class_name: string
  bbox_x: number
  bbox_y: number
  bbox_w: number
  bbox_h: number
  confidence: number | null
  status: DetectionStatus
  source_type: DetectionSourceType
  master_item_id: number | null
  // Phase 1.11: 引出線ラベル帯の表示位置。BBox本体(bbox_x/y/w/h)とは独立した
  // 0.0〜1.0正規化座標。未設定(null)の場合、Frontend側でBBox右上角を基準に
  // 初期位置を自動計算する (指示書12章/13章)。
  leader_label_x: number | null
  leader_label_y: number | null
  // Phase 1.11: master_item_idからBackendがJOINして返すcategory。色そのものは
  // ここに含まれず、Frontend側で`getCategoryPresentation(category)`により
  // 都度解決する (要件2: 色を固定値としてコピーしない)。
  master_item_category: string | null
  // Phase 1.11: master_item_idからJOINして得たmodel。引出線ラベル「コード 型式」
  // (master_item_code + master_item_model) の表示に使う。
  master_item_model: string | null
  // Phase 1.11 追加修正: master_item_idからJOINして得たcode。引出線の「コード」表示は
  // class_name(登録時点のコピー)より、こちらのライブJOIN結果を優先する
  // (指示書12章/14章)。class_nameへ依存しすぎない。
  master_item_code: string | null
}

// Manual BBox登録リクエスト (Phase 1.6)。座標は0.0〜1.0の正規化座標。
export interface ManualDetectionCreateInput {
  drawing_page_id: number
  master_item_id: number
  bbox_x: number
  bbox_y: number
  bbox_w: number
  bbox_h: number
}

// Phase 1.7: data/master/estimate_master_a.xlsx (Sheet2) を正式な参照元とする。
// 実データにitem_nameに相当する列はないため削除、categoryは1件だけ空欄行が
// 存在することを確認したためnullableとした (docs/data-model.md参照)。
export interface EstimateMasterItem {
  id: number
  code: string
  category: string | null
  model: string | null
  rating: string | null
  note: string | null
  // 価格・工数内訳 (Phase 1.6)。元データに値がない場合はnull (ダミー値は生成しない)。
  total_price_a: number | null
  box_parts_price: number | null
  painting_price: number | null
  setup_a: number | null
  sheet_metal_price: number | null
  assembly_price: number | null
  inspection_price: number | null
}

export interface EstimateReference {
  id: number
  drawing_page_id: number
  detection_id: number | null
  panel_id: number | null
  reason: string | null
}

export interface EstimateItem {
  id: number
  code: string
  category: string
  item_name: string
  model: string | null
  rating: string | null
  quantity: number
  unit: string | null
  source_type: EstimateSourceType
  confidence: number | null
  status: EstimateStatus
  references: EstimateReference[]
}

// --- Phase 1.5: データ参照設定・製番アクセス ---

export interface DataSourceSetting {
  root: string
  exists: boolean
}

export interface DataSourceTestResult {
  success: boolean
  message: string
}

export interface ProductInfo {
  product_no: string
  exists: boolean
  ccv_resolved: boolean
}

// 盤領域Overlay情報 (Phase 1.8)。product_df.csvの1行相当。
// 正規化座標 (0.0〜1.0、DOM/画像の左上原点) はBackend側で変換済みのものを受け取る。
export interface PanelPreview {
  // 所属ページ番号。盤選択の識別・右ペイン表示に使う (Phase 1.9)。
  page_no: number
  ban_menno: number
  ban_no: number
  // 盤領域Overlay内ラベル・Tooltip・右ペイン表示用 (盤領域内表示の追加指示、Phase 1.9)。
  ban_meisyou: string
  ban_type: string
  // 右ペイン「盤パラメータ」表示用の物理寸法 (Phase 1.9)。product_dfに値が無い場合はnull。
  ban_h1: number | null
  ban_h2: number | null
  ban_w: number | null
  ban_d: number | null
  normalized_rect: { x: number; y: number; w: number; h: number }
}

export interface ProductDrawing {
  page_no: number
  thumbnail_url: string
  drawing_type: string | null
  drawing_name: string | null
  panels: PanelPreview[]
}

// 製番の前方一致検索結果 (Phase 1.8)。
export interface ProductSearchResult {
  matches: string[]
  truncated: boolean
}

/** estcode_df.csv (盤ごとの積算コード基本情報) 由来の盤情報 (Phase 1.14)。
 * PAGE列を持たない製番単位のデータのため、`ban_menno`/`ban_no`で選択中盤
 * (product_df由来のPanelPreview) と突き合わせて使う。CSVの列名(MODEL/BAN_H等)を
 * そのままFrontendの型名として使っているが、日本語ラベルへの変換は表示層
 * (`PanelInfo.tsx`のJSX) でのみ行い、この型自体には持たせない。 */
export interface EstimatePanelInfo {
  model: string | null
  ban_menno: number
  ban_no: number
  ban_meisyou: string | null
  ban_h: number | null
  ban_w: number | null
  ban_d: number | null
  ban_connect: string | null
  sort_order: number | null
}

/** detected_df.csv (YOLO検出結果) 由来の検出BBoxプレビュー (Phase 1.12)。
 * DBの`Detection`とは別データ源であり、`id`はDBのDetection.idとは異なる体系
 * (ページ内のYOLO_INDEXそのもの) であることに注意 (混同して同一視しない)。
 * 表示専用の読み取りデータであり、リサイズ・削除・Master紐付けの対象にはならない。 */
export interface DetectedPreviewItem {
  id: number
  page_no: number
  class_name: string
  confidence: number
  normalized_rect: { x: number; y: number; w: number; h: number }
  source: string
}

// 積算確定snapshot (Issue #4 Phase B)。'product'/'panel'/'tie'は
// `types/estimateAggregation.ts::EstimateTargetType`と同じ3値。
export type EstimateTargetType = 'product' | 'panel' | 'tie'

/** 積算確定snapshotの明細1行 (Detection単位。Phase B-2の
 * `POST /api/products/{product_no}/estimate-confirmations`レスポンスの一部)。
 * 確定時点の値をBackend側が非正規化コピーとして保存したものであり、以後
 * `estimate_master_items`が更新されてもこの値自体は変化しない
 * (`docs/decision-snapshot-design.md`参照)。 */
export interface EstimateConfirmationItem {
  id: number
  detection_id: number | null
  drawing_page_id: number | null
  target_id: string
  target_type: EstimateTargetType
  ban_menno: number | null
  ban_no: number | null
  panel_name: string | null
  master_item_id: number | null
  code: string
  category: string | null
  model: string | null
  rating: string | null
  source_type: DetectionSourceType
  quantity: number
  unit_price: number | null
  amount: number | null
  status: DetectionStatus
  bbox_x: number | null
  bbox_y: number | null
  bbox_w: number | null
  bbox_h: number | null
  page_no: number | null
}

/** 積算確定snapshotのheader (Issue #4 Phase B-2)。製番単位でその時点の
 * 積算結果一式を丸ごと保存したもの。読み出しAPIは無い(Phase B-2時点)ため、
 * `POST /api/products/{product_no}/estimate-confirmations`のレスポンスとして
 * のみ得られる。 */
export interface EstimateConfirmation {
  id: number
  product_no: string
  confirmed_at: string
  item_count: number
  items: EstimateConfirmationItem[]
}
