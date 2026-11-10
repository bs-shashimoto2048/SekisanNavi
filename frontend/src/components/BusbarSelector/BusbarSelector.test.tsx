import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BusbarSelector } from './BusbarSelector'
import { BUSBAR_FACTOR_OPTIONS, FIRST_ROW_ID, emptyRow, type BusbarRow } from '../../domain/busbarSelections'

function Harness({ face = '1', initial }: { face?: string; initial?: BusbarRow[] }) {
  const [rows, setRows] = useState<BusbarRow[]>(initial ?? [emptyRow(FIRST_ROW_ID)])
  return <BusbarSelector faceLabel={face} rows={rows} onChange={setRows} />
}

const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement
const pick = (name: string, value: string) => fireEvent.change(select(name), { target: { value } })
const summaryText = () => (document.querySelector('.busbar-selector__summary')?.textContent ?? '').replace(/\s+/g, ' ').replace(/(コード|品名|型式|定格)/g, '')
const optionTexts = (name: string) => [...select(name).options].map((o) => o.textContent)

describe('BusbarSelector', () => {
  it('starts with all four items unselected, later stages disabled, and an empty selected-code cell', () => {
    render(<Harness />)
    for (const label of ['仕様', '相数', '電圧区分', '容量（kVA）']) expect(select(`面1 銅帯1 ${label}`).value).toBe('')
    expect(select('面1 銅帯1 仕様').disabled).toBe(false)
    expect(select('面1 銅帯1 相数').disabled).toBe(true)
    expect(select('面1 銅帯1 電圧区分').disabled).toBe(true)
    expect(select('面1 銅帯1 容量（kVA）').disabled).toBe(true)
    expect(document.querySelector('.busbar-selector__code')).toBeNull()
    expect(screen.getByText('選定コード')).toBeInTheDocument()
    expect(document.querySelector('.busbar-selector__code-placeholder')?.textContent).toBe('—')
    expect(select('面1 銅帯1 係数').value).toBe('1')
    expect(optionTexts('面1 銅帯1 係数')).toEqual(BUSBAR_FACTOR_OPTIONS.map((factor) => factor.toFixed(1)))
  })

  it('updates and retains the selected coefficient per row', () => {
    render(<Harness />)
    pick('面1 銅帯1 係数', '1.4')
    expect(select('面1 銅帯1 係数').value).toBe('1.4')
  })

  it('narrows the candidates step by step and shows 区分なし（1Φ） for 1Φ', () => {
    render(<Harness />)
    pick('面1 銅帯1 仕様', '公共建築')
    expect(optionTexts('面1 銅帯1 相数')).toEqual(['選択', '1Φ', '3Φ'])
    pick('面1 銅帯1 相数', '1Φ')
    expect(optionTexts('面1 銅帯1 電圧区分')).toEqual(['選択', '区分なし（1Φ）'])
    pick('面1 銅帯1 電圧区分', '—')
    expect(optionTexts('面1 銅帯1 容量（kVA）')).toContain('10')
    pick('面1 銅帯1 容量（kVA）', '10')
    expect(document.querySelector('.busbar-selector__code')?.textContent).toBe('44241')
    // 選定結果は「コード｜品名｜型式｜定格」の 1 行。
    expect(summaryText()).toBe('44241｜入力（主回路銅帯）｜3×30 L=2.6m×3本｜1Φ 10kVA 公共建築 (225A)')
  })

  it('shows the result as a single line 「コード｜品名｜型式｜定格」 and lays the four selects out in one nowrap-label row', () => {
    render(<Harness />)
    pick('面1 銅帯1 仕様', '標準仕様')
    pick('面1 銅帯1 相数', '3Φ')
    pick('面1 銅帯1 電圧区分', '200V級')
    pick('面1 銅帯1 容量（kVA）', '100')
    expect(summaryText()).toBe('44815｜入力（主回路銅帯）｜3×30 L=3.9m×3本｜3Φ 100kVA 200V級 標準仕様 (307A)')
    expect(document.querySelector('.busbar-selector__summary')?.children).toHaveLength(4)
    expect(document.querySelector('.busbar-selector__code')?.textContent).toBe('44815')
    expect(document.querySelectorAll('.busbar-selector__fields > .busbar-selector__field')).toHaveLength(4)
    expect(document.querySelector('.busbar-selector__row-head')?.textContent).toContain('銅帯 1')
    expect(document.querySelector('.busbar-selector__code-cell')?.textContent).toContain('44815')
    expect(document.querySelector('.busbar-selector__result')).toBeInTheDocument()
  })

  it('resets later stages when an earlier stage changes, hiding the code', () => {
    render(<Harness />)
    pick('面1 銅帯1 仕様', '標準仕様')
    pick('面1 銅帯1 相数', '3Φ')
    pick('面1 銅帯1 電圧区分', '200V級')
    pick('面1 銅帯1 容量（kVA）', '100')
    expect(document.querySelector('.busbar-selector__code')?.textContent).toBe('44815')

    pick('面1 銅帯1 電圧区分', '400V級')
    expect(select('面1 銅帯1 容量（kVA）').value).toBe('')
    expect(document.querySelector('.busbar-selector__code')).toBeNull()

    pick('面1 銅帯1 仕様', '公共建築')
    expect(select('面1 銅帯1 相数').value).toBe('')
    expect(select('面1 銅帯1 電圧区分').value).toBe('')
    expect(select('面1 銅帯1 電圧区分').disabled).toBe(true)
  })

  it('shows "no match" and adopts no code when the stored combination matches nothing', () => {
    render(
      <Harness initial={[{ id: 'x', factor: 1, selection: { spec: '標準仕様', phase: '1Φ', voltage: '200V級', kva: '100' } }]} />,
    )
    expect(document.querySelector('.busbar-selector__code-placeholder')?.textContent).toBe('該当なし')
    expect(document.querySelector('.busbar-selector__code-placeholder')?.getAttribute('title')).toContain('一致するコードがありません')
    expect(document.querySelector('.busbar-selector__code')).toBeNull()
  })

  it('adds an unselected row with "＋" and deletes rows individually', () => {
    render(<Harness />)
    pick('面1 銅帯1 仕様', '標準仕様')

    fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
    expect(select('面1 銅帯2 仕様').value).toBe('')
    pick('面1 銅帯2 仕様', '公共建築')
    fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
    expect(screen.getAllByRole('group')).toHaveLength(3)

    // 2 行目を削除しても、1 行目・3 行目の選択は変わらない(3 行目は 2 行目に繰り上がる)。
    fireEvent.click(screen.getByRole('button', { name: '面1 銅帯2を削除' }))
    expect(screen.getAllByRole('group')).toHaveLength(2)
    expect(select('面1 銅帯1 仕様').value).toBe('標準仕様')
    expect(select('面1 銅帯2 仕様').value).toBe('')
  })

  it('shows no selection row when there are no rows, creates the first row only with "＋", and can delete the only row', () => {
    render(<Harness initial={[]} />)
    expect(screen.queryAllByRole('group')).toHaveLength(0)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /を削除/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
    expect(screen.getAllByRole('group')).toHaveLength(1)
    expect(select('面1 銅帯1 仕様').value).toBe('')
    // 行が 1 つだけでも削除でき、削除後は選択行が消えて「＋」で再追加できる。
    fireEvent.click(screen.getByRole('button', { name: '面1 銅帯1を削除' }))
    expect(screen.queryAllByRole('group')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
    expect(screen.getAllByRole('group')).toHaveLength(1)
  })

  it('disables plus, selects, factor and delete and shows a loading notice while loading, and re-enables them afterwards', () => {
    const rows: BusbarRow[] = [{ id: 'row-1', factor: 0.7, selection: { spec: '標準仕様', phase: '3Φ', voltage: '200V級', kva: '100' } }]
    const { rerender } = render(<BusbarSelector faceLabel="1" rows={rows} onChange={() => {}} loading />)
    expect(screen.getByText(/サーバーの保存内容を読み込み中です/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '面1 銅帯1を削除' })).toBeDisabled()
    for (const label of ['仕様', '相数', '電圧区分', '容量（kVA）', '係数']) {
      expect(select(`面1 銅帯1 ${label}`).disabled).toBe(true)
    }
    rerender(<BusbarSelector faceLabel="1" rows={rows} onChange={() => {}} />)
    expect(screen.queryByText(/サーバーの保存内容を読み込み中です/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '面1 銅帯1を削除' })).toBeEnabled()
    expect(select('面1 銅帯1 係数').disabled).toBe(false)
  })

  it('keeps rows of different faces independent (separate instances)', () => {
    render(
      <>
        <Harness face="1" />
        <Harness face="2" />
      </>,
    )
    pick('面1 銅帯1 仕様', '標準仕様')
    fireEvent.click(screen.getByRole('button', { name: '面2に銅帯の選択行を追加' }))
    expect(select('面1 銅帯1 仕様').value).toBe('標準仕様')
    expect(select('面2 銅帯1 仕様').value).toBe('')
    expect(screen.queryByRole('combobox', { name: '面1 銅帯2 仕様' })).not.toBeInTheDocument()
    expect(select('面2 銅帯2 仕様').value).toBe('')
  })
})
