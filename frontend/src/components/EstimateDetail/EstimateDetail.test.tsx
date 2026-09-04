import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EstimateDetail } from './EstimateDetail'
import type { EstimateDetailItem, EstimateTarget } from '../../types/estimateAggregation'

function makeDetailItem(overrides: Partial<EstimateDetailItem> = {}): EstimateDetailItem {
  return {
    id: '1',
    detectionId: 1,
    drawingPageId: 100,
    pageNo: 16,
    targetId: 'product',
    source: 'manual',
    masterItemId: 10,
    code: '18311',
    itemName: null,
    model: '換気扇',
    rating: '上部取付',
    status: 'reviewed',
    editedAt: null,
    editSequence: 0,
    ...overrides,
  }
}

const productTarget: EstimateTarget = { id: 'product', type: 'product', name: '製品全体', banMenno: null, banNo: null }
const panel11Target: EstimateTarget = { id: 'panel:1:1', type: 'panel', name: '高圧受電盤', banMenno: 1, banNo: 1 }
const panel22Target: EstimateTarget = { id: 'panel:2:2', type: 'panel', name: '低圧電灯盤', banMenno: 2, banNo: 2 }
const tieTarget: EstimateTarget = {
  id: '__tie__',
  type: 'tie',
  name: '要確認（複数盤の交差面積が同値）',
  banMenno: null,
  banNo: null,
}
const DEFAULT_TARGETS = [productTarget, panel11Target, panel22Target, tieTarget]

function renderDetail(props: Partial<Parameters<typeof EstimateDetail>[0]> = {}) {
  return render(
    <EstimateDetail
      detailItems={[]}
      targets={DEFAULT_TARGETS}
      selectedTargetId={null}
      currentPageNo={null}
      onNavigateReference={() => {}}
      onHoverDetail={() => {}}
      sourceFilter="all"
      onSourceFilterChange={() => {}}
      {...props}
    />,
  )
}

describe('EstimateDetail (積算明細強化・Undo/Redo・要確認警告・編集追従: 8カラム表)', () => {
  it('shows the empty message inside the table when there are no detail items', () => {
    renderDetail({ detailItems: [] })
    expect(screen.getByText('明細がありません')).toBeInTheDocument()
  })

  it('shows the 8 columns: 面/盤・品名・コード・型式・定格・図面・状態・編集順 (指示1章)', () => {
    renderDetail({ detailItems: [makeDetailItem()], currentPageNo: 16 })
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.replace(/[▲▼]/g, ''))
    expect(headers).toEqual(['面/盤', '品名', 'コード', '型式', '定格', '図面', '状態', '編集順'])
  })

  it('derives the 面/盤 cell from the existing EstimateTarget (targetId lookup), not by parsing display strings (指示1章)', () => {
    renderDetail({
      detailItems: [
        makeDetailItem({ id: '1', targetId: 'panel:1:1' }),
        makeDetailItem({ id: '2', detectionId: 2, targetId: 'product', code: '18312' }),
        makeDetailItem({ id: '3', detectionId: 3, targetId: '__tie__', code: '18313' }),
      ],
      currentPageNo: 16,
    })
    const panelCol = document.querySelectorAll('tbody .estimate-detail__col-panel')
    const texts = Array.from(panelCol).map((c) => c.textContent)
    expect(texts).toEqual(['1/1', '全体', '要確認'])
  })

  it('shows "-" for 面/盤 when the targetId has no matching EstimateTarget', () => {
    renderDetail({ detailItems: [makeDetailItem({ targetId: 'panel:9:9' })], currentPageNo: 16 })
    expect(document.querySelector('tbody .estimate-detail__col-panel')?.textContent).toBe('-')
  })

  it('shows "-" for 品名 since no real item-name field exists in the data, without fabricating a value', () => {
    renderDetail({ detailItems: [makeDetailItem({ itemName: null })], currentPageNo: 16 })
    const row = screen.getByText('18311').closest('tr') as HTMLElement
    const nameCell = row.querySelector('.estimate-detail__col-name')
    expect(nameCell?.textContent).toBe('-')
  })

  it('shows 型式 and 定格 as independent columns', () => {
    renderDetail({
      detailItems: [makeDetailItem({ model: 'IS2-1622', rating: '2.3*1.6*2.2:両開' })],
      currentPageNo: 16,
    })
    const row = screen.getByText('18311').closest('tr') as HTMLElement
    expect(within(row).getByText('IS2-1622')).toBeInTheDocument()
    expect(within(row).getByText('2.3*1.6*2.2:両開')).toBeInTheDocument()
  })

  it('shows only the page number (e.g. "P16"), not the drawing name, in the 図面 column', () => {
    renderDetail({ detailItems: [makeDetailItem({ pageNo: 16 })], currentPageNo: 16 })
    expect(screen.getByText('P16')).toBeInTheDocument()
    expect(screen.queryByText(/外形図/)).not.toBeInTheDocument()
  })

  it('shows the status as one of ○/△/× symbols, mapped from the real Detection.status', () => {
    const items = [
      makeDetailItem({ id: '1', detectionId: 1, status: 'reviewed' }),
      makeDetailItem({ id: '2', detectionId: 2, status: 'needs_review' }),
      makeDetailItem({ id: '3', detectionId: 3, status: 'pending' }),
      makeDetailItem({ id: '4', detectionId: 4, status: 'excluded' }),
    ]
    renderDetail({ detailItems: items, currentPageNo: 16 })
    expect(screen.getAllByText('○')).toHaveLength(1) // reviewed
    expect(screen.getAllByText('△')).toHaveLength(2) // needs_review + pending
    expect(screen.getAllByText('×')).toHaveLength(1) // excluded
  })

  it('shows "-" for 編集順 when the item has never been edited this session (editedAt === null)', () => {
    renderDetail({ detailItems: [makeDetailItem({ editedAt: null })], currentPageNo: 16 })
    expect(document.querySelector('tbody .estimate-detail__col-edit-order')?.textContent).toBe('-')
  })

  it('shows both the datetime and the sequence number for an edited item (CSS container query switches which is visible)', () => {
    const editedAt = new Date(2026, 8, 3, 10, 44, 3).getTime() // 2026-09-03 10:44:03 (月は0始まり)
    renderDetail({ detailItems: [makeDetailItem({ editedAt, editSequence: 15 })], currentPageNo: 16 })
    const cell = document.querySelector('tbody .estimate-detail__col-edit-order') as HTMLElement
    expect(within(cell).getByText('20260903 10:44:03')).toBeInTheDocument()
    expect(within(cell).getByText('15')).toBeInTheDocument()
  })

  it('shows a legend explaining the status symbols, always outside the scroll area', () => {
    renderDetail({ detailItems: [makeDetailItem()], currentPageNo: 16 })
    const legend = document.querySelector('.estimate-detail__legend')
    expect(legend?.textContent).toBe('○ 確定　△ 要確認　× 不備')
    // 凡例はテーブルのスクロール領域(.estimate-detail__table-scroll)の外にある。
    expect(document.querySelector('.estimate-detail__table-scroll')?.contains(legend as Node)).toBe(false)
  })

  it('shows 4 source tabs (全て/AI/設計情報/マニュアル) with counts, controlled by the sourceFilter prop', () => {
    const items = [
      makeDetailItem({ id: '1', source: 'ai' }),
      makeDetailItem({ id: '2', source: 'manual' }),
      makeDetailItem({ id: '3', source: 'manual' }),
    ]
    renderDetail({ detailItems: items, currentPageNo: 16 })
    expect(screen.getByRole('tab', { name: '全て 3' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'AI 1' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '設計情報 0' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'マニュアル 2' })).toBeInTheDocument()
  })

  it('calls onSourceFilterChange (not an internal state) when a source tab is clicked (指示12章: App.tsx側から強制切替できるようcontrolled)', () => {
    const onSourceFilterChange = vi.fn()
    renderDetail({
      detailItems: [makeDetailItem({ source: 'ai' })],
      currentPageNo: 16,
      sourceFilter: 'all',
      onSourceFilterChange,
    })
    fireEvent.click(screen.getByRole('tab', { name: /^AI/ }))
    expect(onSourceFilterChange).toHaveBeenCalledWith('ai')
  })

  it('filters detail items to the currently selected target', () => {
    const items = [
      makeDetailItem({ id: '1', targetId: 'product', code: '18311' }),
      makeDetailItem({ id: '2', targetId: 'panel:1:1', code: '11576' }),
    ]
    renderDetail({ detailItems: items, selectedTargetId: 'panel:1:1', currentPageNo: 16 })
    expect(screen.queryByText('18311')).not.toBeInTheDocument()
    expect(screen.getByText('11576')).toBeInTheDocument()
  })

  it('does not merge same-code items across different pages: each stays its own row', () => {
    const items = [
      makeDetailItem({ id: '1', detectionId: 1, pageNo: 16 }),
      makeDetailItem({ id: '2', detectionId: 2, pageNo: 18 }),
      makeDetailItem({ id: '3', detectionId: 3, pageNo: 23 }),
    ]
    renderDetail({ detailItems: items, currentPageNo: 16 })
    expect(screen.getAllByText('18311')).toHaveLength(3)
    expect(screen.getByText('P16')).toBeInTheDocument()
    expect(screen.getByText('P18')).toBeInTheDocument()
    expect(screen.getByText('P23')).toBeInTheDocument()
  })

  it('calls onHoverDetail(detectionId) on row mouseEnter and onHoverDetail(null) on mouseLeave', () => {
    const onHoverDetail = vi.fn()
    renderDetail({ detailItems: [makeDetailItem({ detectionId: 42 })], currentPageNo: 16, onHoverDetail })
    const row = screen.getByText('18311').closest('tr') as HTMLElement
    fireEvent.mouseEnter(row)
    expect(onHoverDetail).toHaveBeenCalledWith(42)
    fireEvent.mouseLeave(row)
    expect(onHoverDetail).toHaveBeenCalledWith(null)
  })

  it('calls onNavigateReference when the 図面 cell is clicked, and does NOT call it on mere hover', () => {
    const onNavigateReference = vi.fn()
    renderDetail({
      detailItems: [makeDetailItem({ detectionId: 7, drawingPageId: 55, pageNo: 16 })],
      currentPageNo: 18,
      onNavigateReference,
    })
    const row = screen.getByText('18311').closest('tr') as HTMLElement
    fireEvent.mouseEnter(row)
    expect(onNavigateReference).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('P16'))
    expect(onNavigateReference).toHaveBeenCalledWith(55, 7)
  })

  it('marks the page link for the currently-displayed page distinctly from other pages', () => {
    const items = [makeDetailItem({ id: '1', detectionId: 1, pageNo: 16 }), makeDetailItem({ id: '2', detectionId: 2, pageNo: 18 })]
    renderDetail({ detailItems: items, currentPageNo: 16 })
    expect(screen.getByText('P16').className).toContain('estimate-detail__page-link--current')
    expect(screen.getByText('P18').className).not.toContain('estimate-detail__page-link--current')
  })

  describe('現在ページ行の強調 (指示4章)', () => {
    it('marks the row whose pageNo matches currentPageNo with the current-page class, and no others', () => {
      const items = [
        makeDetailItem({ id: '1', detectionId: 1, pageNo: 16, code: '111' }),
        makeDetailItem({ id: '2', detectionId: 2, pageNo: 18, code: '222' }),
      ]
      renderDetail({ detailItems: items, currentPageNo: 16 })
      const row16 = screen.getByText('111').closest('tr') as HTMLElement
      const row18 = screen.getByText('222').closest('tr') as HTMLElement
      expect(row16.className).toContain('estimate-detail__row--current-page')
      expect(row18.className).not.toContain('estimate-detail__row--current-page')
    })

    it('switches which row is marked as current-page in real time when currentPageNo prop changes', () => {
      const items = [
        makeDetailItem({ id: '1', detectionId: 1, pageNo: 16, code: '111' }),
        makeDetailItem({ id: '2', detectionId: 2, pageNo: 18, code: '222' }),
      ]
      const { rerender } = renderDetail({ detailItems: items, currentPageNo: 16 })
      expect((screen.getByText('111').closest('tr') as HTMLElement).className).toContain('--current-page')

      rerender(
        <EstimateDetail
          detailItems={items}
          targets={DEFAULT_TARGETS}
          selectedTargetId={null}
          currentPageNo={18}
          onNavigateReference={() => {}}
          onHoverDetail={() => {}}
          sourceFilter="all"
          onSourceFilterChange={() => {}}
        />,
      )
      expect((screen.getByText('111').closest('tr') as HTMLElement).className).not.toContain('--current-page')
      expect((screen.getByText('222').closest('tr') as HTMLElement).className).toContain('--current-page')
    })
  })

  describe('編集直後の一時強調 (指示5章/13章)', () => {
    it('marks the edit-followed row with the edit-follow class, taking priority over current-page', () => {
      const items = [makeDetailItem({ id: '1', detectionId: 1, pageNo: 16, code: '111' })]
      renderDetail({ detailItems: items, currentPageNo: 16, editFollowDetectionId: 1 })
      const row = screen.getByText('111').closest('tr') as HTMLElement
      expect(row.className).toContain('estimate-detail__row--edit-follow')
    })

    it('does not mark any row when editFollowDetectionId does not match any item', () => {
      const items = [makeDetailItem({ id: '1', detectionId: 1, pageNo: 16, code: '111' })]
      renderDetail({ detailItems: items, currentPageNo: 16, editFollowDetectionId: 999 })
      const row = screen.getByText('111').closest('tr') as HTMLElement
      expect(row.className).not.toContain('estimate-detail__row--edit-follow')
    })

    it('scrolls the edit-followed row into view', () => {
      const items = [makeDetailItem({ id: '1', detectionId: 1, pageNo: 16, code: '111' })]
      const scrollIntoView = vi.fn()
      const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
      HTMLElement.prototype.scrollIntoView = scrollIntoView
      try {
        renderDetail({ detailItems: items, currentPageNo: 16, editFollowDetectionId: 1 })
        expect(scrollIntoView).toHaveBeenCalled()
      } finally {
        HTMLElement.prototype.scrollIntoView = originalScrollIntoView
      }
    })
  })

  describe('全カラムソート (指示3章)', () => {
    it('defaults to 編集順 descending (指示3章: 初期状態は編集順降順)', () => {
      const items = [
        makeDetailItem({ id: '1', detectionId: 1, code: '111', editSequence: 1 }),
        makeDetailItem({ id: '2', detectionId: 2, code: '222', editSequence: 3 }),
        makeDetailItem({ id: '3', detectionId: 3, code: '333', editSequence: 2 }),
      ]
      renderDetail({ detailItems: items, currentPageNo: 16 })
      const codes = screen.getAllByText(/^(111|222|333)$/).map((el) => el.textContent)
      expect(codes).toEqual(['222', '333', '111']) // editSequence 3,2,1
      // 編集順ヘッダに▼(降順)が出ている。
      const editOrderHeader = screen.getAllByRole('columnheader').find((h) => h.textContent?.includes('編集順'))
      expect(editOrderHeader?.textContent).toContain('▼')
    })

    it('sorts by コード numerically (指示3章: 数値順)', () => {
      const items = [
        makeDetailItem({ id: '1', detectionId: 1, code: '20' }),
        makeDetailItem({ id: '2', detectionId: 2, code: '3' }),
        makeDetailItem({ id: '3', detectionId: 3, code: '100' }),
      ]
      renderDetail({ detailItems: items, currentPageNo: 16 })
      fireEvent.click(screen.getByRole('button', { name: 'コードでソート' }))
      const codes = screen.getAllByText(/^(20|3|100)$/).map((el) => el.textContent)
      expect(codes).toEqual(['3', '20', '100']) // 昇順、数値として3<20<100 (文字列順なら100<20<3)
    })

    it('toggles ascending/descending on repeated header clicks of the same column', () => {
      const items = [
        makeDetailItem({ id: '1', detectionId: 1, code: '20' }),
        makeDetailItem({ id: '2', detectionId: 2, code: '3' }),
      ]
      renderDetail({ detailItems: items, currentPageNo: 16 })
      const codeHeaderButton = screen.getByRole('button', { name: 'コードでソート' })
      fireEvent.click(codeHeaderButton) // 1回目: 昇順
      expect(screen.getAllByText(/^(20|3)$/).map((el) => el.textContent)).toEqual(['3', '20'])
      fireEvent.click(codeHeaderButton) // 2回目: 降順
      expect(screen.getAllByText(/^(20|3)$/).map((el) => el.textContent)).toEqual(['20', '3'])
    })

    it('sorts 図面 (page) numerically, so P2 comes before P10', () => {
      const items = [
        makeDetailItem({ id: '1', detectionId: 1, pageNo: 10, code: 'a' }),
        makeDetailItem({ id: '2', detectionId: 2, pageNo: 2, code: 'b' }),
      ]
      renderDetail({ detailItems: items, currentPageNo: 16 })
      fireEvent.click(screen.getByRole('button', { name: '図面でソート' }))
      const pages = screen.getAllByText(/^P(2|10)$/).map((el) => el.textContent)
      expect(pages).toEqual(['P2', 'P10'])
    })

    it('sorts 状態 as ×→△→○ ascending (指示3章)', () => {
      const items = [
        makeDetailItem({ id: '1', detectionId: 1, code: 'a', status: 'reviewed' }),
        makeDetailItem({ id: '2', detectionId: 2, code: 'b', status: 'excluded' }),
        makeDetailItem({ id: '3', detectionId: 3, code: 'c', status: 'needs_review' }),
      ]
      renderDetail({ detailItems: items, currentPageNo: 16 })
      fireEvent.click(screen.getByRole('button', { name: '状態でソート' }))
      const rows = screen.getAllByRole('row').slice(1) // ヘッダ行を除く
      const symbols = rows.map((r) => within(r).getByTitle(/reviewed|excluded|needs_review/).textContent)
      expect(symbols).toEqual(['×', '△', '○'])
    })

    it('sorts 面/盤 by banMenno then banNo numerically, using the EstimateTarget lookup (not string parsing)', () => {
      const items = [
        makeDetailItem({ id: '1', detectionId: 1, targetId: 'panel:2:2', code: 'a' }),
        makeDetailItem({ id: '2', detectionId: 2, targetId: 'panel:1:1', code: 'b' }),
      ]
      renderDetail({ detailItems: items, currentPageNo: 16 })
      fireEvent.click(screen.getByRole('button', { name: '面/盤でソート' }))
      const codes = screen.getAllByText(/^(a|b)$/).map((el) => el.textContent)
      expect(codes).toEqual(['b', 'a']) // 面1/盤1 (b) が先
    })

    it('does not reset the sort column when the data changes (parent re-render), preserving the user-selected sort (指示14章)', () => {
      const items = [
        makeDetailItem({ id: '1', detectionId: 1, code: '20' }),
        makeDetailItem({ id: '2', detectionId: 2, code: '3' }),
      ]
      const { rerender } = renderDetail({ detailItems: items, currentPageNo: 16 })
      fireEvent.click(screen.getByRole('button', { name: 'コードでソート' })) // コード昇順にする

      const updatedItems = [
        makeDetailItem({ id: '1', detectionId: 1, code: '20', editSequence: 5 }),
        makeDetailItem({ id: '2', detectionId: 2, code: '3', editSequence: 5 }),
      ]
      rerender(
        <EstimateDetail
          detailItems={updatedItems}
          targets={DEFAULT_TARGETS}
          selectedTargetId={null}
          currentPageNo={16}
          onNavigateReference={() => {}}
          onHoverDetail={() => {}}
          sourceFilter="all"
          onSourceFilterChange={() => {}}
        />,
      )
      // 編集順(初期ソート)へ戻らず、コード昇順のまま維持されている。
      expect(screen.getAllByText(/^(20|3)$/).map((el) => el.textContent)).toEqual(['3', '20'])
    })
  })
})

// Sekisan Navi 追加UI修正指示: 表セル境界の統一 + ヘッダ左寄せ / 数値セル右寄せ
describe('EstimateDetail: 表セル境界の統一・ヘッダ左寄せ/数値セル右寄せ', () => {
  it('keeps every column header left-aligned (5章: 積算明細も数値列を含めheader文字は原則左寄せ、既存のまま変更なし)', () => {
    renderDetail({ detailItems: [makeDetailItem()] })
    const headers = screen.getAllByRole('columnheader')
    expect(headers.length).toBeGreaterThan(0)
    for (const th of headers) {
      expect(getComputedStyle(th).textAlign).toBe('left')
    }
  })

  it('does not change header/cell padding (row/header height不変, 指示18章: 情報密度を変えない)', () => {
    renderDetail({ detailItems: [makeDetailItem()] })
    const th = screen.getAllByRole('columnheader')[0]
    const td = screen.getByRole('table').querySelector('td') as HTMLElement
    expect(getComputedStyle(th).padding).toBe('0.3rem')
    expect(getComputedStyle(td).padding).toBe('0.35rem 0.3rem')
  })

  it('keeps the sort indicator visible after the cell-border change (9章)', () => {
    renderDetail({ detailItems: [makeDetailItem()] })
    expect(screen.getByRole('button', { name: '編集順でソート' }).textContent).toContain('▼')
  })

  it('keeps the sticky header positioning unaffected by the new cell border (17章)', () => {
    renderDetail({ detailItems: [makeDetailItem()] })
    const th = screen.getAllByRole('columnheader')[0]
    expect(getComputedStyle(th).position).toBe('sticky')
  })

  // 注記: jsdom(cssstyle)はborder-right(var(...)使用)の解決を確実には行わないため、
  // --border-cellトークンの値自体はindex.css.test.ts側で検証し、実際の縦罫線描画は
  // 実ブラウザ確認で行う(EstimateMasterPicker.test.tsx既存の注記と同じ制約)。
})

describe('EstimateDetail: 折りたたみ (Issue #6: Improve estimation target visibility and collapsible right pane sections)', () => {
  it('defaults to expanded (collapsed prop omitted) and shows the source tabs/table', () => {
    renderDetail({ detailItems: [makeDetailItem()] })
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: '情報源' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /積算明細/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('hides the body (source tabs/table/legend) but keeps the heading when collapsed=true, without touching sourceFilter/sort logic', () => {
    const onSourceFilterChange = vi.fn()
    renderDetail({
      detailItems: [makeDetailItem()],
      collapsed: true,
      onToggleCollapsed: () => {},
      onSourceFilterChange,
    })
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: '情報源' })).not.toBeInTheDocument()
    expect(screen.getByText('積算明細')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /積算明細/ })).toHaveAttribute('aria-expanded', 'false')
    expect(onSourceFilterChange).not.toHaveBeenCalled()
  })

  it('calls onToggleCollapsed when the heading is clicked, independent of source tab/sort column buttons', () => {
    const onToggleCollapsed = vi.fn()
    renderDetail({ detailItems: [makeDetailItem()], collapsed: false, onToggleCollapsed })
    fireEvent.click(screen.getByRole('button', { name: /積算明細/ }))
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '編集順でソート' })).toBeInTheDocument()
  })

  it('keeps sort state and source filter intact across collapse/expand', () => {
    const { rerender } = renderDetail({
      detailItems: [makeDetailItem({ id: '1', code: '11001' })],
      collapsed: false,
      onToggleCollapsed: () => {},
    })
    fireEvent.click(screen.getByRole('button', { name: 'コードでソート' }))
    expect(screen.getByRole('button', { name: 'コードでソート' }).textContent).toContain('▲')

    rerender(
      <EstimateDetail
        detailItems={[makeDetailItem({ id: '1', code: '11001' })]}
        targets={DEFAULT_TARGETS}
        selectedTargetId={null}
        currentPageNo={null}
        onNavigateReference={() => {}}
        onHoverDetail={() => {}}
        sourceFilter="all"
        onSourceFilterChange={() => {}}
        collapsed={true}
        onToggleCollapsed={() => {}}
      />,
    )
    rerender(
      <EstimateDetail
        detailItems={[makeDetailItem({ id: '1', code: '11001' })]}
        targets={DEFAULT_TARGETS}
        selectedTargetId={null}
        currentPageNo={null}
        onNavigateReference={() => {}}
        onHoverDetail={() => {}}
        sourceFilter="all"
        onSourceFilterChange={() => {}}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: 'コードでソート' }).textContent).toContain('▲')
  })
})
