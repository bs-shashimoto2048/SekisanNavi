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
  // [追加修正: 部品台帳への再設計 指示2章] Frontend側の検索欄は廃止したが、
  // `fetchMasterItems`自体の`q`引数(Backend API)は変更していない。この
  // componentが`category`のみを渡すようになったことをモック経由で確認する。
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

describe('EstimateMasterPicker: 部品台帳への再設計 (Issue #19 追加修正)', () => {
  it('shows the UI heading as 部品台帳, not 積算コードMaster (指示1章: ユーザー向け名称変更)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    expect(await screen.findByRole('heading', { name: '部品台帳' })).toBeInTheDocument()
    expect(screen.queryByText('積算コードMaster')).not.toBeInTheDocument()
  })

  it('has no search input (指示2章: 検索欄を廃止)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    await screen.findByText('11001')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('labels the selection list as 品名, not カテゴリ (追加修正指示1章: ユーザー向け表記の変更)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    await screen.findByText('11001')
    expect(screen.getByText('品名')).toBeInTheDocument()
    expect(screen.queryByText('カテゴリ')).not.toBeInTheDocument()
    // ネイティブ<label>のラップによる暗黙のaccessible name。
    expect(screen.getByRole('combobox', { name: '品名' })).toBeInTheDocument()
  })

  it('generates category select options from the categories actually present in Master data (no hardcoding), using the full-width label', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    await screen.findByText('11001')

    const select = screen.getByRole('combobox') as HTMLSelectElement
    const options = within(select).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([BOX_TANDOKU.label, NAIBU_PANEL.label, FUZOKUHIN.label])
    // 内部値(半角混在)がそのままoption textに出ていないこと。
    expect(screen.queryByText(BOX_TANDOKU.internal)).not.toBeInTheDocument()
    expect(screen.queryByText(NAIBU_PANEL.internal)).not.toBeInTheDocument()
  })

  it('shows only the selected category rows, and changing the category select switches the displayed rows', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)

    expect(await screen.findByText('11001')).toBeInTheDocument()
    expect(screen.getByText('11002')).toBeInTheDocument()
    expect(screen.queryByText('18001')).not.toBeInTheDocument()

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: NAIBU_PANEL.internal } })

    expect(await screen.findByText('18001')).toBeInTheDocument()
    expect(screen.queryByText('11001')).not.toBeInTheDocument()
  })

  it('renders exactly the 3 specified columns in order (指示3章: コード/型式/定格のみ)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    await screen.findByText('11001')

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['コード', '型式', '定格'])
    // 廃止した価格・工数列は表示されない(元データ自体は取得したまま、表示のみ絞る)。
    expect(screen.queryByText('総合価格A')).not.toBeInTheDocument()
    expect(screen.queryByText('315,300')).not.toBeInTheDocument()
  })

  it('leaves missing values blank (no fabricated data)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: FUZOKUHIN.internal } })

    const row = (await screen.findByText('18311')).closest('tr') as HTMLElement
    const cells = within(row).getAllByRole('cell')
    // コード, 型式(null→空欄), 定格
    expect(cells.map((c) => c.textContent)).toEqual(['18311', '', '天井のみ1面に付'])
  })

  it('calls onSelectItem with the row id when a row is clicked (BBox追加モードへの既存連携を維持)', async () => {
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

describe('EstimateMasterPicker: カテゴリ選択リストの配色 (Issue #19 追加修正)', () => {
  it('injects the selected category color onto the <select> itself, so the current category is clearly visible (指示2章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const select = await screen.findByRole('combobox')
    await screen.findByText('11001')

    expect(select.style.getPropertyValue('--cat-tab-border')).toBe(BOX_TANDOKU.colors.tabBorder)
    expect(select.style.getPropertyValue('--cat-tab-active-bg')).toBe(BOX_TANDOKU.colors.tabActiveBg)
    expect(select.style.getPropertyValue('--cat-tab-active-fg')).toBe(BOX_TANDOKU.colors.tabActiveFg)
  })

  it('switches the injected color immediately when a different category is selected', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const select = await screen.findByRole('combobox')
    await screen.findByText('11001')
    expect(select.style.getPropertyValue('--cat-tab-border')).toBe(BOX_TANDOKU.colors.tabBorder)

    fireEvent.change(select, { target: { value: NAIBU_PANEL.internal } })
    await screen.findByText('18001')

    expect(select.style.getPropertyValue('--cat-tab-border')).toBe(NAIBU_PANEL.colors.tabBorder)
    expect(select.style.getPropertyValue('--cat-tab-border')).not.toBe(BOX_TANDOKU.colors.tabBorder)
  })

  it('reflects the current category as the select value (native select shows the selected option, 指示2章「現在選択中カテゴリが明確に分かる」)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    await screen.findByText('11001')
    expect(select.value).toBe(BOX_TANDOKU.internal)

    fireEvent.change(select, { target: { value: FUZOKUHIN.internal } })
    await screen.findByText('18311')
    expect(select.value).toBe(FUZOKUHIN.internal)
  })
})

describe('EstimateMasterPicker: カテゴリ色の変化の簡素化 (Issue #19 追加修正)', () => {
  // [追加修正] 以前は選択中カテゴリのpresentationを<thead>へ注入し、品名を
  // 切り替えるたびにtable header全体の色が大きく変わる表現にしていたが、
  // 「品名を切り替えるたびにpanel全体やtable headerの色が大きく変わる表現は
  // やめる」との指示を受け廃止した。table headerは他panelと同じ固定配色になり、
  // カテゴリの配色情報は品名selectの左accent(--cat-tab-border)のみに限定される
  // (直上の「カテゴリ選択リストの配色」describe参照)。
  it('does not inject any category presentation onto <thead> (table headerはpanel種別によらず固定配色)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    await screen.findByText('11001')
    const thead = document.querySelector('.master-picker__table thead') as HTMLElement

    expect(thead.style.getPropertyValue('--cat-tab-bg')).toBe('')
    expect(thead.getAttribute('style')).toBeNull()
  })

  it('keeps the table header background/color the same across different categories (品名を切り替えても変化しない)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    await screen.findByText('11001')
    const th = screen.getAllByRole('columnheader')[0]
    const bgBefore = getComputedStyle(th).backgroundColor

    fireEvent.change(screen.getByRole('combobox'), { target: { value: NAIBU_PANEL.internal } })
    await screen.findByText('18001')

    expect(getComputedStyle(th).backgroundColor).toBe(bgBefore)
  })

  it('does not apply any category presentation to data rows (tbody) either', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const row = (await screen.findByText('11001')).closest('tr') as HTMLElement
    expect(row.style.getPropertyValue('--cat-tab-bg')).toBe('')
  })

  it('assigns every one of the 13 categories a unique tabBorder (used only as the select accent, no duplicates)', () => {
    const tabBorders = MASTER_CATEGORY_PRESENTATION.map((p) => p.colors.tabBorder)
    expect(new Set(tabBorders).size).toBe(13)
  })

  it('leaves selected-row cobalt styling and bbox/leader colors untouched (指示8章/12章、指示5章: BBox追加モードの部品選択フローは維持)', async () => {
    render(<EstimateMasterPicker selectedItemId={2} onSelectItem={() => {}} />)
    const selectedRow = (await screen.findByText('11002')).closest('tr') as HTMLElement
    expect(getComputedStyle(selectedRow).boxShadow.toLowerCase()).toContain('#2563eb')
    // BBox/引出線が参照するbboxBorder等は今回も無変更。
    expect(BOX_TANDOKU.colors.bboxBorder).toBe('#2a73bb')
    expect(BOX_TANDOKU.colors.leaderTextColor).toBe('#184c81')
  })
})

describe('EstimateMasterPicker: 選択中行の視覚表現 (UI視覚階層改善 追加修正指示から維持)', () => {
  it('renders the selected row with a cobalt-blue accent, not the old amber "edit-follow"-like color', async () => {
    render(<EstimateMasterPicker selectedItemId={2} onSelectItem={() => {}} />)
    const selectedRow = (await screen.findByText('11002')).closest('tr') as HTMLElement
    const style = getComputedStyle(selectedRow)
    expect(style.backgroundColor).not.toBe('rgb(254, 243, 199)')
    expect(style.boxShadow.toLowerCase()).toContain('#2563eb')
    expect(style.fontWeight).toBe('600')
  })

  it('does not apply the selected accent to a non-selected row', async () => {
    render(<EstimateMasterPicker selectedItemId={2} onSelectItem={() => {}} />)
    const otherRow = (await screen.findByText('11001')).closest('tr') as HTMLElement
    const style = getComputedStyle(otherRow)
    expect(style.boxShadow === 'none' || style.boxShadow === '').toBe(true)
  })

  it('does not change row height when a row becomes selected (情報密度を変えない)', async () => {
    const { rerender } = render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const row = (await screen.findByText('11002')).closest('tr') as HTMLElement
    const heightBefore = getComputedStyle(row).height
    rerender(<EstimateMasterPicker selectedItemId={2} onSelectItem={() => {}} />)
    const heightAfter = getComputedStyle(row).height
    expect(heightAfter).toBe(heightBefore)
  })
})

describe('EstimateMasterPicker: 使用品名の限定 (追加指示から維持)', () => {
  it('does not render a select option for a null-category row (Importer側で既に除外されている前提の防御的確認)', async () => {
    // Master Importer側で対象13品名・取り消し線行は既に除外されているため、
    // Frontendが受け取るデータにcategory:nullの行が混ざることは想定していない。
    // それでも万一混入した場合に選択リストが壊れたり例外を投げたりしないことだけ確認する
    // (「未分類」選択肢は追加しない)。
    mockDataset = [
      ...ALL_ITEMS,
      makeItem({ id: 99, code: '99999', category: null, model: '想定外行', rating: null }),
    ]
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)

    const select = await screen.findByRole('combobox')
    const options = within(select).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual([BOX_TANDOKU.label, NAIBU_PANEL.label, FUZOKUHIN.label])
    expect(screen.queryByText('未分類')).not.toBeInTheDocument()
    expect(screen.queryByText('99999')).not.toBeInTheDocument()
  })
})

describe('EstimateMasterPicker: 表セル境界の統一・ヘッダ左寄せ (Sekisan Navi 追加UI修正指示から維持、3列化に合わせて更新)', () => {
  it('left-aligns every column header (コード/型式/定格の3列とも)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const headers = await screen.findAllByRole('columnheader')
    expect(headers).toHaveLength(3)
    for (const th of headers) {
      expect(getComputedStyle(th).textAlign).toBe('left')
    }
  })

  it('left-aligns code/model/rating value cells (指示3章: 3列とも文字列列のため右寄せの対象は無い)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const row = (await screen.findByText('11001')).closest('tr') as HTMLElement
    const cells = within(row).getAllByRole('cell')
    expect(cells).toHaveLength(3)
    for (const cell of cells) {
      expect(getComputedStyle(cell).textAlign).not.toBe('right')
    }
  })

  it('does not change header/cell padding (情報密度を変えない)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    await screen.findByText('11001')
    const th = screen.getAllByRole('columnheader')[0]
    const td = screen.getByRole('table').querySelector('td') as HTMLElement
    expect(getComputedStyle(th).padding).toBe('0.3rem 0.5rem')
    expect(getComputedStyle(td).padding).toBe('0.3rem 0.5rem')
  })

  it('leaves the selected-row cobalt accent unchanged after the column reduction', async () => {
    render(<EstimateMasterPicker selectedItemId={2} onSelectItem={() => {}} />)
    const selectedRow = (await screen.findByText('11002')).closest('tr') as HTMLElement
    const style = getComputedStyle(selectedRow)
    expect(style.boxShadow.toLowerCase()).toContain('#2563eb')
    expect(style.fontWeight).toBe('600')
  })

  it('keeps the sticky header positioning unaffected by the column reduction', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const th = (await screen.findAllByRole('columnheader'))[0]
    expect(getComputedStyle(th).position).toBe('sticky')
  })

  // 注記: jsdom(cssstyle)はborder-right(var(...)使用)の解決を確実には行わないため、
  // --border-cell/active header用のrgba(255,255,255,0.18)の実際の描画は
  // 実ブラウザ確認で行う。
})

describe('EstimateMasterPicker: 大量データ表示 (全件表示であることの確認、維持)', () => {
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
