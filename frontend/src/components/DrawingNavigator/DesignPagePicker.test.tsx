import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DesignPagePicker } from './DesignPagePicker'
import type { DesignPage } from '../../types/domain'

const items = [
  { key: '01', page_label: '01', drawing_name: '質量計算書', mode: 'preview', inference_page_no: null, ban_labels: [] },
  { key: '1', page_label: '1', drawing_name: '外形図', mode: 'inference', inference_page_no: 1, ban_labels: [] },
] as DesignPage[]

function setup(over: Partial<React.ComponentProps<typeof DesignPagePicker>> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <DesignPagePicker
      productNo="A1AD1269"
      items={items}
      initialExcluded={new Set()}
      cancelable
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...over}
    />,
  )
  return { onConfirm, onCancel }
}

describe('DesignPagePicker', () => {
  it('starts with every drawing checked and shows the original page labels (01 and 1 separately)', () => {
    setup()
    expect(screen.getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true)
    expect(screen.getByText('01')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2 / 2 件を選択')).toBeInTheDocument()
  })

  it('passes the unchecked keys as excluded on open', () => {
    const { onConfirm } = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: /質量計算書/ }))
    fireEvent.click(screen.getByRole('button', { name: '開く' }))
    expect(onConfirm).toHaveBeenCalledWith(new Set(['01']))
  })

  it('reflects the previous exclusion and disables open when nothing is checked', () => {
    setup({ initialExcluded: new Set(['1']) })
    expect(screen.getByText('1 / 2 件を選択')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'すべて解除' }))
    expect(screen.getByRole('button', { name: '開く' })).toBeDisabled()
  })

  it('cancels with Escape only when cancelable', () => {
    const a = setup()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(a.onCancel).toHaveBeenCalledTimes(1)
  })

  it('ignores Escape and hides cancel on the first (non-cancelable) selection', () => {
    const b = setup({ cancelable: false })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(b.onCancel).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'キャンセル' })).not.toBeInTheDocument()
  })
})
