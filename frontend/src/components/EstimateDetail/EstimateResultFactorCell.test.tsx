import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EstimateResultFactorCell } from './EstimateResultFactorCell'
import type { EstimateResult } from '../../types/domain'

function makeResult(overrides: Partial<EstimateResult> = {}): EstimateResult {
  return {
    id: 1,
    product_no: 'A1GV2421',
    result_key: '11001:panel:1:1',
    master_item_id: 10,
    code: '11001',
    quantity: 1,
    applicable_unit: 'face',
    initial_factor: 1.0,
    current_factor: 1.0,
    factor_overridden: false,
    factor_override_reason: null,
    factor_updated_at: null,
    factor_updated_by: null,
    judgment_method: 'drawing_judgment',
    judgment_scope: 'panel',
    target_panel_ban_menno: 1,
    target_panel_ban_no: 1,
    target_drawing_page_id: 16,
    judgment_reason: null,
    source_rule_id: 5,
    unit_price: 1000,
    unit_labor: null,
    price: 1000,
    labor: null,
    status: 'auto',
    allowed_factors: null,
    evidence: [],
    ...overrides,
  }
}

describe('EstimateResultFactorCell (Issue #40 Phase 4: 積算明細の係数UI)', () => {
  it('shows the initial factor in green when not overridden', () => {
    const result = makeResult({ initial_factor: 0.7, current_factor: 0.7, factor_overridden: false })
    render(<EstimateResultFactorCell result={result} onOverride={() => {}} onReset={() => {}} />)
    const value = screen.getByTitle(/初期値のまま/)
    expect(value.className).toContain('--initial')
    expect(value.textContent).toBe('0.7')
  })

  it('shows the current (overridden) factor in red, with initial value available via title', () => {
    const result = makeResult({ initial_factor: 0.7, current_factor: 0.8, factor_overridden: true })
    render(<EstimateResultFactorCell result={result} onOverride={() => {}} onReset={() => {}} />)
    const value = screen.getByText('0.8')
    expect(value.className).toContain('--overridden')
    expect(value.title).toContain('現在: 0.8')
    expect(value.title).toContain('初期: 0.7')
    expect(value.title).toContain('手動修正')
  })

  it('renders a <select> limited to allowed_factors candidates when set (候補外は選択不可)', () => {
    const result = makeResult({ current_factor: 0.7, allowed_factors: [0.5, 0.7, 1.0] })
    render(<EstimateResultFactorCell result={result} onOverride={() => {}} onReset={() => {}} />)
    const select = screen.getByLabelText('係数') as HTMLSelectElement
    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).toEqual(['0.5', '0.7', '1'])
  })

  it('calls onOverride with the newly selected in-candidate value', () => {
    const onOverride = vi.fn()
    const result = makeResult({ current_factor: 0.7, allowed_factors: [0.5, 0.7, 1.0] })
    render(<EstimateResultFactorCell result={result} onOverride={onOverride} onReset={() => {}} />)
    const select = screen.getByLabelText('係数') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '0.5' } })
    expect(onOverride).toHaveBeenCalledWith(0.5)
  })

  it('renders a free-input number field when allowed_factors is null', () => {
    const onOverride = vi.fn()
    const result = makeResult({ current_factor: 1.0, allowed_factors: null })
    render(<EstimateResultFactorCell result={result} onOverride={onOverride} onReset={() => {}} />)
    const input = screen.getByLabelText('係数') as HTMLInputElement
    fireEvent.change(input, { target: { value: '0.42' } })
    fireEvent.blur(input)
    expect(onOverride).toHaveBeenCalledWith(0.42)
  })

  it('calls onReset when the reset button is clicked, and disables it when already at initial value', () => {
    const onReset = vi.fn()
    const overridden = makeResult({ factor_overridden: true })
    const { rerender } = render(
      <EstimateResultFactorCell result={overridden} onOverride={() => {}} onReset={onReset} />,
    )
    const button = screen.getByRole('button', { name: '初期値へ戻す' })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    expect(onReset).toHaveBeenCalled()

    const notOverridden = makeResult({ factor_overridden: false })
    rerender(<EstimateResultFactorCell result={notOverridden} onOverride={() => {}} onReset={onReset} />)
    expect(screen.getByRole('button', { name: '初期値へ戻す' })).toBeDisabled()
  })
})
