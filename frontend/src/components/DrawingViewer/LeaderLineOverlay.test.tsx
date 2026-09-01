// LeaderLineOverlay.tsx自体はCSSをimportしていない (実際の画面ではDrawingViewer.tsxが
// 一括importする、既存のOverlayコンポーネント群と同じ構成)。単体テストでCSSカスケードを
// 検証するテストのためだけに、ここで明示的にimportする。
import '../DrawingViewer/DrawingViewer.css'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LeaderLineOverlay } from './LeaderLineOverlay'
import type { Detection } from '../../types/domain'
import { getLatestMockResizeObserver } from '../../testUtils/mockResizeObserver'

function makeDetection(overrides: Partial<Detection> = {}): Detection {
  return {
    id: 1,
    drawing_page_id: 1,
    panel_id: null,
    class_name: '11001',
    bbox_x: 0.2,
    bbox_y: 0.3,
    bbox_w: 0.1,
    bbox_h: 0.1,
    confidence: null,
    status: 'reviewed',
    source_type: 'manual',
    master_item_id: 10,
    leader_label_x: null,
    leader_label_y: null,
    master_item_category: '箱・単独',
    master_item_model: 'OS2-816',
    master_item_code: '11001',
    ...overrides,
  }
}

function setOverlayRect(width: number, height: number) {
  const el = document.querySelector('.leader-line-overlay') as HTMLElement
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, right: width, bottom: height, width, height }),
    configurable: true,
  })
}

describe('LeaderLineOverlay (Phase 1.11 UI改修指示5章〜16章)', () => {
  it('renders nothing (no leader) for detections without master_item_id (要件29: AI Detectionは対象外)', () => {
    const ai = makeDetection({ master_item_id: null, master_item_category: null })
    render(
      <LeaderLineOverlay
        detections={[ai]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    expect(screen.queryByText(/11001/)).not.toBeInTheDocument()
  })

  it('shows "コード 型式" (master_item_code + master_item_model) as the label text (指示書11章/14章)', () => {
    const detection = makeDetection({ master_item_code: '11001', master_item_model: 'OS2-816' })
    render(
      <LeaderLineOverlay
        detections={[detection]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    expect(screen.getByText('11001 OS2-816')).toBeInTheDocument()
  })

  it('prefers master_item_code (live JOIN from Backend) over class_name for the code part (追加修正12章/14章)', () => {
    // class_nameは登録時点のコピーであり、Master Item側のcodeが後から変わっても
    // 追従しない。引出線はmaster_item_codeを優先して表示する。
    const detection = makeDetection({
      class_name: 'STALE-COPY',
      master_item_code: '11523',
      master_item_model: 'IS2-1620',
    })
    render(
      <LeaderLineOverlay
        detections={[detection]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    expect(screen.getByText('11523 IS2-1620')).toBeInTheDocument()
    expect(screen.queryByText(/STALE-COPY/)).not.toBeInTheDocument()
  })

  it('falls back to class_name only if master_item_code is unavailable (異常系のフォールバック)', () => {
    const detection = makeDetection({ class_name: '11001', master_item_code: null, master_item_model: 'OS2-816' })
    render(
      <LeaderLineOverlay
        detections={[detection]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    expect(screen.getByText('11001 OS2-816')).toBeInTheDocument()
  })

  it('omits the model when master_item_model is null, showing only the code (指示書13章)', () => {
    const detection = makeDetection({ master_item_code: '11001', master_item_model: null })
    render(
      <LeaderLineOverlay
        detections={[detection]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    expect(screen.getByText('11001')).toBeInTheDocument()
  })

  it('treats a whitespace-only model the same as an empty model (buildLabelTextの.trim()防御。追加修正14章)', () => {
    const detection = makeDetection({ master_item_code: '11001', master_item_model: '   ' })
    render(
      <LeaderLineOverlay
        detections={[detection]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    expect(screen.getByText('11001')).toBeInTheDocument()
  })

  it('shows the model whenever it is present — a present model must never be dropped (指示書13章: modelありなのに欠落は不具合)', () => {
    const detection = makeDetection({ master_item_code: '11523', master_item_model: 'IS2-1620' })
    render(
      <LeaderLineOverlay
        detections={[detection]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    expect(screen.getByText('11523 IS2-1620')).toBeInTheDocument()
  })

  it('does not show rating/price info in the label (指示書14章: コード 型式のみ)', () => {
    const detection = makeDetection()
    render(
      <LeaderLineOverlay
        detections={[detection]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    const label = screen.getByText('11001 OS2-816')
    expect(label.textContent).toBe('11001 OS2-816')
  })

  // pathの`d`属性("M x y L x y L x y")から座標点を取り出す簡易ヘルパー。
  function parsePathPoints(d: string): { x: number; y: number }[] {
    const nums = d.match(/-?[\d.]+/g)!.map(Number)
    const points: { x: number; y: number }[] = []
    for (let i = 0; i < nums.length; i += 2) points.push({ x: nums[i], y: nums[i + 1] })
    return points
  }

  function getVisiblePathD(container: HTMLElement): string {
    // 1つ目はhit area(透明・太い)、2つ目が見た目の引出線(marker-end付き)。
    const paths = container.querySelectorAll('svg path')
    const visible = Array.from(paths).find((p) => p.getAttribute('marker-end'))
    return visible!.getAttribute('d')!
  }

  it('anchors the leader line at the BBox top-right corner, as the LAST point of the path (矢印はここを指す。指示書11章)', () => {
    const detection = makeDetection({ bbox_x: 0.2, bbox_y: 0.3, bbox_w: 0.1, bbox_h: 0.1 })
    const { container } = render(
      <LeaderLineOverlay
        detections={[detection]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    const points = parsePathPoints(getVisiblePathD(container))
    const anchorPoint = points[points.length - 1]
    // BBox右上角 = (x+w, y) = (0.3, 0.3)
    expect(anchorPoint.x).toBeCloseTo(0.3)
    expect(anchorPoint.y).toBeCloseTo(0.3)
  })

  it('follows a moved/resized BBox: re-renders with a new bbox and the anchor updates accordingly (自動追従)', () => {
    const detection = makeDetection({ bbox_x: 0.2, bbox_y: 0.3, bbox_w: 0.1, bbox_h: 0.1 })
    const { container, rerender } = render(
      <LeaderLineOverlay
        detections={[detection]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    const moved = { ...detection, bbox_x: 0.5, bbox_y: 0.1, bbox_w: 0.1, bbox_h: 0.1 }
    rerender(
      <LeaderLineOverlay
        detections={[moved]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    const points = parsePathPoints(getVisiblePathD(container))
    const anchorPoint = points[points.length - 1]
    expect(anchorPoint.x).toBeCloseTo(0.6) // 0.5+0.1
    expect(anchorPoint.y).toBeCloseTo(0.1)
  })

  it('follows a resized BBox (width/height change) too (自動追従、指示書11章)', () => {
    const detection = makeDetection({ bbox_x: 0.2, bbox_y: 0.3, bbox_w: 0.1, bbox_h: 0.1 })
    const { container, rerender } = render(
      <LeaderLineOverlay
        detections={[detection]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    const resized = { ...detection, bbox_w: 0.25, bbox_h: 0.05 } // 右上角が変わる
    rerender(
      <LeaderLineOverlay
        detections={[resized]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    const points = parsePathPoints(getVisiblePathD(container))
    const anchorPoint = points[points.length - 1]
    expect(anchorPoint.x).toBeCloseTo(0.45) // 0.2+0.25
    expect(anchorPoint.y).toBeCloseTo(0.3) // bbox_yは変わっていない
  })

  describe('引出線の形状 (Phase 1.11 追加修正5章〜9章): 1本の連続したpolyline + 矢印head', () => {
    it('draws the diagonal and horizontal segments as ONE continuous path (no gap between them)', () => {
      const detection = makeDetection({ leader_label_x: 0.5, leader_label_y: 0.1 })
      const { container } = render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={null}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
        />,
      )
      const d = getVisiblePathD(container)
      // "M x y L x y L x y" の3点構成 (end→elbow→anchor)。斜線と水平線が
      // 同じ<path>要素内で連続しているため、CSSの隙間は原理的に発生しない。
      const points = parsePathPoints(d)
      expect(points).toHaveLength(3)
    })

    it('renders an arrowhead marker (marker-end) attached to the visible path, pointing toward the anchor (追加修正7章/8章)', () => {
      const detection = makeDetection()
      const { container } = render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={null}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
        />,
      )
      const marker = container.querySelector('marker')
      expect(marker).not.toBeNull()
      expect(marker!.getAttribute('orient')).toBe('auto')
      const visiblePath = Array.from(container.querySelectorAll('svg path')).find((p) =>
        p.getAttribute('marker-end'),
      )
      expect(visiblePath!.getAttribute('marker-end')).toContain(marker!.id)
      // marker-endは経路の最後の頂点(=anchor)につく。end→elbow→anchorの順で
      // 描画しているため、矢印は必ずBBox右上角(最後の点)を指す。
      const points = parsePathPoints(visiblePath!.getAttribute('d')!)
      expect(points[points.length - 1].x).toBeCloseTo(detection.bbox_x + detection.bbox_w)
      expect(points[points.length - 1].y).toBeCloseTo(detection.bbox_y)
    })

    it('the arrowhead marker is smaller than the old size, and stays within the instructed 50-65% reduction range (追加修正1章〜4章)', () => {
      const detection = makeDetection()
      const { container } = render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={null}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
        />,
      )
      const marker = container.querySelector('marker')!
      const OLD_SIZE = 0.018
      const width = Number(marker.getAttribute('markerWidth'))
      const height = Number(marker.getAttribute('markerHeight'))
      expect(width).toBeLessThan(OLD_SIZE)
      expect(height).toBeLessThan(OLD_SIZE)
      // 指示された50%〜65%の範囲に収まっている(小さすぎて視認不能にもしない)。
      expect(width).toBeGreaterThanOrEqual(OLD_SIZE * 0.5)
      expect(width).toBeLessThanOrEqual(OLD_SIZE * 0.65)
      // BBox四隅リサイズハンドルは10px(CSS固定、zoom非依存)。矢印は正規化座標
      // (viewBox 0 0 1 1)のためViewer実表示幅に応じて実ピクセルサイズが変わるが、
      // 一般的なViewer幅(概ね800px〜1600px)の範囲ではハンドルと同等かそれ以下の
      // 大きさに収まる (指示書2章: リサイズハンドルより小さいこと)。
      const typicalViewportPx = 900
      expect(width * typicalViewportPx).toBeLessThanOrEqual(10)
    })

    it('the hit-area path shares the exact same "d" as the visible path (指示書18章: hit pathも全体に沿わせる)', () => {
      const detection = makeDetection({ leader_label_x: 0.5, leader_label_y: 0.1 })
      const { container } = render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={null}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
        />,
      )
      // <marker>内部の矢印head用<path>(marker-end属性を持たない)を誤って
      // hit pathと取り違えないよう除外する。
      const paths = Array.from(container.querySelectorAll('svg path')).filter((p) => !p.closest('marker'))
      const hitPath = paths.find((p) => !p.getAttribute('marker-end'))
      const visiblePath = paths.find((p) => p.getAttribute('marker-end'))
      expect(hitPath!.getAttribute('d')).toBe(visiblePath!.getAttribute('d'))
    })

    it('label to the RIGHT of the anchor (labelX >= anchorX): elbow sits at the label\'s own position, horizontal segment extends toward the label (追加修正16章)', () => {
      const detection = makeDetection({
        bbox_x: 0.2,
        bbox_y: 0.3,
        bbox_w: 0.1,
        bbox_h: 0.1, // anchor = (0.3, 0.3)
        leader_label_x: 0.5,
        leader_label_y: 0.1,
      })
      const { container } = render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={null}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
        />,
      )
      const points = parsePathPoints(getVisiblePathD(container))
      const [end, elbow, anchor] = points
      expect(elbow.x).toBeCloseTo(0.5) // ラベル位置そのもの
      expect(elbow.y).toBeCloseTo(0.1)
      expect(end.x).toBeGreaterThan(elbow.x) // 水平線はラベル側(右)へ伸びる
      expect(end.y).toBeCloseTo(elbow.y)
      expect(anchor.x).toBeCloseTo(0.3)
      expect(anchor.y).toBeCloseTo(0.3)
    })

    it('label to the LEFT of the anchor (labelX < anchorX): elbow sits at the label\'s far edge, and the line does not break (追加修正16章)', () => {
      const detection = makeDetection({
        bbox_x: 0.6,
        bbox_y: 0.3,
        bbox_w: 0.1,
        bbox_h: 0.1, // anchor = (0.7, 0.3)
        leader_label_x: 0.1,
        leader_label_y: 0.1,
      })
      const { container } = render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={null}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
        />,
      )
      const points = parsePathPoints(getVisiblePathD(container))
      const [end, elbow, anchor] = points
      expect(end.x).toBeCloseTo(0.1) // ラベルの左端(始点)そのもの
      expect(end.y).toBeCloseTo(0.1)
      expect(elbow.x).toBeGreaterThan(end.x) // 水平線は右(アンカー側)の端で折れる
      expect(elbow.y).toBeCloseTo(end.y)
      expect(elbow.x).toBeLessThanOrEqual(anchor.x + 1e-6) // 折れ点はアンカーより左〜同程度
      expect(anchor.x).toBeCloseTo(0.7)
      expect(anchor.y).toBeCloseTo(0.3)
    })
  })

  it('uses the category color for the label (border/text), sourced from masterCategoryPresentation (要件2)', () => {
    const detection = makeDetection({ master_item_category: '内部ﾊﾟﾈﾙ' })
    render(
      <LeaderLineOverlay
        detections={[detection]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    const label = screen.getByText('11001 OS2-816')
    expect(label.style.getPropertyValue('--cat-leader-color')).toBeTruthy()
    expect(label.style.getPropertyValue('--cat-leader-text')).toBeTruthy()
  })

  it('uses the saved leader_label_x/y position when present, instead of the auto-computed initial position (保存・再取得)', () => {
    const detection = makeDetection({ leader_label_x: 0.7, leader_label_y: 0.05 })
    const { container } = render(
      <LeaderLineOverlay
        detections={[detection]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    const label = container.querySelector('.leader-line-overlay__label') as HTMLElement
    expect(label.style.left).toBe('70%')
    expect(label.style.top).toBe('5%')
  })

  it('auto-computes an initial label position near the anchor when leader_label_x/y is null', () => {
    const detection = makeDetection({ bbox_x: 0.2, bbox_y: 0.3, bbox_w: 0.1, bbox_h: 0.1, leader_label_x: null, leader_label_y: null })
    const { container } = render(
      <LeaderLineOverlay
        detections={[detection]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    const label = container.querySelector('.leader-line-overlay__label') as HTMLElement
    // 初期位置はアンカー(0.3, 0.3)付近 (厳密な値ではなく、BBoxの近くであることを確認する)。
    expect(parseFloat(label.style.left)).toBeGreaterThan(20)
    expect(parseFloat(label.style.left)).toBeLessThan(50)
  })

  it('calls onHoverDetection when hovering the label (要件8: hoverで対応BBoxを表示可能にする)', () => {
    const onHoverDetection = vi.fn()
    const detection = makeDetection()
    render(
      <LeaderLineOverlay
        detections={[detection]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={onHoverDetection}
        onSelectDetection={() => {}}
        onMoveLabel={() => {}}
      />,
    )
    const label = screen.getByText('11001 OS2-816')
    fireEvent.mouseEnter(label)
    expect(onHoverDetection).toHaveBeenCalledWith(1)
    fireEvent.mouseLeave(label)
    expect(onHoverDetection).toHaveBeenCalledWith(null)
  })

  it('calls onSelectDetection when the label is clicked (指示書8章: 引出線から編集状態へ入れる)', () => {
    const onSelectDetection = vi.fn()
    const detection = makeDetection()
    render(
      <LeaderLineOverlay
        detections={[detection]}
        selectedDetectionId={null}
        hoveredDetectionId={null}
        onHoverDetection={() => {}}
        onSelectDetection={onSelectDetection}
        onMoveLabel={() => {}}
      />,
    )
    fireEvent.click(screen.getByText('11001 OS2-816'))
    expect(onSelectDetection).toHaveBeenCalledWith(1)
  })

  describe('ラベル帯のdrag移動 (Phase 1.11 指示書10章)', () => {
    it('dragging the label (while selected/editing) reports a new normalized position via onMoveLabel', () => {
      const onMoveLabel = vi.fn()
      const detection = makeDetection({ leader_label_x: 0.4, leader_label_y: 0.1 })
      render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={1}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={onMoveLabel}
        />,
      )
      setOverlayRect(1000, 1000) // 1px = 0.001 正規化

      const label = screen.getByText('11001 OS2-816')
      fireEvent.mouseDown(label, { clientX: 400, clientY: 100 })
      fireEvent.mouseMove(window, { clientX: 500, clientY: 150 }) // +0.1, +0.05
      fireEvent.mouseUp(window, { clientX: 500, clientY: 150 })

      expect(onMoveLabel).toHaveBeenCalledTimes(1)
      const [id, x, y] = onMoveLabel.mock.calls[0]
      expect(id).toBe(1)
      expect(x).toBeCloseTo(0.5)
      expect(y).toBeCloseTo(0.15)
    })

    it('does not start a label drag when the detection is not selected (要件: ラベルdragはediting状態のみ)', () => {
      const onMoveLabel = vi.fn()
      const detection = makeDetection({ leader_label_x: 0.4, leader_label_y: 0.1 })
      render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={null}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={onMoveLabel}
        />,
      )
      setOverlayRect(1000, 1000)

      const label = screen.getByText('11001 OS2-816')
      fireEvent.mouseDown(label, { clientX: 400, clientY: 100 })
      fireEvent.mouseMove(window, { clientX: 500, clientY: 150 })
      fireEvent.mouseUp(window, { clientX: 500, clientY: 150 })

      expect(onMoveLabel).not.toHaveBeenCalled()
    })

    it('does not treat a plain click (movement below threshold) as a label move', () => {
      const onMoveLabel = vi.fn()
      const detection = makeDetection({ leader_label_x: 0.4, leader_label_y: 0.1 })
      render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={1}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={onMoveLabel}
        />,
      )
      setOverlayRect(1000, 1000)

      const label = screen.getByText('11001 OS2-816')
      fireEvent.mouseDown(label, { clientX: 400, clientY: 100 })
      fireEvent.mouseMove(window, { clientX: 402, clientY: 101 }) // 閾値(6px)未満
      fireEvent.mouseUp(window, { clientX: 402, clientY: 101 })

      expect(onMoveLabel).not.toHaveBeenCalled()
    })

    it('label drag does not affect the BBox coordinates at all (onMoveLabel only ever carries the label position, not a bbox rect)', () => {
      const onMoveLabel = vi.fn()
      const detection = makeDetection({ leader_label_x: 0.4, leader_label_y: 0.1 })
      render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={1}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={onMoveLabel}
        />,
      )
      setOverlayRect(1000, 1000)

      const label = screen.getByText('11001 OS2-816')
      fireEvent.mouseDown(label, { clientX: 400, clientY: 100 })
      fireEvent.mouseMove(window, { clientX: 500, clientY: 150 })
      fireEvent.mouseUp(window, { clientX: 500, clientY: 150 })

      // onMoveLabelのシグネチャは(detectionId, x, y)のみ。bbox_w/hに相当する引数はない。
      expect(onMoveLabel.mock.calls[0]).toHaveLength(3)
    })

    it('the leader line stays a single continuous 3-point path (no gap) while the label is being dragged (追加修正15章)', () => {
      const detection = makeDetection({
        bbox_x: 0.2,
        bbox_y: 0.3,
        bbox_w: 0.1,
        bbox_h: 0.1,
        leader_label_x: 0.4,
        leader_label_y: 0.1,
      })
      const { container } = render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={1}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
        />,
      )
      setOverlayRect(1000, 1000)

      const label = screen.getByText('11001 OS2-816')
      fireEvent.mouseDown(label, { clientX: 400, clientY: 100 })
      fireEvent.mouseMove(window, { clientX: 700, clientY: 300 }) // ドラッグ中(未確定)

      const points = parsePathPoints(getVisiblePathD(container))
      expect(points).toHaveLength(3) // ドラッグ中も1本のpolylineのまま
      expect(points[points.length - 1].x).toBeCloseTo(0.3) // anchorは不変 (0.2+0.1)
      expect(points[points.length - 1].y).toBeCloseTo(0.3)

      fireEvent.mouseUp(window, { clientX: 700, clientY: 300 })
    })
  })

  describe('previewBBoxによるBBox編集中のリアルタイム追従 (Phase 1.11 追加修正11章〜17章)', () => {
    it('the anchor (and thus the arrow) follows previewBBox in real time, before mouseup / before persisting (要件11〜13)', () => {
      const detection = makeDetection({ bbox_x: 0.2, bbox_y: 0.3, bbox_w: 0.1, bbox_h: 0.1 }) // persisted anchor = (0.3, 0.3)
      const { container, rerender } = render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={1}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
          previewBBox={null}
        />,
      )
      // ドラッグ中(未確定)。DBには未保存 = detections配列自体は変わっていないが、
      // previewBBoxだけが更新される想定 (DetectionOverlayのmousemoveと同じ経路)。
      rerender(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={1}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
          previewBBox={{ detectionId: 1, rect: { x: 0.5, y: 0.1, w: 0.1, h: 0.1 } }}
        />,
      )
      const points = parsePathPoints(getVisiblePathD(container))
      const anchorPoint = points[points.length - 1]
      // アンカーはpreviewBBoxの右上角(0.6, 0.1)へ、mouseup前でも追従する。
      expect(anchorPoint.x).toBeCloseTo(0.6)
      expect(anchorPoint.y).toBeCloseTo(0.1)
    })

    it('the label position is NEVER affected by previewBBox — only the anchor/line tracks it (要件16: ラベル位置は固定)', () => {
      const detection = makeDetection({
        bbox_x: 0.2,
        bbox_y: 0.3,
        bbox_w: 0.1,
        bbox_h: 0.1,
        leader_label_x: 0.45,
        leader_label_y: 0.05,
      })
      const { container, rerender } = render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={1}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
          previewBBox={null}
        />,
      )
      const labelBefore = container.querySelector('.leader-line-overlay__label') as HTMLElement
      const beforeLeft = labelBefore.style.left
      const beforeTop = labelBefore.style.top

      rerender(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={1}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
          previewBBox={{ detectionId: 1, rect: { x: 0.7, y: 0.6, w: 0.1, h: 0.1 } }}
        />,
      )
      const labelAfter = container.querySelector('.leader-line-overlay__label') as HTMLElement
      expect(labelAfter.style.left).toBe(beforeLeft)
      expect(labelAfter.style.top).toBe(beforeTop)

      // 一方、アンカー(引出線)側は確実にpreviewBBoxへ追従している。
      const points = parsePathPoints(getVisiblePathD(container))
      const anchorPoint = points[points.length - 1]
      expect(anchorPoint.x).toBeCloseTo(0.8) // 0.7+0.1
      expect(anchorPoint.y).toBeCloseTo(0.6)
    })

    it('ignores previewBBox for a different detectionId (複数BBox編集中に他のanchorを動かさない)', () => {
      const detection = makeDetection({ id: 1, bbox_x: 0.2, bbox_y: 0.3, bbox_w: 0.1, bbox_h: 0.1 })
      const { container } = render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={1}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
          previewBBox={{ detectionId: 999, rect: { x: 0.9, y: 0.9, w: 0.05, h: 0.05 } }}
        />,
      )
      const points = parsePathPoints(getVisiblePathD(container))
      const anchorPoint = points[points.length - 1]
      expect(anchorPoint.x).toBeCloseTo(0.3) // persisted bboxのまま(0.2+0.1)
      expect(anchorPoint.y).toBeCloseTo(0.3)
    })

    it('once previewBBox clears back to null (mouseup後), the anchor reflects the newly-persisted bbox', () => {
      const detection = makeDetection({ bbox_x: 0.2, bbox_y: 0.3, bbox_w: 0.1, bbox_h: 0.1 })
      const { container, rerender } = render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={1}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
          previewBBox={{ detectionId: 1, rect: { x: 0.5, y: 0.1, w: 0.1, h: 0.1 } }}
        />,
      )
      // mouseup: previewBBoxはnullへ戻り、同時にdetections自体がPATCH結果で更新される
      // (App.tsx側の実際のフロー。DrawingViewer.tsxのpreviewBBox stateとApp.tsxの
      // detections stateは別々に更新されるが、最終的に同じ値へ収束する)。
      const persisted = { ...detection, bbox_x: 0.5, bbox_y: 0.1, bbox_w: 0.1, bbox_h: 0.1 }
      rerender(
        <LeaderLineOverlay
          detections={[persisted]}
          selectedDetectionId={1}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
          previewBBox={null}
        />,
      )
      const points = parsePathPoints(getVisiblePathD(container))
      const anchorPoint = points[points.length - 1]
      expect(anchorPoint.x).toBeCloseTo(0.6)
      expect(anchorPoint.y).toBeCloseTo(0.1)
    })
  })

  describe('引出線ラベルのスタイル (追加修正 第3ラウンド1章〜5章): 背景/枠なし・フォント拡大', () => {
    it('has no background, border, or box-shadow (図面へ直接文字を描画する。追加修正1章/2章)', () => {
      const detection = makeDetection()
      render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={null}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
        />,
      )
      const label = screen.getByText('11001 OS2-816')
      const style = getComputedStyle(label)
      // jsdomの実装によりtransparentは`rgba(0, 0, 0, 0)`として計算されることがある。
      expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(style.backgroundColor)
      expect(style.borderBottomStyle).toBe('none')
      expect(style.boxShadow === 'none' || style.boxShadow === '').toBe(true)
    })

    it('does not show a background even when hovered or selected (旧: hover時に白背景が濃くなる仕様だった)', () => {
      const detection = makeDetection()
      render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={1}
          hoveredDetectionId={1}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
        />,
      )
      const label = screen.getByText('11001 OS2-816')
      expect(label.className).toContain('leader-line-overlay__label--selected')
      expect(label.className).toContain('leader-line-overlay__label--hovered')
      const style = getComputedStyle(label)
      expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(style.backgroundColor)
    })

    it('uses a larger font-size than the old value (旧0.82rem≒11.48pxより大きい。追加修正3章、目安15〜25%拡大)', () => {
      const detection = makeDetection()
      render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={null}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
        />,
      )
      const label = screen.getByText('11001 OS2-816')
      // jsdomのgetComputedStyleは`rem`をpxへ解決しない(指定値の文字列をそのまま返す)ため、
      // 数値比較ではなく実際に指定したCSS値そのものを検証する。「1rem = 14px
      // (`index.css`の`:root`のfont-size)」という換算は実ブラウザ上でのみ有効な事実であり、
      // 旧0.82rem(≒11.48px)→新1rem(14px)で約22%拡大 (指示の15〜25%の範囲内)。
      expect(getComputedStyle(label).fontSize).toBe('1rem')
    })

    it('still uses the category leaderTextColor for the text color (既存仕様維持。追加修正6章)', () => {
      const detection = makeDetection({ master_item_category: '内部ﾊﾟﾈﾙ' })
      render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={null}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
        />,
      )
      const label = screen.getByText('11001 OS2-816')
      expect(label.style.getPropertyValue('--cat-leader-text')).toBeTruthy()
      expect(getComputedStyle(label).color).toBeTruthy()
    })
  })

  describe('水平線長の自動計算 (追加修正 第3ラウンド7章〜14章): 固定長ではなく実測ベース', () => {
    function horizontalLen(container: HTMLElement): number {
      const points = parsePathPoints(getVisiblePathD(container))
      return Math.abs(points[0].x - points[1].x) // end <-> elbow (水平線部分)
    }

    function triggerContainerResize(width: number, height: number) {
      setOverlayRect(width, height)
      const el = document.querySelector('.leader-line-overlay') as HTMLElement
      getLatestMockResizeObserver().trigger(el, { width, height })
    }

    it('a longer label text produces a longer horizontal segment than a shorter one, at the same container width', async () => {
      const short = makeDetection({
        id: 1,
        master_item_code: '18001',
        master_item_model: 'A1',
        leader_label_x: 0.5,
        leader_label_y: 0.1,
      })
      const { container: shortContainer, unmount: unmountShort } = render(
        <LeaderLineOverlay
          detections={[short]}
          selectedDetectionId={null}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
        />,
      )
      const beforeResize = horizontalLen(shortContainer)
      triggerContainerResize(1000, 1000)
      // MockResizeObserver.trigger()によるstate更新はReactの通常のイベント
      // ハンドラ経由ではないため、DrawingCanvas.test.tsxの既存パターンと同じく
      // `vi.waitFor`で実際に再レンダーが反映される(＝実測ベースの値に変わる)のを
      // 待ってから読み取る (同期的に直後を読むと更新前の値のままになることがある)。
      await vi.waitFor(() => {
        expect(horizontalLen(shortContainer)).not.toBe(beforeResize)
      })
      const shortLen = horizontalLen(shortContainer)
      unmountShort()

      const long = makeDetection({
        id: 1,
        master_item_code: '18401',
        master_item_model: 'A2(ﾁｬﾝﾈﾙﾍﾞｰｽ含)',
        leader_label_x: 0.5,
        leader_label_y: 0.1,
      })
      const { container: longContainer } = render(
        <LeaderLineOverlay
          detections={[long]}
          selectedDetectionId={null}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
        />,
      )
      const longBeforeResize = horizontalLen(longContainer)
      triggerContainerResize(1000, 1000)
      await vi.waitFor(() => {
        expect(horizontalLen(longContainer)).not.toBe(longBeforeResize)
      })
      const longLen = horizontalLen(longContainer)

      expect(longLen).toBeGreaterThan(shortLen)
    })

    it('the same label text produces a proportionally shorter normalized width when the container is wider (zoom-in相当。追加修正14章: 実pxの文字幅は変わらないため、コンテナが大きいほど正規化割合は小さくなる)', async () => {
      const detection = makeDetection({
        master_item_code: '11526',
        master_item_model: 'IS2-922',
        leader_label_x: 0.5,
        leader_label_y: 0.1,
      })
      const { container } = render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={null}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
        />,
      )
      const initialLen = horizontalLen(container)
      triggerContainerResize(1000, 1000)
      await vi.waitFor(() => {
        expect(horizontalLen(container)).not.toBe(initialLen)
      })
      const narrowLen = horizontalLen(container)
      expect(narrowLen).toBeGreaterThan(0)

      // コンテナ幅を2倍(zoom in相当)にする。文字の実pxサイズ自体は変わらないため、
      // 正規化された水平線の長さはおよそ半分になるはず。
      triggerContainerResize(2000, 2000)
      await vi.waitFor(() => {
        expect(horizontalLen(container)).not.toBe(narrowLen)
      })
      const wideLen = horizontalLen(container)

      expect(wideLen).toBeLessThan(narrowLen)
      expect(wideLen).toBeCloseTo(narrowLen / 2, 2)
    })

    it('falls back to a reasonable approximate width before the container size is known (containerWidthPx=0, e.g. very first render)', () => {
      // ResizeObserverをtriggerしない = containerWidthPxが未確定(0)のまま。
      // この場合でも線が完全に消える・NaNになることはない (フォールバック値を使う)。
      const detection = makeDetection({ leader_label_x: 0.5, leader_label_y: 0.1 })
      const { container } = render(
        <LeaderLineOverlay
          detections={[detection]}
          selectedDetectionId={null}
          hoveredDetectionId={null}
          onHoverDetection={() => {}}
          onSelectDetection={() => {}}
          onMoveLabel={() => {}}
        />,
      )
      const points = parsePathPoints(getVisiblePathD(container))
      const len = Math.abs(points[0].x - points[1].x)
      expect(Number.isFinite(len)).toBe(true)
      expect(len).toBeGreaterThan(0)
    })
  })
})
