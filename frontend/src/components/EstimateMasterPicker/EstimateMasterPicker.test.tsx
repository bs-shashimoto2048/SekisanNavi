import { render, screen, fireEvent, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EstimateMasterPicker } from './EstimateMasterPicker'
import { fetchMasterItems } from '../../api/client'
import type { EstimateMasterItem } from '../../types/domain'
import { MASTER_CATEGORY_PRESENTATION } from '../../domain/masterCategoryPresentation'

// Excel由来のcategory原文 (半角カナ・半角中点混在) を手打ちで再現するとタイプミスの
// リスクがあるため、`masterCategoryPresentation.ts`(backend側ALLOWED_CATEGORIESから
// 生成済み)の値をそのまま参照する。category列にはこの`internal`(半角混在の原文)を
// 入れ、Frontendが`label`(全角統一表示名)へ変換して描画することを検証する
// (Phase 1.10 UI改修指示8章/9章)。
const BOX_TANDOKU = MASTER_CATEGORY_PRESENTATION[0] // 箱･単独 → 箱・単独 (blue)
const NAIBU_PANEL = MASTER_CATEGORY_PRESENTATION[3] // 内部ﾊﾟﾈﾙ → 内部パネル (green)
const FUZOKUHIN = MASTER_CATEGORY_PRESENTATION[6] // 附属品加算価格 (半角無し, orange)

function makeItem(overrides: Partial<EstimateMasterItem>): EstimateMasterItem {
  return {
    id: 1,
    code: '11001',
    category: BOX_TANDOKU.internal,
    model: 'OS2-816',
    rating: '2.3*0.8*1.6',
    note: null,
    total_price_a: 315300,
    box_parts_price: 61600,
    painting_price: 89100,
    setup_a: 216,
    sheet_metal_price: 1096,
    assembly_price: 351,
    inspection_price: 15,
    ...overrides,
  }
}

const ALL_ITEMS: EstimateMasterItem[] = [
  makeItem({ id: 1, code: '11001', category: BOX_TANDOKU.internal }),
  makeItem({
    id: 2,
    code: '11002',
    category: BOX_TANDOKU.internal,
    model: 'OS2-916',
    total_price_a: 322000,
    box_parts_price: 64600,
    painting_price: 92800,
  }),
  makeItem({
    id: 3,
    code: '18001',
    category: NAIBU_PANEL.internal,
    model: 'A1',
    rating: 'H+W=1500',
    total_price_a: 11100,
    box_parts_price: 2100,
    painting_price: 2800,
    setup_a: 20,
    sheet_metal_price: 32,
    assembly_price: 10,
    inspection_price: 2,
  }),
  makeItem({
    id: 4,
    code: '18311',
    category: FUZOKUHIN.internal,
    model: null,
    rating: '天井のみ1面に付',
    total_price_a: null,
    box_parts_price: null,
    painting_price: null,
    setup_a: null,
    sheet_metal_price: null,
    assembly_price: null,
    inspection_price: null,
  }),
]

// `fetchMasterItems` はモック化した上で、各テストが `mockDataset` を差し替えることで
// 挙動を変えられるようにする (モジュールのモック自体は1回のみ静的に行う)。
let mockDataset: EstimateMasterItem[] = ALL_ITEMS

vi.mock('../../api/client', () => ({
  fetchMasterItems: vi.fn((params: { q?: string; category?: string }) => {
    let items = mockDataset
    if (params.category) items = items.filter((i) => i.category === params.category)
    if (params.q) {
      const q = params.q
      items = items.filter((i) => i.code.includes(q) || (i.model ?? '').includes(q))
    }
    return Promise.resolve(items)
  }),
}))

beforeEach(() => {
  mockDataset = ALL_ITEMS
  vi.mocked(fetchMasterItems).mockClear()
})

describe('EstimateMasterPicker', () => {
  it('generates tabs from the categories actually present in Master data (no hardcoding), displayed with the full-width label (Phase 1.10 指示書8章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)

    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([
      BOX_TANDOKU.label,
      NAIBU_PANEL.label,
      FUZOKUHIN.label,
    ])
    // 内部値(半角混在)がそのまま画面に出ていないこと。
    expect(screen.queryByText(BOX_TANDOKU.internal)).not.toBeInTheDocument()
    expect(screen.queryByText(NAIBU_PANEL.internal)).not.toBeInTheDocument()
  })

  it('shows only the active tab category, and switching tabs changes the displayed rows', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)

    expect(await screen.findByText('11001')).toBeInTheDocument()
    expect(screen.getByText('11002')).toBeInTheDocument()
    expect(screen.queryByText('18001')).not.toBeInTheDocument()

    fireEvent.click(await screen.findByRole('tab', { name: NAIBU_PANEL.label }))

    expect(await screen.findByText('18001')).toBeInTheDocument()
    expect(screen.queryByText('11001')).not.toBeInTheDocument()
  })

  it('renders exactly the specified 10 columns in order', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    await screen.findByText('11001')

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual([
      'コード',
      '型式',
      '定格',
      '総合価格A',
      '箱・部品価格',
      '塗装価格',
      '設A',
      '板金',
      '組立',
      '検査',
    ])
  })

  it('formats numeric values with thousands separators and leaves missing values blank (no fabricated data)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    expect(await screen.findByText('315,300')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('tab', { name: FUZOKUHIN.label }))
    const row = (await screen.findByText('18311')).closest('tr') as HTMLElement
    const cells = within(row).getAllByRole('cell')
    // コード, 型式, 定格, 総合価格A, 箱・部品価格, 塗装価格, 設A, 板金, 組立, 検査
    expect(cells.map((c) => c.textContent)).toEqual([
      '18311',
      '',
      '天井のみ1面に付',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ])
  })

  it('calls onSelectItem with the row id when a row is clicked', async () => {
    const onSelectItem = vi.fn()
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={onSelectItem} />)
    const row = (await screen.findByText('11002')).closest('tr') as HTMLElement

    fireEvent.click(row)

    expect(onSelectItem).toHaveBeenCalledWith(2)
  })

  it('highlights the row matching selectedItemId as selected', async () => {
    render(<EstimateMasterPicker selectedItemId={2} onSelectItem={() => {}} />)
    const selectedRow = (await screen.findByText('11002')).closest('tr') as HTMLElement
    const otherRow = screen.getByText('11001').closest('tr') as HTMLElement

    expect(selectedRow.className).toContain('master-picker__row--selected')
    expect(otherRow.className).not.toContain('master-picker__row--selected')
  })
})

describe('EstimateMasterPicker: タブの全角表記・色分け (Phase 1.10 UI改修指示8章〜13章、Phase 1.11で固有色化)', () => {
  it('injects each tab with its own unique color via CSS custom properties (Phase 1.11 指示書1章/30章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const tabs = await screen.findAllByRole('tab')
    const byLabel = new Map(tabs.map((t) => [t.textContent, t]))

    const boxTab = byLabel.get(BOX_TANDOKU.label)!
    const naibuTab = byLabel.get(NAIBU_PANEL.label)!
    const fuzokuTab = byLabel.get(FUZOKUHIN.label)!

    expect(boxTab.style.getPropertyValue('--cat-tab-border')).toBe(BOX_TANDOKU.colors.tabBorder)
    expect(naibuTab.style.getPropertyValue('--cat-tab-border')).toBe(
      NAIBU_PANEL.colors.tabBorder,
    )
    expect(fuzokuTab.style.getPropertyValue('--cat-tab-border')).toBe(
      FUZOKUHIN.colors.tabBorder,
    )
    // 13カテゴリすべて固有色のため、どの2カテゴリを取っても同じ色にはならない。
    expect(BOX_TANDOKU.colors.tabBorder).not.toBe(NAIBU_PANEL.colors.tabBorder)
    expect(NAIBU_PANEL.colors.tabBorder).not.toBe(FUZOKUHIN.colors.tabBorder)
    expect(BOX_TANDOKU.colors.tabBorder).not.toBe(FUZOKUHIN.colors.tabBorder)
  })

  it('marks the active tab distinctly, separate from the row-selected highlight color (指示書13章/14章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const activeTab = await screen.findByRole('tab', { name: BOX_TANDOKU.label })
    const inactiveTab = await screen.findByRole('tab', { name: NAIBU_PANEL.label })

    expect(activeTab.className).toContain('master-picker__tab--active')
    expect(inactiveTab.className).not.toContain('master-picker__tab--active')
  })

  it('keeps the tab color class distinct from the row-selection class name (no naming/CSS collision, 指示書14章)', async () => {
    render(<EstimateMasterPicker selectedItemId={2} onSelectItem={() => {}} />)
    const tab = await screen.findByRole('tab', { name: BOX_TANDOKU.label })
    const selectedRow = (await screen.findByText('11002')).closest('tr') as HTMLElement

    expect(tab.className).not.toContain('master-picker__row--selected')
    expect(selectedRow.className).not.toMatch(/master-picker__tab--/)
  })
})

describe('EstimateMasterPicker: 使用品名の限定 (追加指示)', () => {
  it('does not render a tab for a null-category row (Importer側で既に除外されている前提の防御的確認)', async () => {
    // Master Importer側で対象13品名・取り消し線行は既に除外されているため、
    // Frontendが受け取るデータにcategory:nullの行が混ざることは想定していない。
    // それでも万一混入した場合にタブが壊れたり例外を投げたりしないことだけ確認する
    // (「未分類」タブは廃止した)。
    mockDataset = [
      ...ALL_ITEMS,
      makeItem({ id: 99, code: '99999', category: null, model: '想定外行', rating: null }),
    ]
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)

    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([
      BOX_TANDOKU.label,
      NAIBU_PANEL.label,
      FUZOKUHIN.label,
    ])
    expect(screen.queryByRole('tab', { name: '未分類' })).not.toBeInTheDocument()
    expect(screen.queryByText('99999')).not.toBeInTheDocument()
  })
})

describe('EstimateMasterPicker: 大量データ表示 (全件表示であることの確認)', () => {
  it('renders every row of a large category without truncating (no arbitrary page-size limit)', async () => {
    mockDataset = Array.from({ length: 230 }, (_, i) =>
      makeItem({ id: 1000 + i, code: `9${String(i).padStart(4, '0')}`, category: BOX_TANDOKU.internal }),
    )
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)

    await screen.findByText('90000')
    const rows = screen.getAllByRole('row')
    // ヘッダー行1 + データ行230
    expect(rows.length).toBe(231)
  })
})
