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

describe('EstimateMasterPicker: 選択中行の視覚表現 (UI視覚階層改善 追加修正指示 7章〜13章)', () => {
  it('renders the selected row with a cobalt-blue accent, not the old amber "edit-follow"-like color', async () => {
    render(<EstimateMasterPicker selectedItemId={2} onSelectItem={() => {}} />)
    const selectedRow = (await screen.findByText('11002')).closest('tr') as HTMLElement
    const style = getComputedStyle(selectedRow)
    // #fef3c7(旧amber, 要確認/編集直後と同じ意味色)ではなく、コバルトブルー系。
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

  it('does not change row height when a row becomes selected (指示25章: 情報密度を変えない)', async () => {
    const { rerender } = render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const row = (await screen.findByText('11002')).closest('tr') as HTMLElement
    const heightBefore = getComputedStyle(row).height
    rerender(<EstimateMasterPicker selectedItemId={2} onSelectItem={() => {}} />)
    const heightAfter = getComputedStyle(row).height
    expect(heightAfter).toBe(heightBefore)
  })

  it('marks the active tab with a background distinct from row-selection styling (no box-shadow-based marker; box-shadow stays reserved for row selection)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const activeTab = await screen.findByRole('tab', { name: BOX_TANDOKU.label })
    const style = getComputedStyle(activeTab)
    // Master行選択のコバルトブルー(#2563eb)をactiveタブ側では使わない(指示14章)。
    expect(style.backgroundColor.toLowerCase()).not.toContain('37, 99, 235')
  })
})

describe('EstimateMasterPicker: 選択中タブとMaster表の一体化 (UI視覚階層改善 追加修正第2ラウンド)', () => {
  it('gives the active tab a background distinct from (and stronger than) the unselected tabBg (指示5章/9章/25章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const activeTab = await screen.findByRole('tab', { name: BOX_TANDOKU.label })
    const inactiveTab = await screen.findByRole('tab', { name: NAIBU_PANEL.label })

    expect(activeTab.style.getPropertyValue('--cat-tab-active-bg')).toBe(BOX_TANDOKU.colors.tabActiveBg)
    expect(BOX_TANDOKU.colors.tabActiveBg).not.toBe(BOX_TANDOKU.colors.tabBg)
    // 各タブは自分自身のカテゴリ色のみを注入する(他タブの値と混ざらない)。
    expect(activeTab.style.getPropertyValue('--cat-tab-active-bg')).not.toBe(
      inactiveTab.style.getPropertyValue('--cat-tab-active-bg'),
    )
  })

  it('removes the bottom border on the active tab so it visually merges with the table below (指示3章/4章/7章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const activeTab = await screen.findByRole('tab', { name: BOX_TANDOKU.label })
    const style = getComputedStyle(activeTab)
    expect(style.borderBottomStyle === 'none' || style.borderBottomWidth === '0px').toBe(true)
  })

  it('keeps the active tab border colors tied to its own category (--cat-tab-border), not a fixed/shared color (指示7章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const activeTab = await screen.findByRole('tab', { name: BOX_TANDOKU.label })
    expect(activeTab.style.getPropertyValue('--cat-tab-border')).toBe(BOX_TANDOKU.colors.tabBorder)
  })

  it('lifts the active tab above the table boundary via position/z-index (not by adding padding/margin/height, 指示11章/12章/21章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const activeTab = await screen.findByRole('tab', { name: BOX_TANDOKU.label })
    const style = getComputedStyle(activeTab)
    expect(style.position).toBe('relative')
    expect(Number(style.zIndex)).toBeGreaterThan(0)
  })

  it('moves the --active class to the newly clicked tab and off the previous one immediately (指示17章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const boxTab = await screen.findByRole('tab', { name: BOX_TANDOKU.label })
    expect(boxTab.className).toContain('master-picker__tab--active')

    const naibuTab = await screen.findByRole('tab', { name: NAIBU_PANEL.label })
    fireEvent.click(naibuTab)

    expect(boxTab.className).not.toContain('master-picker__tab--active')
    expect(naibuTab.className).toContain('master-picker__tab--active')
  })

  it('does not change tab padding/font-size when a tab becomes active (指示12章/20章: 情報密度を変えない)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const activeTab = await screen.findByRole('tab', { name: BOX_TANDOKU.label })
    const inactiveTab = await screen.findByRole('tab', { name: NAIBU_PANEL.label })
    const activeStyle = getComputedStyle(activeTab)
    const inactiveStyle = getComputedStyle(inactiveTab)
    // active/inactiveどちらもbase(`.master-picker__tab`)のpadding/font-sizeを
    // 共有しており、`--active`修飾ルール側でこれらを一切上書きしていないことを確認する。
    expect(activeStyle.padding).toBe(inactiveStyle.padding)
    expect(activeStyle.fontSize).toBe(inactiveStyle.fontSize)
    expect(activeStyle.lineHeight).toBe(inactiveStyle.lineHeight)
  })
})

describe('EstimateMasterPicker: 選択カテゴリ色のtable header連動 (UI視覚階層改善 追加修正第3ラウンド)', () => {
  it('injects the active category presentation onto <thead>, matching the active tab (指示1章/2章/11章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const activeTab = await screen.findByRole('tab', { name: BOX_TANDOKU.label })
    await screen.findByText('11001')
    const thead = document.querySelector('.master-picker__table thead') as HTMLElement

    expect(thead.style.getPropertyValue('--cat-tab-bg')).toBe(
      activeTab.style.getPropertyValue('--cat-tab-bg'),
    )
    expect(thead.style.getPropertyValue('--cat-tab-bg')).toBe(BOX_TANDOKU.colors.tabBg)
    expect(thead.style.getPropertyValue('--cat-tab-fg')).toBe(BOX_TANDOKU.colors.tabFg)
    expect(thead.style.getPropertyValue('--cat-tab-border')).toBe(BOX_TANDOKU.colors.tabBorder)
  })

  it('switches the header presentation immediately when the category tab changes (指示9章/10章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    await screen.findByText('11001')
    const thead = document.querySelector('.master-picker__table thead') as HTMLElement
    expect(thead.style.getPropertyValue('--cat-tab-bg')).toBe(BOX_TANDOKU.colors.tabBg)

    fireEvent.click(await screen.findByRole('tab', { name: NAIBU_PANEL.label }))
    await screen.findByText('18001')

    expect(thead.style.getPropertyValue('--cat-tab-bg')).toBe(NAIBU_PANEL.colors.tabBg)
    expect(thead.style.getPropertyValue('--cat-tab-bg')).not.toBe(BOX_TANDOKU.colors.tabBg)
  })

  it('keeps the header presentation while searching within the current category (指示9章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    await screen.findByText('11001')
    const thead = document.querySelector('.master-picker__table thead') as HTMLElement
    const bgBeforeSearch = thead.style.getPropertyValue('--cat-tab-bg')

    fireEvent.change(screen.getByPlaceholderText('コード・型式で検索 (現在のタブ内)'), {
      target: { value: '11001' },
    })
    await screen.findByText('11001')

    expect(thead.style.getPropertyValue('--cat-tab-bg')).toBe(bgBeforeSearch)
  })

  it('does not apply the category presentation to data rows (tbody), only to the header (指示7章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const row = (await screen.findByText('11001')).closest('tr') as HTMLElement
    expect(row.style.getPropertyValue('--cat-tab-bg')).toBe('')
  })

  it('does not change header height/padding/font-size when the category presentation is applied (指示13章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const th = (await screen.findAllByRole('columnheader'))[0]
    const style = getComputedStyle(th)
    expect(style.padding).toBe('0.3rem 0.5rem')
    expect(style.fontSize).not.toBe('')
  })

  it('assigns every one of the 13 categories a header presentation reusing the already-unique tabBg (no duplicates, 指示18章)', () => {
    const tabBgs = MASTER_CATEGORY_PRESENTATION.map((p) => p.colors.tabBg)
    expect(new Set(tabBgs).size).toBe(13)
  })

  it('leaves selected-row cobalt styling and bbox/leader colors untouched by the header change (指示8章/12章)', async () => {
    render(<EstimateMasterPicker selectedItemId={2} onSelectItem={() => {}} />)
    const selectedRow = (await screen.findByText('11002')).closest('tr') as HTMLElement
    expect(getComputedStyle(selectedRow).boxShadow.toLowerCase()).toContain('#2563eb')
    // BBox/引出線が参照するbboxBorder等は今回も無変更。
    expect(BOX_TANDOKU.colors.bboxBorder).toBe('#2a73bb')
    expect(BOX_TANDOKU.colors.leaderTextColor).toBe('#184c81')
  })
})

describe('EstimateMasterPicker: 濃色+白抜きによる選択カテゴリ強調 (UI視覚階層改善 追加修正第4ラウンド)', () => {
  // 注記: jsdom(cssstyle)は`color`/`background-color`のようなプロパティに対する
  // `var(...)`の解決を確実には行わないため(box-shadowとは異なり、そのまま
  // 未評価の文字列を返すことがある)、実際に注入されたCSSカスタムプロパティの
  // 値そのものをアサーションする。値の対応関係(--cat-tab-active-fgがCSSの
  // `color`として、--cat-tab-active-bgが`background`として使われること)は
  // EstimateMasterPicker.cssのルール定義で担保し、実描画色は本文末尾の
  // 実ブラウザ確認(スクリーンショット・getComputedStyle実測)で検証している。
  it('injects white (#fff) as --cat-tab-active-fg on the active tab, matching tabActiveFg (指示2章/18章/19章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const activeTab = await screen.findByRole('tab', { name: BOX_TANDOKU.label })
    expect(activeTab.style.getPropertyValue('--cat-tab-active-fg')).toBe('#fff')
    expect(BOX_TANDOKU.colors.tabActiveFg).toBe('#fff')
  })

  it('carries a --cat-tab-active-bg distinct from --cat-tab-bg on every tab, so the active-state CSS rule renders a different (darker) color than the unselected rule (指示2章/5章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const activeTab = await screen.findByRole('tab', { name: BOX_TANDOKU.label })
    expect(activeTab.style.getPropertyValue('--cat-tab-active-bg')).toBe(BOX_TANDOKU.colors.tabActiveBg)
    expect(activeTab.style.getPropertyValue('--cat-tab-bg')).toBe(BOX_TANDOKU.colors.tabBg)
    expect(BOX_TANDOKU.colors.tabActiveBg).not.toBe(BOX_TANDOKU.colors.tabBg)
    // 未選択タブは base(`.master-picker__tab`)ルールにより`--cat-tab-bg`(淡色)
    // だけを参照する(`master-picker__tab--active`クラスを持たない、指示5章)。
    const inactiveTab = await screen.findByRole('tab', { name: NAIBU_PANEL.label })
    expect(inactiveTab.className).not.toContain('master-picker__tab--active')
  })

  it('injects the active category presentation (bg/fg) onto <thead>, for use by the header CSS rule (指示3章/9章/19章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    await screen.findByText('11001')
    const thead = document.querySelector('.master-picker__table thead') as HTMLElement
    expect(thead.style.getPropertyValue('--cat-tab-active-bg')).toBe(BOX_TANDOKU.colors.tabActiveBg)
    expect(thead.style.getPropertyValue('--cat-tab-active-fg')).toBe('#fff')
  })

  it('injects the same --cat-tab-active-bg/--cat-tab-active-fg onto <thead> as the active tab (header and tab form one color band, 指示3章/9章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const activeTab = await screen.findByRole('tab', { name: BOX_TANDOKU.label })
    await screen.findByText('11001')
    const thead = document.querySelector('.master-picker__table thead') as HTMLElement

    expect(thead.style.getPropertyValue('--cat-tab-active-bg')).toBe(
      activeTab.style.getPropertyValue('--cat-tab-active-bg'),
    )
    expect(thead.style.getPropertyValue('--cat-tab-active-fg')).toBe('#fff')
  })

  it('keeps data rows white, not the category color, even for the active category (指示11章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const row = (await screen.findByText('11001')).closest('tr') as HTMLElement
    const style = getComputedStyle(row)
    expect(style.backgroundColor === '' || style.backgroundColor === 'rgba(0, 0, 0, 0)').toBe(true)
  })

  it('does not dim or weaken the active tab on hover (selected > hover, 指示13章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const activeTab = await screen.findByRole('tab', { name: BOX_TANDOKU.label })
    expect(getComputedStyle(activeTab).filter).toBe('none')
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

describe('EstimateMasterPicker: 表セル境界の統一・ヘッダ左寄せ/数値セル右寄せ (Sekisan Navi 追加UI修正指示)', () => {
  it('left-aligns every column header, including the numeric price/工数 columns (5章: 既存仕様のまま左寄せを維持)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const headers = await screen.findAllByRole('columnheader')
    expect(headers).toHaveLength(10)
    for (const th of headers) {
      expect(getComputedStyle(th).textAlign).toBe('left')
    }
  })

  it('right-aligns numeric value cells (総合価格A/箱・部品価格/塗装価格/設A/板金/組立/検査), left-aligns code/model/rating (6章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const row = (await screen.findByText('11001')).closest('tr') as HTMLElement
    const cells = within(row).getAllByRole('cell')
    // コード, 型式, 定格, 総合価格A, 箱・部品価格, 塗装価格, 設A, 板金, 組立, 検査
    expect(getComputedStyle(cells[0]).textAlign).not.toBe('right') // コード
    expect(getComputedStyle(cells[1]).textAlign).not.toBe('right') // 型式
    expect(getComputedStyle(cells[2]).textAlign).not.toBe('right') // 定格
    for (const numericCell of cells.slice(3)) {
      expect(getComputedStyle(numericCell).textAlign).toBe('right')
    }
  })

  it('does not change header/cell padding (row/header height不変, 指示18章: 情報密度を変えない)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    await screen.findByText('11001')
    const th = screen.getAllByRole('columnheader')[0]
    const td = screen.getByRole('table').querySelector('td') as HTMLElement
    expect(getComputedStyle(th).padding).toBe('0.3rem 0.5rem')
    expect(getComputedStyle(td).padding).toBe('0.3rem 0.5rem')
  })

  it('leaves the selected-row cobalt accent unchanged after adding the cell grid (Master selected row style不変)', async () => {
    render(<EstimateMasterPicker selectedItemId={2} onSelectItem={() => {}} />)
    const selectedRow = (await screen.findByText('11002')).closest('tr') as HTMLElement
    const style = getComputedStyle(selectedRow)
    expect(style.boxShadow.toLowerCase()).toContain('#2563eb')
    expect(style.fontWeight).toBe('600')
  })

  it('keeps the sticky header positioning unaffected by the new cell border (17章)', async () => {
    render(<EstimateMasterPicker selectedItemId={null} onSelectItem={() => {}} />)
    const th = (await screen.findAllByRole('columnheader'))[0]
    expect(getComputedStyle(th).position).toBe('sticky')
  })

  // 注記: jsdom(cssstyle)はborder-right(var(...)使用)の解決を確実には行わないため
  // (本ファイル既存の397行目以降のコメント参照)、--border-cell/active header用の
  // rgba(255,255,255,0.18)の実際の描画は実ブラウザ確認で行う。
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
