import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BusbarSelector } from './BusbarSelector'
import { FIRST_ROW_ID, emptyRow, type BusbarRow } from '../../domain/busbarSelections'

function Harness({ face = '1', initial }: { face?: string; initial?: BusbarRow[] }) {
  const [rows, setRows] = useState<BusbarRow[]>(initial ?? [emptyRow(FIRST_ROW_ID)])
  return <BusbarSelector faceLabel={face} rows={rows} onChange={setRows} />
}

const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement
const pick = (name: string, value: string) => fireEvent.change(select(name), { target: { value } })
const optionTexts = (name: string) => [...select(name).options].map((o) => o.textContent)

describe('BusbarSelector', () => {
  it('starts with all four items unselected, later stages disabled, and no code', () => {
    render(<Harness />)
    for (const label of ['仕様', '相数', '電圧区分', '容量（kVA）']) expect(select(`面1 銅帯1 ${label}`).value).toBe('')
    expect(select('面1 銅帯1 仕様').disabled).toBe(false)
    expect(select('面1 銅帯1 相数').disabled).toBe(true)
    expect(select('面1 銅帯1 電圧区分').disabled).toBe(true)
    expect(select('面1 銅帯1 容量（kVA）').disabled).toBe(true)
    expect(document.querySelector('.busbar-selector__code')).toBeNull()
    expect(screen.getByText('左から順に 4 項目を選択してください。')).toBeInTheDocument()
  })

  it('narrows the candidates step by step and shows 区分なし（1Φ） for 1Φ', () => {
    render(<Harness />)
    pick('面1 銅帯1 仕様', '公共建築')
    expect(optionTexts('面1 銅帯1 相数')).toEqual(['選択してください', '1Φ', '3Φ'])
    pick('面1 銅帯1 相数', '1Φ')
    expect(optionTexts('面1 銅帯1 電圧区分')).toEqual(['選択してください', '区分なし（1Φ）'])
    pick('面1 銅帯1 電圧区分', '—')
    expect(optionTexts('面1 銅帯1 容量（kVA）')).toContain('10')
    pick('面1 銅帯1 容量（kVA）', '10')
    expect(document.querySelector('.busbar-selector__code')?.textContent).toBe('44241')
    expect(document.querySelector('.busbar-selector__spec')?.textContent).toBe('公共建築')
    expect(screen.getByText('3×30 L=2.6m×3本')).toBeInTheDocument()
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
      <Harness initial={[{ id: 'x', selection: { spec: '標準仕様', phase: '1Φ', voltage: '200V級', kva: '100' } }]} />,
    )
    expect(screen.getByText(/一致するコードがありません/)).toBeInTheDocument()
    expect(document.querySelector('.busbar-selector__code')).toBeNull()
  })

  it('adds an unselected row with "＋", deletes rows individually, and shows no delete button for a single row', () => {
    render(<Harness />)
    expect(screen.queryByRole('button', { name: /を削除/ })).not.toBeInTheDocument()
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
