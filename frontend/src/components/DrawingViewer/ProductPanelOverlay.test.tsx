// ProductPanelOverlay.tsx自体はCSSをimportしていない (実際の画面ではDrawingViewer.tsxが
// 一括importする、既存のOverlayコンポーネント群と同じ構成)。単体テストでCSSカスケードを
// 検証するテストのためだけに、ここで明示的にimportする。
import '../DrawingViewer/DrawingViewer.css'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProductPanelOverlay } from './ProductPanelOverlay'
import { panelKey } from '../../utils/panel'
import type { PanelPreview } from '../../types/domain'

function makePanel(overrides: Partial<PanelPreview> = {}): PanelPreview {
  return {
    page_no: 16,
    ban_menno: 1,
    ban_no: 1,
    ban_meisyou: '高圧受電盤',
    ban_type: '正面図',
    ban_h1: 2300,
    ban_h2: 2300,
    ban_w: 900,
    ban_d: 2200,
    normalized_rect: { x: 0.1, y: 0.2, w: 0.05, h: 0.1 },
    ...overrides,
  }
}

describe('ProductPanelOverlay (Phase 1.9〜実画面未達修正: 盤ラベル簡素化・クリック選択・hover Tooltip)', () => {
  it('renders nothing when there are no panels', () => {
    const { container } = render(
      <ProductPanelOverlay panels={[]} selectedPanelKey={null} onSelectPanel={() => {}} />,
    )
    expect(container.querySelectorAll('.product-panel-overlay__area')).toHaveLength(0)
  })

  it('renders one rect per panel, positioned by normalized coordinates as percentages', () => {
    const panels = [makePanel({ normalized_rect: { x: 0.25, y: 0.15, w: 0.05, h: 0.2 } })]
    const { container } = render(
      <ProductPanelOverlay panels={panels} selectedPanelKey={null} onSelectPanel={() => {}} />,
    )
    const rect = container.querySelector('.product-panel-overlay__area') as HTMLElement
    expect(rect.style.left).toBe('25%')
    expect(rect.style.top).toBe('15%')
    expect(rect.style.width).toBe('5%')
    expect(rect.style.height).toBe('20%')
  })

  it('renders all rows for a page with multiple panels, not just the first (要件11/20)', () => {
    const panels = [
      makePanel({ ban_menno: 1, ban_no: 1, normalized_rect: { x: 0.1, y: 0.1, w: 0.05, h: 0.05 } }),
      makePanel({ ban_menno: 1, ban_no: 1, normalized_rect: { x: 0.2, y: 0.1, w: 0.05, h: 0.05 } }),
      makePanel({ ban_menno: 2, ban_no: 1, normalized_rect: { x: 0.3, y: 0.1, w: 0.05, h: 0.05 } }),
    ]
    const { container } = render(
      <ProductPanelOverlay panels={panels} selectedPanelKey={null} onSelectPanel={() => {}} />,
    )
    const rects = container.querySelectorAll('.product-panel-overlay__area')
    expect(rects).toHaveLength(3)
  })

  it('shows only BAN_MENNO/BAN_NO on the visible label (BAN_MEISYOU/BAN_TYPE must not be shown by default. 要件3)', () => {
    const panels = [makePanel({ ban_meisyou: 'No.2-1低圧動力盤', ban_type: '背面図', ban_menno: 5, ban_no: 5 })]
    render(<ProductPanelOverlay panels={panels} selectedPanelKey={null} onSelectPanel={() => {}} />)
    expect(screen.getByText('5/5')).toBeInTheDocument()
    expect(screen.queryByText(/No\.2-1低圧動力盤/)).not.toBeInTheDocument()
    expect(screen.queryByText(/背面図/)).not.toBeInTheDocument()
  })

  it('the label must actually be visible (line-height must not be 0, mirroring the DrawingNavigator regression)', () => {
    const { container } = render(
      <ProductPanelOverlay panels={[makePanel()]} selectedPanelKey={null} onSelectPanel={() => {}} />,
    )
    const label = container.querySelector('.product-panel-overlay__label') as HTMLElement
    expect(getComputedStyle(label).lineHeight).not.toBe('0')
  })

  it('regression: the label is not rendered at an unreadably small size (実画面未達 修正指示3章/24章)', () => {
    const { container } = render(
      <ProductPanelOverlay panels={[makePanel()]} selectedPanelKey={null} onSelectPanel={() => {}} />,
    )
    const label = container.querySelector('.product-panel-overlay__label') as HTMLElement
    // jsdomのgetComputedStyleはrem→px解決を行わないため、ルートfont-size
    // (index.css: 15px。全体フォント拡大・BBox編集追従回帰修正 指示1章で14px→15pxへ
    // 引き上げ) を掛けて概算pxへ変換して比較する。
    const ROOT_FONT_SIZE_PX = 15
    expect(parseFloat(getComputedStyle(label).fontSize) * ROOT_FONT_SIZE_PX).toBeGreaterThanOrEqual(11)
  })

  it('Phase 1.10 指示書1章: normal state has no fill at all (border only), so the drawing is never covered in red by default', () => {
    const { container } = render(
      <ProductPanelOverlay panels={[makePanel()]} selectedPanelKey={null} onSelectPanel={() => {}} />,
    )
    const area = container.querySelector('.product-panel-overlay__area') as HTMLElement
    const bg = getComputedStyle(area).backgroundColor
    // transparent は 'rgba(0, 0, 0, 0)' として解決される。いずれにせよalpha=0であること。
    const alpha = Number(bg.match(/[\d.]+\)$/)?.[0].replace(')', '') ?? '1')
    expect(alpha).toBe(0)
  })

  it('Phase 1.10 指示書2章: hovering shows the lightest red fill (rgba(255,0,0,0.08) 相当)、図面の視認性を優先しつつ判別できる', () => {
    const { container } = render(
      <ProductPanelOverlay panels={[makePanel()]} selectedPanelKey={null} onSelectPanel={() => {}} />,
    )
    const area = container.querySelector('.product-panel-overlay__area') as HTMLElement
    // jsdomは:hover疑似クラスをgetComputedStyleへ反映しないため、CSSルール自体の
    // 存在を`document.styleSheets`から確認する (実際のhover時にこの値が適用される
    // ことの間接的な保証。実ブラウザでの最終確認は別途必要)。
    let found = false
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      for (const rule of Array.from(rules)) {
        if (
          rule instanceof CSSStyleRule &&
          rule.selectorText === '.product-panel-overlay__area:hover' &&
          rule.style.backgroundColor
        ) {
          const alpha = Number(rule.style.backgroundColor.match(/[\d.]+\)$/)?.[0].replace(')', ''))
          expect(alpha).toBeGreaterThan(0)
          expect(alpha).toBeLessThanOrEqual(0.1)
          found = true
        }
      }
    }
    expect(found).toBe(true)
    // 通常時(hoverしていない)は塗りつぶし無しのまま。
    expect(Number(getComputedStyle(area).backgroundColor.match(/[\d.]+\)$/)?.[0].replace(')', '') ?? '1')).toBe(0)
  })

  it('the label has no background/box-shadow box, so it does not cover the drawing (追加修正 第4ラウンド7章〜10章)', () => {
    const { container } = render(
      <ProductPanelOverlay panels={[makePanel()]} selectedPanelKey={null} onSelectPanel={() => {}} />,
    )
    const label = container.querySelector('.product-panel-overlay__label') as HTMLElement
    const style = getComputedStyle(label)
    const alpha = Number(style.backgroundColor.match(/[\d.]+\)$/)?.[0].replace(')', '') ?? '1')
    expect(alpha).toBe(0)
    expect(style.boxShadow === 'none' || style.boxShadow === '').toBe(true)
  })

  it('the label still has no background while the panel area is hovered (hover fills only the area, never the label. 追加修正 第4ラウンド10章)', () => {
    const { container } = render(
      <ProductPanelOverlay panels={[makePanel()]} selectedPanelKey={null} onSelectPanel={() => {}} />,
    )
    const area = container.querySelector('.product-panel-overlay__area') as HTMLElement
    fireEvent.mouseEnter(area, { clientX: 50, clientY: 50 })
    const label = container.querySelector('.product-panel-overlay__label') as HTMLElement
    // ラベル自体は`--selected`修飾子しか持たず、hover専用のクラス/背景は
    // 一切付与されない (コンポーネント側の実装自体がhover state用のクラスを
    // labelへ付けていないことをクラス名からも確認する)。
    expect(label.className).not.toMatch(/hover/i)
    const alpha = Number(getComputedStyle(label).backgroundColor.match(/[\d.]+\)$/)?.[0].replace(')', '') ?? '1')
    expect(alpha).toBe(0)
  })

  it('calls onSelectPanel with the panel key and object when a panel area is clicked (要件5)', () => {
    const panel = makePanel({ ban_menno: 2, ban_no: 2 })
    const onSelectPanel = vi.fn()
    render(<ProductPanelOverlay panels={[panel]} selectedPanelKey={null} onSelectPanel={onSelectPanel} />)
    fireEvent.click(screen.getByText('2/2'))
    expect(onSelectPanel).toHaveBeenCalledWith(panelKey(panel, 0), panel)
  })

  it('marks the selected panel visually distinct (bolder border, slightly darker fill. 要件7)', () => {
    const panel = makePanel({ ban_menno: 2, ban_no: 2 })
    const key = panelKey(panel, 0)
    const { container } = render(
      <ProductPanelOverlay panels={[panel]} selectedPanelKey={key} onSelectPanel={() => {}} />,
    )
    const area = container.querySelector('.product-panel-overlay__area') as HTMLElement
    expect(area.className).toContain('product-panel-overlay__area--selected')
    expect(area.className).not.toContain('product-panel-overlay__area--dimmed')
  })

  it('emphasizes the selected panel label too (実画面未達 修正指示10章: `5/5` → `[5/5]`)', () => {
    const panel = makePanel({ ban_menno: 5, ban_no: 5 })
    const key = panelKey(panel, 0)
    render(<ProductPanelOverlay panels={[panel]} selectedPanelKey={key} onSelectPanel={() => {}} />)
    expect(screen.getByText('[5/5]')).toBeInTheDocument()
    expect(screen.queryByText('5/5')).not.toBeInTheDocument()
  })

  it('dims non-selected panels while a panel is selected, without hiding them entirely (要件8)', () => {
    const panels = [makePanel({ ban_menno: 1, ban_no: 1 }), makePanel({ ban_menno: 2, ban_no: 2 })]
    const selectedKey = panelKey(panels[0], 0)
    const { container } = render(
      <ProductPanelOverlay panels={panels} selectedPanelKey={selectedKey} onSelectPanel={() => {}} />,
    )
    const areas = container.querySelectorAll('.product-panel-overlay__area')
    expect(areas[0].className).toContain('--selected')
    expect(areas[0].className).not.toContain('--dimmed')
    expect(areas[1].className).toContain('--dimmed')
    expect(areas[1].className).not.toContain('--selected')
    // 完全非表示にはしない (DOM上に引き続き存在しクリック可能)
    expect(areas[1]).toBeInTheDocument()
  })

  it('renders each area as a <button> so DrawingCanvas\'s existing closest("button") guard excludes it from Pan/Manual BBox start (要件9/10)', () => {
    const { container } = render(
      <ProductPanelOverlay panels={[makePanel()]} selectedPanelKey={null} onSelectPanel={() => {}} />,
    )
    const area = container.querySelector('.product-panel-overlay__area') as HTMLElement
    expect(area.tagName).toBe('BUTTON')
  })

  describe('hover Tooltip (実画面未達 修正指示5章/6章/7章: title属性だけに依存しない独自Tooltip)', () => {
    it('shows no tooltip before hovering', () => {
      const { container } = render(
        <ProductPanelOverlay panels={[makePanel()]} selectedPanelKey={null} onSelectPanel={() => {}} />,
      )
      expect(container.querySelector('.product-panel-overlay__tooltip')).not.toBeInTheDocument()
    })

    it('shows a real DOM tooltip (not just a title attribute) on hover, with PAGE/BAN_MENNO/BAN_NO/BAN_MEISYOU/BAN_TYPE', () => {
      const panel = makePanel({
        page_no: 16,
        ban_menno: 5,
        ban_no: 5,
        ban_meisyou: 'No.2-1低圧動力盤',
        ban_type: '正面図',
      })
      const { container } = render(
        <ProductPanelOverlay panels={[panel]} selectedPanelKey={null} onSelectPanel={() => {}} />,
      )
      const area = screen.getByText('5/5').closest('button') as HTMLElement
      expect(area.title).toBeFalsy() // title属性単体には依存しない

      fireEvent.mouseEnter(area, { clientX: 100, clientY: 100 })

      const tooltip = container.querySelector('.product-panel-overlay__tooltip') as HTMLElement
      expect(tooltip).toBeInTheDocument()
      expect(tooltip.textContent).toContain('面番号：5')
      expect(tooltip.textContent).toContain('盤番号：5')
      expect(tooltip.textContent).toContain('盤名称：No.2-1低圧動力盤')
      expect(tooltip.textContent).toContain('種別：正面図')
      expect(tooltip.textContent).toContain('PAGE：16')
    })

    it('omits missing BAN_MEISYOU/BAN_TYPE from the tooltip rather than showing empty labels', () => {
      const panel = makePanel({ ban_meisyou: '', ban_type: '' })
      const { container } = render(
        <ProductPanelOverlay panels={[panel]} selectedPanelKey={null} onSelectPanel={() => {}} />,
      )
      const area = container.querySelector('.product-panel-overlay__area') as HTMLElement
      fireEvent.mouseEnter(area, { clientX: 50, clientY: 50 })
      const tooltip = container.querySelector('.product-panel-overlay__tooltip') as HTMLElement
      expect(tooltip.textContent).not.toContain('盤名称')
      expect(tooltip.textContent).not.toContain('種別')
    })

    it('hides the tooltip when the mouse leaves the panel area', () => {
      const { container } = render(
        <ProductPanelOverlay panels={[makePanel()]} selectedPanelKey={null} onSelectPanel={() => {}} />,
      )
      const area = container.querySelector('.product-panel-overlay__area') as HTMLElement
      fireEvent.mouseEnter(area, { clientX: 50, clientY: 50 })
      expect(container.querySelector('.product-panel-overlay__tooltip')).toBeInTheDocument()

      fireEvent.mouseLeave(area)
      expect(container.querySelector('.product-panel-overlay__tooltip')).not.toBeInTheDocument()
    })

    it('does not intercept clicks/hover of other panel areas (pointer-events:none)', () => {
      const { container } = render(
        <ProductPanelOverlay panels={[makePanel()]} selectedPanelKey={null} onSelectPanel={() => {}} />,
      )
      const area = container.querySelector('.product-panel-overlay__area') as HTMLElement
      fireEvent.mouseEnter(area, { clientX: 50, clientY: 50 })
      const tooltip = container.querySelector('.product-panel-overlay__tooltip') as HTMLElement
      expect(getComputedStyle(tooltip).pointerEvents).toBe('none')
    })

    it('hover and click are independent: showing the tooltip does not prevent onSelectPanel from firing (要件7)', () => {
      const panel = makePanel({ ban_menno: 3, ban_no: 3 })
      const onSelectPanel = vi.fn()
      render(<ProductPanelOverlay panels={[panel]} selectedPanelKey={null} onSelectPanel={onSelectPanel} />)
      const area = screen.getByText('3/3').closest('button') as HTMLElement

      fireEvent.mouseEnter(area, { clientX: 50, clientY: 50 })
      fireEvent.click(area)

      expect(onSelectPanel).toHaveBeenCalledWith(panelKey(panel, 0), panel)
    })
  })

  describe('積算コード選択中の挙動 (Phase 1.10 指示書4章〜7章)', () => {
    it('shows the tooltip on hover when no Master item is selected (masterItemSelected=false)', () => {
      const { container } = render(
        <ProductPanelOverlay
          panels={[makePanel()]}
          selectedPanelKey={null}
          onSelectPanel={() => {}}
          masterItemSelected={false}
        />,
      )
      const area = container.querySelector('.product-panel-overlay__area') as HTMLElement
      fireEvent.mouseEnter(area, { clientX: 50, clientY: 50 })
      expect(container.querySelector('.product-panel-overlay__tooltip')).toBeInTheDocument()
    })

    it('does NOT show the tooltip on hover while a Master item is selected (要件4/5)', () => {
      const { container } = render(
        <ProductPanelOverlay
          panels={[makePanel()]}
          selectedPanelKey={null}
          onSelectPanel={() => {}}
          masterItemSelected={true}
        />,
      )
      const area = container.querySelector('.product-panel-overlay__area') as HTMLElement
      fireEvent.mouseEnter(area, { clientX: 50, clientY: 50 })
      expect(container.querySelector('.product-panel-overlay__tooltip')).not.toBeInTheDocument()
    })

    it('hides an already-visible tooltip the moment a Master item becomes selected, even without a mouseLeave', () => {
      const panel = makePanel()
      const { container, rerender } = render(
        <ProductPanelOverlay
          panels={[panel]}
          selectedPanelKey={null}
          onSelectPanel={() => {}}
          masterItemSelected={false}
        />,
      )
      const area = container.querySelector('.product-panel-overlay__area') as HTMLElement
      fireEvent.mouseEnter(area, { clientX: 50, clientY: 50 })
      expect(container.querySelector('.product-panel-overlay__tooltip')).toBeInTheDocument()

      rerender(
        <ProductPanelOverlay
          panels={[panel]}
          selectedPanelKey={null}
          onSelectPanel={() => {}}
          masterItemSelected={true}
        />,
      )
      expect(container.querySelector('.product-panel-overlay__tooltip')).not.toBeInTheDocument()
    })

    it('keeps the border and BAN_MENNO/BAN_NO label visible while a Master item is selected (要件6: 盤の位置確認は妨げない)', () => {
      const panel = makePanel({ ban_menno: 7, ban_no: 7 })
      const { container } = render(
        <ProductPanelOverlay
          panels={[panel]}
          selectedPanelKey={null}
          onSelectPanel={() => {}}
          masterItemSelected={true}
        />,
      )
      expect(container.querySelector('.product-panel-overlay__area')).toBeInTheDocument()
      expect(screen.getByText('7/7')).toBeInTheDocument()
    })

    it('does not call onSelectPanel when clicked while a Master item is selected (盤クリックより先にBBox作業を優先する)', () => {
      const panel = makePanel()
      const onSelectPanel = vi.fn()
      const { container } = render(
        <ProductPanelOverlay
          panels={[panel]}
          selectedPanelKey={null}
          onSelectPanel={onSelectPanel}
          masterItemSelected={true}
        />,
      )
      fireEvent.click(container.querySelector('.product-panel-overlay__area') as HTMLElement)
      expect(onSelectPanel).not.toHaveBeenCalled()
    })

    it('sets pointer-events:none on the area while a Master item is selected, so Viewer drags reach DrawingCanvas directly for Manual BBox creation (要件7)', () => {
      const { container } = render(
        <ProductPanelOverlay
          panels={[makePanel()]}
          selectedPanelKey={null}
          onSelectPanel={() => {}}
          masterItemSelected={true}
        />,
      )
      const area = container.querySelector('.product-panel-overlay__area') as HTMLElement
      expect(getComputedStyle(area).pointerEvents).toBe('none')
    })

    it('pointer-events remain auto (normal, interactive) when no Master item is selected', () => {
      const { container } = render(
        <ProductPanelOverlay panels={[makePanel()]} selectedPanelKey={null} onSelectPanel={() => {}} />,
      )
      const area = container.querySelector('.product-panel-overlay__area') as HTMLElement
      expect(getComputedStyle(area).pointerEvents).toBe('auto')
    })
  })

  describe('同一盤の別矢視 連動ハイライト (Phase 1.11 UI改修指示17章〜19章、追加修正1章〜3章で条件変更)', () => {
    function makeSameBanGroup() {
      return [
        makePanel({ ban_menno: 5, ban_no: 5, ban_type: '正面図', ban_meisyou: 'No.2-1低圧動力盤' }),
        makePanel({ ban_menno: 5, ban_no: 5, ban_type: '背面図', ban_meisyou: 'No.2-1低圧動力盤' }),
        makePanel({ ban_menno: 5, ban_no: 5, ban_type: '左側面図', ban_meisyou: 'No.2-1低圧動力盤' }),
        makePanel({ ban_menno: 4, ban_no: 4, ban_type: '正面図', ban_meisyou: '別の盤' }),
      ]
    }

    it('highlights every area sharing the same PAGE/BAN_MENNO/BAN_NO when one is hovered, regardless of BAN_TYPE (ページ内に複数種類のBANが存在する場合)', () => {
      const panels = makeSameBanGroup()
      const { container } = render(
        <ProductPanelOverlay panels={panels} selectedPanelKey={null} onSelectPanel={() => {}} />,
      )
      const areas = container.querySelectorAll('.product-panel-overlay__area')
      fireEvent.mouseEnter(areas[0], { clientX: 50, clientY: 50 }) // 5/5 正面図

      // 5/5の背面図・左側面図も連動してハイライトされる。
      expect(areas[1].className).toContain('--group-hover')
      expect(areas[2].className).toContain('--group-hover')
    })

    it('does not highlight a different BAN_NO (指示書18章)', () => {
      const panels = makeSameBanGroup()
      const { container } = render(
        <ProductPanelOverlay panels={panels} selectedPanelKey={null} onSelectPanel={() => {}} />,
      )
      const areas = container.querySelectorAll('.product-panel-overlay__area')
      fireEvent.mouseEnter(areas[0], { clientX: 50, clientY: 50 }) // 5/5 正面図

      expect(areas[3].className).not.toContain('--group-hover') // 4/4 正面図
    })

    it('shows the Tooltip content for the actually-hovered area only, not a representative/group value (要件19)', () => {
      const panels = makeSameBanGroup()
      const { container } = render(
        <ProductPanelOverlay panels={panels} selectedPanelKey={null} onSelectPanel={() => {}} />,
      )
      const areas = container.querySelectorAll('.product-panel-overlay__area')
      fireEvent.mouseEnter(areas[1], { clientX: 50, clientY: 50 }) // 5/5 背面図

      const tooltip = container.querySelector('.product-panel-overlay__tooltip') as HTMLElement
      expect(tooltip.textContent).toContain('種別：背面図')
      expect(tooltip.textContent).not.toContain('種別：正面図')
    })

    it('clears the group highlight when the mouse leaves', () => {
      const panels = makeSameBanGroup()
      const { container } = render(
        <ProductPanelOverlay panels={panels} selectedPanelKey={null} onSelectPanel={() => {}} />,
      )
      const areas = container.querySelectorAll('.product-panel-overlay__area')
      fireEvent.mouseEnter(areas[0], { clientX: 50, clientY: 50 })
      expect(areas[1].className).toContain('--group-hover')

      fireEvent.mouseLeave(areas[0])
      expect(areas[1].className).not.toContain('--group-hover')
    })

    it('追加修正1章/2章: does NOT group-highlight when the page has only one unique BAN_MENNO/BAN_NO pair (例: P21のように同じ盤の別矢視だけが並ぶページ)', () => {
      const panels = [
        makePanel({ ban_menno: 1, ban_no: 1, ban_type: '正面図' }),
        makePanel({ ban_menno: 1, ban_no: 1, ban_type: '側面図' }),
      ]
      const { container } = render(
        <ProductPanelOverlay panels={panels} selectedPanelKey={null} onSelectPanel={() => {}} />,
      )
      const areas = container.querySelectorAll('.product-panel-overlay__area')
      fireEvent.mouseEnter(areas[0], { clientX: 50, clientY: 50 }) // 1/1 正面図

      // 同じ1/1の側面図であっても、ページ内に他のBAN_MENNO/BAN_NOが存在しないため
      // group-hoverは付与されない (実hover領域だけを塗りつぶす)。
      expect(areas[1].className).not.toContain('--group-hover')
      expect(areas[0].className).not.toContain('--group-hover')
    })

    it('追加修正2章: enables group-highlight as soon as the page has 2+ unique BAN_MENNO/BAN_NO pairs (uniqueBanPairs.size > 1)', () => {
      const panels = [
        makePanel({ ban_menno: 1, ban_no: 1, ban_type: '正面図' }),
        makePanel({ ban_menno: 1, ban_no: 1, ban_type: '右側面図' }),
        makePanel({ ban_menno: 2, ban_no: 2, ban_type: '正面図' }),
      ]
      const { container } = render(
        <ProductPanelOverlay panels={panels} selectedPanelKey={null} onSelectPanel={() => {}} />,
      )
      const areas = container.querySelectorAll('.product-panel-overlay__area')
      fireEvent.mouseEnter(areas[0], { clientX: 50, clientY: 50 }) // 1/1 正面図

      expect(areas[1].className).toContain('--group-hover') // 1/1 右側面図
      expect(areas[2].className).not.toContain('--group-hover') // 2/2 正面図 (別盤)
    })

    it('追加修正4章: Tooltip still shows only the actually-hovered row even when grouped highlighting is disabled', () => {
      const panels = [
        makePanel({ ban_menno: 1, ban_no: 1, ban_type: '正面図', ban_meisyou: '盤A' }),
        makePanel({ ban_menno: 1, ban_no: 1, ban_type: '側面図', ban_meisyou: '盤A' }),
      ]
      const { container } = render(
        <ProductPanelOverlay panels={panels} selectedPanelKey={null} onSelectPanel={() => {}} />,
      )
      const areas = container.querySelectorAll('.product-panel-overlay__area')
      fireEvent.mouseEnter(areas[1], { clientX: 50, clientY: 50 }) // 側面図をhover

      const tooltip = container.querySelector('.product-panel-overlay__tooltip') as HTMLElement
      expect(tooltip.textContent).toContain('種別：側面図')
      expect(tooltip.textContent).not.toContain('種別：正面図')
    })
  })

  describe('focusPanel (盤フォーカス・積算明細再設計 指示1章: 積算集約で個別盤を選択した際のViewer絞り込み)', () => {
    it('renders only the panels matching focusPanel, hiding all others', () => {
      const panels = [
        makePanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '高圧受電盤' }),
        makePanel({ ban_menno: 2, ban_no: 1, ban_meisyou: '低圧電灯盤' }),
      ]
      render(
        <ProductPanelOverlay
          panels={panels}
          selectedPanelKey={null}
          onSelectPanel={() => {}}
          focusPanel={{ banMenno: 1, banNo: 1 }}
        />,
      )
      expect(screen.getByText('1/1')).toBeInTheDocument()
      expect(screen.queryByText('2/1')).not.toBeInTheDocument()
    })

    it('renders all panels when focusPanel is null (総合計・製品全体)', () => {
      const panels = [
        makePanel({ ban_menno: 1, ban_no: 1 }),
        makePanel({ ban_menno: 2, ban_no: 1 }),
      ]
      render(
        <ProductPanelOverlay panels={panels} selectedPanelKey={null} onSelectPanel={() => {}} focusPanel={null} />,
      )
      expect(screen.getByText('1/1')).toBeInTheDocument()
      expect(screen.getByText('2/1')).toBeInTheDocument()
    })

    it('keeps all matching views (矢視) of the focused physical panel visible', () => {
      const panels = [
        makePanel({ ban_menno: 1, ban_no: 1, ban_type: '正面図' }),
        makePanel({ ban_menno: 1, ban_no: 1, ban_type: '背面図' }),
        makePanel({ ban_menno: 2, ban_no: 1, ban_type: '正面図' }),
      ]
      const { container } = render(
        <ProductPanelOverlay
          panels={panels}
          selectedPanelKey={null}
          onSelectPanel={() => {}}
          focusPanel={{ banMenno: 1, banNo: 1 }}
        />,
      )
      expect(container.querySelectorAll('.product-panel-overlay__area')).toHaveLength(2)
    })

    it('does not shift panelKey indices when focusPanel changes, keeping selectedPanelKey matching stable', () => {
      const panels = [
        makePanel({ ban_menno: 1, ban_no: 1 }),
        makePanel({ ban_menno: 2, ban_no: 1 }),
      ]
      const key1 = panelKey(panels[1], 1) // 絞り込み前のindexを使ったkey (盤2/1)
      const { container, rerender } = render(
        <ProductPanelOverlay
          panels={panels}
          selectedPanelKey={key1}
          onSelectPanel={() => {}}
          focusPanel={null}
        />,
      )
      expect(container.querySelector('.product-panel-overlay__area--selected')).not.toBeNull()

      // フォーカスを盤2/1自身へ絞り込んでも、同じkeyのままselected状態を維持できる。
      rerender(
        <ProductPanelOverlay
          panels={panels}
          selectedPanelKey={key1}
          onSelectPanel={() => {}}
          focusPanel={{ banMenno: 2, banNo: 1 }}
        />,
      )
      const remaining = container.querySelectorAll('.product-panel-overlay__area')
      expect(remaining).toHaveLength(1)
      expect(remaining[0].className).toContain('--selected')
    })
  })
})
