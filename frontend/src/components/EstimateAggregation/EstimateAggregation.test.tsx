import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EstimateAggregation } from './EstimateAggregation'
import type { EstimateLineItem, EstimateTarget } from '../../types/estimateAggregation'

function makeTarget(overrides: Partial<EstimateTarget> = {}): EstimateTarget {
  return { id: 'product', type: 'product', name: '製品全体', banMenno: null, banNo: null, ...overrides }
}

function makePanelTarget(overrides: Partial<EstimateTarget> = {}): EstimateTarget {
  return {
    id: 'panel:1:1',
    type: 'panel',
    name: '高圧受電盤',
    banMenno: 1,
    banNo: 1,
    ...overrides,
  }
}

function makeLineItem(overrides: Partial<EstimateLineItem> = {}): EstimateLineItem {
  return {
    id: 'product:10:manual',
    targetId: 'product',
    source: 'manual',
    masterItemId: 10,
    code: '18311',
    category: '附属品加算価格',
    content: '換気扇 / 上部取付',
    quantity: 1,
    unitPrice: 50000,
    amount: 50000,
    detectionIds: [1],
    ...overrides,
  }
}

describe('EstimateAggregation (積算集約・積算明細UI再構成: セレクト方式+表形式)', () => {
  it('shows the empty message when there is nothing to aggregate', () => {
    render(
      <EstimateAggregation targets={[makeTarget()]} lineItems={[]} selectedTargetId={null} onSelectTarget={() => {}} />,
    )
    expect(screen.getByText('現在の製番に付加されている積算コードがありません')).toBeInTheDocument()
  })

  it('has a target select with 総合計 + 製品全体, using target.id (not the label text) as the option value', () => {
    const targets = [makeTarget(), makePanelTarget()]
    render(
      <EstimateAggregation targets={targets} lineItems={[makeLineItem()]} selectedTargetId={null} onSelectTarget={() => {}} />,
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    const options = within(select).getAllByRole('option') as HTMLOptionElement[]
    expect(options[0]).toHaveTextContent('総合計')
    expect(options[0].value).toBe('')
    const panelOption = options.find((o) => o.value === 'panel:1:1')
    expect(panelOption).toBeDefined()
  })

  it('shows 面番号/盤番号/盤名称 together in the panel option label, not just the panel name (指示3章)', () => {
    const targets = [makeTarget(), makePanelTarget({ banMenno: 3, banNo: 3, name: 'No.1低圧動力盤', id: 'panel:3:3' })]
    render(
      <EstimateAggregation targets={targets} lineItems={[makeLineItem()]} selectedTargetId={null} onSelectTarget={() => {}} />,
    )
    expect(screen.getByText('面番号 3 / 盤番号 3 : No.1低圧動力盤')).toBeInTheDocument()
  })

  it('calls onSelectTarget with the real target id (not the display string) when a panel option is chosen', () => {
    const onSelectTarget = vi.fn()
    const targets = [makeTarget(), makePanelTarget()]
    render(
      <EstimateAggregation targets={targets} lineItems={[makeLineItem()]} selectedTargetId={null} onSelectTarget={onSelectTarget} />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'panel:1:1' } })
    expect(onSelectTarget).toHaveBeenCalledWith('panel:1:1')
  })

  it('calls onSelectTarget with null when 総合計 is chosen', () => {
    const onSelectTarget = vi.fn()
    const targets = [makeTarget(), makePanelTarget()]
    render(
      <EstimateAggregation targets={targets} lineItems={[makeLineItem()]} selectedTargetId="panel:1:1" onSelectTarget={onSelectTarget} />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    expect(onSelectTarget).toHaveBeenCalledWith(null)
  })

  it('shows code/content/unit price/quantity/amount as independent table columns, not the old formula-style display (指示6章/7章)', () => {
    const item = makeLineItem({ unitPrice: 241400, quantity: 1, amount: 241400, code: '11576', content: 'IS2-922' })
    render(
      <EstimateAggregation targets={[makeTarget()]} lineItems={[item]} selectedTargetId={null} onSelectTarget={() => {}} />,
    )
    const table = screen.getByRole('table')
    const row = within(table).getByText('11576').closest('tr') as HTMLElement
    expect(within(row).getByText('IS2-922')).toBeInTheDocument()
    expect(row.querySelector('.estimate-aggregation__col-price')?.textContent).toBe('241,400円')
    expect(row.querySelector('.estimate-aggregation__col-amount')?.textContent).toBe('241,400円')
    expect(row.querySelector('.estimate-aggregation__col-qty')?.textContent).toBe('1')
    // 旧「単価 × 数量 = 金額」の数式風表示は使わない。
    expect(row.textContent).not.toContain('×')
    expect(row.textContent).not.toContain('=')
  })

  it('renders a negative unit price / amount without breaking the layout', () => {
    const item = makeLineItem({ code: '18330', content: '側面扉（無）', unitPrice: -9700, amount: -9700 })
    render(
      <EstimateAggregation targets={[makeTarget()]} lineItems={[item]} selectedTargetId={null} onSelectTarget={() => {}} />,
    )
    const table = screen.getByRole('table')
    expect(within(table).getAllByText('-9,700円').length).toBeGreaterThanOrEqual(2) // 単価列・金額列(・小計)
  })

  it('renders quantity > 1 with the correct multiplied amount', () => {
    const item = makeLineItem({ quantity: 2, unitPrice: 50000, amount: 100000 })
    render(
      <EstimateAggregation targets={[makeTarget()]} lineItems={[item]} selectedTargetId={null} onSelectTarget={() => {}} />,
    )
    const table = screen.getByRole('table')
    const row = within(table).getByText('18311').closest('tr') as HTMLElement
    expect(within(row).getByText('2')).toBeInTheDocument()
    expect(within(row).getByText('100,000円')).toBeInTheDocument()
  })

  it('labels the unit price column as provisional ("単価(暫定)"), not a confirmed official price (指示10章)', () => {
    render(
      <EstimateAggregation targets={[makeTarget()]} lineItems={[makeLineItem()]} selectedTargetId={null} onSelectTarget={() => {}} />,
    )
    expect(screen.getByText('単価(暫定)')).toBeInTheDocument()
    expect(screen.getByText(/総合価格A/)).toBeInTheDocument()
  })

  it('filters the table to only the selected target, and shows a header amount labeled with its identifier (面X/盤Y)、not just the panel name (積算対象連動の金額表示・図面一覧絞り込み 指示1章)', () => {
    const targets = [makeTarget(), makePanelTarget()]
    const items = [
      makeLineItem({ id: 'a', targetId: 'product', code: '18311', amount: 23100 }),
      makeLineItem({ id: 'b', targetId: 'panel:1:1', code: '11576', amount: 241400 }),
    ]
    render(
      <EstimateAggregation targets={targets} lineItems={items} selectedTargetId="panel:1:1" onSelectTarget={() => {}} />,
    )
    expect(screen.queryByText('18311')).not.toBeInTheDocument()
    expect(screen.getByText('11576')).toBeInTheDocument()
    // 「面1 / 盤1 小計」のように対象が一意に分かる表現を優先する (盤名称だけだと
    // 同名盤と区別できないため)。
    expect(screen.getByText(/面1 \/ 盤1 小計/)).toBeInTheDocument()
    expect(screen.getAllByText('241,400円').length).toBeGreaterThan(0) // 選択対象(panel:1:1)のみの金額
    expect(screen.queryByText('264,500円')).not.toBeInTheDocument() // 全対象合計(23100+241400)は出さない
  })

  it('labels the header amount "製品全体 小計" (not "製番合計") when 製品全体 is selected, so it is not mistaken for the全製番合計 (指示1章)', () => {
    const targets = [makeTarget()]
    const items = [makeLineItem({ id: 'a', targetId: 'product', amount: 23100 })]
    render(
      <EstimateAggregation targets={targets} lineItems={items} selectedTargetId="product" onSelectTarget={() => {}} />,
    )
    expect(screen.getByText(/製品全体 小計/)).toBeInTheDocument()
    expect(screen.getAllByText('23,100円').length).toBeGreaterThan(0)
  })

  it('shows all items across all targets with a target badge when 総合計 (null) is selected', () => {
    const targets = [makeTarget(), makePanelTarget()]
    const items = [
      makeLineItem({ id: 'a', targetId: 'product', code: '18311', amount: 23100 }),
      makeLineItem({ id: 'b', targetId: 'panel:1:1', code: '11576', amount: 241400 }),
    ]
    render(
      <EstimateAggregation targets={targets} lineItems={items} selectedTargetId={null} onSelectTarget={() => {}} />,
    )
    const table = screen.getByRole('table')
    expect(within(table).getByText('18311')).toBeInTheDocument()
    expect(within(table).getByText('11576')).toBeInTheDocument()
    expect(within(table).getByText('製品全体')).toBeInTheDocument() // 対象バッジ
    expect(within(table).getByText('高圧受電盤')).toBeInTheDocument() // 対象バッジ
    expect(screen.getByText(/製番合計/)).toBeInTheDocument()
  })

  it('shows 製番合計 as the sum of ALL items when 総合計 (null) is selected (積算対象連動の金額表示・図面一覧絞り込み 指示3章: 総合計=全対象の合計)', () => {
    const targets = [makeTarget(), makePanelTarget()]
    const items = [
      makeLineItem({ id: 'a', targetId: 'product', amount: 23100 }),
      makeLineItem({ id: 'b', targetId: 'panel:1:1', amount: 241400 }),
    ]
    render(
      <EstimateAggregation targets={targets} lineItems={items} selectedTargetId={null} onSelectTarget={() => {}} />,
    )
    expect(screen.getByText(/製番合計/)).toBeInTheDocument()
    expect(screen.getByText('264,500円')).toBeInTheDocument() // 23100+241400、総合計は全体合計のまま
  })

  it('does not render a duplicate subtotal element anywhere (指示2章: 上下で別々に再計算・二重表示しない、金額表示は1箇所のみ)', () => {
    const targets = [makeTarget(), makePanelTarget()]
    const items = [makeLineItem({ id: 'a', targetId: 'panel:1:1', amount: 241400 })]
    render(
      <EstimateAggregation targets={targets} lineItems={items} selectedTargetId="panel:1:1" onSelectTarget={() => {}} />,
    )
    // 旧`.estimate-aggregation__subtotal`(表下部の対象別小計)は削除済みで、
    // 金額表示は`.estimate-aggregation__grand-total`(上部)の1箇所のみになる。
    expect(document.querySelector('.estimate-aggregation__subtotal')).toBeNull()
    expect(screen.getAllByText('241,400円')).toHaveLength(2) // 表の金額列 + 上部金額表示、の2箇所のみ
  })

  it('shows a warning banner and excludes the tie target items from being silently assigned when the tie target is selected', () => {
    const tieTarget: EstimateTarget = { id: '__tie__', type: 'tie', name: '要確認（複数盤の交差面積が同値）', banMenno: null, banNo: null }
    const targets = [makeTarget(), tieTarget]
    const item = makeLineItem({ targetId: '__tie__' })
    render(
      <EstimateAggregation targets={targets} lineItems={[item]} selectedTargetId="__tie__" onSelectTarget={() => {}} />,
    )
    expect(screen.getByText(/機械的に一意の盤へ決定/)).toBeInTheDocument()
  })

  it('shows "未設定" for unit price and "-" for amount when the master item has no total_price_a, without fabricating a value', () => {
    const item = makeLineItem({ unitPrice: null, amount: null })
    render(
      <EstimateAggregation targets={[makeTarget()]} lineItems={[item]} selectedTargetId={null} onSelectTarget={() => {}} />,
    )
    const table = screen.getByRole('table')
    expect(within(table).getByText('未設定')).toBeInTheDocument()
    expect(within(table).getByText('-')).toBeInTheDocument()
  })

  it('keeps the table header sticky so it stays visible while the body scrolls (盤フォーカス・積算明細再設計 指示5章)', () => {
    render(
      <EstimateAggregation targets={[makeTarget()]} lineItems={[makeLineItem()]} selectedTargetId={null} onSelectTarget={() => {}} />,
    )
    const th = screen.getAllByRole('columnheader')[0]
    expect(getComputedStyle(th).position).toBe('sticky')
  })

  it('places the amount summary outside the scrolling table area so it stays visible (指示5章/積算対象連動の金額表示・図面一覧絞り込み指示2章: 金額表示を上部へ統合しても固定表示は維持)', () => {
    render(
      <EstimateAggregation targets={[makeTarget()]} lineItems={[makeLineItem()]} selectedTargetId={null} onSelectTarget={() => {}} />,
    )
    const scrollArea = document.querySelector('.estimate-aggregation__table-scroll')
    const grandTotal = document.querySelector('.estimate-aggregation__grand-total')
    expect(grandTotal).not.toBeNull()
    expect(scrollArea?.contains(grandTotal as Node)).toBe(false)
  })

  it('highlights the target select when Viewer is focused on a specific target (individual panel), not when 総合計 is selected', () => {
    const targets = [makeTarget(), makePanelTarget()]
    const { rerender } = render(
      <EstimateAggregation targets={targets} lineItems={[makeLineItem()]} selectedTargetId={null} onSelectTarget={() => {}} />,
    )
    expect(screen.getByRole('combobox').className).not.toContain('--focused')

    rerender(
      <EstimateAggregation targets={targets} lineItems={[makeLineItem()]} selectedTargetId="panel:1:1" onSelectTarget={() => {}} />,
    )
    expect(screen.getByRole('combobox').className).toContain('--focused')
  })
})
