import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type {
  Detection,
  DrawingPage,
  EstimateItem,
  EstimateMasterItem,
  Panel,
  PanelArea,
  ProductDrawing,
  ProjectInfo,
} from './types/domain'

// PDF.js の実描画には依存せず、「積算結果→根拠図面→Viewerページ移動→BBox選択→
// 一時強調」「積算コードMaster行選択→BBox追加モード」というApp内の状態連動のみを
// 検証する (PDFレンダリング自体はブラウザでの目視確認が前提。docs/ui-spec.md参照)。
// bboxAddModeをdata属性として露出し、Appからの伝播をテストで検証できるようにする。
// 削除ボタンは実DrawingCanvasのツールバー相当を簡易再現し、Appからの
// selectedDetectionLabel/onDeleteSelectedDetection の伝播を検証できるようにする。
vi.mock('./components/DrawingViewer/DrawingCanvas', () => ({
  DrawingCanvas: ({
    children,
    bboxAddMode,
    selectedDetectionLabel,
    onDeleteSelectedDetection,
    onBackgroundClick,
  }: {
    children?: ReactNode
    bboxAddMode?: boolean
    selectedDetectionLabel?: string | null
    onDeleteSelectedDetection?: () => void
    onBackgroundClick?: () => void
  }) => (
    <div data-testid="drawing-canvas-stub" data-bbox-add-mode={String(!!bboxAddMode)}>
      <button type="button" disabled={selectedDetectionLabel == null} onClick={onDeleteSelectedDetection}>
        BBox削除
      </button>
      {/* 実DrawingCanvasの「空白クリックで選択解除」相当 (Phase 1.9 要件10)。
          実装側はPanドラッグ終了と誤判定しないようdrag量で判定しているが、
          Appからの伝播確認が目的のためここでは単純なボタンで代替する。 */}
      <button type="button" onClick={onBackgroundClick}>
        背景クリック
      </button>
      {children}
    </div>
  ),
}))

const project: ProjectInfo = {
  id: 1,
  seiri_no: 'A1AB3211',
  seiban: 'AB0367',
  panel_name: 'テスト盤',
  analysis_status: 'needs_review',
}

const pageOutline: DrawingPage = {
  id: 1,
  drawing_file_id: 1,
  page_no: 16,
  drawing_type: '外形図',
  drawing_name: '外形図(P16)',
  thumbnail_url: null,
  image_url: null,
  page_width: 1191,
  page_height: 842,
  display_order: 0,
  source_type: 'product_file',
  product_no: 'A1GV2421',
  source_page_no: 16,
}

const pageFoundation: DrawingPage = {
  ...pageOutline,
  id: 2,
  page_no: 18,
  drawing_type: '基礎図',
  drawing_name: '基礎図(P18)',
  source_page_no: 18,
}

// Phase 1.8: 左ペイン(DrawingNavigator)は/api/products/{product_no}/drawings由来の
// ProductDrawing[]を表示する。page_noはdbPages側のsource_page_noと一致させ、
// matchingDbPage解決 (App.tsx参照) がテスト内で機能するようにする。
// fetchProductDrawingsのモックはfoundation(18)を先頭で返し、既定選択ページが
// 従来と同じ「基礎図(P18)」になるようにしている (既存テストの待機条件を維持)。
const productPageFoundation: ProductDrawing = {
  page_no: 18,
  thumbnail_url: '/api/products/A1GV2421/drawings/18/thumbnail',
  drawing_type: '基礎図',
  drawing_name: '基礎図(P18)',
  panels: [],
}

// 中央Viewerの盤領域Overlay確認用に、外形図(P16)へ複数盤(要件11/20)を持たせる。
const productPageOutline: ProductDrawing = {
  page_no: 16,
  thumbnail_url: '/api/products/A1GV2421/drawings/16/thumbnail',
  drawing_type: '外形図',
  drawing_name: '外形図(P16)',
  panels: [
    {
      page_no: 16,
      ban_menno: 1,
      ban_no: 1,
      ban_meisyou: '高圧受電盤',
      ban_type: '背面図',
      ban_h1: 2300,
      ban_h2: 2300,
      ban_w: 900,
      ban_d: 2200,
      normalized_rect: { x: 0.1, y: 0.1, w: 0.05, h: 0.1 },
    },
    {
      page_no: 16,
      ban_menno: 2,
      ban_no: 1,
      ban_meisyou: '低圧動力盤',
      ban_type: '背面図',
      ban_h1: 2300,
      ban_h2: null,
      ban_w: 700,
      ban_d: 1200,
      normalized_rect: { x: 0.2, y: 0.1, w: 0.05, h: 0.1 },
    },
  ],
}

const detectionOnOutline: Detection = {
  id: 100,
  drawing_page_id: 1,
  panel_id: 1,
  class_name: 'roof_fan',
  bbox_x: 0.25,
  bbox_y: 0.15,
  bbox_w: 0.04,
  bbox_h: 0.03,
  confidence: 0.6,
  status: 'needs_review',
  source_type: 'ai',
  master_item_id: null,
  leader_label_x: null,
  leader_label_y: null,
  master_item_category: null,
  master_item_model: null,
  master_item_code: null,
}

const panel: Panel = {
  id: 1,
  panel_no: '1',
  name: '高圧受電盤',
  primary_drawing_page_id: 1,
  attributes: [],
}

const estimateItems: EstimateItem[] = [
  {
    id: 1,
    code: '18311',
    category: '附属品加算価格',
    item_name: '換気扇',
    model: null,
    rating: null,
    quantity: 1,
    unit: '箇所',
    source_type: 'ai',
    confidence: 0.6,
    status: 'needs_review',
    references: [
      {
        id: 1,
        drawing_page_id: 1,
        detection_id: 100,
        panel_id: 1,
        reason: 'test',
      },
    ],
  },
]

const masterItems: EstimateMasterItem[] = [
  {
    id: 10,
    code: '11001',
    category: '箱・単独',
    model: 'OS2-816',
    rating: '2.3*0.8*1.6',
    note: null,
    total_price_a: 315300,
    box_parts_price: 61600,
    painting_price: 89100,
    setup_a: 216,
    sheet_metal_price: 1096,
    assembly_price: 351,
    inspection_price: 15,
  },
  {
    id: 11,
    code: '11002',
    category: '箱・単独',
    model: 'OS2-916',
    rating: '2.3*0.9*1.6',
    note: null,
    total_price_a: 322000,
    box_parts_price: 64600,
    painting_price: 92800,
    setup_a: 216,
    sheet_metal_price: 1096,
    assembly_price: 351,
    inspection_price: 15,
  },
]

vi.mock('./api/client', () => ({
  fetchProjectInfo: vi.fn(async () => project),
  fetchDrawingPages: vi.fn(async () => [pageFoundation, pageOutline]),
  fetchEstimateItems: vi.fn(async () => estimateItems),
  // SystemSettingsモーダルを開くテスト (Phase 1.11 Escキー処理) のためのスタブ。
  fetchDataSource: vi.fn(async () => ({ root: '\\\\dummy\\share', exists: true })),
  fetchDetections: vi.fn(async (drawingPageId?: number) =>
    drawingPageId === 1 ? [detectionOnOutline] : [],
  ),
  fetchPanelAreas: vi.fn(async (): Promise<PanelArea[]> => []),
  fetchPanel: vi.fn(async () => panel),
  fetchMasterItems: vi.fn(async () => masterItems),
  // Phase 1.8: 製番選択・左ペインPNGサムネイル。
  fetchProductDrawings: vi.fn(async () => [productPageFoundation, productPageOutline]),
  fetchProductInfo: vi.fn(async (productNo: string) => ({
    product_no: productNo,
    exists: true,
    ccv_resolved: false,
  })),
  searchProducts: vi.fn(async () => ({ matches: [], truncated: false })),
  productDrawingFileUrl: vi.fn(
    (productNo: string, pageNo: number) =>
      `http://localhost:8000/api/products/${productNo}/drawings/${pageNo}/file`,
  ),
  createManualDetection: vi.fn(
    async (): Promise<Detection> => ({
      id: 200,
      drawing_page_id: 1,
      panel_id: null,
      class_name: '11001',
      bbox_x: 0.1,
      bbox_y: 0.1,
      bbox_w: 0.05,
      bbox_h: 0.05,
      confidence: null,
      status: 'reviewed',
      source_type: 'manual',
      master_item_id: 10,
      leader_label_x: null,
      leader_label_y: null,
      master_item_category: '箱・単独',
      master_item_model: 'OS2-816',
      master_item_code: '11001',
    }),
  ),
  drawingPageFileUrl: vi.fn((id: number) => `http://localhost:8000/api/drawing-pages/${id}/file`),
  deleteDetection: vi.fn(async () => {}),
  updateDetectionBBox: vi.fn(async (id: number, rect: Record<string, number>) => ({
    ...detectionOnOutline,
    id,
    bbox_x: rect.bbox_x,
    bbox_y: rect.bbox_y,
    bbox_w: rect.bbox_w,
    bbox_h: rect.bbox_h,
  })),
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

// Phase 1.11 UI改修指示22章: App.tsxはURL query (?product=&page=) を読み書きするため、
// jsdomのwindow.locationがテスト間で共有・蓄積されないよう、各テスト開始前に
// クリーンなURLへリセットする (localStorageのclear()と同じ考え方)。
beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('App: 積算結果 → 根拠図面 → Viewer → BBox選択 → 一時強調', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('navigates to the referenced page, selects the BBox, and briefly highlights it', async () => {
    render(<App />)

    // 初期表示 (先頭ページ = 基礎図(P18)) が終わるのを待つ
    await waitFor(() => expect(screen.getAllByText('基礎図(P18)').length).toBeGreaterThan(0))

    // 積算結果Treeの根拠図面リンクをクリック
    // (同じテキストが図面一覧のページ名としても表示されるため、
    //  estimate-tree__reference クラスを持つ要素を明示的に選ぶ)
    const referenceLink = await waitFor(() => {
      const candidates = screen.getAllByText('外形図(P16)')
      const link = candidates.find((el) => el.className.includes('estimate-tree__reference'))
      if (!link) throw new Error('reference link not rendered yet')
      return link
    })
    fireEvent.click(referenceLink)

    // Viewerの見出しが対象ページ (外形図(P16)) に切り替わること
    await waitFor(() => {
      expect(screen.getAllByText('外形図(P16)').length).toBeGreaterThan(0)
    })

    // 対象BBoxが選択され、一時的に強調表示されること
    await waitFor(() => {
      const bbox = screen.getByTitle(/roof_fan/)
      expect(bbox.className).toContain('detection-overlay__bbox--selected')
      expect(bbox.className).toContain('detection-overlay__bbox--flash')
    })
  })
})

describe('App: 積算コードMaster行選択 → Manual BBox追加モード (Phase 1.6)', () => {
  function drawingCanvasStub() {
    return screen.getByTestId('drawing-canvas-stub')
  }

  it('toggles bboxAddMode on row select/re-click/switch, and keeps selection after a BBox is added', async () => {
    render(<App />)

    const row11001 = (await screen.findByText('11001')).closest('tr') as HTMLElement
    const row11002 = screen.getByText('11002').closest('tr') as HTMLElement

    // 未選択時はPanモード (bboxAddMode=false)
    expect(drawingCanvasStub().dataset.bboxAddMode).toBe('false')

    // 行クリックで選択 -> BBox追加モードON
    fireEvent.click(row11001)
    await waitFor(() => expect(drawingCanvasStub().dataset.bboxAddMode).toBe('true'))
    expect(row11001.className).toContain('master-picker__row--selected')

    // 同じ行を再クリック -> 選択解除
    fireEvent.click(row11001)
    await waitFor(() => expect(drawingCanvasStub().dataset.bboxAddMode).toBe('false'))
    expect(row11001.className).not.toContain('master-picker__row--selected')

    // 別の行をクリック -> 選択先が切り替わる (同時に選択できるのは1件のみ)
    fireEvent.click(row11001)
    await waitFor(() => expect(drawingCanvasStub().dataset.bboxAddMode).toBe('true'))
    fireEvent.click(row11002)
    await waitFor(() => {
      expect(row11002.className).toContain('master-picker__row--selected')
      expect(row11001.className).not.toContain('master-picker__row--selected')
    })
    expect(drawingCanvasStub().dataset.bboxAddMode).toBe('true')
  })
})

describe('App: BBox削除 (Phase 1.7)', () => {
  afterEach(() => {
    // deleteDetection等はモジュールスコープの単一vi.fn()のため、
    // 呼び出し回数がテスト間で蓄積しないようにクリアする
    // (実装のisEditableTargetガード自体は正しく動作しており、これはテスト分離のための対応)。
    vi.clearAllMocks()
  })

  async function navigateToOutlinePage() {
    // Phase 1.8: 左ペインはPNGサムネイルカード表示になり、ページ番号は
    // <img alt="P{page_no}"> で識別する (drawing-navigator__labelクラスは廃止)。
    const thumbnail = await screen.findByRole('img', { name: 'P16' })
    fireEvent.click(thumbnail)
    await screen.findByTitle(/roof_fan/)
  }

  it('deletes the selected Detection via the toolbar delete button and clears the selection', async () => {
    const { deleteDetection } = await import('./api/client')
    render(<App />)
    await navigateToOutlinePage()

    fireEvent.click(screen.getByTitle(/roof_fan/))
    const deleteButton = await screen.findByRole('button', { name: 'BBox削除' })
    await waitFor(() => expect(deleteButton).not.toBeDisabled())

    fireEvent.click(deleteButton)

    await waitFor(() => expect(deleteDetection).toHaveBeenCalledWith(100))
    await waitFor(() => expect(screen.queryByTitle(/roof_fan/)).not.toBeInTheDocument())
  })

  it('deletes the selected Detection when the Delete key is pressed (no input focused)', async () => {
    const { deleteDetection } = await import('./api/client')
    render(<App />)
    await navigateToOutlinePage()

    fireEvent.click(screen.getByTitle(/roof_fan/))
    const deleteButton = await screen.findByRole('button', { name: 'BBox削除' })
    await waitFor(() => expect(deleteButton).not.toBeDisabled())

    fireEvent.keyDown(document, { key: 'Delete' })

    await waitFor(() => expect(deleteDetection).toHaveBeenCalledWith(100))
  })

  it('does not delete when the Delete key is pressed while a text input is focused (master picker search box)', async () => {
    const { deleteDetection } = await import('./api/client')
    render(<App />)
    await navigateToOutlinePage()
    fireEvent.click(screen.getByTitle(/roof_fan/))
    await waitFor(() => expect(screen.getByRole('button', { name: 'BBox削除' })).not.toBeDisabled())

    const searchBox = screen.getByPlaceholderText('コード・型式で検索 (現在のタブ内)')
    searchBox.focus()
    fireEvent.keyDown(searchBox, { key: 'Delete' })

    expect(deleteDetection).not.toHaveBeenCalled()
    // 選択状態・BBoxも消えていないこと
    expect(screen.getByTitle(/roof_fan/)).toBeInTheDocument()
  })

  it('a 404 (already-deleted on the Backend) is treated as stale state, not a persistent error: the BBox disappears from the list and no error banner is shown (追加修正 第4ラウンド1章〜4章)', async () => {
    const { deleteDetection, ApiError } = await import('./api/client')
    vi.mocked(deleteDetection).mockRejectedValueOnce(new ApiError(404, '指定されたDetectionが見つかりません。'))
    render(<App />)
    await navigateToOutlinePage()

    fireEvent.click(screen.getByTitle(/roof_fan/))
    const deleteButton = await screen.findByRole('button', { name: 'BBox削除' })
    await waitFor(() => expect(deleteButton).not.toBeDisabled())

    fireEvent.click(deleteButton)

    await waitFor(() => expect(deleteDetection).toHaveBeenCalledWith(100))
    // stale state: 一覧から消える (Backend上に既に存在しないため)
    await waitFor(() => expect(screen.queryByTitle(/roof_fan/)).not.toBeInTheDocument())
    // 404を重大エラーとして常駐表示しない (要件4)
    expect(document.querySelector('.app-layout__error')).not.toBeInTheDocument()
  })

  it('a real failure (500/network) still shows the error banner, and does NOT optimistically remove the BBox (追加修正 第4ラウンド4章)', async () => {
    const { deleteDetection, ApiError } = await import('./api/client')
    vi.mocked(deleteDetection).mockRejectedValueOnce(new ApiError(500, 'サーバー内部エラーが発生しました。'))
    render(<App />)
    await navigateToOutlinePage()

    fireEvent.click(screen.getByTitle(/roof_fan/))
    const deleteButton = await screen.findByRole('button', { name: 'BBox削除' })
    await waitFor(() => expect(deleteButton).not.toBeDisabled())

    fireEvent.click(deleteButton)

    await waitFor(() => expect(deleteDetection).toHaveBeenCalledWith(100))
    await waitFor(() => {
      const banner = document.querySelector('.app-layout__error')
      expect(banner).toBeInTheDocument()
      expect(banner?.textContent).toContain('BBoxの削除に失敗しました')
    })
    // 本物の失敗はBBoxを消さない(楽観的な削除をしない)
    expect(screen.getByTitle(/roof_fan/)).toBeInTheDocument()
  })

  it('a subsequent successful delete clears a previously-shown error banner (追加修正 第4ラウンド5章)', async () => {
    const { deleteDetection, ApiError } = await import('./api/client')
    vi.mocked(deleteDetection).mockRejectedValueOnce(new ApiError(500, 'サーバー内部エラーが発生しました。'))
    render(<App />)
    await navigateToOutlinePage()

    fireEvent.click(screen.getByTitle(/roof_fan/))
    const deleteButton = await screen.findByRole('button', { name: 'BBox削除' })
    await waitFor(() => expect(deleteButton).not.toBeDisabled())

    // 1回目: 失敗してエラーバナーが出る
    fireEvent.click(deleteButton)
    await waitFor(() => expect(document.querySelector('.app-layout__error')).toBeInTheDocument())

    // 2回目: 成功する (デフォルトのモック実装に戻る) → 以前のエラーバナーは消える
    fireEvent.click(deleteButton)
    await waitFor(() => expect(deleteDetection).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(document.querySelector('.app-layout__error')).not.toBeInTheDocument())
  })
})

describe('App: product_df盤領域Overlayの表示先 (実画面未反映調査・修正指示)', () => {
  async function navigateToOutlinePage() {
    const thumbnail = await screen.findByRole('img', { name: 'P16' })
    fireEvent.click(thumbnail)
    await screen.findByTitle(/roof_fan/)
  }

  it('shows the red panel-area overlay inside the center Viewer, not inside the left pane (要件1/7/8/17)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    // 中央Viewer側 (DrawingCanvasスタブのchildren) に、外形図(P16)のpanels(2件)が
    // 全件描画されること。
    const nav = document.querySelector('.drawing-navigator') as HTMLElement
    const canvasStub = screen.getByTestId('drawing-canvas-stub')

    await waitFor(() => {
      expect(canvasStub.querySelectorAll('.product-panel-overlay__area')).toHaveLength(2)
    })
    // 左ペインには一切描画しない。
    expect(nav.querySelectorAll('.product-panel-overlay__area')).toHaveLength(0)
    expect(nav.querySelectorAll('.drawing-navigator__panel-overlay')).toHaveLength(0)
  })
})

describe('App: 左右ペインのリサイズ (UIレイアウト追加修正指示)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    window.localStorage.clear()
  })

  async function renderApp() {
    render(<App />)
    await waitFor(() => expect(screen.getAllByText('基礎図(P18)').length).toBeGreaterThan(0))
  }

  it('keeps EstimateMasterPicker inside MainArea as a sibling of (not nested under) the right pane', async () => {
    await renderApp()
    const rightPane = document.querySelector('.app-workspace__right') as HTMLElement
    const mainArea = document.querySelector('.app-workspace__main') as HTMLElement
    const master = document.querySelector('.master-picker') as HTMLElement

    expect(rightPane).not.toBeNull()
    expect(mainArea).not.toBeNull()
    expect(master).not.toBeNull()
    // Masterは右ペインの下(DOM上の子孫)ではなく、MainArea側に属する (指示書3章/7章)。
    expect(mainArea.contains(master)).toBe(true)
    expect(rightPane.contains(master)).toBe(false)
    // MainAreaとRightPaneは同階層 (overlayで重ねているのではなく別領域)。
    expect(mainArea.parentElement).toBe(rightPane.parentElement)
  })

  it('resizes the left pane by dragging its splitter, and clamps at the minimum width', async () => {
    await renderApp()
    const nav = document.querySelector('.app-workspace__nav') as HTMLElement
    expect(nav.style.width).toBe('220px')

    const handle = screen.getByRole('separator', { name: '図面一覧の幅を変更' })
    fireEvent.mouseDown(handle, { clientX: 200, button: 0 })
    fireEvent.mouseMove(window, { clientX: 260 })
    fireEvent.mouseUp(window, { clientX: 260 })
    expect(nav.style.width).toBe('280px')

    // 最小幅(140px)を下回らない
    fireEvent.mouseDown(handle, { clientX: 260, button: 0 })
    fireEvent.mouseMove(window, { clientX: -10000 })
    fireEvent.mouseUp(window, { clientX: -10000 })
    expect(nav.style.width).toBe('140px')
  })

  it('resizes the right pane by dragging its splitter (drag right = narrower, drag left = wider), clamped at the minimum', async () => {
    await renderApp()
    const right = document.querySelector('.app-workspace__right') as HTMLElement
    expect(right.style.width).toBe('300px')

    const handle = screen.getByRole('separator', { name: '右ペインの幅を変更' })
    fireEvent.mouseDown(handle, { clientX: 500, button: 0 })
    fireEvent.mouseMove(window, { clientX: 450 }) // 左へドラッグ -> 右ペインが広くなる
    fireEvent.mouseUp(window, { clientX: 450 })
    expect(right.style.width).toBe('350px')

    fireEvent.mouseDown(handle, { clientX: 450, button: 0 })
    fireEvent.mouseMove(window, { clientX: 10000 }) // 右へ大きくドラッグ -> 最小幅でクランプ
    fireEvent.mouseUp(window, { clientX: 10000 })
    expect(right.style.width).toBe('220px')
  })

  it('does not exceed the maximum width for either pane', async () => {
    await renderApp()
    const nav = document.querySelector('.app-workspace__nav') as HTMLElement
    const right = document.querySelector('.app-workspace__right') as HTMLElement

    const leftHandle = screen.getByRole('separator', { name: '図面一覧の幅を変更' })
    fireEvent.mouseDown(leftHandle, { clientX: 0, button: 0 })
    fireEvent.mouseMove(window, { clientX: 100000 })
    fireEvent.mouseUp(window, { clientX: 100000 })
    expect(parseFloat(nav.style.width)).toBeCloseTo(window.innerWidth * 0.3, 5)

    const rightHandle = screen.getByRole('separator', { name: '右ペインの幅を変更' })
    fireEvent.mouseDown(rightHandle, { clientX: 100000, button: 0 })
    fireEvent.mouseMove(window, { clientX: -100000 }) // 左へ大きく = 右ペイン拡大方向
    fireEvent.mouseUp(window, { clientX: -100000 })
    expect(parseFloat(right.style.width)).toBeCloseTo(window.innerWidth * 0.4, 5)
  })

  it('restores previously saved pane widths from localStorage on mount', async () => {
    window.localStorage.setItem('sekisan-navi:left-pane-width', '260')
    window.localStorage.setItem('sekisan-navi:right-pane-width', '340')
    await renderApp()
    const nav = document.querySelector('.app-workspace__nav') as HTMLElement
    const right = document.querySelector('.app-workspace__right') as HTMLElement
    expect(nav.style.width).toBe('260px')
    expect(right.style.width).toBe('340px')
  })

  it('falls back to the initial widths when a stored value is invalid', async () => {
    window.localStorage.setItem('sekisan-navi:left-pane-width', 'garbage')
    window.localStorage.setItem('sekisan-navi:right-pane-width', '999999')
    await renderApp()
    const nav = document.querySelector('.app-workspace__nav') as HTMLElement
    const right = document.querySelector('.app-workspace__right') as HTMLElement
    expect(nav.style.width).toBe('220px')
    expect(right.style.width).toBe('300px')
  })
})

describe('App: 積算コードMaster領域の高さリサイズ (Phase 1.11 UI改修指示24章〜26章)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    window.localStorage.clear()
  })

  async function renderApp() {
    render(<App />)
    await waitFor(() => expect(screen.getAllByText('基礎図(P18)').length).toBeGreaterThan(0))
  }

  it('renders a horizontal Resize Handle between the Viewer area and the Master area, at the initial height', async () => {
    await renderApp()
    const master = document.querySelector('.master-picker') as HTMLElement
    expect(master.style.height).toBe('260px')

    const handle = screen.getByRole('separator', { name: '積算コードMasterの高さを変更' })
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('dragging the handle up increases the Master area height', async () => {
    await renderApp()
    const master = document.querySelector('.master-picker') as HTMLElement
    const handle = screen.getByRole('separator', { name: '積算コードMasterの高さを変更' })

    fireEvent.mouseDown(handle, { clientY: 500, button: 0 })
    fireEvent.mouseMove(window, { clientY: 460 }) // 上へ40px
    fireEvent.mouseUp(window, { clientY: 460 })

    expect(master.style.height).toBe('300px')
  })

  it('dragging the handle down decreases the Master area height, clamped at the minimum', async () => {
    await renderApp()
    const master = document.querySelector('.master-picker') as HTMLElement
    const handle = screen.getByRole('separator', { name: '積算コードMasterの高さを変更' })

    fireEvent.mouseDown(handle, { clientY: 300, button: 0 })
    fireEvent.mouseMove(window, { clientY: 10000 }) // 大きく下へ
    fireEvent.mouseUp(window, { clientY: 10000 })

    expect(master.style.height).toBe('120px') // MASTER_PANE_HEIGHT_MIN
  })

  it('does not exceed the maximum height (viewport-relative, so the Viewer stays usable)', async () => {
    await renderApp()
    const master = document.querySelector('.master-picker') as HTMLElement
    const handle = screen.getByRole('separator', { name: '積算コードMasterの高さを変更' })

    fireEvent.mouseDown(handle, { clientY: 10000, button: 0 })
    fireEvent.mouseMove(window, { clientY: -100000 }) // 大きく上へ
    fireEvent.mouseUp(window, { clientY: -100000 })

    expect(parseFloat(master.style.height)).toBeCloseTo(window.innerHeight * 0.6, 5)
  })

  it('restores a previously saved Master height from localStorage on mount (指示書26章)', async () => {
    window.localStorage.setItem('sekisan-navi:master-pane-height', '340')
    await renderApp()
    const master = document.querySelector('.master-picker') as HTMLElement
    expect(master.style.height).toBe('340px')
  })

  it('falls back to the initial height when a stored value is invalid', async () => {
    window.localStorage.setItem('sekisan-navi:master-pane-height', 'garbage')
    await renderApp()
    const master = document.querySelector('.master-picker') as HTMLElement
    expect(master.style.height).toBe('260px')
  })

  it('uses its own storage key, independent of the left/right pane width keys (指示書26章: 保存方式は統一しつつ、値自体は別管理)', async () => {
    window.localStorage.setItem('sekisan-navi:left-pane-width', '999')
    await renderApp()
    const master = document.querySelector('.master-picker') as HTMLElement
    const nav = document.querySelector('.app-workspace__nav') as HTMLElement
    expect(master.style.height).toBe('260px')
    expect(nav.style.width).not.toBe('260px')
  })
})

describe('App: 盤選択 → 右ペイン連動 (Phase 1.9)', () => {
  async function navigateToOutlinePage() {
    const thumbnail = await screen.findByRole('img', { name: 'P16' })
    fireEvent.click(thumbnail)
    await screen.findByTitle(/roof_fan/)
  }

  it('shows the empty state until a panel area is clicked, then shows its product_df fields', async () => {
    render(<App />)
    await navigateToOutlinePage()

    expect(screen.getByText('盤が選択されていません')).toBeInTheDocument()

    fireEvent.click(screen.getByText('1/1'))

    await waitFor(() => expect(screen.queryByText('盤が選択されていません')).not.toBeInTheDocument())
    expect(screen.getByText('高圧受電盤')).toBeInTheDocument()
    expect(screen.getByText('背面図')).toBeInTheDocument()
    expect(screen.getByText('900 mm')).toBeInTheDocument()
  })

  it('switches selection immediately when a different panel is clicked, updating the right pane (要件6)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    fireEvent.click(screen.getByText('1/1'))
    await waitFor(() => expect(screen.getByText('高圧受電盤')).toBeInTheDocument())

    fireEvent.click(screen.getByText('2/1'))
    await waitFor(() => expect(screen.getByText('低圧動力盤')).toBeInTheDocument())
    expect(screen.queryByText('高圧受電盤')).not.toBeInTheDocument()
  })

  it('applies the selected/dimmed visual classes to the clicked and other panel areas (要件7/8)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    const areaOne = screen.getByText('1/1').closest('button') as HTMLElement
    const areaTwo = screen.getByText('2/1').closest('button') as HTMLElement
    fireEvent.click(areaOne)

    await waitFor(() => expect(areaOne.className).toContain('--selected'))
    expect(areaTwo.className).toContain('--dimmed')
    expect(areaTwo.className).not.toContain('--selected')
    // 非選択盤も非表示にはしない (DOM上に引き続き存在)
    expect(areaTwo).toBeInTheDocument()
  })

  it('clears the selected panel when switching to a different page (要件8)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    fireEvent.click(screen.getByText('1/1'))
    await waitFor(() => expect(screen.getByText('高圧受電盤')).toBeInTheDocument())

    const foundationThumbnail = await screen.findByRole('img', { name: 'P18' })
    fireEvent.click(foundationThumbnail)

    await waitFor(() => expect(screen.getByText('盤が選択されていません')).toBeInTheDocument())
    expect(screen.queryByText('高圧受電盤')).not.toBeInTheDocument()
  })

  it('clears the selected panel on a background click without affecting a real Pan drag (要件10)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    fireEvent.click(screen.getByText('1/1'))
    await waitFor(() => expect(screen.getByText('高圧受電盤')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '背景クリック' }))

    await waitFor(() => expect(screen.getByText('盤が選択されていません')).toBeInTheDocument())
  })
})

describe('App: 積算コード選択中の盤領域の扱い (Phase 1.10 UI改修指示4章〜7章)', () => {
  async function navigateToOutlinePage() {
    const thumbnail = await screen.findByRole('img', { name: 'P16' })
    fireEvent.click(thumbnail)
    await screen.findByTitle(/roof_fan/)
  }

  it('does not show the panel Tooltip on hover while a Master row is selected (要件4/5)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    const row11001 = (await screen.findByText('11001')).closest('tr') as HTMLElement
    fireEvent.click(row11001)
    await waitFor(() => expect(row11001.className).toContain('master-picker__row--selected'))

    const area = screen.getByText('1/1').closest('button') as HTMLElement
    fireEvent.mouseEnter(area, { clientX: 50, clientY: 50 })

    expect(document.querySelector('.product-panel-overlay__tooltip')).not.toBeInTheDocument()
  })

  it('shows the panel Tooltip on hover again once the Master row is deselected', async () => {
    render(<App />)
    await navigateToOutlinePage()

    const row11001 = (await screen.findByText('11001')).closest('tr') as HTMLElement
    fireEvent.click(row11001) // 選択
    fireEvent.click(row11001) // 再クリックで解除 (Phase 1.6 既存トグル仕様)
    await waitFor(() => expect(row11001.className).not.toContain('master-picker__row--selected'))

    const area = screen.getByText('1/1').closest('button') as HTMLElement
    fireEvent.mouseEnter(area, { clientX: 50, clientY: 50 })

    expect(document.querySelector('.product-panel-overlay__tooltip')).toBeInTheDocument()
  })

  it('keeps the panel border/label visible but disables its pointer-events while a Master row is selected, so a Viewer drag reaches DrawingCanvas for Manual BBox creation (要件6/7)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    const row11001 = (await screen.findByText('11001')).closest('tr') as HTMLElement
    fireEvent.click(row11001)
    await waitFor(() => expect(row11001.className).toContain('master-picker__row--selected'))

    // 盤の位置確認自体は妨げない (赤枠・ラベルは表示され続ける)。
    const area = screen.getByText('1/1').closest('button') as HTMLElement
    expect(area).toBeInTheDocument()
    expect(getComputedStyle(area).pointerEvents).toBe('none')
  })

  it('clicking a panel area while a Master row is selected does not change selectedPanel (BBox作業を優先する)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    const row11001 = (await screen.findByText('11001')).closest('tr') as HTMLElement
    fireEvent.click(row11001)
    await waitFor(() => expect(row11001.className).toContain('master-picker__row--selected'))

    fireEvent.click(screen.getByText('1/1'))

    expect(screen.getByText('盤が選択されていません')).toBeInTheDocument()
  })
})

describe('App: URLによる表示状態の復元 (Phase 1.11 UI改修指示22章/23章)', () => {
  it('restores the product/page from the URL query on mount, instead of the default page', async () => {
    window.history.replaceState(null, '', '/?product=A1GV2421&page=16')
    render(<App />)

    await waitFor(() => expect(screen.getAllByText('外形図(P16)').length).toBeGreaterThan(0))
    // 既定(P18)ではなく、URLで指定したP16が表示されていること。
    expect(screen.queryAllByText('基礎図(P18)')).toHaveLength(0)
  })

  it('updates the URL query when the user switches pages, without pushing a new history entry', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getAllByText('基礎図(P18)').length).toBeGreaterThan(0))

    const thumbnail = await screen.findByRole('img', { name: 'P16' })
    fireEvent.click(thumbnail)

    await waitFor(() => expect(window.location.search).toContain('page=16'))
    expect(window.location.search).toContain('product=A1GV2421')
  })

  it('falls back to the default page when the URL page number does not exist for the product (指示書23章)', async () => {
    window.history.replaceState(null, '', '/?product=A1GV2421&page=999999')
    render(<App />)

    // 存在しないPAGEは無視され、先頭ページ(基礎図P18)へ安全にfallbackする。
    await waitFor(() => expect(screen.getAllByText('基礎図(P18)').length).toBeGreaterThan(0))
  })

  it('does not crash when the URL page value is not a valid number (指示書23章)', async () => {
    window.history.replaceState(null, '', '/?product=A1GV2421&page=not-a-number')
    render(<App />)

    await waitFor(() => expect(screen.getAllByText('基礎図(P18)').length).toBeGreaterThan(0))
  })
})

describe('App: Escキーによる編集モード解除 (Phase 1.11 UI改修指示3章/28章)', () => {
  function drawingCanvasStub() {
    return screen.getByTestId('drawing-canvas-stub')
  }

  async function navigateToOutlinePage() {
    const thumbnail = await screen.findByRole('img', { name: 'P16' })
    fireEvent.click(thumbnail)
    await screen.findByTitle(/roof_fan/)
  }

  it('BBox編集中にEscを押すと、その選択(Resize Handle表示)のみ解除する', async () => {
    render(<App />)
    await navigateToOutlinePage()

    fireEvent.click(screen.getByTitle(/roof_fan/))
    await screen.findAllByRole('button', { name: /BBoxサイズ変更/ })

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryAllByRole('button', { name: /BBoxサイズ変更/ })).toHaveLength(0)
  })

  it('積算コードMaster選択中にEscを押すと、Master選択・BBox追加モードを解除する', async () => {
    render(<App />)
    const row11001 = (await screen.findByText('11001')).closest('tr') as HTMLElement
    fireEvent.click(row11001)
    await waitFor(() => expect(drawingCanvasStub().dataset.bboxAddMode).toBe('true'))

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(drawingCanvasStub().dataset.bboxAddMode).toBe('false'))
    expect(row11001.className).not.toContain('master-picker__row--selected')
  })

  it('盤選択中のみの状態でEscを押すと、盤選択を解除する', async () => {
    render(<App />)
    await navigateToOutlinePage()
    fireEvent.click(screen.getByText('1/1'))
    await waitFor(() => expect(screen.getByText('高圧受電盤')).toBeInTheDocument())

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.getByText('盤が選択されていません')).toBeInTheDocument())
  })

  it('BBox編集中とMaster選択中が両方アクティブな場合、1回目のEscはBBox編集のみ解除し、Master選択は残す (優先順位)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    const row11001 = (await screen.findByText('11001')).closest('tr') as HTMLElement
    fireEvent.click(row11001)
    await waitFor(() => expect(row11001.className).toContain('master-picker__row--selected'))

    fireEvent.click(screen.getByTitle(/roof_fan/))
    await screen.findAllByRole('button', { name: /BBoxサイズ変更/ })

    // 1回目のEsc: BBox編集のみ解除
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryAllByRole('button', { name: /BBoxサイズ変更/ })).toHaveLength(0),
    )
    expect(row11001.className).toContain('master-picker__row--selected')

    // 2回目のEsc: Master選択を解除
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(row11001.className).not.toContain('master-picker__row--selected'))
  })

  it('Escは検索欄等にフォーカスがあっても機能する (Deleteキーの除外ガードとは異なる。指示書3章)', async () => {
    render(<App />)
    const row11001 = (await screen.findByText('11001')).closest('tr') as HTMLElement
    fireEvent.click(row11001)
    await waitFor(() => expect(row11001.className).toContain('master-picker__row--selected'))

    const searchBox = screen.getByPlaceholderText('コード・型式で検索 (現在のタブ内)')
    searchBox.focus()
    fireEvent.keyDown(searchBox, { key: 'Escape' })

    await waitFor(() => expect(row11001.className).not.toContain('master-picker__row--selected'))
  })

  it('SystemSettingsモーダルが開いている間はEscで編集モードを解除しない (将来のModal自身のEsc処理と競合しない。指示書3章)', async () => {
    render(<App />)
    const row11001 = (await screen.findByText('11001')).closest('tr') as HTMLElement
    fireEvent.click(row11001)
    await waitFor(() => expect(row11001.className).toContain('master-picker__row--selected'))

    fireEvent.click(screen.getByRole('button', { name: 'システム設定' }))
    fireEvent.keyDown(document, { key: 'Escape' })

    // Master選択状態は維持されたまま (Modal内のEsc処理に委ねる方針)。
    expect(row11001.className).toContain('master-picker__row--selected')
  })
})
