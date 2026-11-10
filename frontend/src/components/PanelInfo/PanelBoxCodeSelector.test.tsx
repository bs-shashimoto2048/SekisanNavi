import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EstimateDetail } from '../EstimateDetail/EstimateDetail'
import { PanelBoxCodeSelector } from './PanelBoxCodeSelector'
import {
  BOX_CATEGORIES,
  boxCodeOptionGroups,
  boxSelectionState,
  isBoxResult,
} from '../../domain/boxCodeSelection'
import type { EstimateMasterItem, EstimateResult } from '../../types/domain'

function item(id: number, category: string, model: string, rating: string): EstimateMasterItem {
  return {
    id,
    code: String(11000 + id),
    category,
    model,
    rating,
    note: null,
    total_price_a: 1000,
    box_parts_price: null,
    painting_price: null,
    setup_a: null,
    sheet_metal_price: null,
    assembly_price: null,
    inspection_price: null,
  } as EstimateMasterItem
}

const MASTER = [
  item(1, '箱･単独', 'OS2-920', '2.3*0.9*2.0'),
  item(2, '箱･単独', 'OS2-1020', '2.3*1.0*2.0'),
  item(3, '箱･左右', 'OS2-920', '2.3*0.9*2.0'),
  item(4, '箱･中', 'OS2-920', '2.3*0.9*2.0'),
  item(5, '底板', 'X', '-'),
]
const MASTER_BY_ID = new Map(MASTER.map((m) => [m.id, m]))

function boxResult(overrides: Partial<EstimateResult> = {}): EstimateResult {
  return {
    id: 1,
    product_no: 'A1GV2421',
    result_key: 'box:1:1',
    master_item_id: 1,
    code: '11001',
    quantity: 1,
    initial_quantity: 1,
    current_quantity: 1,
    quantity_overridden: false,
    quantity_override_reason: null,
    quantity_updated_at: null,
    quantity_updated_by: null,
    applicable_unit: 'unit',
    initial_factor: 1,
    current_factor: 1,
    factor_overridden: false,
    factor_override_reason: null,
    factor_updated_at: null,
    factor_updated_by: null,
    judgment_method: 'design_data',
    judgment_scope: 'panel',
    target_panel_ban_menno: 1,
    target_panel_ban_no: 1,
    target_drawing_page_id: null,
    judgment_reason: '自動選定',
    source_rule_id: null,
    unit_price: 1000,
    unit_labor: null,
    price: 1000,
    labor: null,
    status: 'auto',
    allowed_factors: null,
    evidence: [],
    box_category: '箱･単独',
    code_overridden: false,
    ...overrides,
  }
}

describe('boxCodeSelection helpers', () => {
  it('recognizes box rows by result_key and derives the selection state', () => {
    expect(isBoxResult(boxResult())).toBe(true)
    expect(isBoxResult(boxResult({ result_key: '11001:panel:1:1' }))).toBe(false)
    expect(boxSelectionState(boxResult())).toBe('auto')
    expect(boxSelectionState(boxResult({ code_overridden: true, status: 'reviewed' }))).toBe('manual')
    expect(boxSelectionState(boxResult({ master_item_id: null, code: '', status: 'needs_review' }))).toBe('needs_review')
    expect(boxSelectionState(boxResult({ status: 'needs_review' }))).toBe('needs_review') // 重複の可能性
  })

  it('offers only the panel category when known, and all three box categories when unknown', () => {
    const known = boxCodeOptionGroups(boxResult({ box_category: '箱･左右' }), MASTER)
    expect(known.map((g) => g.category)).toEqual(['箱･左右'])
    const unknown = boxCodeOptionGroups(boxResult({ box_category: null, master_item_id: null, code: '' }), MASTER)
    expect(unknown.map((g) => g.category)).toEqual([...BOX_CATEGORIES])
    expect(unknown.flatMap((g) => g.items).every((i) => i.category !== '底板')).toBe(true)
  })
})

describe('PanelBoxCodeSelector', () => {
  it('shows the target panel and selection state, and lists same-category codes only', () => {
    render(<PanelBoxCodeSelector result={boxResult()} masterItemById={MASTER_BY_ID} onChange={() => {}} onReset={() => {}} />)
    expect(screen.getByText('面1/盤1')).toBeInTheDocument()
    expect(screen.getByText('自動選定')).toBeInTheDocument()
    const select = screen.getByRole('combobox', { name: '面1/盤1の箱コード' }) as HTMLSelectElement
    expect(select.value).toBe('1')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '11001 OS2-920 / 2.3*0.9*2.0',
      '11002 OS2-1020 / 2.3*1.0*2.0',
    ])
    expect(screen.queryByRole('button', { name: '自動選定に戻す' })).not.toBeInTheDocument()
  })

  it('calls onChange with the chosen master item id', () => {
    const onChange = vi.fn()
    render(<PanelBoxCodeSelector result={boxResult()} masterItemById={MASTER_BY_ID} onChange={onChange} onReset={() => {}} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2' } })
    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('shows manual state and a reset button for an overridden row', () => {
    const onReset = vi.fn()
    render(
      <PanelBoxCodeSelector
        result={boxResult({ code_overridden: true, status: 'reviewed', master_item_id: 2, code: '11002' })}
        masterItemById={MASTER_BY_ID}
        onChange={() => {}}
        onReset={onReset}
      />,
    )
    expect(screen.getByText('手修正')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '自動選定に戻す' }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('needs-review row has no code selected yet and a placeholder; choosing does not auto-pick', () => {
    render(
      <PanelBoxCodeSelector
        result={boxResult({ master_item_id: null, code: '', status: 'needs_review', box_category: null })}
        masterItemById={MASTER_BY_ID}
        onChange={() => {}}
        onReset={() => {}}
      />,
    )
    expect(screen.getByText('要確認')).toBeInTheDocument()
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('')
    expect(within(select).getByRole('option', { name: 'コードを選択' })).toBeInTheDocument()
    expect(within(select).getAllByRole('group').map((g) => g.getAttribute('label'))).toEqual(['箱･単独', '箱･左右', '箱･中'])
  })
})

describe('EstimateDetail with box rows', () => {
  function renderDetail(results: EstimateResult[], handlers: Partial<React.ComponentProps<typeof EstimateDetail>> = {}) {
    return render(
      <EstimateDetail
        results={results}
        masterItemById={MASTER_BY_ID}
        tabFilter="all"
        onTabFilterChange={() => {}}
        {...handlers}
      />,
    )
  }

  it('renders box results as ordinary estimate rows without an editor', () => {
    renderDetail([
      boxResult({ id: 1 }),
      boxResult({ id: 2, result_key: 'box:2:2', target_panel_ban_menno: 2, target_panel_ban_no: 2, master_item_id: 3, code: '11003', box_category: '箱･左右' }),
    ])
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('11001')).toBeInTheDocument()
    expect(within(rows[0]).getByText('OS2-920 / 2.3*0.9*2.0')).toBeInTheDocument()
    expect(within(rows[1]).getByText('11003')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /箱コード/ })).not.toBeInTheDocument()
  })

  it('shows box and non-box codes as plain text in the code column', () => {
    const onSelectResultRow = vi.fn()
    renderDetail(
      [boxResult(), boxResult({ id: 9, result_key: '18323:panel:1:1', master_item_id: null, code: '18323', box_category: null })],
      { onSelectResultRow },
    )
    expect(screen.getByText('11001')).toBeInTheDocument()
    expect(screen.getByText('18323')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
