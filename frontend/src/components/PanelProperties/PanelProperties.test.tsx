import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PanelProperties } from './PanelProperties'
import type { Panel, PanelPreview } from '../../types/domain'

function makeProductPanel(overrides: Partial<PanelPreview> = {}): PanelPreview {
  return {
    page_no: 16,
    ban_menno: 5,
    ban_no: 5,
    ban_meisyou: 'No.2-1低圧動力盤',
    ban_type: '正面図',
    ban_h1: 2100,
    ban_h2: null,
    ban_w: 1900,
    ban_d: 1200,
    normalized_rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
    ...overrides,
  }
}

const dummyPanel: Panel = {
  id: 1,
  panel_no: '1',
  name: '高圧受電盤',
  primary_drawing_page_id: 1,
  attributes: [
    { id: 1, key: 'W', label: '幅', value: '2120', unit: 'mm', source: 'design_data', display_order: 0 },
  ],
}

describe('PanelProperties (Phase 1.9: 選択盤のproduct_df情報表示)', () => {
  it('shows the empty message when nothing is selected', () => {
    render(<PanelProperties panel={null} selectedProductPanel={null} />)
    expect(screen.getByText('盤が選択されていません')).toBeInTheDocument()
  })

  it('shows product_df fields when a panel area is selected (要件12/13)', () => {
    render(<PanelProperties panel={null} selectedProductPanel={makeProductPanel()} />)
    expect(screen.getByText('16')).toBeInTheDocument() // PAGE
    expect(screen.getAllByText('5').length).toBeGreaterThan(0) // 面番号/盤番号
    expect(screen.getByText('No.2-1低圧動力盤')).toBeInTheDocument()
    expect(screen.getByText('正面図')).toBeInTheDocument()
    expect(screen.getByText('2100 mm')).toBeInTheDocument()
    expect(screen.getByText('1900 mm')).toBeInTheDocument()
    expect(screen.getByText('1200 mm')).toBeInTheDocument()
  })

  it('shows "-" for null values instead of the literal strings null/undefined/NaN (要件14)', () => {
    render(
      <PanelProperties
        panel={null}
        selectedProductPanel={makeProductPanel({ ban_h2: null, ban_meisyou: '' })}
      />,
    )
    expect(screen.queryByText('null')).not.toBeInTheDocument()
    expect(screen.queryByText('undefined')).not.toBeInTheDocument()
    expect(screen.queryByText('NaN')).not.toBeInTheDocument()
    const dashes = screen.getAllByText('-')
    expect(dashes.length).toBeGreaterThanOrEqual(2) // ban_h2, ban_meisyou
  })

  it('prioritizes the selected product_df panel over the dummy Detection-linked panel when both are present (要件11)', () => {
    render(<PanelProperties panel={dummyPanel} selectedProductPanel={makeProductPanel()} />)
    expect(screen.getByText('No.2-1低圧動力盤')).toBeInTheDocument()
    expect(screen.queryByText('高圧受電盤')).not.toBeInTheDocument()
  })

  it('falls back to the existing dummy Panel display when no product_df panel is selected (回帰確認)', () => {
    render(<PanelProperties panel={dummyPanel} selectedProductPanel={null} />)
    expect(screen.getByText('1 / 高圧受電盤')).toBeInTheDocument()
    expect(screen.getByText('幅')).toBeInTheDocument()
    expect(screen.getByText('2120 mm')).toBeInTheDocument()
  })
})
