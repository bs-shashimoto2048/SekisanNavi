// 実画面未達 修正指示: 「盤領域をクリックしても選択されない」という実ブラウザでの
// 不具合について、App.test.tsx側は`DrawingCanvas`を丸ごとスタブ化しているため、
// 実際の`.detection-overlay`/`.product-panel-overlay`のCSS(pointer-events/z-index)を
// 一切経由しない状態でしかテストできていなかった (14章/15章)。
// このファイルはDrawingCanvasも含めて実コンポーネントをそのままレンダリングし、
// 実際に発生していた原因 ── `.detection-overlay`コンテナがpointer-eventsを
// 明示していなかったため既定のautoのままViewer全域のクリックを奪い、下(paint順)の
// 盤領域<button>へクリックが届かなくなっていたこと ── を、実際のCSSカスケード結果
// (getComputedStyle, vite.config.tsのcss:true) で検証する。
//
// 注意 (誠実な限界の明記): jsdomはレイアウトエンジンを持たず、実ブラウザのような
// 「画面上の座標に対して最前面の要素を解決する」ヒットテストは行わない。
// `fireEvent.click(el)`は常に指定したDOM要素へ直接dispatchされるため、このテストは
// 「pointer-events/z-indexのCSS宣言が意図通りcascadeされていること」と
// 「クリックイベントの配線(onClick→state更新)が正しく繋がっていること」までしか
// 保証できず、実ブラウザでの見た目上の重なりによるクリック奪い合いそのものは
// 再現・証明できない。実ブラウザでの最終確認は別途必要。
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DrawingViewer } from './DrawingViewer'
import type { DetectedPreviewItem, Detection, PanelPreview } from '../../types/domain'

// DrawingCanvasは(mode="png"でも)モジュール読み込み時にpdfjs-distへ依存しており、
// jsdomにはpdfjsが要求するDOMMatrix等が無いため、DrawingCanvas.test.tsxと同じく
// フェイクに差し替える (pngモードのテストでは実際には使用されない)。
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

function makeDetection(overrides: Partial<Detection> = {}): Detection {
  return {
    id: 100,
    drawing_page_id: 1,
    panel_id: null,
    class_name: 'roof_fan',
    bbox_x: 0.6,
    bbox_y: 0.6,
    bbox_w: 0.1,
    bbox_h: 0.1,
    confidence: 0.9,
    status: 'needs_review',
    source_type: 'ai',
    master_item_id: null,
    leader_label_x: null,
    leader_label_y: null,
    master_item_category: null,
    master_item_model: null,
    master_item_code: null,
    ...overrides,
  }
}

function makePanel(overrides: Partial<PanelPreview> = {}): PanelPreview {
  return {
    page_no: 16,
    ban_menno: 5,
    ban_no: 5,
    ban_meisyou: 'No.2-1低圧動力盤',
    ban_type: '正面図',
    ban_h1: 2300,
    ban_h2: 2300,
    ban_w: 1700,
    ban_d: 2200,
    normalized_rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
    ...overrides,
  }
}

async function renderViewer(props: {
  panels?: PanelPreview[]
  detections?: Detection[]
  detectedPreview?: DetectedPreviewItem[]
  selectedPanelKey?: string | null
  selectedDetectionId?: number | null
  onSelectPanel?: (key: string, panel: PanelPreview) => void
}) {
  const onSelectPanel = props.onSelectPanel ?? vi.fn()
  const utils = render(
    <DrawingViewer
      productNo="A1GV2421"
      pageNo={16}
      pageImageUrl="/api/products/A1GV2421/drawings/16/thumbnail"
      pageLabel="外形図(P16)"
      panels={props.panels ?? []}
      selectedPanelKey={props.selectedPanelKey ?? null}
      onSelectPanel={onSelectPanel}
      detectedPreview={props.detectedPreview ?? []}
      detections={props.detections ?? []}
      selectedDetectionId={props.selectedDetectionId ?? null}
      highlightedDetectionId={null}
      onSelectDetection={() => {}}
      bboxAddMode={false}
      onCreateBBox={() => {}}
      onResizeDetection={() => {}}
      onMoveDetectionLabel={() => {}}
      onDeleteSelectedDetection={() => {}}
      onDeselectDetection={() => {}}
    />,
  )
  const viewport = document.querySelector('.drawing-canvas__viewport') as HTMLElement
  Object.defineProperty(viewport, 'clientWidth', { value: 500, configurable: true })
  Object.defineProperty(viewport, 'clientHeight', { value: 400, configurable: true })
  const preloadImg = document.querySelector('.drawing-canvas__preload-img') as HTMLImageElement
  Object.defineProperty(preloadImg, 'naturalWidth', { value: NATIVE_WIDTH, configurable: true })
  Object.defineProperty(preloadImg, 'naturalHeight', { value: NATIVE_HEIGHT, configurable: true })
  fireEvent.load(preloadImg)
  // Fit to View (画像ロード完了時に自動実行される) の完了を待つ (100% -> 49%)。
  // これにより`.drawing-canvas__content`(and Overlay類)が実際にレンダリングされる
  // ところまで待機できる (DrawingCanvas.test.tsxと同じ待機パターン)。
  await screen.findByText('49%')
  return { ...utils, viewport, onSelectPanel }
}

describe('DrawingViewer (実画面未達 修正指示: Overlayレイヤーのpointer-events/z-index契約)', () => {
  it('the DetectionOverlay container itself does not capture pointer events (pointer-events: none)', async () => {
    await renderViewer({ panels: [makePanel()], detections: [] })
    const detectionOverlay = document.querySelector('.detection-overlay') as HTMLElement
    expect(getComputedStyle(detectionOverlay).pointerEvents).toBe('none')
  })

  it('individual Detection BBoxes remain clickable despite the container being pointer-events:none', async () => {
    await renderViewer({ detections: [makeDetection()] })
    const bbox = document.querySelector('.detection-overlay__bbox') as HTMLElement
    expect(getComputedStyle(bbox).pointerEvents).toBe('auto')
  })

  it('resize handles remain clickable/draggable despite the container being pointer-events:none', async () => {
    // ハンドルは選択中BBoxにのみ表示される。DrawingViewerはstateless(選択状態は
    // 親App側)のため、selectedDetectionIdを最初から指定して選択済み状態で描画する。
    await renderViewer({
      detections: [makeDetection({ id: 1, status: 'reviewed' })],
      selectedDetectionId: 1,
    })
    const handle = document.querySelector('.detection-overlay__handle') as HTMLElement
    expect(handle).not.toBeNull()
    expect(getComputedStyle(handle).pointerEvents).toBe('auto')
  })

  it('product_df panel areas remain clickable (pointer-events: auto)', async () => {
    await renderViewer({ panels: [makePanel()] })
    const area = document.querySelector('.product-panel-overlay__area') as HTMLElement
    expect(getComputedStyle(area).pointerEvents).toBe('auto')
  })

  it('z-index ordering matches the documented layer contract: BBox(20) > panel area(10)', async () => {
    await renderViewer({ panels: [makePanel()], detections: [makeDetection()] })
    const panelOverlay = document.querySelector('.product-panel-overlay') as HTMLElement
    const detectionOverlay = document.querySelector('.detection-overlay') as HTMLElement
    const panelZ = Number(getComputedStyle(panelOverlay).zIndex)
    const detectionZ = Number(getComputedStyle(detectionOverlay).zIndex)
    expect(detectionZ).toBeGreaterThan(panelZ)
  })

  it('clicking a panel area (no overlapping BBox) still reaches onSelectPanel end-to-end through the real (non-stubbed) DrawingCanvas/Overlay tree', async () => {
    const panel = makePanel({ ban_menno: 5, ban_no: 5 })
    const { onSelectPanel } = await renderViewer({
      panels: [panel],
      detections: [makeDetection({ bbox_x: 0.6, bbox_y: 0.6 })], // 重ならない位置
    })
    fireEvent.click(screen.getByText('5/5'))
    expect(onSelectPanel).toHaveBeenCalled()
  })
})

describe('DrawingViewer フォントサイズ (全体フォント拡大・BBox編集追従回帰修正 指示1章: 旧「第4ラウンド」の縮小方針から一転し、全体を引き上げる)', () => {
  const ROOT_FONT_SIZE_PX = 15 // index.cssの:root font-size (指示1章で14px→15pxへ引き上げ)

  it('the heading font-size is clearly larger than the old 0.85rem(≒11.9px), landing in a comfortably readable range', async () => {
    await renderViewer({})
    const heading = document.querySelector('.drawing-viewer__heading') as HTMLElement
    const px = parseFloat(getComputedStyle(heading).fontSize) * ROOT_FONT_SIZE_PX
    expect(px).toBeGreaterThan(11.9) // 旧値(0.85rem×14px≒11.9px)より明確に大きい
    expect(px).toBeLessThanOrEqual(18) // 見出しとして過大にはしない
  })

  it('the toolbar button/zoom-label font-size is clearly larger than before, without becoming oversized', async () => {
    await renderViewer({})
    const button = document.querySelector('.drawing-canvas__toolbar button') as HTMLElement
    const zoomLabel = document.querySelector('.drawing-canvas__zoom-label') as HTMLElement
    const buttonPx = parseFloat(getComputedStyle(button).fontSize) * ROOT_FONT_SIZE_PX
    const zoomPx = parseFloat(getComputedStyle(zoomLabel).fontSize) * ROOT_FONT_SIZE_PX
    expect(buttonPx).toBeGreaterThan(11.2) // 旧値(0.8rem×14px=11.2px)より大きい
    expect(zoomPx).toBeGreaterThan(10.9) // 旧値(0.78rem×14px≒10.9px)より大きい
    expect(buttonPx).toBeLessThanOrEqual(16) // ボタン高さだけ過剰にならない範囲に収める
    expect(zoomPx).toBeLessThanOrEqual(16)
  })
})

describe('DrawingViewer: detected_df.csv由来の検出BBoxプレビューのLayer順序 (Phase 1.12指示書12章)', () => {
  function makeDetectedPreviewItem(overrides: Partial<DetectedPreviewItem> = {}): DetectedPreviewItem {
    return {
      id: 0,
      page_no: 16,
      class_name: 'roof_fan',
      confidence: 0.97,
      normalized_rect: { x: 0.6, y: 0.15, w: 0.03, h: 0.02 },
      source: 'detected_csv',
      ...overrides,
    }
  }

  it('renders the detected-preview overlay, positioned between product_df盤領域(10) and 引出線/Manual BBox(15/20)', async () => {
    await renderViewer({ detectedPreview: [makeDetectedPreviewItem()] })
    const panelOverlay = document.querySelector('.product-panel-overlay') as HTMLElement
    const detectedOverlay = document.querySelector('.detected-preview-overlay') as HTMLElement
    const detectionOverlay = document.querySelector('.detection-overlay') as HTMLElement
    const panelZ = Number(getComputedStyle(panelOverlay).zIndex)
    const detectedZ = Number(getComputedStyle(detectedOverlay).zIndex)
    const detectionZ = Number(getComputedStyle(detectionOverlay).zIndex)
    expect(detectedZ).toBeGreaterThan(panelZ)
    expect(detectionZ).toBeGreaterThan(detectedZ)
  })

  it('shows the detected-preview BBox on top of the real (non-stubbed) DrawingCanvas/Overlay tree', async () => {
    await renderViewer({ detectedPreview: [makeDetectedPreviewItem({ class_name: 'roof_fan', confidence: 0.97 })] })
    expect(screen.getByText('roof_fan')).toBeInTheDocument()
  })

  it('does not block clicks on the product_df panel area underneath it (指示書12章: 表示専用でpointer-eventsを奪わない)', async () => {
    const panel = makePanel({ ban_menno: 5, ban_no: 5 })
    const { onSelectPanel } = await renderViewer({
      panels: [panel],
      detectedPreview: [makeDetectedPreviewItem({ normalized_rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } })],
    })
    fireEvent.click(screen.getByText('5/5'))
    expect(onSelectPanel).toHaveBeenCalled()
  })
})
