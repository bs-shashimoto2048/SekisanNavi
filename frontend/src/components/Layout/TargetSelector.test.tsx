import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TargetSelector } from './TargetSelector'
import type { EstimateTarget } from '../../types/estimateAggregation'

function makeTarget(overrides: Partial<EstimateTarget> = {}): EstimateTarget {
  return { id: 'product', type: 'product', name: '製番仕様', banMenno: null, banNo: null, ...overrides }
}

function makePanelTarget(overrides: Partial<EstimateTarget> = {}): EstimateTarget {
  return { id: 'panel:1:1', type: 'panel', name: '高圧受電盤', banMenno: 1, banNo: 1, ...overrides }
}

// 指示: 「積算明細と積算集約にある『対象』プルダウンは同じ選択状態に連動している
// ため、重複をなくして1つにまとめる」。旧`EstimateAggregation`/`EstimateDetail`
// それぞれが個別に持っていた`<select>`の挙動(選択肢・onChange・Viewer連動中の
// 強調表示)を、この共通componentでそのまま検証する(重複removal元の
// `EstimateAggregation.test.tsx`/`EstimateDetail.test.tsx`から移設)。
describe('TargetSelector', () => {
  it('has 総合計 as the first option (empty-string value) plus one option per target, using target.id (not the label text) as the option value', () => {
    const targets = [makeTarget(), makePanelTarget()]
    render(<TargetSelector targets={targets} selectedTargetId={null} onSelectTarget={() => {}} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    const options = within(select).getAllByRole('option') as HTMLOptionElement[]
    expect(options[0]).toHaveTextContent('総合計')
    expect(options[0].value).toBe('')
    const panelOption = options.find((o) => o.value === 'panel:1:1')
    expect(panelOption).toBeDefined()
  })

  it('shows 面番号/盤番号/盤名称 together in the panel option label, not just the panel name (指示3章)', () => {
    const targets = [makeTarget(), makePanelTarget({ banMenno: 3, banNo: 3, name: 'No.1低圧動力盤', id: 'panel:3:3' })]
    render(<TargetSelector targets={targets} selectedTargetId={null} onSelectTarget={() => {}} />)
    expect(screen.getByText('面番号 3 / 盤番号 3 : No.1低圧動力盤')).toBeInTheDocument()
  })

  it('calls onSelectTarget with the real target id (not the display string) when a panel option is chosen', () => {
    const onSelectTarget = vi.fn()
    const targets = [makeTarget(), makePanelTarget()]
    render(<TargetSelector targets={targets} selectedTargetId={null} onSelectTarget={onSelectTarget} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'panel:1:1' } })
    expect(onSelectTarget).toHaveBeenCalledWith('panel:1:1')
  })

  it('calls onSelectTarget with null when 総合計 is chosen', () => {
    const onSelectTarget = vi.fn()
    const targets = [makeTarget(), makePanelTarget()]
    render(<TargetSelector targets={targets} selectedTargetId="panel:1:1" onSelectTarget={onSelectTarget} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })
    expect(onSelectTarget).toHaveBeenCalledWith(null)
  })

  it('shows the currently selected target as the select value', () => {
    const targets = [makeTarget(), makePanelTarget()]
    render(<TargetSelector targets={targets} selectedTargetId="panel:1:1" onSelectTarget={() => {}} />)
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('panel:1:1')
  })

  it('only shows 総合計 when there are no targets', () => {
    render(<TargetSelector targets={[]} selectedTargetId={null} onSelectTarget={() => {}} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['総合計'])
  })

  describe('Viewer連動中の強調表示 (旧EstimateAggregation select、指示8章「Viewer連動中の対象表示」を引き継ぐ)', () => {
    it('has only the base class (no --focused) when 総合計 is selected', () => {
      render(<TargetSelector targets={[makeTarget()]} selectedTargetId={null} onSelectTarget={() => {}} />)
      const select = screen.getByRole('combobox')
      expect(select.className).toBe('target-selector__select')
      expect(select.className).not.toContain('--focused')
    })

    it('adds the "--focused" class only while Viewer is focused on a specific target (個別盤選択中)', () => {
      const targets = [makeTarget(), makePanelTarget()]
      render(<TargetSelector targets={targets} selectedTargetId="panel:1:1" onSelectTarget={() => {}} />)
      expect(screen.getByRole('combobox').className).toContain('target-selector__select--focused')
    })

    it('removes the "--focused" class again when switching back to 総合計 (focused解除)', () => {
      const targets = [makeTarget(), makePanelTarget()]
      const { rerender } = render(
        <TargetSelector targets={targets} selectedTargetId="panel:1:1" onSelectTarget={() => {}} />,
      )
      expect(screen.getByRole('combobox').className).toContain('--focused')

      rerender(<TargetSelector targets={targets} selectedTargetId={null} onSelectTarget={() => {}} />)
      expect(screen.getByRole('combobox').className).not.toContain('--focused')
    })
  })

  it('caps its width using the shared --target-selector-width token (指示: 積算明細側の指定幅(220px)に統一する。共通CSS変数で一元管理する)', () => {
    render(<TargetSelector targets={[makeTarget()]} selectedTargetId={null} onSelectTarget={() => {}} />)
    const select = screen.getByRole('combobox')
    // jsdom(cssstyle)は`var()`をpx値へ解決しないため、宣言値そのもの
    // (共通tokenを参照していること)を検証する。実ブラウザでの実際のpx一致
    // (220px)はPlaywrightで確認する。
    expect(getComputedStyle(select).maxWidth).toBe('var(--target-selector-width)')
  })

  it('has a label of "対象"', () => {
    render(<TargetSelector targets={[makeTarget()]} selectedTargetId={null} onSelectTarget={() => {}} />)
    expect(screen.getByText('対象')).toBeInTheDocument()
  })
})
