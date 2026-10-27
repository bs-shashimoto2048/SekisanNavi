import { useRef } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useAutoFitGridColumns } from './useAutoFitGridColumns'
import { getLatestMockResizeObserver } from '../testUtils/mockResizeObserver'

// jsdomは`scrollWidth`等のレイアウト計測を実装していないため(既存の
// `docs/coding-conventions.md`「テスト」節の制約と同じ)、ここでは実際の
// px値ではなく「CSS変数が設定される」「列数分設定される」
// 「ResizeObserverをこのcontainerに対してobserveする」ことのみを確認する。
// 実際の列幅の正しさは実ブラウザで確認する。

function Harness({ columnCount, deps }: { columnCount: number; deps: unknown[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useAutoFitGridColumns(ref, columnCount, deps)
  return (
    <div ref={ref} data-testid="container">
      <span data-auto-col="0">A</span>
      <span data-auto-col="1">BB</span>
      {columnCount > 2 && <span data-auto-col="2">CCC</span>}
    </div>
  )
}

describe('useAutoFitGridColumns', () => {
  it('sets a --auto-col-N CSS custom property for every column on the container element', () => {
    const { getByTestId } = render(<Harness columnCount={2} deps={[]} />)
    const container = getByTestId('container')
    expect(container.style.getPropertyValue('--auto-col-0')).toMatch(/px$/)
    expect(container.style.getPropertyValue('--auto-col-1')).toMatch(/px$/)
  })

  it('does not set a property for columns beyond columnCount', () => {
    const { getByTestId } = render(<Harness columnCount={2} deps={[]} />)
    const container = getByTestId('container')
    expect(container.style.getPropertyValue('--auto-col-2')).toBe('')
  })

  it('observes the container with ResizeObserver so later resizes re-trigger recalculation', () => {
    const { getByTestId } = render(<Harness columnCount={2} deps={[]} />)
    const container = getByTestId('container')
    const observer = getLatestMockResizeObserver()
    expect(observer.observed).toContain(container)
  })

  it('does not throw when the container ref is not yet attached (defensive no-op)', () => {
    function EmptyHarness() {
      const ref = useRef<HTMLDivElement>(null)
      useAutoFitGridColumns(ref, 3, [])
      return null
    }
    expect(() => render(<EmptyHarness />)).not.toThrow()
  })

  it('recalculates when deps change (re-running without error for new content)', () => {
    const { getByTestId, rerender } = render(<Harness columnCount={3} deps={['a']} />)
    const container = getByTestId('container')
    expect(container.style.getPropertyValue('--auto-col-2')).toMatch(/px$/)
    rerender(<Harness columnCount={3} deps={['b']} />)
    expect(container.style.getPropertyValue('--auto-col-2')).toMatch(/px$/)
  })
})
