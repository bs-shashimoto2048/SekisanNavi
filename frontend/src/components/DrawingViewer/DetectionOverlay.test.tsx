import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DetectionOverlay } from './DetectionOverlay'
import type { PreviewBBox } from './DetectionOverlay'
import type { Detection } from '../../types/domain'
import type { NormalizedRect } from '../../utils/bbox'

/**
 * previewBBoxを実際にDrawingViewer.tsxが行う通りに"lift"して保持する薄いラッパー
 * (Phase 1.11 追加修正11章〜17章)。onPreviewBBoxChangeへ渡した素の`vi.fn()`は
 * 呼ばれたかどうかしか検証できず、「controlled propが実際に更新されて再描画される」
 * という本番の流れ(mousemove→親re-render→mouseup時には最新previewBBoxを読める)を
 * 再現できないため、このコンポーネントテストではこのハーネスを使う。
 */
function ControlledPreviewHarness({
  detection,
  onResizeDetection,
}: {
  detection: Detection
  onResizeDetection: (detectionId: number, rect: NormalizedRect) => void
}) {
  const [previewBBox, setPreviewBBox] = useState<PreviewBBox | null>(null)
  return (
    <DetectionOverlay
      detections={[detection]}
      selectedDetectionId={detection.id}
      highlightedDetectionId={null}
      onSelectDetection={() => {}}
      onResizeDetection={onResizeDetection}
      previewBBox={previewBBox}
      onPreviewBBoxChange={(detectionId, rect) =>
        setPreviewBBox(rect ? { detectionId, rect } : null)
      }
    />
  )
}

function makeDetection(overrides: Partial<Detection>): Detection {
  return {
    id: 1,
    drawing_page_id: 1,
    panel_id: null,
    class_name: 'roof_fan',
    bbox_x: 0.25,
    bbox_y: 0.15,
    bbox_w: 0.05,
    bbox_h: 0.03,
    confidence: 0.9,
    status: 'pending',
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

describe('DetectionOverlay', () => {
  it('converts normalized [0,1] bbox to percentage-based CSS position (resize-independent)', () => {
    const detection = makeDetection({ bbox_x: 0.25, bbox_y: 0.15, bbox_w: 0.05, bbox_h: 0.03 })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={null}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
      />,
    )
    const bbox = screen.getByTitle(/roof_fan/)
    expect(bbox.style.left).toBe('25%')
    expect(bbox.style.top).toBe('15%')
    expect(bbox.style.width).toBe('5%')
    expect(bbox.style.height).toBe('3%')
  })

  it('applies a distinct class per status (通常/要確認/除外/確認済み)', () => {
    const detections = [
      makeDetection({ id: 1, status: 'pending' }),
      makeDetection({ id: 2, status: 'needs_review' }),
      makeDetection({ id: 3, status: 'excluded' }),
      makeDetection({ id: 4, status: 'reviewed' }),
    ]
    render(
      <DetectionOverlay
        detections={detections}
        selectedDetectionId={null}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
      />,
    )
    const buttons = screen.getAllByTitle(/roof_fan/)
    expect(buttons[0].className).toContain('detection-overlay__bbox--pending')
    expect(buttons[1].className).toContain('detection-overlay__bbox--needs_review')
    expect(buttons[2].className).toContain('detection-overlay__bbox--excluded')
    expect(buttons[3].className).toContain('detection-overlay__bbox--reviewed')
  })

  it('marks the selected detection and calls onSelectDetection on click', () => {
    const onSelectDetection = vi.fn()
    const detection = makeDetection({ id: 42 })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={null}
        highlightedDetectionId={null}
        onSelectDetection={onSelectDetection}
      />,
    )
    fireEvent.click(screen.getByTitle(/roof_fan/))
    expect(onSelectDetection).toHaveBeenCalledWith(42)
  })

  it('visually distinguishes manual BBoxes from AI detections (class + label icon)', () => {
    const detections = [
      makeDetection({ id: 1, source_type: 'ai' }),
      makeDetection({ id: 2, source_type: 'manual', class_name: '11001' }),
    ]
    render(
      <DetectionOverlay
        detections={detections}
        selectedDetectionId={null}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
      />,
    )
    const aiButton = screen.getByTitle(/roof_fan.*confidence/)
    const manualButton = screen.getByTitle(/11001.*手動追加/)
    expect(aiButton.className).not.toContain('--manual')
    expect(manualButton.className).toContain('detection-overlay__bbox--manual')
    expect(manualButton.textContent).toContain('✎')
  })

  it('applies the flash class only to the highlighted detection', () => {
    const detections = [makeDetection({ id: 1 }), makeDetection({ id: 2 })]
    render(
      <DetectionOverlay
        detections={detections}
        selectedDetectionId={null}
        highlightedDetectionId={2}
        onSelectDetection={() => {}}
      />,
    )
    const buttons = screen.getAllByTitle(/roof_fan/)
    expect(buttons[0].className).not.toContain('--flash')
    expect(buttons[1].className).toContain('detection-overlay__bbox--flash')
  })
})

describe('DetectionOverlay: 四隅リサイズハンドル (Phase 1.7)', () => {
  function setOverlayRect(width: number, height: number) {
    const el = document.querySelector('.detection-overlay') as HTMLElement
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: width, bottom: height, width, height }),
      configurable: true,
    })
  }

  it('shows 4 corner handles only for the selected detection', () => {
    const detections = [makeDetection({ id: 1 }), makeDetection({ id: 2 })]
    render(
      <DetectionOverlay
        detections={detections}
        selectedDetectionId={1}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
      />,
    )
    const handles = screen.getAllByRole('button', { name: /BBoxサイズ変更/ })
    expect(handles).toHaveLength(4)
    expect(handles.map((h) => h.getAttribute('aria-label'))).toEqual([
      'BBoxサイズ変更 (top-left)',
      'BBoxサイズ変更 (top-right)',
      'BBoxサイズ変更 (bottom-left)',
      'BBoxサイズ変更 (bottom-right)',
    ])
  })

  it('does not show handles when nothing is selected', () => {
    render(
      <DetectionOverlay
        detections={[makeDetection({ id: 1 })]}
        selectedDetectionId={null}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
      />,
    )
    expect(screen.queryAllByRole('button', { name: /BBoxサイズ変更/ })).toHaveLength(0)
  })

  it('dragging the bottom-right handle resizes toward that corner and reports a normalized rect on mouseup', () => {
    const onResizeDetection = vi.fn()
    const detection = makeDetection({ id: 1, bbox_x: 0.2, bbox_y: 0.2, bbox_w: 0.2, bbox_h: 0.1 })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={1}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
        onResizeDetection={onResizeDetection}
      />,
    )
    setOverlayRect(1000, 1000) // 1px = 0.001 正規化

    const handle = screen.getByRole('button', { name: 'BBoxサイズ変更 (bottom-right)' })
    fireEvent.mouseDown(handle, { clientX: 400, clientY: 300 })
    fireEvent.mouseMove(window, { clientX: 500, clientY: 400 })
    fireEvent.mouseUp(window, { clientX: 500, clientY: 400 })

    expect(onResizeDetection).toHaveBeenCalledTimes(1)
    const [id, rect] = onResizeDetection.mock.calls[0]
    expect(id).toBe(1)
    expect(rect.x).toBeCloseTo(0.2) // top-leftは固定
    expect(rect.y).toBeCloseTo(0.2)
    expect(rect.w).toBeCloseTo(0.3)
    expect(rect.h).toBeCloseTo(0.2)
  })

  it('dragging the top-left handle keeps the bottom-right corner fixed', () => {
    const onResizeDetection = vi.fn()
    const detection = makeDetection({ id: 1, bbox_x: 0.2, bbox_y: 0.2, bbox_w: 0.2, bbox_h: 0.1 })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={1}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
        onResizeDetection={onResizeDetection}
      />,
    )
    setOverlayRect(1000, 1000)

    const handle = screen.getByRole('button', { name: 'BBoxサイズ変更 (top-left)' })
    fireEvent.mouseDown(handle, { clientX: 200, clientY: 200 })
    fireEvent.mouseMove(window, { clientX: 100, clientY: 100 })
    fireEvent.mouseUp(window, { clientX: 100, clientY: 100 })

    const [, rect] = onResizeDetection.mock.calls[0]
    expect(rect.x + rect.w).toBeCloseTo(0.4) // 元のbbox_x+bbox_w=0.4が固定される
    expect(rect.y + rect.h).toBeCloseTo(0.3)
    expect(rect.x).toBeCloseTo(0.1)
    expect(rect.y).toBeCloseTo(0.1)
  })

  it('clamps the dragged corner to the page bounds (0.0-1.0)', () => {
    const onResizeDetection = vi.fn()
    const detection = makeDetection({ id: 1, bbox_x: 0.2, bbox_y: 0.2, bbox_w: 0.2, bbox_h: 0.1 })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={1}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
        onResizeDetection={onResizeDetection}
      />,
    )
    setOverlayRect(1000, 1000)

    const handle = screen.getByRole('button', { name: 'BBoxサイズ変更 (bottom-right)' })
    fireEvent.mouseDown(handle, { clientX: 400, clientY: 300 })
    fireEvent.mouseMove(window, { clientX: 5000, clientY: 5000 }) // ページ外まで大きくドラッグ
    fireEvent.mouseUp(window, { clientX: 5000, clientY: 5000 })

    const [, rect] = onResizeDetection.mock.calls[0]
    expect(rect.x + rect.w).toBeLessThanOrEqual(1)
    expect(rect.y + rect.h).toBeLessThanOrEqual(1)
  })

  it('does not shrink below the minimum BBox size even when dragged past the fixed corner', () => {
    const onResizeDetection = vi.fn()
    const detection = makeDetection({ id: 1, bbox_x: 0.2, bbox_y: 0.2, bbox_w: 0.2, bbox_h: 0.1 })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={1}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
        onResizeDetection={onResizeDetection}
      />,
    )
    setOverlayRect(1000, 1000)

    const handle = screen.getByRole('button', { name: 'BBoxサイズ変更 (bottom-right)' })
    fireEvent.mouseDown(handle, { clientX: 400, clientY: 300 })
    fireEvent.mouseMove(window, { clientX: 0, clientY: 0 }) // 固定角(top-left)より内側へ
    fireEvent.mouseUp(window, { clientX: 0, clientY: 0 })

    const [, rect] = onResizeDetection.mock.calls[0]
    expect(rect.w).toBeGreaterThan(0)
    expect(rect.h).toBeGreaterThan(0)
    expect(rect.w).toBeCloseTo(0.001, 3)
    expect(rect.h).toBeCloseTo(0.001, 3)
  })

  it('reports the live in-progress rect via onPreviewBBoxChange on every mousemove, BEFORE mouseup, and still commits correctly on mouseup (Phase 1.11 追加修正11章〜17章: LeaderLineOverlayが同じ値をリアルタイム追従するために必要)', () => {
    const onResizeDetection = vi.fn()
    const detection = makeDetection({ id: 1, bbox_x: 0.2, bbox_y: 0.2, bbox_w: 0.2, bbox_h: 0.1 })
    const { container } = render(
      <ControlledPreviewHarness detection={detection} onResizeDetection={onResizeDetection} />,
    )
    setOverlayRect(1000, 1000)

    const handle = screen.getByRole('button', { name: 'BBoxサイズ変更 (bottom-right)' })
    fireEvent.mouseDown(handle, { clientX: 400, clientY: 300 })
    // mouseupを送っていない = まだ未確定。それでもmousemove毎にpreviewBBox(親のstate)は
    // 既に更新されており、DBへの保存(onResizeDetection)はまだ行われない (要件14)。
    fireEvent.mouseMove(window, { clientX: 500, clientY: 400 })

    expect(onResizeDetection).not.toHaveBeenCalled() // mouseup前はBackendへ保存しない
    // ドラッグ中でもBBox本体の見た目(プレビュー座標)は既に更新されている
    // (LeaderLineOverlayが同じpreviewBBoxを見て引出線を追従させられることの根拠)。
    const bboxButton = container.querySelector('.detection-overlay__bbox') as HTMLElement
    expect(bboxButton.style.width).toBe('30%') // 0.3
    expect(bboxButton.style.height).toBe('20%') // 0.2

    fireEvent.mouseUp(window, { clientX: 500, clientY: 400 })
    expect(onResizeDetection).toHaveBeenCalledTimes(1) // mouseupで初めて確定
    const [id, rect] = onResizeDetection.mock.calls[0]
    expect(id).toBe(1)
    expect(rect.w).toBeCloseTo(0.3)
    expect(rect.h).toBeCloseTo(0.2)
  })
})

describe('DetectionOverlay: BBox内部dragによる移動 (Phase 1.11 UI改修指示4章)', () => {
  function setOverlayRect(width: number, height: number) {
    const el = document.querySelector('.detection-overlay') as HTMLElement
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: width, bottom: height, width, height }),
      configurable: true,
    })
  }

  it('dragging the selected BBox body moves it (x/y change) while keeping width/height unchanged', () => {
    const onResizeDetection = vi.fn()
    const detection = makeDetection({ id: 1, bbox_x: 0.2, bbox_y: 0.2, bbox_w: 0.2, bbox_h: 0.1 })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={1}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
        onResizeDetection={onResizeDetection}
      />,
    )
    setOverlayRect(1000, 1000) // 1px = 0.001 正規化

    const bbox = screen.getByTitle(/roof_fan/)
    fireEvent.mouseDown(bbox, { clientX: 300, clientY: 300 })
    fireEvent.mouseMove(window, { clientX: 400, clientY: 350 }) // +0.1, +0.05 (超過MIN_DRAG_PX)
    fireEvent.mouseUp(window, { clientX: 400, clientY: 350 })

    expect(onResizeDetection).toHaveBeenCalledTimes(1)
    const [id, rect] = onResizeDetection.mock.calls[0]
    expect(id).toBe(1)
    expect(rect.x).toBeCloseTo(0.3)
    expect(rect.y).toBeCloseTo(0.25)
    expect(rect.w).toBeCloseTo(0.2) // 幅は不変
    expect(rect.h).toBeCloseTo(0.1) // 高さは不変
  })

  it('does not treat a plain click (movement below the threshold) as a move', () => {
    const onResizeDetection = vi.fn()
    const detection = makeDetection({ id: 1, bbox_x: 0.2, bbox_y: 0.2, bbox_w: 0.2, bbox_h: 0.1 })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={1}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
        onResizeDetection={onResizeDetection}
      />,
    )
    setOverlayRect(1000, 1000)

    const bbox = screen.getByTitle(/roof_fan/)
    fireEvent.mouseDown(bbox, { clientX: 300, clientY: 300 })
    fireEvent.mouseMove(window, { clientX: 302, clientY: 301 }) // 2px程度、MIN_DRAG_PX(6)未満
    fireEvent.mouseUp(window, { clientX: 302, clientY: 301 })

    expect(onResizeDetection).not.toHaveBeenCalled()
  })

  it('does not start a move-drag when the BBox is not selected (通常/hover時は移動不可。要件9)', () => {
    const onResizeDetection = vi.fn()
    const detection = makeDetection({ id: 1, bbox_x: 0.2, bbox_y: 0.2, bbox_w: 0.2, bbox_h: 0.1 })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={null}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
        onResizeDetection={onResizeDetection}
      />,
    )
    setOverlayRect(1000, 1000)

    const bbox = screen.getByTitle(/roof_fan/)
    fireEvent.mouseDown(bbox, { clientX: 300, clientY: 300 })
    fireEvent.mouseMove(window, { clientX: 400, clientY: 400 })
    fireEvent.mouseUp(window, { clientX: 400, clientY: 400 })

    expect(onResizeDetection).not.toHaveBeenCalled()
  })

  it('clamps the moved BBox so it does not leave the page bounds', () => {
    const onResizeDetection = vi.fn()
    const detection = makeDetection({ id: 1, bbox_x: 0.2, bbox_y: 0.2, bbox_w: 0.2, bbox_h: 0.1 })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={1}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
        onResizeDetection={onResizeDetection}
      />,
    )
    setOverlayRect(1000, 1000)

    const bbox = screen.getByTitle(/roof_fan/)
    fireEvent.mouseDown(bbox, { clientX: 300, clientY: 300 })
    fireEvent.mouseMove(window, { clientX: 5000, clientY: 5000 }) // ページ外まで大きくドラッグ
    fireEvent.mouseUp(window, { clientX: 5000, clientY: 5000 })

    const [, rect] = onResizeDetection.mock.calls[0]
    expect(rect.x + rect.w).toBeLessThanOrEqual(1 + 1e-9)
    expect(rect.y + rect.h).toBeLessThanOrEqual(1 + 1e-9)
    expect(rect.w).toBeCloseTo(0.2)
    expect(rect.h).toBeCloseTo(0.1)
  })

  it('reports the live in-progress rect via onPreviewBBoxChange while moving, BEFORE mouseup, and still commits correctly on mouseup (追加修正11章〜17章)', () => {
    const onResizeDetection = vi.fn()
    const detection = makeDetection({ id: 1, bbox_x: 0.2, bbox_y: 0.2, bbox_w: 0.2, bbox_h: 0.1 })
    const { container } = render(
      <ControlledPreviewHarness detection={detection} onResizeDetection={onResizeDetection} />,
    )
    setOverlayRect(1000, 1000)

    const bbox = screen.getByTitle(/roof_fan/)
    fireEvent.mouseDown(bbox, { clientX: 300, clientY: 300 })
    fireEvent.mouseMove(window, { clientX: 400, clientY: 350 }) // mouseupはまだ

    expect(onResizeDetection).not.toHaveBeenCalled()
    const bboxButton = container.querySelector('.detection-overlay__bbox') as HTMLElement
    expect(parseFloat(bboxButton.style.left)).toBeCloseTo(30) // 0.2+0.1
    expect(parseFloat(bboxButton.style.top)).toBeCloseTo(25) // 0.2+0.05

    fireEvent.mouseUp(window, { clientX: 400, clientY: 350 })
    expect(onResizeDetection).toHaveBeenCalledTimes(1)
    const [id, rect] = onResizeDetection.mock.calls[0]
    expect(id).toBe(1)
    expect(rect.x).toBeCloseTo(0.3)
    expect(rect.y).toBeCloseTo(0.25)
  })
})

describe('DetectionOverlay: onResizeDetectionのstale closure回帰修正 (全体フォント拡大・BBox編集追従回帰修正 指示2章)', () => {
  function setOverlayRect(width: number, height: number) {
    const el = document.querySelector('.detection-overlay') as HTMLElement
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: width, bottom: height, width, height }),
      configurable: true,
    })
  }

  // 実際の不具合の原因: mousemove/mouseupの購読は依存配列`[]`のuseEffectで
  // マウント時に1度だけ張られるため、その時点の`onResizeDetection`をクロージャで
  // 捕まえたまま以後更新されない。App.tsx側は毎レンダー新しい関数
  // (`allDetections`等の最新stateを閉じたクロージャ)を渡すため、親の再レンダー後に
  // 行った移動/リサイズ確定が「古い(≒データ未確定時点の)」コールバックを呼び続けて
  // しまい、そのコールバック内で行うはずの所属追従・Toast表示が一切発火しない、
  // という回帰が実際に起きていた。refを介して常に最新のコールバックを呼ぶことで
  // 修正する (Undo/RedoのCtrl+Zショートカットと同じ手法)。
  it('always invokes the LATEST onResizeDetection after a re-render, not the one captured at mount time', () => {
    const staleCallback = vi.fn()
    const freshCallback = vi.fn()
    const detection = makeDetection({ id: 1, bbox_x: 0.2, bbox_y: 0.2, bbox_w: 0.2, bbox_h: 0.1 })
    const { rerender } = render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={1}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
        onResizeDetection={staleCallback}
      />,
    )
    // Appが再レンダーし、新しいクロージャ(allDetections等の最新stateを閉じたclosure)を
    // 渡すのと同じ状況を再現する。DetectionOverlay自身はアンマウントされない
    // (=mount時のuseEffectは再実行されない)点が重要。
    rerender(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={1}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
        onResizeDetection={freshCallback}
      />,
    )
    setOverlayRect(1000, 1000)

    const bbox = screen.getByTitle(/roof_fan/)
    fireEvent.mouseDown(bbox, { clientX: 300, clientY: 300 })
    fireEvent.mouseMove(window, { clientX: 400, clientY: 350 })
    fireEvent.mouseUp(window, { clientX: 400, clientY: 350 })

    expect(staleCallback).not.toHaveBeenCalled()
    expect(freshCallback).toHaveBeenCalledTimes(1)
  })

  it('also uses the latest callback for the corner-resize path (not just body move)', () => {
    const staleCallback = vi.fn()
    const freshCallback = vi.fn()
    const detection = makeDetection({ id: 1, bbox_x: 0.2, bbox_y: 0.2, bbox_w: 0.2, bbox_h: 0.1 })
    const { rerender } = render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={1}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
        onResizeDetection={staleCallback}
      />,
    )
    rerender(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={1}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
        onResizeDetection={freshCallback}
      />,
    )
    setOverlayRect(1000, 1000)

    const handle = screen.getByRole('button', { name: 'BBoxサイズ変更 (bottom-right)' })
    fireEvent.mouseDown(handle, { clientX: 400, clientY: 300 })
    fireEvent.mouseMove(window, { clientX: 500, clientY: 400 })
    fireEvent.mouseUp(window, { clientX: 500, clientY: 400 })

    expect(staleCallback).not.toHaveBeenCalled()
    expect(freshCallback).toHaveBeenCalledTimes(1)
  })
})

describe('DetectionOverlay: 積算Master Item紐づきBBoxのカテゴリ色・通常非表示 (Phase 1.11指示書2章/7章/8章/9章/29章)', () => {
  it('does not render a master-linked (Manual) BBox by default (not selected, not hovered via leader)', () => {
    const detection = makeDetection({
      id: 1,
      source_type: 'manual',
      master_item_id: 10,
      master_item_category: '箱・単独',
      class_name: '11001',
    })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={null}
        highlightedDetectionId={null}
        hoveredDetectionId={null}
        onSelectDetection={() => {}}
      />,
    )
    expect(screen.queryByTitle(/11001/)).not.toBeInTheDocument()
  })

  it('renders the master-linked BBox when it is the one hovered via the leader line (要件8)', () => {
    const detection = makeDetection({
      id: 1,
      source_type: 'manual',
      master_item_id: 10,
      master_item_category: '箱・単独',
      class_name: '11001',
    })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={null}
        highlightedDetectionId={null}
        hoveredDetectionId={1}
        onSelectDetection={() => {}}
      />,
    )
    expect(screen.getByTitle(/11001/)).toBeInTheDocument()
  })

  it('renders the master-linked BBox when it is selected (editing state, 要件9)', () => {
    const detection = makeDetection({
      id: 1,
      source_type: 'manual',
      master_item_id: 10,
      master_item_category: '箱・単独',
      class_name: '11001',
    })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={1}
        highlightedDetectionId={null}
        hoveredDetectionId={null}
        onSelectDetection={() => {}}
      />,
    )
    expect(screen.getByTitle(/11001/)).toBeInTheDocument()
    // 編集中はResize Handleも表示される (要件9)。
    expect(screen.getAllByRole('button', { name: /BBoxサイズ変更/ })).toHaveLength(4)
  })

  it('uses the category color (CSS custom properties) for a master-linked BBox, not the fixed AI/manual color', () => {
    const detection = makeDetection({
      id: 1,
      source_type: 'manual',
      master_item_id: 10,
      master_item_category: '内部ﾊﾟﾈﾙ',
      class_name: '18001',
    })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={1}
        highlightedDetectionId={null}
        onSelectDetection={() => {}}
      />,
    )
    const bbox = screen.getByTitle(/18001/)
    expect(bbox.className).toContain('detection-overlay__bbox--category')
    expect(bbox.style.getPropertyValue('--cat-bbox-border')).toBeTruthy()
    expect(bbox.style.getPropertyValue('--cat-bbox-fill')).toBeTruthy()
  })

  it('does not change the always-visible display of plain AI detections (no master_item_id, 要件29)', () => {
    const aiDetection = makeDetection({ id: 1, source_type: 'ai', master_item_id: null })
    render(
      <DetectionOverlay
        detections={[aiDetection]}
        selectedDetectionId={null}
        highlightedDetectionId={null}
        hoveredDetectionId={null}
        onSelectDetection={() => {}}
      />,
    )
    // 選択もhoverもしていないが、AI Detectionは従来通り常時表示される。
    expect(screen.getByTitle(/roof_fan/)).toBeInTheDocument()
    expect(screen.getByTitle(/roof_fan/).className).not.toContain('detection-overlay__bbox--category')
  })
})

describe('DetectionOverlay: 積算明細hover強調 (積算集約・積算明細UI再構成 指示18章〜21章)', () => {
  it('renders the master-linked BBox when it is the one hovered via 積算明細 (detailHoveredDetectionId)', () => {
    const detection = makeDetection({
      id: 1,
      source_type: 'manual',
      master_item_id: 10,
      master_item_category: '箱・単独',
      class_name: '11001',
    })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={null}
        highlightedDetectionId={null}
        hoveredDetectionId={null}
        detailHoveredDetectionId={1}
        onSelectDetection={() => {}}
      />,
    )
    const bbox = screen.getByTitle(/11001/)
    expect(bbox).toBeInTheDocument()
    // 情報源(manual)に応じた専用クラスであること (明細遷移後のBBox残留・Hover色・
    // 品名列修正 指示2章: 単一色固定ではなく情報源別のclassにする)。
    expect(bbox.className).toContain('detection-overlay__bbox--detail-hover-manual')
    expect(bbox.className).not.toContain('detection-overlay__bbox--detail-hover-ai')
  })

  it('uses the AI color class (not manual) when the detail-hovered Detection is AI-sourced (指示2章: 情報源ごとに既存配色を再利用)', () => {
    const detection = makeDetection({
      id: 1,
      source_type: 'ai',
      master_item_id: 10,
      master_item_category: '箱・単独',
      class_name: '11001',
    })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={null}
        highlightedDetectionId={null}
        hoveredDetectionId={null}
        detailHoveredDetectionId={1}
        onSelectDetection={() => {}}
      />,
    )
    const bbox = screen.getByTitle(/11001/)
    expect(bbox.className).toContain('detection-overlay__bbox--detail-hover-ai')
    expect(bbox.className).not.toContain('detection-overlay__bbox--detail-hover-manual')
  })

  it('does not render a master-linked BBox when detailHoveredDetectionId refers to a different id', () => {
    const detection = makeDetection({ id: 1, source_type: 'manual', master_item_id: 10, class_name: '11001' })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={null}
        highlightedDetectionId={null}
        hoveredDetectionId={null}
        detailHoveredDetectionId={999}
        onSelectDetection={() => {}}
      />,
    )
    expect(screen.queryByTitle(/11001/)).not.toBeInTheDocument()
  })

  it('uses a visually distinct class from the leader-hover/selected states (指示21章: 既存の強調と混同しない)', () => {
    const detection = makeDetection({ id: 1, source_type: 'manual', master_item_id: 10, class_name: '11001' })
    render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={null}
        highlightedDetectionId={null}
        hoveredDetectionId={1}
        detailHoveredDetectionId={1}
        onSelectDetection={() => {}}
      />,
    )
    const bbox = screen.getByTitle(/11001/)
    expect(bbox.className).toContain('detection-overlay__bbox--detail-hover-manual')
    expect(bbox.className).not.toContain('detection-overlay__bbox--selected')
  })

  it('clears the detail-hover highlight once detailHoveredDetectionId goes back to null', () => {
    const detection = makeDetection({ id: 1, source_type: 'manual', master_item_id: 10, class_name: '11001' })
    const { rerender } = render(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={null}
        highlightedDetectionId={null}
        hoveredDetectionId={null}
        detailHoveredDetectionId={1}
        onSelectDetection={() => {}}
      />,
    )
    expect(screen.getByTitle(/11001/)).toBeInTheDocument()

    rerender(
      <DetectionOverlay
        detections={[detection]}
        selectedDetectionId={null}
        highlightedDetectionId={null}
        hoveredDetectionId={null}
        detailHoveredDetectionId={null}
        onSelectDetection={() => {}}
      />,
    )
    expect(screen.queryByTitle(/11001/)).not.toBeInTheDocument()
  })
})
