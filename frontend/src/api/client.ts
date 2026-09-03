// バックエンドAPIクライアント (PoC)
//
// React Query等は導入せず、fetchの薄いラッパーに留めている。
// 将来データ量が増えてキャッシュ戦略が必要になった時点で見直す。
import type {
  DataSourceSetting,
  DataSourceTestResult,
  Detection,
  DetectedPreviewItem,
  DrawingPage,
  EstimateItem,
  EstimateMasterItem,
  EstimatePanelInfo,
  ManualDetectionCreateInput,
  Panel,
  PanelArea,
  ProductDrawing,
  ProductInfo,
  ProductSearchResult,
  ProjectInfo,
} from '../types/domain'

// 既定では相対パス ('') を使い、開発時はVite devサーバーの `/api` プロキシ
// (vite.config.ts, VITE_BACKEND_URLで設定) 経由で同一オリジンとして呼び出す。
// これにより開発中のCORS設定に依存せずに済む。Frontend/Backendを別ホストへ
// 分離配置する場合等は VITE_API_BASE_URL に絶対URLを指定すれば上書きできる。
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function extractErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.detail === 'string') return body.detail
  } catch {
    // ignore JSON parse failure, fall back to generic message
  }
  return `API error: ${res.status}`
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`)
  if (!res.ok) {
    throw new ApiError(res.status, await extractErrorMessage(res))
  }
  return (await res.json()) as T
}

async function sendJson<T>(
  path: string,
  method: 'PUT' | 'POST' | 'PATCH',
  body: unknown,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new ApiError(res.status, await extractErrorMessage(res))
  }
  return (await res.json()) as T
}

async function sendNoContent(path: string, method: 'DELETE'): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, { method })
  if (!res.ok) {
    throw new ApiError(res.status, await extractErrorMessage(res))
  }
}

export function fetchProjectInfo(): Promise<ProjectInfo> {
  return getJson('/api/project')
}

export function fetchDrawingPages(): Promise<DrawingPage[]> {
  return getJson('/api/drawing-pages')
}

export function drawingPageFileUrl(pageId: number): string {
  return `${BASE_URL}/api/drawing-pages/${pageId}/file`
}

export function fetchPanels(): Promise<Panel[]> {
  return getJson('/api/panels')
}

export function fetchPanel(panelId: number): Promise<Panel> {
  return getJson(`/api/panels/${panelId}`)
}

export function fetchPanelAreas(drawingPageId?: number): Promise<PanelArea[]> {
  const query = drawingPageId != null ? `?drawing_page_id=${drawingPageId}` : ''
  return getJson(`/api/panel-areas${query}`)
}

export function fetchDetections(drawingPageId?: number): Promise<Detection[]> {
  const query = drawingPageId != null ? `?drawing_page_id=${drawingPageId}` : ''
  return getJson(`/api/detections${query}`)
}

export function fetchEstimateItems(): Promise<EstimateItem[]> {
  return getJson('/api/estimate-items')
}

export function fetchMasterItems(params: { q?: string; category?: string }): Promise<EstimateMasterItem[]> {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.category) search.set('category', params.category)
  const qs = search.toString()
  return getJson(`/api/master-items${qs ? `?${qs}` : ''}`)
}

// Manual BBox登録 (Phase 1.6)。
export function createManualDetection(input: ManualDetectionCreateInput): Promise<Detection> {
  return sendJson('/api/detections', 'POST', input)
}

// BBoxリサイズ/移動保存 (Phase 1.7)。Manual/AIの双方が対象。
// Phase 1.11: 引出線ラベル位置(leader_label_x/y)の保存にも同じエンドポイントを使う。
// 省略した場合、Backend側で既存のラベル位置を保持する (BBox位置とは独立)。
export function updateDetectionBBox(
  detectionId: number,
  rect: {
    bbox_x: number
    bbox_y: number
    bbox_w: number
    bbox_h: number
    leader_label_x?: number
    leader_label_y?: number
  },
): Promise<Detection> {
  return sendJson(`/api/detections/${detectionId}`, 'PATCH', rect)
}

// Detection削除 (Phase 1.7)。Manual/AIの双方が対象。
export function deleteDetection(detectionId: number): Promise<void> {
  return sendNoContent(`/api/detections/${detectionId}`, 'DELETE')
}

// --- Phase 1.5: データ参照設定 (システム設定画面) ---

export function fetchDataSource(): Promise<DataSourceSetting> {
  return getJson('/api/settings/data-source')
}

export function updateDataSource(root: string, adminPassword: string): Promise<DataSourceSetting> {
  return sendJson('/api/settings/data-source', 'PUT', { root, admin_password: adminPassword })
}

export function testDataSourceConnection(
  root: string | undefined,
  adminPassword: string,
): Promise<DataSourceTestResult> {
  return sendJson('/api/settings/data-source/test', 'POST', {
    root: root ?? null,
    admin_password: adminPassword,
  })
}

// --- Phase 1.5: 製番を指定した実データ参照 ---

export function fetchProductInfo(productNo: string): Promise<ProductInfo> {
  return getJson(`/api/products/${encodeURIComponent(productNo)}`)
}

export function fetchProductDrawings(productNo: string): Promise<ProductDrawing[]> {
  return getJson(`/api/products/${encodeURIComponent(productNo)}/drawings`)
}

export function productDrawingFileUrl(productNo: string, pageNo: number): string {
  return `${BASE_URL}/api/products/${encodeURIComponent(productNo)}/drawings/${pageNo}/file`
}

/** detected_df.csv (YOLO検出結果) 由来の検出BBoxプレビュー (Phase 1.12指示書25章)。
 * 該当ページの検出結果が無い場合(detected_df.csv自体が無い場合含む)は
 * エラーではなく空配列が返る (Backend側で保証済み)。 */
export function fetchDetectedPreview(productNo: string, pageNo: number): Promise<DetectedPreviewItem[]> {
  return getJson(`/api/products/${encodeURIComponent(productNo)}/drawings/${pageNo}/detected-preview`)
}

/** estcode_df.csv (盤ごとの積算コード基本情報) 由来の盤情報 (Phase 1.14指示書25章)。
 * PAGE列を持たない製番単位のデータのため、pageNoは受け取らない。製番配下の全盤を
 * まとめて返す (Frontend側で選択中盤のban_menno/ban_noと突き合わせる)。 */
export function fetchEstimatePanels(productNo: string): Promise<EstimatePanelInfo[]> {
  return getJson(`/api/products/${encodeURIComponent(productNo)}/estimate-panels`)
}

// --- Phase 1.8: 製番検索・左ペインPNGサムネイル ---

// ルート直下の製番を無条件全件取得しない (要件2/3)。前方一致候補のみ返す。
export function searchProducts(query: string, limit?: number): Promise<ProductSearchResult> {
  const search = new URLSearchParams({ q: query })
  if (limit != null) search.set('limit', String(limit))
  return getJson(`/api/products/search?${search.toString()}`)
}

// サムネイルURL (thumbnail_url) はBackendの `/api/products/{product_no}/drawings`
// レスポンスに完全な形 (Vite devプロキシ経由でそのまま使えるパス) で含まれるため、
// Frontend側で別途組み立てるヘルパーは持たない (ProductDrawing.thumbnail_urlを
// そのまま使う)。

export { ApiError }
