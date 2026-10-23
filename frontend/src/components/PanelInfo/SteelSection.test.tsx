import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { SteelSection } from './SteelSection'
import { groupSteelItems, matchCabtype, normalizeModel } from '../../domain/steelOutline'
import type { SteelItem, SteelOutline } from '../../types/domain'

const item = (over: Partial<SteelItem> = {}): SteelItem => ({
  symbol_name: 'BSP-STEELA-H',
  cabtype: 'TYPE-X',
  component_name: '基礎ベース',
  material_spec: 'TEST-MAT-A 10x20',
  ...over,
})

const okSteel = (items: SteelItem[]): SteelOutline => ({
  status: 'ok',
  source_page: '5',
  source_drawing_name: '外形図(2)',
  items,
})

function open() {
  fireEvent.click(screen.getByRole('button', { name: /鋼材/ }))
}

describe('matchCabtype (正規化後の完全一致だけを一致にする)', () => {
  it('matches only after normalization (trim / case / full-width)', () => {
    expect(matchCabtype('type-x', ['TYPE-X'])).toEqual({ kind: 'match', model: 'TYPE-X' })
    expect(matchCabtype(' TYPE-X ', ['type-x '])).toEqual({ kind: 'match', model: 'type-x' })
    expect(matchCabtype('ＴＹＰＥ-Ｘ', ['TYPE-X']).kind).toBe('match')
    expect(normalizeModel(null)).toBe('')
  })

  it('does not treat prefix / partial / similar models as a match', () => {
    expect(matchCabtype('TYPE-X', ['TYPE-X2']).kind).toBe('mismatch')
    expect(matchCabtype('TYPE-X', ['TYPE']).kind).toBe('mismatch')
    expect(matchCabtype('TYPE-X', ['TYPE X']).kind).toBe('mismatch')
    expect(matchCabtype('TYPE-X', ['TYPE_X']).kind).toBe('mismatch')
  })

  it('is unknown (not mismatch) when CABTYPE or box models are missing', () => {
    expect(matchCabtype('', ['TYPE-X']).kind).toBe('unknown-no-cabtype')
    expect(matchCabtype('   ', ['TYPE-X']).kind).toBe('unknown-no-cabtype')
    expect(matchCabtype('TYPE-X', []).kind).toBe('unknown-no-model')
    expect(matchCabtype('TYPE-X', [null, undefined, '  ']).kind).toBe('unknown-no-model')
  })

  it('lists every distinct box model on mismatch', () => {
    expect(matchCabtype('Z', ['A', 'B', 'A'])).toEqual({ kind: 'mismatch', models: ['A', 'B'] })
  })
})

describe('groupSteelItems', () => {
  it('groups consecutive rows of the same symbol/CABTYPE and keeps CSV order (no merging of separated groups)', () => {
    const groups = groupSteelItems([
      item({ component_name: 'a' }),
      item({ component_name: 'b' }),
      item({ cabtype: 'OTHER', component_name: 'c' }),
      item({ component_name: 'd' }),
    ])
    expect(groups.map((g) => [g.cabtype, g.items.map((i) => i.component_name)])).toEqual([
      ['TYPE-X', ['a', 'b']],
      ['OTHER', ['c']],
      ['TYPE-X', ['d']],
    ])
  })
})

describe('SteelSection', () => {
  it('renders nothing when steel is not provided (existing callers are unaffected)', () => {
    const { container } = render(<SteelSection steel={undefined} panelModels={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is collapsed by default and toggles with aria-expanded', () => {
    render(<SteelSection steel={okSteel([item()])} panelModels={['TYPE-X']} />)
    const toggle = screen.getByRole('button', { name: /鋼材/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('steel-group')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByTestId('steel-group')).toHaveLength(1)
    fireEvent.click(toggle)
    expect(screen.queryByTestId('steel-group')).not.toBeInTheDocument()
  })

  it('shows source page small, symbol, CABTYPE, components and specs (未記載/無し kept distinct as-is)', () => {
    render(
      <SteelSection
        steel={okSteel([
          item(),
          item({ component_name: '側板', material_spec: '無し' }),
          item({ component_name: '屋根', material_spec: '未記載' }),
        ])}
        panelModels={['type-x']}
      />,
    )
    open()
    expect(screen.getByText('表示元: 外形図(2) P5')).toBeInTheDocument()
    const group = screen.getByTestId('steel-group')
    expect(within(group).getByText('BSP-STEELA-H')).toBeInTheDocument()
    expect(within(group).getByText('TEST-MAT-A 10x20')).toBeInTheDocument()
    expect(within(group).getByText('無し')).toHaveAttribute('data-spec-kind', 'nothing')
    expect(within(group).getByText('未記載')).toHaveAttribute('data-spec-kind', 'not_described')
    expect(within(group).getByText(/箱体型式 type-x と一致/)).toBeInTheDocument()
  })

  it('shows fixed mismatch and unknown notes, never as a match', () => {
    render(
      <SteelSection
        steel={okSteel([item({ cabtype: 'NOPE' }), item({ cabtype: '', symbol_name: 'S2' })])}
        panelModels={['TYPE-X', 'TYPE-Y']}
      />,
    )
    open()
    const groups = screen.getAllByTestId('steel-group')
    expect(within(groups[0]).getByText('✗ 箱体型式(TYPE-X / TYPE-Y)と一致しません')).toBeInTheDocument()
    expect(within(groups[0]).queryByText(/と一致$/)).not.toBeInTheDocument()
    expect(within(groups[1]).getByText('△ CABTYPEの記載がないため、対応は不明です')).toBeInTheDocument()
  })

  it('shows the unknown note when no box model information exists', () => {
    render(<SteelSection steel={okSteel([item()])} panelModels={[]} />)
    open()
    expect(screen.getByText('△ 箱体型式の情報がないため、対応は不明です')).toBeInTheDocument()
  })

  it.each([
    ['invalid', '鋼材データを読み込めませんでした'],
    ['no_outline', '外形図の鋼材データがありません'],
    ['unavailable', '鋼材データを取得できませんでした'],
    ['missing', '鋼材データがありません'],
    ['empty', '鋼材データがありません'],
  ] as const)('shows the fixed message for status %s without any other text', (status, message) => {
    render(
      <SteelSection
        steel={{ status, source_page: null, source_drawing_name: null, items: [] }}
        panelModels={['TYPE-X']}
      />,
    )
    open()
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByTestId('steel-group')).not.toBeInTheDocument()
  })

  it('shows a loading note while fetching (null) and keeps source page strings as-is (leading zero kept)', () => {
    const { rerender } = render(<SteelSection steel={null} panelModels={[]} />)
    open()
    expect(screen.getByText('読み込み中…')).toBeInTheDocument()
    rerender(<SteelSection steel={{ ...okSteel([item()]), source_page: '16', source_drawing_name: null }} panelModels={[]} />)
    expect(screen.getByText('表示元: P16')).toBeInTheDocument()
  })
})
