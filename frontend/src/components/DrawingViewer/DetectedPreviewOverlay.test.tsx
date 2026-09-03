// DetectedPreviewOverlay.tsx自体はCSSをimportしていない (実際の画面ではDrawingViewer.tsxが
// 一括importする、既存のOverlayコンポーネント群と同じ構成)。単体テストでCSSカスケードを
// 検証するテストのためだけに、ここで明示的にimportする。
import '../DrawingViewer/DrawingViewer.css'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DetectedPreviewOverlay } from './DetectedPreviewOverlay'
import type { DetectedPreviewItem } from '../../types/domain'

function makeItem(overrides: Partial<DetectedPreviewItem> = {}): DetectedPreviewItem {
  return {
    id: 0,
    page_no: 16,
    class_name: 'roof_fan',
    confidence: 0.97,
    normalized_rect: { x: 0.2, y: 0.15, w: 0.03, h: 0.02 },
    source: 'detected_csv',
    ...overrides,
  }
}

describe('DetectedPreviewOverlay (Phase 1.12指示書12章〜17章、Phase 1.13で表示優先度・視認性を整理)', () => {
  it('renders nothing when there are no items (指示書26章/27章: 検出結果なしでもエラーにならない)', () => {
    const { container } = render(<DetectedPreviewOverlay items={[]} />)
    expect(container.querySelectorAll('.detected-preview-overlay__bbox')).toHaveLength(0)
  })

  it('renders one box positioned by normalized coordinates as percentages (指示書8章/9章)', () => {
    const items = [makeItem({ normalized_rect: { x: 0.25, y: 0.15, w: 0.05, h: 0.03 } })]
    const { container } = render(<DetectedPreviewOverlay items={items} />)
    const box = container.querySelector('.detected-preview-overlay__bbox') as HTMLElement
    expect(box.style.left).toBe('25%')
    expect(box.style.top).toBe('15%')
    expect(box.style.width).toBe('5%')
    expect(box.style.height).toBe('3%')
  })

  it('renders ALL detections for the page, not just the first one (指示書10章)', () => {
    const items = [
      makeItem({ id: 0, normalized_rect: { x: 0.1, y: 0.1, w: 0.03, h: 0.02 } }),
      makeItem({ id: 1, normalized_rect: { x: 0.2, y: 0.1, w: 0.03, h: 0.02 } }),
      makeItem({ id: 2, normalized_rect: { x: 0.3, y: 0.1, w: 0.03, h: 0.02 } }),
    ]
    const { container } = render(<DetectedPreviewOverlay items={items} />)
    expect(container.querySelectorAll('.detected-preview-overlay__bbox')).toHaveLength(3)
  })

  describe('Phase 1.13 追加修正1章〜7章: 通常表示は控えめに、詳細はhoverでのみ確認', () => {
    it('shows only the DEVICE name in the always-visible label (confidence is NOT shown by default. 指示書5章/6章)', () => {
      const items = [makeItem({ class_name: 'roof_fan', confidence: 0.923456 })]
      render(<DetectedPreviewOverlay items={items} />)
      expect(screen.getByText('roof_fan')).toBeInTheDocument()
      expect(screen.queryByText(/0\.92/)).not.toBeInTheDocument()
      expect(screen.queryByText(/roof_fan.*0\./)).not.toBeInTheDocument()
    })

    it('has no fill and only a thin (1px) border in the normal state (指示書2章/3章)', () => {
      const items = [makeItem()]
      const { container } = render(<DetectedPreviewOverlay items={items} />)
      const box = container.querySelector('.detected-preview-overlay__bbox') as HTMLElement
      const style = getComputedStyle(box)
      expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(style.backgroundColor)
      expect(style.borderWidth).toBe('1px')
      expect(style.borderColor).toMatch(/59, 130, 246|#3b82f6/i)
    })

    it('does not use a Master category color (uses the same fixed AI color for every item regardless of class. 指示書4章)', () => {
      const items = [makeItem({ id: 0, class_name: 'roof_fan' }), makeItem({ id: 1, class_name: 'panel' })]
      const { container } = render(<DetectedPreviewOverlay items={items} />)
      const boxes = Array.from(container.querySelectorAll('.detected-preview-overlay__bbox'))
      const colors = boxes.map((b) => getComputedStyle(b as HTMLElement).borderColor)
      expect(colors[0]).toBe(colors[1])
    })

    it(':hover CSS rule makes the border thicker and adds a light blue fill (指示書8章)', () => {
      // jsdomは:hover疑似クラスをgetComputedStyleへ反映しないため、CSSルール自体の
      // 存在を`document.styleSheets`から確認する (ProductPanelOverlay.test.tsxと同じ手法)。
      let found = false
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList
        try {
          rules = sheet.cssRules
        } catch {
          continue
        }
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule && rule.selectorText === '.detected-preview-overlay__bbox:hover') {
            expect(rule.style.borderWidth).toBe('2px')
            expect(rule.style.backgroundColor).toBeTruthy()
            found = true
          }
        }
      }
      expect(found).toBe(true)
    })
  })

  describe('Phase 1.13 追加修正8章〜9章: hover時の詳細Tooltip', () => {
    it('shows a DEVICE/SCORE/PAGE/YOLO_INDEX tooltip on hover, with SCORE rounded to 2 decimals (指示書9章/10章)', () => {
      const items = [
        makeItem({ id: 5, page_no: 16, class_name: 'roof_fan', confidence: 0.963812 }),
      ]
      const { container } = render(<DetectedPreviewOverlay items={items} />)
      const box = container.querySelector('.detected-preview-overlay__bbox') as HTMLElement
      fireEvent.mouseEnter(box, { clientX: 100, clientY: 100 })

      expect(screen.getByText('DEVICE: roof_fan')).toBeInTheDocument()
      expect(screen.getByText('SCORE: 0.96')).toBeInTheDocument() // 丸め表示 (元データ0.963812は変更しない)
      expect(screen.getByText('PAGE: 16')).toBeInTheDocument()
      expect(screen.getByText('YOLO_INDEX: 5')).toBeInTheDocument()
    })

    it('hides the tooltip on mouse leave', () => {
      const items = [makeItem()]
      const { container } = render(<DetectedPreviewOverlay items={items} />)
      const box = container.querySelector('.detected-preview-overlay__bbox') as HTMLElement
      fireEvent.mouseEnter(box, { clientX: 100, clientY: 100 })
      expect(screen.getByRole('tooltip')).toBeInTheDocument()

      fireEvent.mouseLeave(box)
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })

    it('clicking a box does not enter any editing/selected state (指示書12章: 表示・確認専用)', () => {
      const items = [makeItem()]
      const { container } = render(<DetectedPreviewOverlay items={items} />)
      const box = container.querySelector('.detected-preview-overlay__bbox') as HTMLElement
      fireEvent.click(box)
      // 選択状態を示すクラスや属性が一切付与されない (そもそもクリックハンドラを持たない)。
      expect(box.className).toBe('detected-preview-overlay__bbox')
    })
  })

  describe('Phase 1.13 追加修正16章〜17章: Master Item選択中(Manual BBox追加モード)との共存', () => {
    it('is hoverable and shows the tooltip when masterItemSelected is false (default. 指示書17章)', () => {
      const items = [makeItem()]
      const { container } = render(<DetectedPreviewOverlay items={items} masterItemSelected={false} />)
      const box = container.querySelector('.detected-preview-overlay__bbox') as HTMLElement
      fireEvent.mouseEnter(box, { clientX: 10, clientY: 10 })
      expect(screen.getByRole('tooltip')).toBeInTheDocument()
    })

    it('does not show the tooltip and sets pointer-events:none while masterItemSelected is true, so it does not block Manual BBox drag creation (指示書16章)', () => {
      const items = [makeItem()]
      const { container } = render(<DetectedPreviewOverlay items={items} masterItemSelected />)
      const box = container.querySelector('.detected-preview-overlay__bbox') as HTMLElement
      fireEvent.mouseEnter(box, { clientX: 10, clientY: 10 })
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
      expect(getComputedStyle(box).pointerEvents).toBe('none')
    })

    it('immediately clears an already-shown tooltip when masterItemSelected becomes true (mirrors ProductPanelOverlay)', () => {
      const items = [makeItem()]
      const { container, rerender } = render(<DetectedPreviewOverlay items={items} masterItemSelected={false} />)
      const box = container.querySelector('.detected-preview-overlay__bbox') as HTMLElement
      fireEvent.mouseEnter(box, { clientX: 10, clientY: 10 })
      expect(screen.getByRole('tooltip')).toBeInTheDocument()

      rerender(<DetectedPreviewOverlay items={items} masterItemSelected />)
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    })
  })

  it('clears hover state when the item list changes (PAGE switch. 指示書21章)', () => {
    const items = [makeItem({ id: 0 })]
    const { container, rerender } = render(<DetectedPreviewOverlay items={items} />)
    const box = container.querySelector('.detected-preview-overlay__bbox') as HTMLElement
    fireEvent.mouseEnter(box, { clientX: 10, clientY: 10 })
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    // 別ページへの切替相当: itemsが入れ替わる (App.tsx側は一旦[]にしてから再取得する)。
    rerender(<DetectedPreviewOverlay items={[]} />)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('is read-only / non-interactive at the container level: the wrapper does not capture pointer events (指示書15章)', () => {
    const items = [makeItem()]
    const { container } = render(<DetectedPreviewOverlay items={items} />)
    const wrapper = container.querySelector('.detected-preview-overlay') as HTMLElement
    expect(getComputedStyle(wrapper).pointerEvents).toBe('none')
  })
})
