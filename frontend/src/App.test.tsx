import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type {
  Detection,
  DrawingPage,
  EstimateMasterItem,
  EstimatePanelInfo,
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
    title,
    children,
    bboxAddMode,
    selectedDetectionLabel,
    onDeleteSelectedDetection,
    onBackgroundClick,
  }: {
    title?: string
    children?: ReactNode
    bboxAddMode?: boolean
    selectedDetectionLabel?: string | null
    onDeleteSelectedDetection?: () => void
    onBackgroundClick?: () => void
  }) => (
    <div data-testid="drawing-canvas-stub" data-bbox-add-mode={String(!!bboxAddMode)}>
      {/* Viewer上部1行化 指示2章: 実DrawingCanvasでは図面名(title)がtoolbar内に
          描画されるようになったため、このstubでも同様に描画し、Appからの
          pageLabel伝播をこれまでどおりgetByText等で検証できるようにする。 */}
      <span>{title}</span>
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

// Phase 1.14: estcode_df.csv由来の盤情報。productPageOutline.panelsと同じ
// ban_menno/ban_noを持つ行を用意し、右ペイン連動テストが新しい表示形式でも
// 意味のある値(盤名称等)を検証できるようにする。
const estimatePanelsFixture: EstimatePanelInfo[] = [
  {
    model: 'IS2',
    ban_menno: 1,
    ban_no: 1,
    ban_meisyou: '高圧受電盤',
    ban_h: 2300,
    ban_w: 900,
    ban_d: 2200,
    ban_connect: '箱・左右(R)',
    sort_order: 5,
  },
  {
    model: 'IS2',
    ban_menno: 2,
    ban_no: 1,
    ban_meisyou: '低圧動力盤',
    ban_h: 2300,
    ban_w: 700,
    ban_d: 1200,
    ban_connect: '箱・中央',
    sort_order: 4,
  },
]

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

// 積算集約(②)・積算明細(③)向けの積算コード(master_item_id有)Detection。
// `detectionOnOutline`(roof_fan, master_item_id=null)は他の多数のテストが
// 「常時表示されるAI Detection」の前提で使っているため変更せず、別途追加する。
// コード/型式はMaster Pickerの固定行(11001/11002)と衝突しないよう、他のテストで
// 参照されていない値を使う (`screen.getByText('11001')`等が複数箇所にヒットして
// 曖昧にならないようにするため)。
const masterLinkedDetectionOnOutline: Detection = {
  id: 101,
  drawing_page_id: 1,
  panel_id: null,
  class_name: '18999',
  bbox_x: 0.5,
  bbox_y: 0.5,
  bbox_w: 0.02,
  bbox_h: 0.02,
  confidence: null,
  status: 'reviewed',
  source_type: 'manual',
  master_item_id: 10,
  leader_label_x: null,
  leader_label_y: null,
  master_item_category: '箱・単独',
  master_item_model: 'テスト品目',
  master_item_code: '18999',
}

// 積算明細強化・Undo/Redo・要確認警告・編集追従 指示7章/11章: 面1/盤1(x:0.1-0.15/
// y:0.1-0.2)・面2/盤2(x:0.2-0.25/y:0.1-0.2)の両方と厳密に同じ面積(0.0015)で交差する
// よう座標を選んだfixture。BBox所属判定は浮動小数の完全一致(===)で同値判定するため、
// UI操作(drag)経由の座標では丸め誤差により意図した同値を再現できない
// (assignDetectionToPanel自体は変更しない)。「要確認」警告バナーのテスト専用に
// 使う (通常は`fetchDetections`のmockImplementationOnceで個別のテストにのみ含める)。
const tieDetectionOnOutline: Detection = {
  id: 102,
  drawing_page_id: 1,
  panel_id: null,
  class_name: '18500',
  bbox_x: 0.135,
  bbox_y: 0.1,
  bbox_w: 0.08,
  bbox_h: 0.1,
  confidence: null,
  status: 'reviewed',
  source_type: 'manual',
  master_item_id: 10,
  leader_label_x: null,
  leader_label_y: null,
  master_item_category: '箱・単独',
  master_item_model: 'テスト品目2',
  master_item_code: '18500',
}

const panel: Panel = {
  id: 1,
  panel_no: '1',
  name: '高圧受電盤',
  primary_drawing_page_id: 1,
  attributes: [],
}

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

// 積算集約・積算明細UI再構成: App.tsxは起動時に`fetchDetections()`を引数無しで
// 呼び、DB全件(=このfixtureでは全ページ分)を取得する。ページ指定時は従来通り
// そのページのDetectionのみを返す。既定の初期表示ページ(基礎図P18,
// dbPageId=2)への副作用的な呼び出し(`fetchDetections(2)`)も含め、通常は
// この既定実装で足りる。個別のテスト(要確認warningテスト等)が一時的に
// `mockImplementation`で上書きした場合は、このデフォルトへ明示的に戻す
// (afterEach参照)。
function defaultFetchDetectionsImpl(drawingPageId?: number) {
  const all = [detectionOnOutline, masterLinkedDetectionOnOutline]
  if (drawingPageId === undefined) return Promise.resolve(all)
  return Promise.resolve(drawingPageId === 1 ? all : [])
}

vi.mock('./api/client', () => ({
  fetchProjectInfo: vi.fn(async () => project),
  fetchDrawingPages: vi.fn(async () => [pageFoundation, pageOutline]),
  // SystemSettingsモーダルを開くテスト (Phase 1.11 Escキー処理) のためのスタブ。
  fetchDataSource: vi.fn(async () => ({ root: '\\\\dummy\\share', exists: true })),
  fetchDetections: vi.fn(defaultFetchDetectionsImpl),
  fetchPanelAreas: vi.fn(async (): Promise<PanelArea[]> => []),
  fetchPanel: vi.fn(async () => panel),
  // Phase 1.12: detected_df.csv由来の検出BBoxプレビュー。既存テストへの影響を
  // 避けるため既定では空配列を返す (個別にdetected_dfの表示を検証するテストのみ
  // 上書きする)。
  fetchDetectedPreview: vi.fn(async () => []),
  // Phase 1.14: estcode_df.csv由来の盤情報。productPageOutline.panelsと対応する
  // 固定fixtureを返す (右ペイン連動テストが意味のある値で検証できるようにする)。
  fetchEstimatePanels: vi.fn(async () => estimatePanelsFixture),
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
  // 積算明細強化・Undo/Redo・要確認警告・編集追従 指示8章: BBox本体はidで特定した
  // 元のDetectionを基準に更新する (実Backendの既存仕様と同じく、bbox_x/y/w/h以外の
  // 項目(master_item_id/source_type等)は変更しない。以前は常に`detectionOnOutline`を
  // 基準にしていたため、masterLinkedDetectionOnOutline(101)を更新すると
  // master_item_idがnullへ化けてしまっていた)。
  // 盤情報1行化・3領域リサイズ拡張・Redo時引出線回帰修正 指示7章: leader_label_x/yも
  // 送られた場合はそのまま反映する(以前はbboxのみ反映しラベル更新を黙って捨てていた。
  // Undo/Redoを跨いだラベル位置追従のテストにはこの反映が必須)。
  updateDetectionBBox: vi.fn(async (id: number, rect: Record<string, number>): Promise<Detection> => {
    const base =
      [detectionOnOutline, masterLinkedDetectionOnOutline, tieDetectionOnOutline].find((d) => d.id === id) ??
      detectionOnOutline
    return {
      ...base,
      id,
      bbox_x: rect.bbox_x,
      bbox_y: rect.bbox_y,
      bbox_w: rect.bbox_w,
      bbox_h: rect.bbox_h,
      leader_label_x: rect.leader_label_x ?? base.leader_label_x,
      leader_label_y: rect.leader_label_y ?? base.leader_label_y,
    }
  }),
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

// 次work指示(盤情報UI改善)により、中央Viewerの盤領域Overlay(ProductPanelOverlay)と
// 右ペインの盤情報カード一覧(PanelInfo)の両方が「1/1」「2/1」のような面番号/盤番号
// ラベルを表示するようになったため、`getViewerPanelArea('1/1')`だけでは一意に絞り
// 込めない。中央Viewerの盤領域クリックを検証するテストは、この関数で
// `.drawing-viewer`配下に限定して取得する (右ペインのカードクリックは
// PanelInfo.test.tsxで別途検証する)。
function getViewerPanelArea(label: string): HTMLElement {
  const viewer = document.querySelector('.drawing-viewer') as HTMLElement
  return within(viewer).getByText(label)
}

// 右ペインの盤情報カード(PanelInfo)を盤名称で取得する。
function getPanelInfoCard(banMeisyou: string): HTMLElement {
  const panelInfo = document.querySelector('.panel-info') as HTMLElement
  return within(panelInfo).getByText(banMeisyou).closest('button') as HTMLElement
}

describe('App: 積算明細 → 図面クリック → Viewer → BBox選択 → 一時強調 (積算集約・積算明細UI再構成 指示17章)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('navigates to the referenced page and briefly flashes the BBox, WITHOUT entering selected/editing state (明細遷移後のBBox残留・Hover色・品名列修正 指示1章)', async () => {
    render(<App />)

    // 初期表示 (先頭ページ = 基礎図(P18)) が終わるのを待つ
    await waitFor(() => expect(screen.getAllByText('基礎図(P18)').length).toBeGreaterThan(0))

    // 積算明細(③)の図面リンクをクリック (指示17章: 既存のViewerナビゲーション
    // 機構を再利用する経路そのものをテストする)。
    // 盤フォーカス・積算明細再設計 指示2章: 図面列はページ番号のみ表示するため、
    // 左ペインの図面一覧サムネイル(同じく"P16"というテキストを含む)と紛れないよう
    // .estimate-detail配下に限定して探す。
    const estimateDetail = await waitFor(() => {
      const el = document.querySelector('.estimate-detail')
      if (!el) throw new Error('estimate-detail not rendered yet')
      return el as HTMLElement
    })
    const referenceLink = await within(estimateDetail).findByText('P16')
    fireEvent.click(referenceLink)

    // Viewerの見出しが対象ページ (外形図(P16)) に切り替わること
    await waitFor(() => {
      expect(screen.getAllByText('外形図(P16)').length).toBeGreaterThan(0)
    })

    // 対象BBoxが一時的に強調表示されるが、選択(編集)状態にはならない
    // (次々々work指示1章: navigate/flash/selectの役割分離)。
    await waitFor(() => {
      const bbox = screen.getByTitle(/18999/)
      expect(bbox.className).toContain('detection-overlay__bbox--flash')
      expect(bbox.className).not.toContain('detection-overlay__bbox--selected')
    })
    // 選択(編集)状態ではないため、リサイズハンドルも表示されない。
    expect(screen.queryAllByRole('button', { name: /BBoxサイズ変更/ })).toHaveLength(0)

    // 一定時間後、ESCを押さなくても自動的に強調が解除される (指示1章)。
    // 解除後はmaster-linkedなBBoxのため通常どおり非表示に戻る。
    await waitFor(
      () => {
        expect(screen.queryByTitle(/18999/)).not.toBeInTheDocument()
      },
      { timeout: 3000 },
    )
  }, 10000)
})

describe('App: 積算集約で個別盤を選択した際のViewerフォーカス (盤フォーカス・積算明細再設計 指示1章)', () => {
  async function navigateToOutlinePage() {
    const thumbnail = await screen.findByRole('img', { name: 'P16' })
    fireEvent.click(thumbnail)
    await screen.findByTitle(/roof_fan/)
  }

  it('hides other panels\' BBox and non-focused estimate codes when an individual panel is selected, and restores them on 総合計', async () => {
    render(<App />)
    await navigateToOutlinePage()

    // 初期状態(総合計): 2盤とも見える。masterLinkedDetectionOnOutline(18999)は
    // どちらの盤とも交差しないため製品全体扱いだが、総合計では表示される
    // (リード線ラベルは通常表示なので、これで存在を確認できる)。
    await waitFor(() => expect(document.querySelectorAll('.product-panel-overlay__area')).toHaveLength(2))
    expect(screen.getByText('18999 テスト品目')).toBeInTheDocument()

    // 積算集約(②)のセレクトで「低圧動力盤」(面番号2/盤番号1)を選択する。
    const select = document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'panel:2:1' } })

    // 他盤(高圧受電盤)のBBoxは非表示になり、選択した盤(低圧動力盤)だけが残る。
    // ("1/1"はViewer盤ラベルとPanelInfoカードバッジの両方に出るため、
    //  Viewer(.drawing-viewer)配下に限定して確認する。)
    await waitFor(() => expect(document.querySelectorAll('.product-panel-overlay__area')).toHaveLength(1))
    const viewer = document.querySelector('.drawing-viewer') as HTMLElement
    expect(within(viewer).getByText('2/1')).toBeInTheDocument()
    expect(within(viewer).queryByText('1/1')).not.toBeInTheDocument()

    // 製品全体所属(18999)の引出線・BBoxも、この盤には属さないため非表示になる。
    expect(screen.queryByText('18999 テスト品目')).not.toBeInTheDocument()

    // 「総合計」へ戻すと、非表示にしていた表示が全て復元される (指示13章)。
    fireEvent.change(select, { target: { value: '' } })
    await waitFor(() => expect(document.querySelectorAll('.product-panel-overlay__area')).toHaveLength(2))
    expect(within(viewer).getByText('1/1')).toBeInTheDocument()
    expect(within(viewer).getByText('2/1')).toBeInTheDocument()
    expect(screen.getByText('18999 テスト品目')).toBeInTheDocument()
  })

  it('does not filter panel BBoxes when 製品全体 is selected (盤BBox自体は維持してよい)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    const select = document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'product' } })

    // 製品全体所属(18999)のリード線ラベルは表示され続ける。
    await waitFor(() => expect(screen.getByText('18999 テスト品目')).toBeInTheDocument())
    // 製品全体選択時も盤BBox自体は絞り込まない (指示1章)。
    expect(document.querySelectorAll('.product-panel-overlay__area')).toHaveLength(2)
  })
})

describe('App: 積算対象連動の図面一覧絞り込み・自動ページ移動 (積算対象連動の金額表示・図面一覧絞り込み 指示4章〜7章)', () => {
  function getEstimateTargetSelect(): HTMLSelectElement {
    return document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement
  }

  function getDrawingNavigator(): HTMLElement {
    return document.querySelector('.drawing-navigator') as HTMLElement
  }

  it('shows only the pages related to the selected panel target (高圧受電盤=面1/盤1はP16にのみ存在) in the left drawing list, and auto-navigates away from a now-out-of-scope page', async () => {
    render(<App />)
    // 初期表示は基礎図(P18)。P18には盤情報が無いため、絞り込み前は普通に一覧に出る。
    await waitFor(() => expect(screen.getAllByText('基礎図(P18)').length).toBeGreaterThan(0))
    await waitFor(() => expect(within(getDrawingNavigator()).getByRole('img', { name: 'P18' })).toBeInTheDocument())

    const select = await waitFor(() => getEstimateTargetSelect())
    fireEvent.change(select, { target: { value: 'panel:1:1' } })

    // 現在ページ(P18)は面1/盤1に関係ないため、対象内の先頭ページ(P16)へ自動移動する (指示7章)。
    await waitFor(() => expect(screen.getAllByText('外形図(P16)').length).toBeGreaterThan(0))
    // 図面一覧も面1/盤1に関連するP16だけになり、P18は消える (指示4章)。
    await waitFor(() => {
      const nav = getDrawingNavigator()
      expect(within(nav).getByRole('img', { name: 'P16' })).toBeInTheDocument()
      expect(within(nav).queryByRole('img', { name: 'P18' })).not.toBeInTheDocument()
    })
  })

  it('does not navigate away, and does not clear the current BBox selection, when the current page is already within the selected target\'s pages (指示7章/12章: 不要なページ移動をしない)', async () => {
    render(<App />)
    const thumbnail = await screen.findByRole('img', { name: 'P16' })
    fireEvent.click(thumbnail)
    await screen.findByTitle(/roof_fan/)

    // BBoxを選択しておく (常時表示のAI Detection)。
    fireEvent.click(screen.getByTitle(/roof_fan/))
    await screen.findAllByRole('button', { name: /BBoxサイズ変更/ })

    // 面1/盤1もP16にのみ関連するため、現在ページ(P16)のまま変わらないはず。
    fireEvent.change(getEstimateTargetSelect(), { target: { value: 'panel:1:1' } })

    await waitFor(() => expect(screen.getAllByText('外形図(P16)').length).toBeGreaterThan(0))
    // 不要なページ移動が起きていないため、選択状態もクリアされていない。
    expect(screen.queryAllByRole('button', { name: /BBoxサイズ変更/ }).length).toBeGreaterThan(0)
  })

  it('shows only the page(s) with detail items belonging to 製品全体 when 製品全体 is selected (指示5章)', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getAllByText('基礎図(P18)').length).toBeGreaterThan(0))

    fireEvent.change(await waitFor(() => getEstimateTargetSelect()), { target: { value: 'product' } })

    // 18999(masterLinkedDetectionOnOutline)はどの盤とも交差しないため製品全体扱いで、
    // P16由来。製品全体選択時はP16のみが図面一覧に残るはず。
    await waitFor(() => expect(screen.getAllByText('外形図(P16)').length).toBeGreaterThan(0))
    await waitFor(() => {
      const nav = getDrawingNavigator()
      expect(within(nav).getByRole('img', { name: 'P16' })).toBeInTheDocument()
      expect(within(nav).queryByRole('img', { name: 'P18' })).not.toBeInTheDocument()
    })
  })

  it('restores the full drawing list (all pages) when switching back to 総合計, with no filtering residue (指示10章)', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getAllByText('基礎図(P18)').length).toBeGreaterThan(0))
    const select = await waitFor(() => getEstimateTargetSelect())
    fireEvent.change(select, { target: { value: 'panel:1:1' } })
    await waitFor(() => {
      expect(within(getDrawingNavigator()).queryByRole('img', { name: 'P18' })).not.toBeInTheDocument()
    })

    fireEvent.change(select, { target: { value: '' } })

    await waitFor(() => {
      const nav = getDrawingNavigator()
      expect(within(nav).getByRole('img', { name: 'P16' })).toBeInTheDocument()
      expect(within(nav).getByRole('img', { name: 'P18' })).toBeInTheDocument()
    })
  })
})

describe('App: BBox編集による積算対象追従・Undo/Redo (積算明細強化・Undo/Redo・要確認警告・編集追従 指示8章〜15章)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  async function navigateToOutlinePage() {
    const thumbnail = await screen.findByRole('img', { name: 'P16' })
    fireEvent.click(thumbnail)
    await screen.findByTitle(/roof_fan/)
  }

  function setOverlayRect(width: number, height: number) {
    const el = document.querySelector('.detection-overlay') as HTMLElement
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: width, bottom: height, width, height }),
      configurable: true,
    })
  }

  // masterLinkedDetectionOnOutline(18999)を選択し、面1/盤1(高圧受電盤、
  // rect x:0.1-0.15/y:0.1-0.2)の内側へドラッグで移動する。移動前はどの盤とも
  // 交差しないため対象は「製品全体」。
  async function selectAndDragOnto11001() {
    // 引出線ラベル(button)をクリックして選択する (BBox本体は選択されるまで非表示のため)。
    // 所属変更通知トーストも同じ文字列("18999 テスト品目")を表示しうるため、
    // role='button'で一意に絞り込む。
    fireEvent.click(screen.getByRole('button', { name: '18999 テスト品目' }))
    const bbox = await screen.findByTitle(/18999/)
    setOverlayRect(1000, 1000)
    fireEvent.mouseDown(bbox, { clientX: 500, clientY: 500 })
    fireEvent.mouseMove(window, { clientX: 110, clientY: 140 }) // -0.39, -0.36 → (0.11, 0.14)
    fireEvent.mouseUp(window, { clientX: 110, clientY: 140 })
  }

  it('switches the estimate target, shows a toast, and highlights the row when a BBox edit moves it into a different panel', async () => {
    render(<App />)
    await navigateToOutlinePage()

    await selectAndDragOnto11001()

    // 積算集約の対象が新所属(面1/盤1)へ切り替わる (指示10章)。
    await waitFor(() => {
      const select = document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement
      expect(select.value).toBe('panel:1:1')
    })

    // 所属変更の一時通知 (指示9章)。
    const toast = document.querySelector('.app-layout__target-change-toast') as HTMLElement
    expect(toast).not.toBeNull()
    expect(within(toast).getByText('積算先が変更されました')).toBeInTheDocument()
    expect(within(toast).getByText('18999 テスト品目')).toBeInTheDocument()
    expect(within(toast).getByText('製品全体 → 面1 / 盤1')).toBeInTheDocument()

    // 選択状態は残さず、Viewer側は既存flashで一時強調するだけ (指示13章)。
    const bbox = screen.getByTitle(/18999/)
    expect(bbox.className).toContain('detection-overlay__bbox--flash')
    expect(bbox.className).not.toContain('detection-overlay__bbox--selected')

    // 積算明細側も編集直後として一時強調される (指示5章/13章)。
    const estimateDetail = document.querySelector('.estimate-detail') as HTMLElement
    const detailRow = within(estimateDetail).getByText('18999').closest('tr') as HTMLElement
    expect(detailRow.className).toContain('estimate-detail__row--edit-follow')
  })

  it('does not switch the estimate target while dragging is in progress (only after pointer up)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    fireEvent.click(screen.getByText('18999 テスト品目'))
    const bbox = await screen.findByTitle(/18999/)
    setOverlayRect(1000, 1000)
    fireEvent.mouseDown(bbox, { clientX: 500, clientY: 500 })
    fireEvent.mouseMove(window, { clientX: 110, clientY: 140 }) // ドラッグ中(mouseup前)

    const select = document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement
    expect(select.value).toBe('') // まだ総合計のまま (指示8章: 編集中はUIを切り替えない)

    fireEvent.mouseUp(window, { clientX: 110, clientY: 140 })
    await waitFor(() => expect(select.value).toBe('panel:1:1'))
  })

  it('Undo reverts the BBox position and re-follows the screen back to the original target', async () => {
    render(<App />)
    await navigateToOutlinePage()
    await selectAndDragOnto11001()
    await waitFor(() => {
      const select = document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement
      expect(select.value).toBe('panel:1:1')
    })

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true })

    await waitFor(() => {
      const select = document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement
      // 移動前の所属は「製品全体」(実対象。総合計=nullとは別物) なので、Undoで
      // そこへ追従して戻る。
      expect(select.value).toBe('product')
    })
    expect(screen.getByText('面1 / 盤1 → 製品全体')).toBeInTheDocument()
  })

  it('Redo re-applies the move after an Undo, using Ctrl+Shift+Z', async () => {
    render(<App />)
    await navigateToOutlinePage()
    await selectAndDragOnto11001()
    await waitFor(() => {
      const select = document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement
      expect(select.value).toBe('panel:1:1')
    })

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true }) // Undo
    await waitFor(() => {
      const select = document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement
      expect(select.value).toBe('product')
    })

    fireEvent.keyDown(document, { key: 'Z', ctrlKey: true, shiftKey: true }) // Redo
    await waitFor(() => {
      const select = document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement
      expect(select.value).toBe('panel:1:1')
    })
  })

  it('disables the Undo/Redo toolbar buttons when there is nothing to undo/redo, and enables them appropriately', async () => {
    render(<App />)
    await navigateToOutlinePage()

    const undoButton = screen.getByRole('button', { name: /元に戻す/ })
    const redoButton = screen.getByRole('button', { name: /やり直す/ })
    expect(undoButton).toBeDisabled()
    expect(redoButton).toBeDisabled()

    await selectAndDragOnto11001()
    await waitFor(() => expect(undoButton).not.toBeDisabled())
    expect(redoButton).toBeDisabled()

    fireEvent.click(undoButton)
    await waitFor(() => expect(redoButton).not.toBeDisabled())
  })

  it('a new edit after Undo discards the Redo history (Redo becomes unavailable again)', async () => {
    render(<App />)
    await navigateToOutlinePage()
    await selectAndDragOnto11001()
    await waitFor(() => {
      const select = document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement
      expect(select.value).toBe('panel:1:1')
    })

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true }) // Undo
    const redoButton = screen.getByRole('button', { name: /やり直す/ })
    await waitFor(() => expect(redoButton).not.toBeDisabled())

    // 新しい編集 (もう一度同じ移動) を行うとRedo履歴が破棄される (指示6章)。
    await selectAndDragOnto11001()
    await waitFor(() => expect(redoButton).toBeDisabled())
  })

  it('disables Undo/Redo while an operation is in flight, and ignores a concurrent second Undo request until the first settles (盤情報1行化・3領域リサイズ拡張・Redo時引出線回帰修正 指示6章/7章: 連続実行による競合防止)', async () => {
    render(<App />)
    await navigateToOutlinePage()
    await selectAndDragOnto11001()
    const undoButton = await waitFor(() => {
      const btn = screen.getByRole('button', { name: /元に戻す/ })
      expect(btn).not.toBeDisabled()
      return btn
    })
    const redoButton = screen.getByRole('button', { name: /やり直す/ })

    // updateDetectionBBoxの解決を保留にし、Undo実行中の状態を観察できるようにする。
    const { updateDetectionBBox } = await import('./api/client')
    const deferred: { resolve: ((value: Detection) => void) | null } = { resolve: null }
    vi.mocked(updateDetectionBBox).mockImplementationOnce(
      () =>
        new Promise<Detection>((resolve) => {
          deferred.resolve = resolve
        }),
    )

    fireEvent.click(undoButton)
    await waitFor(() => expect(undoButton).toBeDisabled())
    // 実行中はRedoボタンも操作不可にする (指示6章)。
    expect(redoButton).toBeDisabled()

    // 実行中に追加でUndo/Redoを試みても、ガードにより新たな処理は始まらない
    // (2重にBackend呼び出しが走らないことを、直後のmock呼び出し回数で確認する)。
    const callsBeforeExtra = vi.mocked(updateDetectionBBox).mock.calls.length
    fireEvent.click(undoButton)
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true })
    expect(vi.mocked(updateDetectionBBox).mock.calls.length).toBe(callsBeforeExtra)

    // 保留中のPromiseを解決する (後続テストへ影響を残さないための後始末)。
    deferred.resolve?.({ ...masterLinkedDetectionOnOutline, bbox_x: 0.1, bbox_y: 0.1, bbox_w: 0.05, bbox_h: 0.1 })
  })

  it('shows the tie-confirmation warning banner when a Detection has an equal-area intersection with 2 panels, switches to 要確認 on click, and hides again once resolved (指示7章/11章)', async () => {
    // tieDetectionOnOutline(面1/盤1・面2/盤2の両方と厳密に同じ面積で交差するよう
    // 座標を選んだfixture。BBox所属判定は浮動小数の完全一致(===)で同値判定するため、
    // UI操作(drag)経由の座標では丸め誤差により意図した同値を再現できない。実装
    // 自体は変更しないため、fixture側で確実に同値になる値を用意している)を
    // このテストにだけ含める。
    const allWithTie = [detectionOnOutline, masterLinkedDetectionOnOutline, tieDetectionOnOutline]
    const { fetchDetections } = await import('./api/client')
    // 既定の初期表示ページ(基礎図P18, dbPageId=2)への呼び出しも発生するため、
    // 呼び出し順ではなく引数(drawingPageId)で判定する (mockImplementationOnceの
    // 積み上げでは順序を読み違えやすい)。テスト終了時は既定実装へ戻す。
    vi.mocked(fetchDetections).mockImplementation(async (drawingPageId?: number) => {
      if (drawingPageId === undefined) return allWithTie
      return drawingPageId === 1 ? allWithTie : []
    })

    try {
      render(<App />)
      await navigateToOutlinePage()

      // 最上部に要確認の警告バナーが表示される (指示7章)。
      await waitFor(() => {
        expect(screen.getByText('⚠ 積算先を確定できない項目が 1件あります')).toBeInTheDocument()
      })

      // クリックすると積算集約/積算明細の対象が「要確認」へ切り替わる。
      fireEvent.click(screen.getByText('⚠ 積算先を確定できない項目が 1件あります'))
      await waitFor(() => {
        const select = document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement
        expect(select.value).toBe('__tie__')
      })
      const estimateDetail = document.querySelector('.estimate-detail') as HTMLElement
      expect(within(estimateDetail).getByText('18500')).toBeInTheDocument()

      // 面1/盤1の内側だけへ移動して解消すると、警告が自動的に消える (0件)。
      fireEvent.click(screen.getByRole('button', { name: '18500 テスト品目2' }))
      const bbox = await screen.findByTitle(/18500/)
      setOverlayRect(1000, 1000)
      fireEvent.mouseDown(bbox, { clientX: 500, clientY: 500 })
      fireEvent.mouseMove(window, { clientX: 465, clientY: 500 }) // dx=-0.035 → x: 0.135→0.1 (面2に届かない)
      fireEvent.mouseUp(window, { clientX: 465, clientY: 500 })

      await waitFor(() => {
        expect(screen.queryByText(/積算先を確定できない項目/)).not.toBeInTheDocument()
      })
    } finally {
      // 他のテストへ影響しないよう、既定のfetchDetections実装へ戻す。
      vi.mocked(fetchDetections).mockImplementation(defaultFetchDetectionsImpl)
    }
  })

  it('Ctrl+Z on a focused text input does not trigger the app Undo (does not steal the browser/input\'s own undo, 指示6章)', async () => {
    render(<App />)
    await navigateToOutlinePage()
    await selectAndDragOnto11001()
    await waitFor(() => {
      const select = document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement
      expect(select.value).toBe('panel:1:1')
    })

    const input = document.createElement('input')
    document.body.appendChild(input)
    try {
      fireEvent.keyDown(input, { key: 'z', ctrlKey: true })
      // input内でのCtrl+Zはアプリ側のUndoとして処理されないため、対象は切り替わらない。
      const select = document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement
      expect(select.value).toBe('panel:1:1')
    } finally {
      document.body.removeChild(input)
    }
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

describe('App: 右ペイン3領域(盤情報・積算集約・積算明細)の高さリサイズ (盤情報1行化・3領域リサイズ拡張・Redo時引出線回帰修正 指示3章〜5章)', () => {
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

  it('renders 2 horizontal splitters: 盤情報↔積算集約 and 積算集約↔積算明細, at their initial heights', async () => {
    await renderApp()
    const panelInfoWrap = document.querySelector('.app-workspace__panel-info-wrap') as HTMLElement
    const aggregationWrap = document.querySelector('.app-workspace__estimate-aggregation-wrap') as HTMLElement
    expect(panelInfoWrap.style.height).toBe('180px') // PANEL_INFO_HEIGHT_INITIAL
    expect(aggregationWrap.style.height).toBe('260px') // ESTIMATE_AGGREGATION_HEIGHT_INITIAL

    const panelInfoHandle = screen.getByRole('separator', { name: '盤情報の高さを変更' })
    const aggregationHandle = screen.getByRole('separator', { name: '積算集約の高さを変更' })
    expect(panelInfoHandle.getAttribute('aria-orientation')).toBe('horizontal')
    expect(aggregationHandle.getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('dragging the 盤情報↔積算集約 splitter down enlarges 盤情報, leaving 積算集約 untouched', async () => {
    await renderApp()
    const panelInfoWrap = document.querySelector('.app-workspace__panel-info-wrap') as HTMLElement
    const aggregationWrap = document.querySelector('.app-workspace__estimate-aggregation-wrap') as HTMLElement
    const handle = screen.getByRole('separator', { name: '盤情報の高さを変更' })

    // このsplitterは自分の上(盤情報)/下(積算集約)の境界そのものなので、下へ
    // ドラッグする(delta>0)と盤情報の高さが増える(既存の積算集約↔積算明細
    // splitterと同じ方向の考え方)。
    fireEvent.mouseDown(handle, { clientY: 460, button: 0 })
    fireEvent.mouseMove(window, { clientY: 500 }) // 下へ40px = 盤情報を拡大
    fireEvent.mouseUp(window, { clientY: 500 })

    expect(panelInfoWrap.style.height).toBe('220px')
    expect(aggregationWrap.style.height).toBe('260px') // 変化なし
  })

  it('does not shrink 盤情報 below its minimum height (操作不能にならない最低高さ、指示5章)', async () => {
    await renderApp()
    const panelInfoWrap = document.querySelector('.app-workspace__panel-info-wrap') as HTMLElement
    const handle = screen.getByRole('separator', { name: '盤情報の高さを変更' })

    fireEvent.mouseDown(handle, { clientY: 10000, button: 0 })
    fireEvent.mouseMove(window, { clientY: -100000 }) // 大きく上へ(縮める方向)
    fireEvent.mouseUp(window, { clientY: -100000 })

    expect(panelInfoWrap.style.height).toBe('90px') // PANEL_INFO_HEIGHT_MIN
  })

  it('keeps the existing 積算集約↔積算明細 splitter working independently of the new 盤情報 splitter', async () => {
    await renderApp()
    const aggregationWrap = document.querySelector('.app-workspace__estimate-aggregation-wrap') as HTMLElement
    const panelInfoWrap = document.querySelector('.app-workspace__panel-info-wrap') as HTMLElement
    const handle = screen.getByRole('separator', { name: '積算集約の高さを変更' })

    fireEvent.mouseDown(handle, { clientY: 460, button: 0 })
    fireEvent.mouseMove(window, { clientY: 500 }) // 下へ40px = 積算集約を拡大
    fireEvent.mouseUp(window, { clientY: 500 })

    expect(aggregationWrap.style.height).toBe('300px')
    expect(panelInfoWrap.style.height).toBe('180px') // 変化なし
  })

  it('persists the 盤情報 height in localStorage under its own key, independent of the other pane sizes (指示書26章の保存方式を踏襲)', async () => {
    window.localStorage.setItem('sekisan-navi:panel-info-height', '250')
    await renderApp()
    const panelInfoWrap = document.querySelector('.app-workspace__panel-info-wrap') as HTMLElement
    const aggregationWrap = document.querySelector('.app-workspace__estimate-aggregation-wrap') as HTMLElement
    expect(panelInfoWrap.style.height).toBe('250px')
    expect(aggregationWrap.style.height).toBe('260px') // 独立して既定値のまま
  })
})

describe('App: 右ペイン3領域の折りたたみ (Issue #6: Improve estimation target visibility and collapsible right pane sections)', () => {
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

  it('starts with all 3 sections expanded (指示: 初期表示は3項目ともOPEN)', async () => {
    await renderApp()
    expect(screen.getByRole('button', { name: /盤情報/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /積算集約/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /積算明細/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('separator', { name: '盤情報の高さを変更' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: '積算集約の高さを変更' })).toBeInTheDocument()
  })

  it('collapsing 盤情報 shrinks its wrap to auto height, hides its own splitter, and leaves 積算集約/積算明細 heights untouched', async () => {
    await renderApp()
    const panelInfoWrap = document.querySelector('.app-workspace__panel-info-wrap') as HTMLElement
    const aggregationWrap = document.querySelector('.app-workspace__estimate-aggregation-wrap') as HTMLElement

    fireEvent.click(screen.getByRole('button', { name: /盤情報/ }))

    expect(panelInfoWrap.style.height).toBe('auto')
    expect(screen.queryByRole('separator', { name: '盤情報の高さを変更' })).not.toBeInTheDocument()
    // 積算集約↔積算明細のsplitterはそのまま残る(盤情報の折りたたみとは無関係)。
    expect(screen.getByRole('separator', { name: '積算集約の高さを変更' })).toBeInTheDocument()
    expect(aggregationWrap.style.height).toBe('260px') // 変化なし
  })

  it('re-expanding 盤情報 restores its previously dragged/stored height, not a reset default', async () => {
    window.localStorage.setItem('sekisan-navi:panel-info-height', '250')
    await renderApp()
    const panelInfoWrap = document.querySelector('.app-workspace__panel-info-wrap') as HTMLElement
    const toggle = screen.getByRole('button', { name: /盤情報/ })

    fireEvent.click(toggle) // collapse
    expect(panelInfoWrap.style.height).toBe('auto')
    fireEvent.click(toggle) // expand
    expect(panelInfoWrap.style.height).toBe('250px')
  })

  it('collapsing 積算集約 hides the 積算集約↔積算明細 splitter and lets 積算明細 keep flex:1 (space naturally flows to it)', async () => {
    await renderApp()
    const aggregationWrap = document.querySelector('.app-workspace__estimate-aggregation-wrap') as HTMLElement
    const detailWrap = document.querySelector('.app-workspace__estimate-detail-wrap') as HTMLElement

    fireEvent.click(screen.getByRole('button', { name: /積算集約/ }))

    expect(aggregationWrap.style.height).toBe('auto')
    expect(screen.queryByRole('separator', { name: '積算集約の高さを変更' })).not.toBeInTheDocument()
    expect(detailWrap.style.flex).toBe('1 1 auto')
  })

  it('collapsing 積算明細 lets 積算集約 take over flex:1 (absorbs the freed space) and shrinks 積算明細 to its heading', async () => {
    await renderApp()
    const aggregationWrap = document.querySelector('.app-workspace__estimate-aggregation-wrap') as HTMLElement
    const detailWrap = document.querySelector('.app-workspace__estimate-detail-wrap') as HTMLElement

    fireEvent.click(screen.getByRole('button', { name: /積算明細/ }))

    expect(detailWrap.style.flex).toBe('0 0 auto')
    expect(aggregationWrap.style.flex).toBe('1 1 auto')
    // 積算集約自体は折りたたまれていないため、通常どおり表示され続ける。
    expect(screen.getByRole('button', { name: /積算明細/ })).toHaveAttribute('aria-expanded', 'false')
    // このとき積算集約↔積算明細splitterは、ドラッグしても見た目に反映されない
    // 状態になるため非表示にする。
    expect(screen.queryByRole('separator', { name: '積算集約の高さを変更' })).not.toBeInTheDocument()
  })

  it('does not affect selectedEstimateTargetId / drawing list filtering when a section is collapsed (指示: 他セクションのロジックに影響しない)', async () => {
    await renderApp()
    const select = document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement
    expect(select.value).toBe('') // 総合計のまま

    // 対象を個別盤へ切り替えてから、盤情報を折りたたむ。
    fireEvent.change(select, { target: { value: 'panel:1:1' } })
    await waitFor(() => expect(select.value).toBe('panel:1:1'))

    fireEvent.click(screen.getByRole('button', { name: /盤情報/ }))
    // 積算対象の選択状態は折りたたみと無関係に維持される。
    expect((document.querySelector('.estimate-aggregation__target-select') as HTMLSelectElement).value).toBe(
      'panel:1:1',
    )
  })

  it('does not affect Undo/Redo button state when sections are collapsed', async () => {
    await renderApp()
    const undoButton = screen.getByRole('button', { name: /元に戻す/ })
    const redoButton = screen.getByRole('button', { name: /やり直す/ })
    expect(undoButton).toBeDisabled()
    expect(redoButton).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /盤情報/ }))
    fireEvent.click(screen.getByRole('button', { name: /積算集約/ }))
    fireEvent.click(screen.getByRole('button', { name: /積算明細/ }))

    expect(undoButton).toBeDisabled()
    expect(redoButton).toBeDisabled()
  })
})

describe('App: 盤選択 → 右ペイン連動 (Phase 1.9)', () => {
  async function navigateToOutlinePage() {
    const thumbnail = await screen.findByRole('img', { name: 'P16' })
    fireEvent.click(thumbnail)
    await screen.findByTitle(/roof_fan/)
  }

  it('shows all panels on the page as cards from the start (指示書3章), and marks the clicked one as selected with its estcode_df fields (Phase 1.14/次work指示6章)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    // 次work指示3章: クリック前から現在ページの全盤がカードとして見える。
    expect(screen.getByText('高圧受電盤')).toBeInTheDocument()
    expect(screen.getByText('低圧動力盤')).toBeInTheDocument()
    expect(getPanelInfoCard('高圧受電盤').className).not.toContain('--selected')

    fireEvent.click(getViewerPanelArea('1/1'))

    await waitFor(() => expect(getPanelInfoCard('高圧受電盤').className).toContain('--selected'))
    expect(getPanelInfoCard('低圧動力盤').className).not.toContain('--selected')
    expect(within(getPanelInfoCard('高圧受電盤')).getByText('H 2300 : W 900 : D 2200')).toBeInTheDocument()
  })

  it('switches the selected card immediately when a different panel is clicked in the Viewer, without removing either card from the list (要件6/次work指示3章)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    fireEvent.click(getViewerPanelArea('1/1'))
    await waitFor(() => expect(getPanelInfoCard('高圧受電盤').className).toContain('--selected'))

    fireEvent.click(getViewerPanelArea('2/1'))
    await waitFor(() => expect(getPanelInfoCard('低圧動力盤').className).toContain('--selected'))
    expect(getPanelInfoCard('高圧受電盤').className).not.toContain('--selected')
    // 両カードともDOM上に残り続ける (一覧から消えたりしない)。
    expect(screen.getByText('高圧受電盤')).toBeInTheDocument()
  })

  it('applies the selected/dimmed visual classes to the clicked and other panel areas (要件7/8)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    const areaOne = getViewerPanelArea('1/1').closest('button') as HTMLElement
    const areaTwo = getViewerPanelArea('2/1').closest('button') as HTMLElement
    fireEvent.click(areaOne)

    await waitFor(() => expect(areaOne.className).toContain('--selected'))
    expect(areaTwo.className).toContain('--dimmed')
    expect(areaTwo.className).not.toContain('--selected')
    // 非選択盤も非表示にはしない (DOM上に引き続き存在)
    expect(areaTwo).toBeInTheDocument()
  })

  it('clears the selected panel when switching to a different page, which has no product_df panels of its own (要件8)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    fireEvent.click(getViewerPanelArea('1/1'))
    await waitFor(() => expect(getPanelInfoCard('高圧受電盤').className).toContain('--selected'))

    const foundationThumbnail = await screen.findByRole('img', { name: 'P18' })
    fireEvent.click(foundationThumbnail)

    // P18(基礎図)はfixture上product_df盤を持たないページのため、盤情報は空表示に戻る。
    await waitFor(() => expect(screen.getByText('このページには盤情報がありません')).toBeInTheDocument())
    expect(screen.queryByText('高圧受電盤')).not.toBeInTheDocument()
  })

  it('clears the selected panel on a background click without affecting a real Pan drag (要件10)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    fireEvent.click(getViewerPanelArea('1/1'))
    await waitFor(() => expect(getPanelInfoCard('高圧受電盤').className).toContain('--selected'))

    fireEvent.click(screen.getByRole('button', { name: '背景クリック' }))

    // カード自体は残るが、どのカードも選択状態ではなくなる。
    await waitFor(() => expect(getPanelInfoCard('高圧受電盤').className).not.toContain('--selected'))
    expect(screen.getByText('高圧受電盤')).toBeInTheDocument()
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

    const area = getViewerPanelArea('1/1').closest('button') as HTMLElement
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

    const area = getViewerPanelArea('1/1').closest('button') as HTMLElement
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
    const area = getViewerPanelArea('1/1').closest('button') as HTMLElement
    expect(area).toBeInTheDocument()
    expect(getComputedStyle(area).pointerEvents).toBe('none')
  })

  it('clicking a panel area while a Master row is selected does not change selectedPanel (BBox作業を優先する)', async () => {
    render(<App />)
    await navigateToOutlinePage()

    const row11001 = (await screen.findByText('11001')).closest('tr') as HTMLElement
    fireEvent.click(row11001)
    await waitFor(() => expect(row11001.className).toContain('master-picker__row--selected'))

    fireEvent.click(getViewerPanelArea('1/1'))

    expect(getPanelInfoCard('高圧受電盤').className).not.toContain('--selected')
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
    fireEvent.click(getViewerPanelArea('1/1'))
    await waitFor(() => expect(getPanelInfoCard('高圧受電盤').className).toContain('--selected'))

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(getPanelInfoCard('高圧受電盤').className).not.toContain('--selected'))
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

describe('App: detected_df.csv由来の検出BBoxプレビュー (Phase 1.12)', () => {
  afterEach(async () => {
    vi.clearAllMocks()
    // clearAllMocks()は呼び出し履歴のみリセットし、mockImplementation()で上書きした
    // 実装自体は引き継がれてしまうため、次のテストへ影響しないよう既定の実装
    // (空配列を返す) へ明示的に戻す。
    const { fetchDetectedPreview } = await import('./api/client')
    vi.mocked(fetchDetectedPreview).mockImplementation(async () => [])
  })

  it('fetches the detected preview for the initial page (製番+ページ番号のみで取得。matchingDbPageに依存しない)', async () => {
    const { fetchDetectedPreview } = await import('./api/client')
    render(<App />)

    // 初期表示は基礎図(P18)。matchingDbPage(ダミーDBのDrawingPage)の有無に関係なく
    // 実製番+実ページ番号だけで呼ばれること (指示書1章/18章)。
    await waitFor(() => expect(fetchDetectedPreview).toHaveBeenCalledWith('A1GV2421', 18))
  })

  it('displays all detections returned for the page, and re-fetches (clearing the old page\'s boxes) on page switch (指示書18章)', async () => {
    const { fetchDetectedPreview } = await import('./api/client')
    vi.mocked(fetchDetectedPreview).mockImplementation(async (_productNo: string, pageNo: number) => {
      if (pageNo === 16) {
        return [
          {
            id: 0,
            page_no: 16,
            class_name: 'roof_fan',
            confidence: 0.97,
            normalized_rect: { x: 0.6, y: 0.15, w: 0.03, h: 0.02 },
            source: 'detected_csv',
          },
          {
            id: 1,
            page_no: 16,
            class_name: 'sidedoor_l',
            confidence: 0.85,
            normalized_rect: { x: 0.08, y: 0.17, w: 0.13, h: 0.2 },
            source: 'detected_csv',
          },
        ]
      }
      return []
    })

    render(<App />)
    // 初期表示(P18)は該当なし = 検出BBoxプレビューは出ない。
    await waitFor(() => expect(fetchDetectedPreview).toHaveBeenCalledWith('A1GV2421', 18))
    expect(document.querySelector('.detected-preview-overlay__bbox')).not.toBeInTheDocument()

    // 外形図(P16)へ切り替えると、そのページの検出結果が全件表示される。
    // (page16はテストfixture上、DB側にも同名class_nameの`roof_fan` AI Detectionが
    // 別途存在するため、`.detected-preview-overlay__label`側だけを対象に検証する。
    // Phase 1.12実装時から開示している既知の残課題=同ページでの偶発的な重複であり、
    // 今回のPhase 1.13の変更そのものとは無関係。docs/implementation-plan.md 8.13章参照)。
    const thumbnail = await screen.findByRole('img', { name: 'P16' })
    fireEvent.click(thumbnail)

    // Phase 1.13指示書5章/6章: 通常表示はDEVICE名のみ (confidenceは常時表示しない)。
    await waitFor(() => {
      const labels = Array.from(document.querySelectorAll('.detected-preview-overlay__label')).map(
        (el) => el.textContent,
      )
      expect(labels).toEqual(['roof_fan', 'sidedoor_l'])
    })
  })

  it('shows no detected-preview boxes (empty, not an error) for a page with no detected_df rows', async () => {
    render(<App />)
    const thumbnail = await screen.findByRole('img', { name: 'P16' })
    fireEvent.click(thumbnail)

    await waitFor(() => expect(screen.getAllByText('外形図(P16)').length).toBeGreaterThan(0))
    // 既定モック(fetchDetectedPreview)は空配列を返すため、検出BBoxは1件も出ない。
    expect(document.querySelector('.detected-preview-overlay__bbox')).not.toBeInTheDocument()
    // かつエラーバナーも出ない (指示書26章/27章)。
    expect(document.querySelector('.app-layout__error')).not.toBeInTheDocument()
  })
})
