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
export type DecisionEventType = 'create' | 'delete' | 'bbox_edit'

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
  // Issue #40 Phase 2: 図面情報マスタ(DrawingEvidenceType.key)への参照。
  // 既存データは全てnull(Phase 3の入力UI再設計以降に設定される)。
  // このPhaseではUIから設定する手段を追加していない(型定義のみ)。
  evidence_type_key: string | null
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

/** 図面情報(evidence_type_key)付きBBox登録リクエスト (Issue #40 Phase 3)。
 * `ManualDetectionCreateInput`(master_item_id経由、既存の部品台帳UI向け)とは
 * 別の入力形。`master_item_id`を持たない点で判別できる(`editHistory.ts`の
 * Undo/Redoでの分岐に利用する)。 */
export interface EvidenceDetectionCreateInput {
  drawing_page_id: number
  evidence_type_key: string
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
  ban_no: number | null
  /** 表示用の元盤番号。英字番号を含む場合はban_noがnullになる。 */
  ban_no_label?: string
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

/** 箱体型式解析で特定できた記号1件(1項目1行表示用)。
 * `backend/app/schemas/settings.py::BoxTypeSymbolMatchOut`と対応する。 */
export interface BoxTypeSymbolMatch {
  group: 'primary' | 'aux1' | 'aux2' | 'aux3'
  code: string
  meaning: string
}

/** 同一の積算対象項目に対して異なる値を主張する記号があった場合の記録。
 * `values`は`[コード, 値]`の組の配列。 */
export interface BoxTypeSpecConflict {
  field: string
  values: [string, string][]
}

/** 箱体型式(キュービクル等)の記号解析結果 (Issue #40 追加機能)。正本資料
 * 「QS-SA020-N 箱体記号一覧表 N版」に基づく解析であり、型式の記号だけから
 * 製作可否・正式承認・未記載の仕様を確定するものではない(不明・競合・
 * 曖昧な箇所は`conflicts`/`warnings`/`requires_review`に残す)。
 * `backend/app/schemas/settings.py::BoxTypeAnalysisOut`と対応する。 */
export interface BoxTypeAnalysis {
  raw: string
  normalized: string
  status: 'parsed' | 'partial' | 'ambiguous' | 'conflict' | 'unknown'
  requires_review: boolean
  primary: BoxTypeSymbolMatch | null
  aux_matches: BoxTypeSymbolMatch[]
  segments: [string, string][]
  unparsed: string[]

  box_category: string | null
  product_category: string | null
  environment: string | null
  usage: string | null
  structure: string | null

  material: string | null
  coating: string | null
  surface_treatment: string | null
  base_finish: string | null
  certification: string | null
  ip55: boolean
  processing_target: 'complete_box' | 'partial_fabrication' | 'other_vendor_product' | 'unknown'

  custom_estimate_conditions: string[]
  other_notes: string[]
  notes: string[]
  conflicts: BoxTypeSpecConflict[]
  warnings: string[]

  alternatives: BoxTypeAnalysis[]
  candidate_index: number
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
  /** [追加機能: 箱体型式解析] `model`を解析した結果。`model`がnullの場合はnull。 */
  box_type_analysis: BoxTypeAnalysis | null
}

/** material.csv (製番の材料一覧。設計データの*.boxspec由来) 1行。ページ × 材料シンボル × 構成部。
 * `material_spec`の`未記載`(.boxspecに記載なし)と`無し`(明示値)は意味が違うため、
 * Backendが返した文字列のまま保持し、表示層で区別する。`cabtype`(箱体型式)は空のことがある。 */
export interface MaterialRow {
  page: string
  source_file: string
  symbol_name: string
  cabtype: string
  component_code: string
  component_name: string
  material_spec: string
}

/** 鋼材欄の1行(構成部 × 材料仕様)。`material_spec`の`未記載`/`無し`はBackendが返した文字列のまま持つ。 */
export interface SteelItem {
  symbol_name: string
  cabtype: string
  component_name: string
  material_spec: string
}

/** 図面情報の「鋼材」欄用。製番の外形図のうち情報量が最大の1ページぶん(選択中の図面には連動しない)。
 * status: ok / empty / missing / invalid / no_outline。`source_page`はmaterial.csvのPAGEの表記のまま(文字列)。
 * `unavailable`はフロント側の取得失敗(Backendは返さない)。 */
export interface SteelOutline {
  status: 'ok' | 'empty' | 'missing' | 'invalid' | 'no_outline' | 'unavailable'
  source_page: string | null
  source_drawing_name: string | null
  items: SteelItem[]
}

/** design.csv基準の図面一覧の1行(対応するPDFがあるもの)。`key`は実在するPDFのファイル名
 * (拡張子を除く)の綴り、`page_label`は「ページ番号」(文字列。先頭ゼロ・大文字小文字はそのまま。
 * 数値にしない)。mode: inference=推論用PNGあり(`inference_page_no`で従来の表示) /
 * preview=表示用プレビューPNG(オーバーレイなし) / unavailable=表示用の画像が未作成。 */
export interface DesignPage {
  key: string
  page_label: string
  drawing_name: string
  mode: 'inference' | 'preview' | 'unavailable'
  inference_page_no: number | null
  /** 元データ(product_df.csvのBAN_MENNO/BAN_NO)の「面番号/盤番号」(`1/1`の形、重複を除き出現順)。
   * 元データに無いページ(書類ページ等)は空。再採番・加工はしない。 */
  ban_labels: string[]
}

/** 図面一覧の最上段に固定表示する書類。`key`は`0_S0`(共通製作仕様書)・`0_A1`(設計作図完了シート)のどちらかだけ。
 * 図面ページ番号ではない(数値にしない・通常の`0.pdf`とも別のファイル)。ファイルが実在するものだけが返る。 */
export interface DesignDocument {
  key: string
  kind: 'spec_sheet' | 'check_sheet'
  label: string
}

/** design.csvを基準にした図面一覧。ファイルが無い・空・不正でもエラーにならず`status`で返る
 * (例外文言・実パスは含まれない)。`documents`は最上段の書類(共通製作仕様書 → 設計作図完了シートの順。無いものは含まれない)。 */
/** ヘッダー用の製番別データ(GET /api/products/{product_no}/header)。データの無い項目はnull。 */
export interface ProductHeader {
  product_no: string
  seiri_no: string | null
  panel_name: string | null
  status: 'ok' | 'empty' | 'missing' | 'invalid'
}

export interface DesignPages {
  status: 'ok' | 'empty' | 'missing' | 'invalid'
  items: DesignPage[]
  skipped_rows: number
  documents?: DesignDocument[]
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

/** 積算確定snapshot明細1行が持つ根拠1件分 (Issue #40 Phase 6-A)。
 * `EstimateResultEvidence`のsnapshot版。BBox根拠は確定時点のDetection情報
 * (表示名解決用の`master_item_code`/`class_name`、AI/手動の取得元、BBox座標等)を
 * 非正規化コピーしたもの、設計データ根拠は`design_data_ref`のJSON文字列を
 * そのままコピーしたもの。 */
export interface EstimateConfirmationEvidence {
  id: number
  evidence_kind: EvidenceKind
  detection_id: number | null
  drawing_page_id: number | null
  source_type: DetectionSourceType | null
  evidence_type_key: string | null
  master_item_code: string | null
  class_name: string | null
  bbox_x: number | null
  bbox_y: number | null
  bbox_w: number | null
  bbox_h: number | null
  page_no: number | null
  design_data_ref: string | null
}

/** 積算確定snapshotの明細1行 (Phase B-2ではDetection単位だったが、Issue #40
 * Phase 6-AでEstimateResult単位へ移行)。Phase B-2の
 * `POST /api/products/{product_no}/estimate-confirmations`レスポンスの一部。
 * 確定時点の値をBackend側が非正規化コピーとして保存したものであり、以後
 * `estimate_master_items`が更新されてもこの値自体は変化しない
 * (`docs/decision-snapshot-design.md`参照)。
 *
 * [Issue #40 Phase 6-A] `source_type`/`status`は旧Detectionベースの行にのみ
 * 意味を持つ(EstimateResultベースの新しい行ではnull)。`current_factor`以降は
 * Phase 6-Aで追加された列で、Phase 6-A以前に確定された過去snapshotでは
 * 全てnullのまま返る(過去snapshot自体は書き換えていない)。 */
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
  source_type: DetectionSourceType | null
  quantity: number
  unit_price: number | null
  amount: number | null
  status: DetectionStatus | null
  bbox_x: number | null
  bbox_y: number | null
  bbox_w: number | null
  bbox_h: number | null
  page_no: number | null
  current_factor: number | null
  factor_overridden: boolean | null
  judgment_method: JudgmentMethod | null
  applicable_unit: ApplicableUnit | null
  judgment_reason: string | null
  source_rule_id: number | null
  result_status: EstimateResultStatus | null
  initial_quantity: number | null
  current_quantity: number | null
  quantity_overridden: boolean | null
  quantity_override_reason: string | null
  // [PR #46レビュー指摘対応] 確定時点のoverride実行時刻・actor。Phase 6後半
  // 以前の過去snapshotでは全てnullのまま返る。
  quantity_updated_at: string | null
  quantity_updated_by: string | null
  evidence: EstimateConfirmationEvidence[]
}

/** 積算確定snapshotのheader (Issue #4 Phase B-2)。製番単位でその時点の
 * 積算結果一式を丸ごと保存したもの。
 * `POST /api/products/{product_no}/estimate-confirmations`(確定操作)の
 * レスポンス形。過去snapshotの一覧・詳細取得(Phase B-4)は下記
 * `EstimateConfirmationSummary`/`EstimateConfirmationDetail`を使う。 */
export interface EstimateConfirmation {
  id: number
  product_no: string
  confirmed_at: string
  item_count: number
  items: EstimateConfirmationItem[]
}

/** 過去確定snapshot一覧の1件分 (Issue #4 Phase B-4、
 * `GET /api/products/{product_no}/estimate-confirmations`のレスポンス要素)。
 * 明細(items)は含まない一覧表示専用の軽量版。`total_amount`は明細のうち
 * `amount`がnull(単価不明)の行を除いた合計(Backend側で算出済みの値を
 * そのまま表示する。Frontend側で再計算しない)。 */
export interface EstimateConfirmationSummary {
  id: number
  product_no: string
  confirmed_at: string
  item_count: number
  total_amount: number
}

/** 過去確定snapshot詳細 (Issue #4 Phase B-4、
 * `GET /api/products/{product_no}/estimate-confirmations/{confirmation_id}`の
 * レスポンス)。保存済みの値をそのまま返すものであり、現在のEstimate Master・
 * 現在のBBox/CSVからの再計算は行わない(確定時点の再現性を保つ)。 */
export interface EstimateConfirmationDetail {
  id: number
  product_no: string
  confirmed_at: string
  item_count: number
  total_amount: number
  items: EstimateConfirmationItem[]
}

/** 判断履歴1件 (Issue #4 Phase A-2、
 * `GET /api/products/{product_no}/decision-events`のレスポンス要素)。
 * `decision_events`に保存済みの値をそのまま返すものであり、現在の
 * `detections`/`estimate_master_items`からの補完・再計算は行わない。
 * `page_no`のみBackend側でJOINして付与した表示補助情報。 */
export interface DecisionEvent {
  id: number
  occurred_at: string
  event_type: DecisionEventType
  detection_id: number
  drawing_page_id: number
  page_no: number | null
  source_type: DetectionSourceType
  master_item_id: number | null
  before_bbox_x: number | null
  before_bbox_y: number | null
  before_bbox_w: number | null
  before_bbox_h: number | null
  after_bbox_x: number | null
  after_bbox_y: number | null
  after_bbox_w: number | null
  after_bbox_h: number | null
}

/** 「資料」ウィンドウ(複数PDF参照)1件分 (`GET /api/help/reference-pdfs`)。
 * ファイル名を最初のアンダーバーで分割できた場合のみ`code`/`target`を持ち
 * `valid=true`になる。分割できない場合は両方`null`で`valid=false`
 * (Frontend側はファイル名のみを「形式不正」として表示する)。 */
export interface ReferencePdfItem {
  filename: string
  code: string | null
  target: string | null
  valid: boolean
}

/** 「資料」ポップアップの一覧API全体の応答。`folder_exists=false`(フォルダ
 * 自体が無い)と`folder_exists=true`かつ`items=[]`(フォルダはあるがPDFが
 * 無い)を区別する。 */
export interface ReferencePdfList {
  folder_exists: boolean
  items: ReferencePdfItem[]
}

// --- Issue #40 Phase 2: 積算コード選定〜数量・係数・金額/工数算出の一貫ルール化 ---
//
// 以下の型はPhase 2時点でBackend APIのレスポンス形と対応させるためだけに用意した
// ものであり、このPhaseではどのUIコンポーネントからも参照・表示しない
// (Phase 3「Viewer入力UI」/Phase 4「数量・係数・明細UI」向けの型定義のみを
// 先行して用意する。既存のViewer/積算集約/積算明細の挙動は一切変更していない)。
// 内部enum値(英語スネークケース)はBackend `app.domain.estimate_rules`と同じ値。

export type EvidenceUsage = 'estimate_target' | 'condition' | 'both'
export type JudgmentMethod = 'design_data' | 'drawing_judgment' | 'needs_confirmation'
export type JudgmentScope = 'position' | 'range' | 'panel' | 'drawing' | 'product' | 'design_data'
export type ApplicableUnit =
  | 'face'
  | 'unit'
  | 'product'
  | 'location'
  | 'sheet'
  | 'actual_quantity'
  | 'other'
export type EvidenceKind = 'detection' | 'design_data'
export type EstimateResultStatus = 'auto' | 'reviewed' | 'needs_review' | 'excluded'

/** 図面情報マスタ1件 (Issue #40 10-1章、`GET /api/drawing-evidence-types`)。 */
export interface DrawingEvidenceType {
  id: number
  key: string
  display_name: string
  category: string | null
  usage: EvidenceUsage
  default_judgment_scope: JudgmentScope
  description: string | null
  enabled: boolean
}

/** 候補マニフェスト(本番seedではない、レビュー専用)の読み取り専用ビュー
 * (Issue #40 追加修正: 図面情報追加パネルの「候補／確認待ち」表示)。`status`/
 * `blocker`はBackendがファイルの値をそのまま返す(ここで加工しない)。
 * DB由来の`DrawingEvidenceType`とは別の型にして、登録済みマスタと型レベル
 * でも混同しない。 */
export interface DrawingEvidenceTypeCandidate {
  key: string
  display_name: string
  category: string | null
  status: 'ready' | 'needs_business_confirmation' | 'blocked'
  blocker: string | null
}

/** 積算結果⇔根拠の多対多、1件分 (Issue #40 9章/12章)。 */
export interface EstimateResultEvidence {
  id: number
  evidence_kind: EvidenceKind
  detection_id: number | null
  design_data_ref: string | null
}

/** 積算結果1件 (Issue #40 12章の標準モデル、
 * `GET/POST /api/products/{product_no}/estimate-results*`)。 */
export interface EstimateResult {
  id: number
  product_no: string
  result_key: string
  master_item_id: number | null
  code: string
  // [Issue #40 Phase 6後半] `quantity`は従来通り「計算に使う現在の数量」の
  // まま(常に`current_quantity`と同じ値。既存の集約・表示コードはこの列を
  // 読むだけで手修正を自動的に反映する)。`initial_quantity`は評価器が算出
  // した自動値そのもの(再評価のたびに最新化される)。
  quantity: number
  initial_quantity: number
  current_quantity: number
  quantity_overridden: boolean
  quantity_override_reason: string | null
  // [PR #46レビュー指摘対応] factor_updated_at/factor_updated_byと同じ考え方
  // で、数量override実行時の時刻・actorを保持する(推奨案A)。
  quantity_updated_at: string | null
  quantity_updated_by: string | null
  applicable_unit: ApplicableUnit | null
  initial_factor: number
  current_factor: number
  factor_overridden: boolean
  factor_override_reason: string | null
  factor_updated_at: string | null
  factor_updated_by: string | null
  judgment_method: JudgmentMethod
  judgment_scope: JudgmentScope
  target_panel_ban_menno: number | null
  target_panel_ban_no: number | null
  target_drawing_page_id: number | null
  judgment_reason: string | null
  source_rule_id: number | null
  unit_price: number | null
  unit_labor: number | null
  price: number | null
  labor: number | null
  status: EstimateResultStatus
  /** 許容係数候補 (Issue #40 Phase 4)。`source_rule_id`が指すルールマスタの
   * `allowed_factors`をAPI応答時に展開したもの。未設定(候補未定義=自由入力)
   * の場合はnull。`source_rule_id`自体がnullの場合も常にnull。 */
  allowed_factors: number[] | null
  evidence: EstimateResultEvidence[]
}

/** `POST /api/products/{product_no}/estimate-results/evaluate`のレスポンス。
 * `skipped_rule_master_ids`はPhase 2の評価器が未実装のため評価しなかった
 * ルールの一覧(診断用)。 */
export interface EstimateResultEvaluateResponse {
  results: EstimateResult[]
  skipped_rule_master_ids: number[]
}
