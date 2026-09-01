import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DrawingCanvas } from './DrawingCanvas'
import { getLatestMockResizeObserver } from '../../testUtils/mockResizeObserver'

// PDF.js自体はネットワーク越しにPDFを取得するため、単体テストでは実描画には依存せず、
// 固定サイズのページを返すフェイクに差し替える (ズーム/パン/BBox作成のロジックのみ検証)。
const NATIVE_WIDTH = 1000
const NATIVE_HEIGHT = 800

vi.mock('../../pdf/pdfjs', () => ({
  pdfjsLib: {
    getDocument: () => ({
      promise: Promise.resolve({
        getPage: () =>
          Promise.resolve({
            getViewport: ({ scale }: { scale: number }) => ({
              width: NATIVE_WIDTH * scale,
              height: NATIVE_HEIGHT * scale,
            }),
            render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
          }),
      }),
    }),
  },
}))

async function renderCanvas(props: Partial<ComponentProps<typeof DrawingCanvas>> = {}) {
  const utils = render(
    <DrawingCanvas
      fileUrl="dummy.pdf"
      fallbackSize={{ width: NATIVE_WIDTH, height: NATIVE_HEIGHT }}
      {...props}
    />,
  )
  const viewport = document.querySelector('.drawing-canvas__viewport') as HTMLElement
  // jsdomはレイアウトを行わないため clientWidth/clientHeight は既定で0。
  // Fit to View (PDFロード完了時に自動実行される) がゼロ除算的にならないよう、
  // PDFロードのPromiseが解決する前 (=Fit実行前) に実ブラウザ相当のサイズを与えておく。
  Object.defineProperty(viewport, 'clientWidth', { value: 500, configurable: true })
  Object.defineProperty(viewport, 'clientHeight', { value: 400, configurable: true })
  Object.defineProperty(viewport, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, right: 500, bottom: 400, width: 500, height: 400 }),
    configurable: true,
  })
  // PDFロード (Promiseチェーン) + Fit to View の完了を待つ。
  // (ズームラベルの初期値は100%なので、そこから変化する = Fit適用済みであることの目印にする)
  await screen.findByText('49%')
  return { ...utils, viewport }
}

describe('DrawingCanvas', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not start drawing / does not call onCreateBBox when bboxAddMode is off (Pan mode instead)', async () => {
    const onCreateBBox = vi.fn()
    const { viewport } = await renderCanvas({ bboxAddMode: false, onCreateBBox })

    fireEvent.mouseDown(viewport, { button: 0, clientX: 50, clientY: 50 })
    fireEvent.mouseMove(window, { clientX: 150, clientY: 150 })
    fireEvent.mouseUp(window, { clientX: 150, clientY: 150 })

    expect(onCreateBBox).not.toHaveBeenCalled()
    // Pan操作時にプレビュー矩形が描画されないこと
    expect(document.querySelector('.drawing-canvas__draft-rect')).toBeNull()
  })

  it('creates a normalized BBox from a drag when bboxAddMode is on, independent of zoom', async () => {
    const onCreateBBox = vi.fn()
    const { viewport } = await renderCanvas({ bboxAddMode: true, onCreateBBox })

    // Fit to View (clientWidth/Height=500/400, 原寸1000/800) により
    // zoom = min(0.5, 0.5) * FIT_MARGIN(0.98) = 0.49 で確定している前提。
    const ZOOM = 0.49

    // ドラッグ中はプレビュー矩形が表示される
    fireEvent.mouseDown(viewport, { button: 0, clientX: 50, clientY: 40 })
    fireEvent.mouseMove(window, { clientX: 150, clientY: 120 })
    expect(document.querySelector('.drawing-canvas__draft-rect')).not.toBeNull()

    fireEvent.mouseUp(window, { clientX: 150, clientY: 120 })

    expect(onCreateBBox).toHaveBeenCalledTimes(1)
    const rect = onCreateBBox.mock.calls[0][0]
    const expectedX = (50 / ZOOM) / NATIVE_WIDTH
    const expectedY = (40 / ZOOM) / NATIVE_HEIGHT
    const expectedW = ((150 - 50) / ZOOM) / NATIVE_WIDTH
    const expectedH = ((120 - 40) / ZOOM) / NATIVE_HEIGHT
    expect(rect.x).toBeCloseTo(expectedX, 3)
    expect(rect.y).toBeCloseTo(expectedY, 3)
    expect(rect.w).toBeCloseTo(expectedW, 3)
    expect(rect.h).toBeCloseTo(expectedH, 3)
    // プレビューはmouseup後に消えること
    expect(document.querySelector('.drawing-canvas__draft-rect')).toBeNull()
  })

  it('ignores drags shorter than the minimum drag distance (click vs drag)', async () => {
    const onCreateBBox = vi.fn()
    const { viewport } = await renderCanvas({ bboxAddMode: true, onCreateBBox })

    fireEvent.mouseDown(viewport, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 102, clientY: 101 }) // MIN_DRAG_PX(6)未満
    fireEvent.mouseUp(window, { clientX: 102, clientY: 101 })

    expect(onCreateBBox).not.toHaveBeenCalled()
  })

  it('shows a BBox-add-mode indicator and crosshair styling when bboxAddMode is on', async () => {
    const { viewport } = await renderCanvas({ bboxAddMode: true })
    expect(screen.getByText(/BBox追加モード/)).toBeInTheDocument()
    expect(viewport.className).toContain('drawing-canvas__viewport--draw')
  })

  it('does not start Pan or Manual BBox creation when the drag starts on a child button (e.g. an existing BBox or resize handle)', async () => {
    const onCreateBBox = vi.fn()
    const { viewport } = await renderCanvas({
      bboxAddMode: true,
      onCreateBBox,
      children: <button type="button">既存BBoxまたはリサイズハンドル</button>,
    })
    const childButton = screen.getByText('既存BBoxまたはリサイズハンドル')
    const scrollBefore = viewport.scrollLeft

    fireEvent.mouseDown(childButton, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 200, clientY: 200 })
    fireEvent.mouseUp(window, { clientX: 200, clientY: 200 })

    expect(onCreateBBox).not.toHaveBeenCalled()
    expect(document.querySelector('.drawing-canvas__draft-rect')).toBeNull()
    expect(viewport.scrollLeft).toBe(scrollBefore) // Panも起きていない
  })

  it('calls onBackgroundClick for a plain click on empty space, but not after a real drag', async () => {
    const onBackgroundClick = vi.fn()
    const { viewport } = await renderCanvas({ bboxAddMode: false, onBackgroundClick })

    // 動きのないクリック相当 -> 背景クリックとして通知される
    fireEvent.mouseDown(viewport, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.mouseUp(window, { clientX: 101, clientY: 100 })
    expect(onBackgroundClick).toHaveBeenCalledTimes(1)

    // 実際にドラッグ(Pan)した場合は背景クリックとして扱わない
    fireEvent.mouseDown(viewport, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 150, clientY: 100 })
    fireEvent.mouseUp(window, { clientX: 150, clientY: 100 })
    expect(onBackgroundClick).toHaveBeenCalledTimes(1)
  })

  it('renders a disabled delete button with no selection, and an enabled one with the selection label when a Detection is selected', async () => {
    const onDeleteSelectedDetection = vi.fn()
    const { rerender } = await renderCanvas({ onDeleteSelectedDetection })

    expect(screen.getByRole('button', { name: 'BBox削除' })).toBeDisabled()
    expect(screen.queryByText(/BBox編集/)).not.toBeInTheDocument()

    rerender(
      <DrawingCanvas
        fileUrl="dummy.pdf"
        fallbackSize={{ width: NATIVE_WIDTH, height: NATIVE_HEIGHT }}
        onDeleteSelectedDetection={onDeleteSelectedDetection}
        selectedDetectionLabel="18311"
      />,
    )
    expect(screen.getByText('BBox編集: 18311')).toBeInTheDocument()
    const deleteButton = screen.getByRole('button', { name: 'BBox削除' })
    expect(deleteButton).not.toBeDisabled()

    fireEvent.click(deleteButton)
    expect(onDeleteSelectedDetection).toHaveBeenCalledTimes(1)
  })
})

describe('DrawingCanvas: pngモード (Phase 1.8重要仕様訂正 — 実製番の中央Viewerはpngを使用)', () => {
  async function renderPngCanvas(props: Partial<ComponentProps<typeof DrawingCanvas>> = {}) {
    const utils = render(
      <DrawingCanvas
        fileUrl="/api/products/A1TEST01/drawings/16/thumbnail"
        mode="png"
        fallbackSize={{ width: NATIVE_WIDTH, height: NATIVE_HEIGHT }}
        {...props}
      />,
    )
    const viewport = document.querySelector('.drawing-canvas__viewport') as HTMLElement
    Object.defineProperty(viewport, 'clientWidth', { value: 500, configurable: true })
    Object.defineProperty(viewport, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 500, bottom: 400, width: 500, height: 400 }),
      configurable: true,
    })
    const preloadImg = document.querySelector('.drawing-canvas__preload-img') as HTMLImageElement
    Object.defineProperty(preloadImg, 'naturalWidth', { value: NATIVE_WIDTH, configurable: true })
    Object.defineProperty(preloadImg, 'naturalHeight', { value: NATIVE_HEIGHT, configurable: true })
    fireEvent.load(preloadImg)
    // Fit to View (画像ロード完了時に自動実行される) の完了を待つ (100% -> 49%)。
    await screen.findByText('49%')
    return { ...utils, viewport, preloadImg }
  }

  it('loads native size from the PNG (naturalWidth/naturalHeight), not from a PDF page, and Fits to it', async () => {
    const { viewport } = await renderPngCanvas()
    const content = viewport.querySelector('.drawing-canvas__content') as HTMLElement
    // Fit後、49% (500/1000 or 400/800 の小さい方 * FIT_MARGIN(0.98) = 0.49) の
    // zoomがcontentのwidth/heightへ反映されていること。
    expect(content.style.width).toBe(`${0.49 * NATIVE_WIDTH}px`)
    expect(content.style.height).toBe(`${0.49 * NATIVE_HEIGHT}px`)
  })

  it('renders the visible <img> with the given fileUrl inside the content area', async () => {
    const { viewport } = await renderPngCanvas({ fileUrl: '/api/products/A1TEST01/drawings/16/thumbnail' })
    const img = viewport.querySelector('.drawing-canvas__canvas') as HTMLImageElement
    expect(img.tagName).toBe('IMG')
    expect(img.src).toContain('/api/products/A1TEST01/drawings/16/thumbnail')
  })

  it('shows an error message instead of crashing when the PNG fails to load', async () => {
    render(
      <DrawingCanvas
        fileUrl="/api/products/A1TEST01/drawings/999/thumbnail"
        mode="png"
        fallbackSize={{ width: NATIVE_WIDTH, height: NATIVE_HEIGHT }}
      />,
    )
    const preloadImg = document.querySelector('.drawing-canvas__preload-img') as HTMLImageElement
    fireEvent.error(preloadImg)

    expect(await screen.findByText(/画像を読み込めませんでした/)).toBeInTheDocument()
  })

  it('creates a normalized BBox from a drag in png mode, based on the PNG native size', async () => {
    const onCreateBBox = vi.fn()
    const { viewport } = await renderPngCanvas({ bboxAddMode: true, onCreateBBox })
    const ZOOM = 0.49

    fireEvent.mouseDown(viewport, { button: 0, clientX: 50, clientY: 40 })
    fireEvent.mouseMove(window, { clientX: 150, clientY: 120 })
    fireEvent.mouseUp(window, { clientX: 150, clientY: 120 })

    expect(onCreateBBox).toHaveBeenCalledTimes(1)
    const rect = onCreateBBox.mock.calls[0][0]
    expect(rect.x).toBeCloseTo((50 / ZOOM) / NATIVE_WIDTH, 3)
    expect(rect.y).toBeCloseTo((40 / ZOOM) / NATIVE_HEIGHT, 3)
  })
})

describe('DrawingCanvas: Viewer自動Fit (実画面未達 追加修正指示18章〜35章)', () => {
  async function renderPngCanvasForFit(props: Partial<ComponentProps<typeof DrawingCanvas>> = {}) {
    const utils = render(
      <DrawingCanvas
        fileUrl="/api/products/A1TEST01/drawings/16/thumbnail"
        mode="png"
        fallbackSize={{ width: NATIVE_WIDTH, height: NATIVE_HEIGHT }}
        {...props}
      />,
    )
    const viewport = document.querySelector('.drawing-canvas__viewport') as HTMLElement
    Object.defineProperty(viewport, 'clientWidth', { value: 500, configurable: true })
    Object.defineProperty(viewport, 'clientHeight', { value: 400, configurable: true })
    Object.defineProperty(viewport, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 500, bottom: 400, width: 500, height: 400 }),
      configurable: true,
    })
    const preloadImg = document.querySelector('.drawing-canvas__preload-img') as HTMLImageElement
    Object.defineProperty(preloadImg, 'naturalWidth', { value: NATIVE_WIDTH, configurable: true })
    Object.defineProperty(preloadImg, 'naturalHeight', { value: NATIVE_HEIGHT, configurable: true })
    fireEvent.load(preloadImg)
    await screen.findByText('49%') // 初期表示は常にfitモード (要件30)
    return { ...utils, viewport, preloadImg }
  }

  it('starts in fit mode: initial zoom is computed from the viewport size (500x400 vs native 1000x800 → 49%)', async () => {
    await renderPngCanvasForFit()
    expect(screen.getByText('49%')).toBeInTheDocument()
  })

  it('resets scroll to the top-left (0,0) after fitting (要件19/22)', async () => {
    const { viewport } = await renderPngCanvasForFit()
    viewport.scrollLeft = 123
    viewport.scrollTop = 45

    const observer = getLatestMockResizeObserver()
    observer.trigger(viewport, { width: 500, height: 400 })
    await vi.waitFor(() => expect(viewport.scrollLeft).toBe(0))
    expect(viewport.scrollTop).toBe(0)
  })

  it('re-fits automatically when the Viewer available area shrinks, while still in fit mode (右/左ペイン・Master高さ・windowリサイズ共通の仕組み)', async () => {
    const { viewport } = await renderPngCanvasForFit()

    // 右ペインを広げてViewerの利用可能幅が縮んだ状況を再現する (250x400)。
    Object.defineProperty(viewport, 'clientWidth', { value: 250, configurable: true })
    Object.defineProperty(viewport, 'clientHeight', { value: 400, configurable: true })
    const observer = getLatestMockResizeObserver()
    observer.trigger(viewport, { width: 250, height: 400 })

    // scaleX = 250/1000 = 0.25, scaleY = 400/800 = 0.5 → min(0.25,0.5)*0.98 = 24.5%
    await screen.findByText('25%')
  })

  it('re-fits when the Viewer available area grows too (Master高さを縮めてViewerが広がる想定)', async () => {
    const { viewport } = await renderPngCanvasForFit()

    Object.defineProperty(viewport, 'clientWidth', { value: 1000, configurable: true })
    Object.defineProperty(viewport, 'clientHeight', { value: 800, configurable: true })
    const observer = getLatestMockResizeObserver()
    observer.trigger(viewport, { width: 1000, height: 800 })

    // scaleX = 1000/1000 = 1.0, scaleY = 800/800 = 1.0 → min(1,1)*0.98 = 98%
    await screen.findByText('98%')
  })

  it('does NOT auto re-fit after the user has manually zoomed (+ button) — respects manual mode (要件27)', async () => {
    const { viewport } = await renderPngCanvasForFit()

    fireEvent.click(screen.getByTitle('拡大'))
    await screen.findByText('61%') // 49% * 1.25 ≈ 61%

    const observer = getLatestMockResizeObserver()
    observer.trigger(viewport, { width: 250, height: 400 }) // レイアウト変更が起きても...

    // 手動Zoom後はfitへ戻らないため、61%のまま変化しない。
    expect(screen.getByText('61%')).toBeInTheDocument()
  })

  it('does NOT auto re-fit after the user has manually zoomed via the mouse wheel', async () => {
    const { viewport } = await renderPngCanvasForFit()

    fireEvent.wheel(viewport, { deltaY: -100 })
    await vi.waitFor(() => expect(screen.queryByText('49%')).not.toBeInTheDocument())

    const observer = getLatestMockResizeObserver()
    observer.trigger(viewport, { width: 250, height: 400 })

    // どちらのzoom値であれ、wheel後の値のまま (250x400へのfit値である25%にはならない)。
    expect(screen.queryByText('25%')).not.toBeInTheDocument()
  })

  it('does NOT auto re-fit after a real manual Pan drag (movement past the click/drag threshold)', async () => {
    const { viewport } = await renderPngCanvasForFit()

    fireEvent.mouseDown(viewport, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.mouseMove(window, { clientX: 150, clientY: 100 }) // 6px超の実移動
    fireEvent.mouseUp(window, { clientX: 150, clientY: 100 })

    const observer = getLatestMockResizeObserver()
    observer.trigger(viewport, { width: 250, height: 400 })

    // Pan後はmanualモードのため、レイアウト変更があってもズームは変化しない (49%のまま)。
    expect(screen.getByText('49%')).toBeInTheDocument()
  })

  it('a plain background click (no real drag) does NOT switch to manual mode — still re-fits on later resize', async () => {
    const { viewport } = await renderPngCanvasForFit()

    fireEvent.mouseDown(viewport, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.mouseUp(window, { clientX: 101, clientY: 100 }) // ほぼ動いていない = クリック

    Object.defineProperty(viewport, 'clientWidth', { value: 250, configurable: true })
    Object.defineProperty(viewport, 'clientHeight', { value: 400, configurable: true })
    const observer = getLatestMockResizeObserver()
    observer.trigger(viewport, { width: 250, height: 400 })

    await screen.findByText('25%') // fitモードのまま維持されているため再Fitされる
  })

  it('the Fit button switches back to fit mode and immediately re-fits to the current viewport size (要件28)', async () => {
    const { viewport } = await renderPngCanvasForFit()

    fireEvent.click(screen.getByTitle('拡大'))
    await screen.findByText('61%')

    // レイアウトも変わった状態で明示的にFitボタンを押す。
    Object.defineProperty(viewport, 'clientWidth', { value: 250, configurable: true })
    Object.defineProperty(viewport, 'clientHeight', { value: 400, configurable: true })
    fireEvent.click(screen.getByTitle('Fit to View'))

    await screen.findByText('25%')

    // 以後は再びfitモードなので、レイアウト変更に追従する。
    Object.defineProperty(viewport, 'clientWidth', { value: 1000, configurable: true })
    Object.defineProperty(viewport, 'clientHeight', { value: 800, configurable: true })
    const observer = getLatestMockResizeObserver()
    observer.trigger(viewport, { width: 1000, height: 800 })
    await screen.findByText('98%')
  })

  it('keeps Overlay children positioned correctly (percentage-based) regardless of how zoom changed (auto-fit vs manual)', async () => {
    const { viewport } = await renderPngCanvasForFit({
      children: <div data-testid="overlay-child" style={{ position: 'absolute', left: '10%', top: '20%' }} />,
    })
    const observer = getLatestMockResizeObserver()
    observer.trigger(viewport, { width: 250, height: 400 })
    await screen.findByText('25%')

    const child = screen.getByTestId('overlay-child')
    expect(child.style.left).toBe('10%')
    expect(child.style.top).toBe('20%')
  })
})
