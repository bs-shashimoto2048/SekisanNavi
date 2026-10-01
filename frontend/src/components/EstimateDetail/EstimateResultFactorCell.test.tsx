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
    initial_quantity: 1,
    current_quantity: 1,
    quantity_overridden: false,
    quantity_override_reason: null,
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

  // PR #43レビュー指摘対応: Number('') === 0 により、空欄blurで意図せず
  // 係数0が保存されてしまっていた不具合の再発防止テスト。
  describe('free-input blur edge cases (PR #43レビュー指摘対応)', () => {
    it('does not call onOverride and restores the display value when blurred while empty', () => {
      const onOverride = vi.fn()
      const result = makeResult({ current_factor: 0.7, allowed_factors: null })
      render(<EstimateResultFactorCell result={result} onOverride={onOverride} onReset={() => {}} />)
      const input = screen.getByLabelText('係数') as HTMLInputElement
      fireEvent.change(input, { target: { value: '' } })
      fireEvent.blur(input)
      expect(onOverride).not.toHaveBeenCalled()
      expect(input.value).toBe('0.7')
    })

    it('calls onOverride(0) when the user explicitly types 0 and blurs (0 itself is not forbidden)', () => {
      const onOverride = vi.fn()
      const result = makeResult({ current_factor: 0.7, allowed_factors: null })
      render(<EstimateResultFactorCell result={result} onOverride={onOverride} onReset={() => {}} />)
      const input = screen.getByLabelText('係数') as HTMLInputElement
      fireEvent.change(input, { target: { value: '0' } })
      fireEvent.blur(input)
      expect(onOverride).toHaveBeenCalledWith(0)
    })

    it('does not call onOverride and restores the display value for a non-numeric value', () => {
      const onOverride = vi.fn()
      const result = makeResult({ current_factor: 0.7, allowed_factors: null })
      render(<EstimateResultFactorCell result={result} onOverride={onOverride} onReset={() => {}} />)
      const input = screen.getByLabelText('係数') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'abc' } })
      fireEvent.blur(input)
      expect(onOverride).not.toHaveBeenCalled()
      expect(input.value).toBe('0.7')
    })

    it('still overrides normally for an ordinary numeric change (regression check)', () => {
      const onOverride = vi.fn()
      const result = makeResult({ current_factor: 0.7, allowed_factors: null })
      render(<EstimateResultFactorCell result={result} onOverride={onOverride} onReset={() => {}} />)
      const input = screen.getByLabelText('係数') as HTMLInputElement
      fireEvent.change(input, { target: { value: '0.9' } })
      fireEvent.blur(input)
      expect(onOverride).toHaveBeenCalledWith(0.9)
    })

    it('applies the same empty-value guard when committed via Enter (blur-on-Enter)', () => {
      const onOverride = vi.fn()
      const result = makeResult({ current_factor: 0.7, allowed_factors: null })
      render(<EstimateResultFactorCell result={result} onOverride={onOverride} onReset={() => {}} />)
      const input = screen.getByLabelText('係数') as HTMLInputElement
      input.focus()
      fireEvent.change(input, { target: { value: '  ' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(onOverride).not.toHaveBeenCalled()
      expect(input.value).toBe('0.7')
    })
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
