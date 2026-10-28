import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MaterialInfo } from './MaterialInfo'
import { PanelInfo } from './PanelInfo'
import { classifyMaterialSpec, groupMaterials } from '../../domain/materialGroups'
import type { MaterialRow } from '../../types/domain'

// 架空値の材料行 (実データ・実材料値は使わない)
function row(overrides: Partial<MaterialRow> = {}): MaterialRow {
  return {
    page: '301',
    source_file: '301.boxspec',
    symbol_name: 'BSP-STEELA-H',
    cabtype: 'TYPE-X',
    component_code: 'STEEL-BASE',
    component_name: '基礎ベース',
    material_spec: 'TEST-MAT-A 10x20',
    ...overrides,
  }
}

const SAMPLE: MaterialRow[] = [
  row(),
  row({ component_code: 'STEEL-SIDE', component_name: '側板', material_spec: '無し' }),
  row({ component_code: 'STEEL-ROOF', component_name: '屋根・天井板', material_spec: '未記載' }),
  row({ page: '302', source_file: '302.boxspec', symbol_name: 'BSP-STEELA-L', cabtype: '' }),
  row({ page: '302', source_file: '302.boxspec', symbol_name: 'BSP-STEELA-L', cabtype: '', component_code: 'STEEL-NEWPART', component_name: '', material_spec: 'NEW-MAT' }),
]

describe('groupMaterials', () => {
  it('groups by page x symbol x cabtype keeping CSV order', () => {
    const groups = groupMaterials(SAMPLE)
    expect(groups.map((g) => [g.page, g.symbolName, g.cabtype, g.rows.length])).toEqual([
      ['301', 'BSP-STEELA-H', 'TYPE-X', 3],
      ['302', 'BSP-STEELA-L', '', 2],
    ])
  })

  it('keeps same page with different symbols or cabtypes apart', () => {
    const groups = groupMaterials([
      row(),
      row({ symbol_name: 'BSP-STEELA-L' }),
      row({ cabtype: 'TYPE-Y' }),
    ])
    expect(groups).toHaveLength(3)
  })

  it('returns no groups for no rows', () => {
    expect(groupMaterials([])).toEqual([])
  })

  it('classifies 未記載 and 無し differently from plain values', () => {
    expect(classifyMaterialSpec('未記載')).toBe('not_described')
    expect(classifyMaterialSpec('無し')).toBe('nothing')
    expect(classifyMaterialSpec('TEST-MAT-A 10x20')).toBe('value')
    expect(classifyMaterialSpec('')).toBe('value')
  })
})

describe('MaterialInfo', () => {
  it('shows "材料情報なし" when there are no rows', () => {
    render(<MaterialInfo materials={[]} />)
    expect(screen.getByText('材料情報なし')).toBeInTheDocument()
    expect(screen.queryAllByTestId('material-group')).toHaveLength(0)
  })

  it('distinguishes pages, symbols and cabtypes per group', () => {
    render(<MaterialInfo materials={SAMPLE} />)
    const groups = screen.getAllByTestId('material-group')
    expect(groups).toHaveLength(2)
    expect(within(groups[0]).getByText('ページ 301')).toBeInTheDocument()
    expect(within(groups[0]).getByText('BSP-STEELA-H')).toBeInTheDocument()
    expect(within(groups[0]).getByText('型式 TYPE-X')).toBeInTheDocument()
    expect(within(groups[1]).getByText('ページ 302')).toBeInTheDocument()
    expect(within(groups[1]).getByText('型式 -')).toBeInTheDocument() // 型式なしは"-"
  })

  it('shows component names and specs without altering the values', () => {
    render(<MaterialInfo materials={SAMPLE} />)
    expect(screen.getAllByText('基礎ベース')).toHaveLength(2) // 301 と 302 の各グループに1行ずつ
    expect(screen.getAllByText('TEST-MAT-A 10x20')).toHaveLength(2)
  })

  it('shows 無し and 未記載 distinctly (text and kind)', () => {
    render(<MaterialInfo materials={SAMPLE} />)
    const none = screen.getByText('無し')
    const undescribed = screen.getByText('未記載')
    expect(none).toHaveAttribute('data-spec-kind', 'nothing')
    expect(undescribed).toHaveAttribute('data-spec-kind', 'not_described')
    expect(none.className).not.toEqual(undescribed.className)
  })

  it('falls back to the component code when the name is empty (unknown STEEL-* key)', () => {
    render(<MaterialInfo materials={SAMPLE} />)
    expect(screen.getByText('STEEL-NEWPART')).toBeInTheDocument()
    expect(screen.getByText('NEW-MAT')).toBeInTheDocument()
  })
})

describe('PanelInfo materials prop (backward compatibility)', () => {
  const base = { panel: null, panels: [], estimatePanels: [], selectedPanel: null, onSelectPanel: () => {} }

  it('does not render the material section when the prop is omitted (old callers)', () => {
    render(<PanelInfo {...base} />)
    expect(screen.queryByLabelText('材料情報')).toBeNull()
    expect(screen.getByText('このページには図面情報がありません')).toBeInTheDocument()
  })

  it('renders "材料情報なし" for an empty array and rows when present', () => {
    const { rerender } = render(<PanelInfo {...base} materials={[]} />)
    fireEvent.click(screen.getByRole('button', { name: /材料情報/ }))
    expect(screen.getByText('材料情報なし')).toBeInTheDocument()
    rerender(<PanelInfo {...base} materials={SAMPLE} />)
    expect(screen.getAllByTestId('material-group')).toHaveLength(2)
  })
})
