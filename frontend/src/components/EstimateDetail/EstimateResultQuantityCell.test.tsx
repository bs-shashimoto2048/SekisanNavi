import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EstimateResultQuantityCell } from './EstimateResultQuantityCell'
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

describe('EstimateResultQuantityCell (Issue #40 Phase 6後半: 積算明細の数量UI)', () => {
  it('shows the initial quantity in green when not overridden', () => {
    const result = makeResult({ initial_quantity: 2, current_quantity: 2, quantity_overridden: false })
    render(<EstimateResultQuantityCell result={result} onOverride={() => {}} onReset={() => {}} />)
    const value = screen.getByTitle(/初期値のまま/)
    expect(value.className).toContain('--initial')
    expect(value.textContent).toBe('2')
  })

  it('shows the current (overridden) quantity in red, with initial value available via title', () => {
    const result = makeResult({ initial_quantity: 2, current_quantity: 5, quantity_overridden: true, quantity_override_reason: '現地確認' })
    render(<EstimateResultQuantityCell result={result} onOverride={() => {}} onReset={() => {}} />)
    const value = screen.getByText('5')
    expect(value.className).toContain('--overridden')
    expect(value.title).toContain('現在: 5')
    expect(value.title).toContain('初期: 2')
    expect(value.title).toContain('現地確認')
  })

  it('does not call onOverride and restores the display value when blurred while empty', () => {
    const onOverride = vi.fn()
    const result = makeResult({ current_quantity: 3 })
    render(<EstimateResultQuantityCell result={result} onOverride={onOverride} onReset={() => {}} />)
    const input = screen.getByLabelText('数量') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(onOverride).not.toHaveBeenCalled()
    expect(input.value).toBe('3')
  })

  it('does not call onOverride for a negative value', () => {
    const onOverride = vi.fn()
    const result = makeResult({ current_quantity: 3 })
    render(<EstimateResultQuantityCell result={result} onOverride={onOverride} onReset={() => {}} />)
    const input = screen.getByLabelText('数量') as HTMLInputElement
    fireEvent.change(input, { target: { value: '-1' } })
    fireEvent.blur(input)
    expect(onOverride).not.toHaveBeenCalled()
    expect(input.value).toBe('3')
  })

  it('does not call onOverride for a non-numeric value', () => {
    const onOverride = vi.fn()
    const result = makeResult({ current_quantity: 3 })
    render(<EstimateResultQuantityCell result={result} onOverride={onOverride} onReset={() => {}} />)
    const input = screen.getByLabelText('数量') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.blur(input)
    expect(onOverride).not.toHaveBeenCalled()
    expect(input.value).toBe('3')
  })

  it('requires a reason before calling onOverride, and calls it once the reason is applied (explicit 0 allowed)', () => {
    const onOverride = vi.fn()
    const result = makeResult({ current_quantity: 3 })
    render(<EstimateResultQuantityCell result={result} onOverride={onOverride} onReset={() => {}} />)
    const input = screen.getByLabelText('数量') as HTMLInputElement
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)
    // 理由入力が確定するまではまだAPIを呼ばない。
    expect(onOverride).not.toHaveBeenCalled()
    const reasonInput = screen.getByLabelText('数量変更の理由') as HTMLInputElement
    const applyButton = screen.getByRole('button', { name: '適用' }) as HTMLButtonElement
    expect(applyButton).toBeDisabled()
    fireEvent.change(reasonInput, { target: { value: '在庫から充当' } })
    fireEvent.click(applyButton)
    expect(onOverride).toHaveBeenCalledWith(0, '在庫から充当')
  })

  it('cancels the pending change and restores the display value', () => {
    const onOverride = vi.fn()
    const result = makeResult({ current_quantity: 3 })
    render(<EstimateResultQuantityCell result={result} onOverride={onOverride} onReset={() => {}} />)
    const input = screen.getByLabelText('数量') as HTMLInputElement
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.blur(input)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onOverride).not.toHaveBeenCalled()
    expect(input.value).toBe('3')
    expect(screen.queryByLabelText('数量変更の理由')).not.toBeInTheDocument()
  })

  it('disables the reset button when not overridden and enables it (and calls onReset) when overridden', () => {
    const onReset = vi.fn()
    const result = makeResult({ quantity_overridden: true })
    render(<EstimateResultQuantityCell result={result} onOverride={() => {}} onReset={onReset} />)
    const resetButton = screen.getByRole('button', { name: '初期値へ戻す' })
    expect(resetButton).not.toBeDisabled()
    fireEvent.click(resetButton)
    expect(onReset).toHaveBeenCalled()
  })
})
