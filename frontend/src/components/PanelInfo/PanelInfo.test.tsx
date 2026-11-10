import { render, screen, fireEvent, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { PanelInfo } from './PanelInfo'
import css from './PanelBoxCodeSelector.css?raw'
import { panelKey } from '../../utils/panel'
import type {
  BoxTypeAnalysis,
  EstimateMasterItem,
  EstimatePanelInfo,
  EstimateResult,
  Panel,
  PanelPreview,
  SteelOutline,
} from '../../types/domain'

function makeProductPanel(overrides: Partial<PanelPreview> = {}): PanelPreview {
  return {
    page_no: 16,
    ban_menno: 5,
    ban_no: 5,
    ban_meisyou: 'No.2-1低圧動力盤',
    ban_type: '正面図',
    ban_h1: 2100,
    ban_h2: null,
    ban_w: 1900,
    ban_d: 1200,
    normalized_rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
    ...overrides,
  }
}

function makeEstimatePanel(overrides: Partial<EstimatePanelInfo> = {}): EstimatePanelInfo {
  return {
    model: 'IS2',
    ban_menno: 5,
    ban_no: 5,
    ban_meisyou: 'No.2-1低圧動力盤',
    ban_h: 2300,
    ban_w: 1700,
    ban_d: 2200,
    ban_connect: '箱・左右(L)',
    sort_order: 1,
    box_type_analysis: null,
    ...overrides,
  }
}

const dummyPanel: Panel = {
  id: 1,
  panel_no: '1',
  name: '高圧受電盤',
  primary_drawing_page_id: 1,
  attributes: [
    { id: 1, key: 'W', label: '幅', value: '2120', unit: 'mm', source: 'design_data', display_order: 0 },
  ],
}

/** 盤名称のテキストから、その盤の行(button)を取得するテスト用ヘルパー。 */
function getRow(name: string): HTMLElement {
  return screen.getByText(name).closest('button') as HTMLElement
}

describe('PanelInfo (Issue #38 Phase 2: カラム型1行一覧への再設計)', () => {
  it('displays alphabetic panel numbers as identifiers without matching numeric estimate panels', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel({ ban_no: null, ban_no_label: 'L1' })]}
        estimatePanels={[makeEstimatePanel({ ban_menno: 5, ban_no: 1, ban_meisyou: '誤った数値盤' })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const row = getRow('No.2-1低圧動力盤')
    expect(within(row).getAllByRole('cell')[0].textContent).toBe('5/L1')
    expect(within(row).getAllByRole('cell')[1].textContent).toBe('No.2-1低圧動力盤')
    expect(screen.queryByText('誤った数値盤')).not.toBeInTheDocument()
  })

  it('shows a status message (and keeps the panel) when no panel info is available anywhere in the product', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[]}
        fallbackPanels={[]}
        estimatePanels={[]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByRole('heading', { name: '図面情報' })).toBeInTheDocument()
    expect(screen.getByText('盤情報を取得できません')).toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('shows a loading state instead of "unavailable" while the product data is being fetched', () => {
    render(
      <PanelInfo panel={null} panels={[]} panelsLoading estimatePanels={[]} selectedPanel={null} onSelectPanel={() => {}} />,
    )
    expect(screen.getByText('盤情報を取得中です')).toBeInTheDocument()
    expect(screen.queryByText('盤情報を取得できません')).not.toBeInTheDocument()
  })

  it('renders a header row with the 6 columns in order, kept visually fixed via position:sticky inside the scrollable list (Issue #40 追加修正: ヘッダを外に出す旧方式から、他の表と同じ sticky 方式へ変更。横スクロール時もヘッダと列が揃うようにするため)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const header = document.querySelector('.panel-info__row--header') as HTMLElement
    expect(header).not.toBeNull()
    const labels = within(header)
      .getAllByRole('columnheader')
      .map((el) => el.textContent)
    expect(labels).toEqual(['面/盤', '盤名称', '高さ', '幅', '奥行', '接続'])

    // ヘッダは今は`.panel-info__list-scroll`の内側にあり(横スクロールが
    // ヘッダ・データ行で同期するようにするため)、`position: sticky`で
    // 縦スクロール時のみ見た目上固定される(他の表のthead thと同じ方式)。
    const scrollArea = document.querySelector('.panel-info__list-scroll')
    expect(scrollArea?.contains(header)).toBe(true)
    expect(getComputedStyle(header).position).toBe('sticky')
  })

  it('always renders exactly 6 cells per row, showing "-" for missing values instead of omitting the cell (指示書8章: 列ズレ禁止)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        dimensionSourcePanels={[makeProductPanel()]}
        estimatePanels={[
          makeEstimatePanel({ model: null, ban_meisyou: null, ban_connect: null, ban_h: null, ban_w: null, ban_d: null }),
        ]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    // 盤名称はestcode_df側がnullのためproduct_df側('No.2-1低圧動力盤')へfallbackする。
    const row = getRow('No.2-1低圧動力盤')
    const cells = within(row).getAllByRole('cell')
    expect(cells).toHaveLength(6)
    // [追加機能: 箱体型式解析] 「型式」列は盤情報テーブルから削除済み。
    // 接続はestcode_df側の値が無く、product_dfにも対応fieldが無いため"-"。
    expect(cells[5].textContent).toBe('-') // 接続
    // 高さ/幅/奥行はestcode_dfがnullでもproduct_df側(ban_h1=2100, ban_w=1900, ban_d=1200)へ
    // fallbackするため"-"にはならない。
    expect(cells[2].textContent).toBe('2100') // 高さ (ban_h1のみ、ban_h2はnull)
    expect(cells[3].textContent).toBe('1900') // 幅
    expect(cells[4].textContent).toBe('1200') // 奥行
  })

  it('shows the matched estcode_df fields for a single panel across the 6 columns', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        dimensionSourcePanels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const row = getRow('No.2-1低圧動力盤')
    const cells = within(row).getAllByRole('cell')
    expect(cells[0].textContent).toBe('5/5') // 面/盤
    expect(cells[1].textContent).toBe('No.2-1低圧動力盤') // 盤名称
    // 高さ: product_df側 ban_h1=2100/ban_h2=null が優先されるため、
    // estcode_df側のban_h=2300は使われない (指示書3章の優先順位)。
    expect(cells[2].textContent).toBe('2100')
    // 幅/奥行: estcode_df側が優先 (指示書4章)。
    expect(cells[3].textContent).toBe('1700')
    expect(cells[4].textContent).toBe('2200')
    expect(cells[5].textContent).toBe('箱・左右(L)')
    // 見出しに件数が出る (指示書4章の表示例「盤情報 5件」に相当)。
    expect(document.querySelector('.panel-info__heading')?.textContent).toContain('図面情報　1件')
  })

  it('lists every distinct panel present on the current page, all at once (指示書3章: 複数盤をすべて確認できる)', () => {
    const panels = [
      makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '高圧受電盤' }),
      makeProductPanel({ ban_menno: 2, ban_no: 1, ban_meisyou: '低圧動力盤' }),
      makeProductPanel({ ban_menno: 3, ban_no: 1, ban_meisyou: '制御盤' }),
    ]
    const estimatePanels = [
      makeEstimatePanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '高圧受電盤' }),
      makeEstimatePanel({ ban_menno: 2, ban_no: 1, ban_meisyou: '低圧動力盤' }),
      makeEstimatePanel({ ban_menno: 3, ban_no: 1, ban_meisyou: '制御盤' }),
    ]
    render(
      <PanelInfo
        panel={null}
        panels={panels}
        estimatePanels={estimatePanels}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(document.querySelector('.panel-info__heading')?.textContent).toContain('図面情報　3件')
    expect(screen.getByText('高圧受電盤')).toBeInTheDocument()
    expect(screen.getByText('低圧動力盤')).toBeInTheDocument()
    expect(screen.getByText('制御盤')).toBeInTheDocument()
  })

  it('collapses multiple views (矢視) of the same panel (same ban_menno+ban_no) into a single row', () => {
    const panels = [
      makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '高圧受電盤', ban_type: '正面図' }),
      makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '高圧受電盤', ban_type: '背面図' }),
    ]
    render(
      <PanelInfo
        panel={null}
        panels={panels}
        estimatePanels={[makeEstimatePanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '高圧受電盤' })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(document.querySelector('.panel-info__heading')?.textContent).toContain('図面情報　1件')
    expect(screen.getAllByText('高圧受電盤')).toHaveLength(1)
  })

  it('never leaks the literal strings null/undefined/NaN when estcode_df fields are missing', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel({ ban_h1: null, ban_h2: null, ban_w: null, ban_d: null })]}
        estimatePanels={[
          makeEstimatePanel({ model: null, ban_meisyou: null, ban_connect: null, ban_h: null, ban_w: null, ban_d: null }),
        ]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.queryByText('null')).not.toBeInTheDocument()
    expect(screen.queryByText('undefined')).not.toBeInTheDocument()
    expect(screen.queryByText('NaN')).not.toBeInTheDocument()
  })

  it('falls back to the product_df name when estcode_df has no matching ban_meisyou, instead of showing "-" (実データ上より有用な情報を優先)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel({ ban_meisyou: 'No.2-1低圧動力盤' })]}
        estimatePanels={[makeEstimatePanel({ ban_meisyou: null })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByText('No.2-1低圧動力盤')).toBeInTheDocument()
  })

  it('shows whole numbers without a trailing ".0" even if the source value came from a float column (指示書9章)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel({ ban_menno: 5, ban_no: 5, ban_h1: 2300, ban_h2: null })]}
        estimatePanels={[makeEstimatePanel({ ban_h: 2300 })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.queryByText(/2300\.0/)).not.toBeInTheDocument()
    expect(screen.queryByText(/5\.0/)).not.toBeInTheDocument()
  })

  it('shows "-" for 接続 (and falls back for 幅/奥行) for a panel with no matching estcode_df row, without dropping the row itself (指示書10章)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        dimensionSourcePanels={[makeProductPanel()]}
        estimatePanels={[]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    // 行自体(盤名称)はproduct_df由来の値で表示され続ける。
    const row = getRow('No.2-1低圧動力盤')
    const cells = within(row).getAllByRole('cell')
    expect(cells[2].textContent).toBe('2100') // 高さ: product_df ban_h1へfallback
    expect(cells[3].textContent).toBe('1900') // 幅: product_dfへfallback
    expect(cells[4].textContent).toBe('1200') // 奥行: product_dfへfallback
    expect(cells[5].textContent).toBe('-') // 接続(estcode_df専用、fallback無し)
    // 「該当する積算盤情報がありません」という単一メッセージへの統合はしない(指示書10章)。
    expect(screen.queryByText('該当する積算盤情報がありません')).not.toBeInTheDocument()
  })

  it('marks the panel matching the current Viewer selection as selected, and no other row (指示書6章)', () => {
    const panels = [
      makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '高圧受電盤' }),
      makeProductPanel({ ban_menno: 2, ban_no: 1, ban_meisyou: '低圧動力盤' }),
    ]
    const selectedPanel = { key: panelKey(panels[0], 0), panel: panels[0] }
    render(
      <PanelInfo
        panel={null}
        panels={panels}
        estimatePanels={[]}
        selectedPanel={selectedPanel}
        onSelectPanel={() => {}}
      />,
    )
    const selectedRow = getRow('高圧受電盤')
    const otherRow = getRow('低圧動力盤')
    expect(selectedRow.className).toContain('panel-info__row--selected')
    expect(otherRow.className).not.toContain('panel-info__row--selected')
  })

  it('shows no row as selected when selectedPanel is null', () => {
    const panels = [makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '高圧受電盤' })]
    render(
      <PanelInfo
        panel={null}
        panels={panels}
        estimatePanels={[]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const row = getRow('高圧受電盤')
    expect(row.className).not.toContain('panel-info__row--selected')
  })

  it('calls onSelectPanel with the same key/panel a Viewer click would use, when a row is clicked (指示書1章: 既存クリック動作の再利用)', () => {
    const onSelectPanel = vi.fn()
    const panels = [makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '高圧受電盤' })]
    render(
      <PanelInfo
        panel={null}
        panels={panels}
        estimatePanels={[]}
        selectedPanel={null}
        onSelectPanel={onSelectPanel}
      />,
    )
    fireEvent.click(getRow('高圧受電盤'))
    expect(onSelectPanel).toHaveBeenCalledTimes(1)
    const [key, panel] = onSelectPanel.mock.calls[0]
    expect(key).toBe(panelKey(panels[0], 0))
    expect(panel).toBe(panels[0])
  })

  it('does not show the legacy product_df-only field (BAN_TYPE) as its own visible text (指示書13章: 二重表示回避)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel({ ban_type: '正面図' })]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.queryByText('正面図')).not.toBeInTheDocument()
  })

  it('falls back to the existing dummy Panel display when the current page has no product_df panels (回帰確認)', () => {
    render(
      <PanelInfo
        panel={dummyPanel}
        panels={[]}
        estimatePanels={[]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByText('1 / 高圧受電盤')).toBeInTheDocument()
    expect(screen.getByText('幅')).toBeInTheDocument()
    expect(screen.getByText('2120 mm')).toBeInTheDocument()
  })

  it('prioritizes the row list over the dummy Detection-linked panel when both are present (要件11相当)', () => {
    render(
      <PanelInfo
        panel={dummyPanel}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByText('No.2-1低圧動力盤')).toBeInTheDocument()
    expect(screen.queryByText('1 / 高圧受電盤')).not.toBeInTheDocument()
  })

  it('does not crash and gives the 盤名称/接続 cells a title attribute (ellipsis時の全文確認用)', () => {
    const longName = '高圧受電盤・低圧動力盤・制御盤・複合ユニット盤(予備含む延長型番)'
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel({ ban_meisyou: longName })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const nameCell = screen.getByText(longName)
    expect(nameCell).toHaveAttribute('title', longName)
    const row = nameCell.closest('button') as HTMLElement
    const connectCell = within(row).getAllByRole('cell')[5]
    expect(connectCell).toHaveAttribute('title', '箱・左右(L)')
  })

  it('does not show a leading label before the cell values (指示書5章の踏襲: ラベル:値の縦並びにしない)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    // 旧来の"面番号"/"接続情報"等のラベル文言は表示しない(見出し行の短い列名のみ)。
    expect(screen.queryByText('面番号')).not.toBeInTheDocument()
    expect(screen.queryByText('接続情報')).not.toBeInTheDocument()
    expect(screen.queryByText('並び順')).not.toBeInTheDocument()
  })

  it('reflects the selection state via aria-pressed on the row button', () => {
    const panels = [makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '高圧受電盤' })]
    const selectedPanel = { key: panelKey(panels[0], 0), panel: panels[0] }
    render(
      <PanelInfo
        panel={null}
        panels={panels}
        estimatePanels={[]}
        selectedPanel={selectedPanel}
        onSelectPanel={() => {}}
      />,
    )
    const row = getRow('高圧受電盤')
    expect(row.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('PanelInfo: 盤ごとの箱コード選定', () => {
  function boxResult(overrides: Partial<EstimateResult> = {}): EstimateResult {
    return {
      id: 71,
      product_no: 'A1GE4568',
      result_key: 'box:5:5',
      master_item_id: 10,
      code: '11010',
      quantity: 1,
      initial_quantity: 1,
      current_quantity: 1,
      quantity_overridden: false,
      quantity_override_reason: null,
      quantity_updated_at: null,
      quantity_updated_by: null,
      applicable_unit: 'unit',
      initial_factor: 1,
      current_factor: 1,
      factor_overridden: false,
      factor_override_reason: null,
      factor_updated_at: null,
      factor_updated_by: null,
      judgment_method: 'design_data',
      judgment_scope: 'panel',
      target_panel_ban_menno: 5,
      target_panel_ban_no: 5,
      target_drawing_page_id: null,
      judgment_reason: null,
      source_rule_id: null,
      unit_price: 1000,
      unit_labor: null,
      price: 1000,
      labor: null,
      status: 'auto',
      allowed_factors: null,
      evidence: [],
      box_category: '箱･左右',
      code_overridden: false,
      ...overrides,
    }
  }

  const boxItems: EstimateMasterItem[] = [
    {
      id: 10,
      code: '11010',
      category: '箱･左右',
      model: 'OS2-920',
      rating: '2.3*0.9*2.0',
      note: null,
      total_price_a: 1000,
      box_parts_price: null,
      painting_price: null,
      setup_a: null,
      sheet_metal_price: null,
      assembly_price: null,
      inspection_price: null,
    } as EstimateMasterItem,
    {
      id: 11,
      code: '11011',
      category: '箱･左右',
      model: 'OS2-1020',
      rating: '2.3*1.0*2.0',
      note: null,
      total_price_a: 1100,
      box_parts_price: null,
      painting_price: null,
      setup_a: null,
      sheet_metal_price: null,
      assembly_price: null,
      inspection_price: null,
    } as EstimateMasterItem,
  ]

  it('shows the box selector under its matching panel row and sends code changes to the override handler', () => {
    const onOverrideBoxCode = vi.fn()
    const result = boxResult()
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
        boxResults={[result]}
        masterItemById={new Map(boxItems.map((item) => [item.id, item]))}
        onOverrideBoxCode={onOverrideBoxCode}
      />,
    )

    const select = screen.getByRole('combobox', { name: '面5/盤5の箱コード' })
    expect(within(select).getAllByRole('option')).toHaveLength(2)
    fireEvent.change(select, { target: { value: '11' } })
    expect(onOverrideBoxCode).toHaveBeenCalledWith(result, 11)
    expect(screen.getByText('2300')).toBeInTheDocument() // 寸法行は編集欄と独立して残る
  })

  it('offers reset to automatic selection for a manually overridden panel', () => {
    const onResetBoxCode = vi.fn()
    const result = boxResult({ code_overridden: true, status: 'reviewed' })
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
        boxResults={[result]}
        masterItemById={new Map(boxItems.map((item) => [item.id, item]))}
        onResetBoxCode={onResetBoxCode}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '自動選定に戻す' }))
    expect(onResetBoxCode).toHaveBeenCalledWith(result)
  })
})

describe('PanelInfo: 盤ごとのまとまり(カード)と箱体情報の1行表示', () => {
  const items = [10, 11].map(
    (id) =>
      ({
        id,
        code: String(11000 + id),
        category: '箱･左右',
        model: 'OS2-920',
        rating: '2.3*0.9*2.0',
        note: null,
        total_price_a: 1000,
        box_parts_price: null,
        painting_price: null,
        setup_a: null,
        sheet_metal_price: null,
        assembly_price: null,
        inspection_price: null,
      }) as EstimateMasterItem,
  )
  function boxRow(menno: number, no: number, masterItemId: number): EstimateResult {
    return {
      id: menno * 10 + no,
      product_no: 'A1TEST',
      result_key: `box:${menno}:${no}`,
      master_item_id: masterItemId,
      code: String(11000 + masterItemId),
      quantity: 1,
      initial_quantity: 1,
      current_quantity: 1,
      quantity_overridden: false,
      quantity_override_reason: null,
      quantity_updated_at: null,
      quantity_updated_by: null,
      applicable_unit: 'unit',
      initial_factor: 1,
      current_factor: 1,
      factor_overridden: false,
      factor_override_reason: null,
      factor_updated_at: null,
      factor_updated_by: null,
      judgment_method: 'design_data',
      judgment_scope: 'panel',
      target_panel_ban_menno: menno,
      target_panel_ban_no: no,
      target_drawing_page_id: null,
      judgment_reason: null,
      source_rule_id: null,
      unit_price: 1000,
      unit_labor: null,
      price: 1000,
      labor: null,
      status: 'auto',
      allowed_factors: null,
      evidence: [],
      box_category: '箱･左右',
      code_overridden: false,
    }
  }
  function renderTwoPanels(onSelectPanel: () => void = () => {}, extra: Partial<ComponentProps<typeof PanelInfo>> = {}) {
    return render(
      <PanelInfo
        panel={null}
        panels={[
          makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: 'パネルA', ban_type: '正面図' }),
          makeProductPanel({ ban_menno: 1, ban_no: 2, ban_meisyou: 'パネルB', ban_type: '正面図' }),
          makeProductPanel({ ban_menno: 2, ban_no: 3, ban_meisyou: 'パネルC', ban_type: '正面図' }),
        ]}
        estimatePanels={[]}
        selectedPanel={null}
        onSelectPanel={onSelectPanel}
        boxResults={[boxRow(1, 1, 10), boxRow(1, 2, 11), boxRow(2, 3, 10)]}
        masterItemById={new Map(items.map((i) => [i.id, i]))}
        {...extra}
      />,
    )
  }
  const cards = () => [...document.querySelectorAll<HTMLElement>('.panel-info__panel-card')]

  it('groups each panel into its own card: header (面/盤・名称・寸法・接続) then box info, with no other panel inside', () => {
    renderTwoPanels()
    const list = cards()
    expect(list).toHaveLength(3)
    list.forEach((card, i) => {
      const header = card.querySelector('.panel-info__data-line')
      const box = card.querySelector('.panel-info__box-code')
      expect(header).not.toBeNull()
      expect(box).not.toBeNull()
      // 見出しの直後に箱体情報が続く。
      expect(header!.nextElementSibling).toBe(box)
      // 1枚のカードには見出し(盤の行)が1つだけ=隣の盤の情報を含まない。
      expect(card.querySelectorAll('.panel-info__data-row')).toHaveLength(1)
      expect(within(card).getAllByRole('combobox', { name: /の箱コード$/ })).toHaveLength(1)
      expect(card.textContent).toContain(['パネルA', 'パネルB', 'パネルC'][i])
    })
    // 銅帯欄は、その面の最初の盤のカード内(箱体情報の下)にだけある。
    expect(list[0].querySelector('[id="busbar-selector-face-1"]')).not.toBeNull()
    expect(list[1].querySelector('[id^="busbar-selector-face-"]')).toBeNull()
    expect(list[2].querySelector('[id="busbar-selector-face-2"]')).not.toBeNull()
    const box0 = list[0].querySelector('.panel-info__box-code')!
    expect(box0.nextElementSibling).toBe(list[0].querySelector('[id="busbar-selector-face-1"]'))
  })

  it('renders the box info as a single row of items: label, state, select, and reset only when overridden', () => {
    renderTwoPanels(() => {}, {
      boxResults: [{ ...boxRow(1, 1, 10), code_overridden: true, status: 'reviewed' }, boxRow(1, 2, 11), boxRow(2, 3, 10)],
    })
    const first = cards()[0].querySelector('.panel-info__box-code .estimate-box-code') as HTMLElement
    expect([...first.children].map((c) => c.tagName + '.' + c.className.split(' ')[0])).toEqual([
      'SPAN.estimate-box-code__label',
      'SPAN.estimate-box-code__state',
      'SELECT.estimate-box-code__select',
      'BUTTON.estimate-box-code__reset',
    ])
    const second = cards()[1].querySelector('.panel-info__box-code .estimate-box-code') as HTMLElement
    expect([...second.children].map((c) => c.tagName)).toEqual(['SPAN', 'SPAN', 'SELECT'])
  })

  it('uses nowrap/row styles so the box info never wraps (jsdom cannot lay out, so the CSS contract is checked)', () => {
    const box = css.match(/\.estimate-box-code \{[^}]*\}/)?.[0] ?? ''
    expect(box).toContain('flex-direction: row')
    expect(box).toContain('flex-wrap: nowrap')
    expect(box).toContain('white-space: nowrap')
    expect(box).not.toMatch(/flex-direction:\s*column/)
  })

  it('keeps panel selection, box code change, and reset wired per panel', () => {
    const onSelectPanel = vi.fn()
    const onOverrideBoxCode = vi.fn()
    const onResetBoxCode = vi.fn()
    const overridden = { ...boxRow(2, 3, 10), code_overridden: true, status: 'reviewed' as const }
    renderTwoPanels(onSelectPanel, { boxResults: [boxRow(1, 1, 10), boxRow(1, 2, 11), overridden], onOverrideBoxCode, onResetBoxCode })
    fireEvent.click(getRow('パネルB'))
    expect(onSelectPanel).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByRole('combobox', { name: '面1/盤2の箱コード' }), { target: { value: '10' } })
    expect(onOverrideBoxCode).toHaveBeenCalledWith(expect.objectContaining({ target_panel_ban_no: 2 }), 10)
    fireEvent.click(screen.getByRole('button', { name: '自動選定に戻す' }))
    expect(onResetBoxCode).toHaveBeenCalledWith(overridden)
    // 箱体情報を操作しても盤選択は走らない(上の1回だけ)。
    expect(onSelectPanel).toHaveBeenCalledTimes(1)
  })
})

describe('PanelInfo: 高さ表示の5分岐 (Issue #38 Phase 2 指示3章)', () => {
  function heightCellFor(panels: PanelPreview[], estimatePanels: EstimatePanelInfo[]): string {
    render(
      <PanelInfo
        panel={null}
        panels={panels}
        dimensionSourcePanels={panels}
        estimatePanels={estimatePanels}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const row = getRow(panels[0].ban_meisyou)
    return within(row).getAllByRole('cell')[2].textContent ?? ''
  }

  it('shows a single value when 正面/背面 are equal', () => {
    expect(
      heightCellFor([makeProductPanel({ ban_h1: 2300, ban_h2: 2300 })], [makeEstimatePanel()]),
    ).toBe('2300')
  })

  it('shows "正面 / 背面" when they differ', () => {
    expect(
      heightCellFor([makeProductPanel({ ban_h1: 2300, ban_h2: 2000 })], [makeEstimatePanel()]),
    ).toBe('2300 / 2000')
  })

  it('shows only the front value when the back value is missing', () => {
    expect(
      heightCellFor([makeProductPanel({ ban_h1: 2300, ban_h2: null })], [makeEstimatePanel()]),
    ).toBe('2300')
  })

  it('shows "- / <back>" (not the bare back value) when only the back value is present, to avoid misreading it as the front value', () => {
    expect(
      heightCellFor([makeProductPanel({ ban_h1: null, ban_h2: 2000 })], [makeEstimatePanel()]),
    ).toBe('- / 2000')
  })

  it('falls back to EstimatePanelInfo.ban_h when both product_df heights are missing', () => {
    expect(
      heightCellFor(
        [makeProductPanel({ ban_h1: null, ban_h2: null })],
        [makeEstimatePanel({ ban_h: 2450 })],
      ),
    ).toBe('2450')
  })

  it('shows "-" when both product_df heights and the estcode_df fallback are all missing', () => {
    expect(
      heightCellFor(
        [makeProductPanel({ ban_h1: null, ban_h2: null })],
        [makeEstimatePanel({ ban_h: null })],
      ),
    ).toBe('-')
  })
})

describe('PanelInfo: 幅/奥行のfallback (Issue #38 Phase 2 指示4章)', () => {
  it('prefers EstimatePanelInfo.ban_w/ban_d over PanelPreview.ban_w/ban_d when both are present', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel({ ban_w: 1900, ban_d: 1200 })]}
        estimatePanels={[makeEstimatePanel({ ban_w: 1700, ban_d: 2200 })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const row = getRow('No.2-1低圧動力盤')
    const cells = within(row).getAllByRole('cell')
    expect(cells[3].textContent).toBe('1700')
    expect(cells[4].textContent).toBe('2200')
  })

  it('falls back to the 外形図・正面図 row (product_df) ban_w/ban_d when EstimatePanelInfo values are missing', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel({ ban_w: 1900, ban_d: 1200 })]}
        dimensionSourcePanels={[makeProductPanel({ ban_w: 1900, ban_d: 1200 })]}
        estimatePanels={[makeEstimatePanel({ ban_w: null, ban_d: null })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const row = getRow('No.2-1低圧動力盤')
    const cells = within(row).getAllByRole('cell')
    expect(cells[3].textContent).toBe('1900')
    expect(cells[4].textContent).toBe('1200')
  })

  it('shows "-" when both sources are missing', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel({ ban_w: null, ban_d: null })]}
        estimatePanels={[makeEstimatePanel({ ban_w: null, ban_d: null })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const row = getRow('No.2-1低圧動力盤')
    const cells = within(row).getAllByRole('cell')
    expect(cells[3].textContent).toBe('-')
    expect(cells[4].textContent).toBe('-')
  })
})

describe('PanelInfo: レイアウト構造 (Issue #38 Phase 2: CSS Gridベースのカラム型1行一覧)', () => {
  it('makes each data row (button) a CSS Grid container carrying all 6 cells as direct children', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const row = getRow('No.2-1低圧動力盤')
    expect(row.className).toContain('panel-info__row')
    expect(row.className).toContain('panel-info__data-row')
    expect(within(row).getAllByRole('cell')).toHaveLength(6)
  })

  it('keeps the heading (件数) fixed outside the scrollable row list area', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const heading = screen.getByText(/図面情報.*1件/)
    const scrollArea = document.querySelector('.panel-info__list-scroll')
    expect(scrollArea).not.toBeNull()
    expect(scrollArea?.contains(heading)).toBe(false)
  })

  it('makes the row list area the internally scrolling part (overflow: auto on both axes, so wide content can scroll horizontally instead of being clipped/wrapped — Issue #40 追加修正), while the section itself fills 100% of its externally-controlled height', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const section = document.querySelector('.panel-info') as HTMLElement
    const scrollArea = document.querySelector('.panel-info__list-scroll') as HTMLElement
    expect(getComputedStyle(section).height).toBe('100%')
    expect(getComputedStyle(scrollArea).overflowY).toBe('auto')
    expect(getComputedStyle(scrollArea).overflowX).toBe('auto')
  })
})

describe('PanelInfo: 見出し (Issue #19 追加修正で折りたたみ機能は廃止、常に本文を表示する)', () => {
  it('always shows the row list (no collapse feature)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByText('No.2-1低圧動力盤')).toBeInTheDocument()
    expect(document.querySelector('.panel-info__heading')?.textContent).toContain('図面情報　1件')
    // 折りたたみ用のchevronトグルボタンは存在しない (見出しは<h2>のプレーンテキスト)。
    expect(screen.queryByRole('button', { name: /図面情報/ })).not.toBeInTheDocument()
  })
})

describe('PanelInfo: 箱体型式タブと鋼材欄 (追加機能)', () => {
  function makeBoxTypeAnalysis(overrides: Partial<BoxTypeAnalysis> = {}): BoxTypeAnalysis {
    return {
      raw: 'IS2',
      normalized: 'IS2',
      status: 'parsed',
      requires_review: false,
      primary: { group: 'primary', code: 'IS2', meaning: '標準アングルレス型' },
      aux_matches: [],
      segments: [['primary', 'IS2']],
      unparsed: [],
      box_category: 'A製品用・屋内キュービクル',
      product_category: 'A製品',
      environment: '屋内',
      usage: '標準',
      structure: '標準アングルレス型',
      material: null,
      coating: null,
      surface_treatment: null,
      base_finish: null,
      certification: null,
      ip55: false,
      processing_target: 'complete_box',
      custom_estimate_conditions: [],
      other_notes: [],
      notes: [],
      conflicts: [],
      warnings: [],
      alternatives: [],
      candidate_index: 0,
      ...overrides,
    }
  }

  it('does not render the 型式 column header any more (moved into the 箱体型式 tab)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.queryByRole('columnheader', { name: '型式' })).not.toBeInTheDocument()
  })

  it('renders 箱体型式 expanded by default, and no 鋼材 section when no steel prop is given', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /箱体型式/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: /鋼材/ })).not.toBeInTheDocument()
    expect(screen.queryByText('仕様検討中')).not.toBeInTheDocument()
  })

  it('[2026-10 追加修正: 回帰確認] renders a bare "IS2" (no aux symbols) as parsed, never showing the "解析できませんでした" failure message', () => {
    // makeBoxTypeAnalysis()の既定値そのもの(補助記号無しのIS2単独、
    // status="parsed")を使う。画面で「この型式は解析できませんでした」と
    // 誤表示される不具合の再発防止。
    const analysis = makeBoxTypeAnalysis()
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel({ model: 'IS2', box_type_analysis: analysis })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.queryByText('この型式は解析できませんでした')).not.toBeInTheDocument()
    expect(screen.getByText('解析済み')).toBeInTheDocument()
    expect(screen.getAllByText('IS2').length).toBeGreaterThan(0)
    expect(screen.getByText('A製品用・屋内キュービクル')).toBeInTheDocument()
  })

  it('[2026-10 追加修正: 回帰確認] renders correctly from a payload shaped exactly like the real Backend API response for "IS2"', () => {
    // `GET /api/products/{product}/estimate-panels`の実レスポンス(curlで取得した
    // 実データそのもの)をそのまま貼り付けたfixture。型・キー名の不一致による
    // 表示崩れを、作り込んだテスト用オブジェクトではなく実レスポンス形状で検出する。
    const realApiAnalysis: BoxTypeAnalysis = {
      raw: 'IS2',
      normalized: 'IS2',
      status: 'parsed',
      requires_review: false,
      primary: { group: 'primary', code: 'IS2', meaning: '標準アングルレス型' },
      aux_matches: [],
      segments: [['primary', 'IS2']],
      unparsed: [],
      box_category: 'A製品用・屋内キュービクル',
      product_category: 'A製品',
      environment: '屋内',
      usage: '標準',
      structure: '標準アングルレス型',
      material: null,
      coating: null,
      surface_treatment: null,
      base_finish: null,
      certification: null,
      ip55: false,
      processing_target: 'complete_box',
      custom_estimate_conditions: [],
      other_notes: [],
      notes: [],
      conflicts: [],
      warnings: [],
      alternatives: [],
      candidate_index: 0,
    }
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel({ model: 'IS2', box_type_analysis: realApiAnalysis })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.queryByText('この型式は解析できませんでした')).not.toBeInTheDocument()
    expect(screen.getByText('解析済み')).toBeInTheDocument()
  })

  it('shows the box type symbol, its meaning per line, and the 積算情報表 when the 箱体型式 tab is expanded', () => {
    const analysis = makeBoxTypeAnalysis({
      aux_matches: [{ group: 'aux1', code: 'GT', meaning: '厚膜塗装（3コート・外面100μm以上）' }],
      coating: '厚膜塗装(3コート・外面100μm以上)',
    })
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel({ model: 'IS2GT', box_type_analysis: analysis })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByText('箱体型式：')).toBeInTheDocument()
    expect(screen.getByText('IS2GT')).toBeInTheDocument()
    // 「標準アングルレス型」は記号の意味欄・積算情報表(箱体構造)の両方に
    // 表示されるため、件数ではなく存在のみを確認する。
    expect(screen.getAllByText('標準アングルレス型').length).toBeGreaterThan(0)
    expect(screen.getByText('厚膜塗装（3コート・外面100μm以上）')).toBeInTheDocument()
    expect(screen.getByText('積算に使用できる情報')).toBeInTheDocument()
    expect(screen.getByText('箱体構造')).toBeInTheDocument()
    expect(screen.getByText('設置環境')).toBeInTheDocument()
  })

  it('marks conflicting fields as 要確認 instead of silently picking one symbol over another', () => {
    const analysis = makeBoxTypeAnalysis({
      status: 'conflict',
      requires_review: true,
      aux_matches: [
        { group: 'aux1', code: 'SU', meaning: 'SUS304の上に塗装仕上' },
        { group: 'aux1', code: 'HL', meaning: 'SUS304・ヘアライン仕上' },
      ],
      material: 'SUS304',
      conflicts: [{ field: 'finish', values: [['SU', '仕上条件が競合'], ['HL', '仕上条件が競合']] }],
      warnings: ['SUとHLは仕上条件(塗装仕上／ヘアライン仕上)が競合しています。要確認。'],
    })
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel({ model: 'IS2SUHL', box_type_analysis: analysis })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getAllByText('要確認(競合)').length).toBeGreaterThan(0)
    expect(screen.getByText(/SUとHLは仕上条件/)).toBeInTheDocument()
  })

  it('shows unparsed characters as a warning, never silently dropping them', () => {
    const analysis = makeBoxTypeAnalysis({
      status: 'partial',
      requires_review: true,
      unparsed: ['Q'],
      warnings: ['未解析の文字があります: Q'],
    })
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel({ model: 'IS2Q', box_type_analysis: analysis })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByText(/未解析の文字列: Q/)).toBeInTheDocument()
  })

  it('shows a placeholder message when there is no model to analyze', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel({ model: null, box_type_analysis: null })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByText('このページには箱体型式の情報がありません')).toBeInTheDocument()
  })

  it('renders exactly one 鋼材 section (the real SteelSection, never a placeholder) and toggles it independently of the 箱体型式 tab', () => {
    const steel: SteelOutline = {
      status: 'ok',
      source_page: '5',
      source_drawing_name: '外形図(2)',
      items: [
        { symbol_name: 'BSP-STEELA-H', cabtype: 'IS2', component_name: '基礎ベース', material_spec: 'TEST-MAT-A 10x20' },
      ],
    }
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel({ model: 'IS2', box_type_analysis: makeBoxTypeAnalysis() })]}
        steel={steel}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    // 鋼材のトグルは1つだけ(二重に描画されない)。
    expect(screen.getAllByRole('button', { name: /鋼材/ })).toHaveLength(1)
    expect(screen.getAllByLabelText('鋼材')).toHaveLength(1)

    // 参照画面では箱体型式・鋼材を初期表示で展開する。
    expect(screen.getByRole('button', { name: /箱体型式/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /鋼材/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('基礎ベース')).toBeInTheDocument()
    expect(screen.queryByText('仕様検討中')).not.toBeInTheDocument()

    // 鋼材を閉じても箱体型式は開いたまま。
    fireEvent.click(screen.getByRole('button', { name: /鋼材/ }))
    expect(screen.getByRole('button', { name: /鋼材/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /箱体型式/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('uses the Viewer-selected panel (not just the first row) for the 箱体型式 tab', () => {
    const panels = [
      makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '高圧受電盤' }),
      makeProductPanel({ ban_menno: 2, ban_no: 1, ban_meisyou: '低圧動力盤' }),
    ]
    const estimatePanels = [
      makeEstimatePanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '高圧受電盤', model: 'OS2' }),
      makeEstimatePanel({ ban_menno: 2, ban_no: 1, ban_meisyou: '低圧動力盤', model: 'IS2' }),
    ]
    const selectedPanel = { key: panelKey(panels[1], 1), panel: panels[1] }
    render(
      <PanelInfo
        panel={null}
        panels={panels}
        estimatePanels={estimatePanels}
        selectedPanel={selectedPanel}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByText('IS2')).toBeInTheDocument()
    expect(screen.queryByText('OS2')).not.toBeInTheDocument()
  })

  it('keeps displaying product-level box-type data when the selected drawing has no model information', () => {
    const panels = [
      makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '外形図の盤' }),
      makeProductPanel({ ban_menno: 2, ban_no: 1, ban_meisyou: '選択中の別図面' }),
    ]
    const estimatePanels = [
      makeEstimatePanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '外形図の盤', model: 'OS2', box_type_analysis: makeBoxTypeAnalysis() }),
      makeEstimatePanel({ ban_menno: 2, ban_no: 1, ban_meisyou: '選択中の別図面', model: null, box_type_analysis: null }),
    ]
    render(
      <PanelInfo
        panel={null}
        panels={panels}
        estimatePanels={estimatePanels}
        selectedPanel={{ key: panelKey(panels[1], 1), panel: panels[1] }}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByText('OS2')).toBeInTheDocument()
    expect(screen.getByText('解析済み')).toBeInTheDocument()
  })

  it('prefers the selected panel\'s own model information (even without an analysis) over other panels\' information', () => {
    const panels = [
      makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '他の盤' }),
      makeProductPanel({ ban_menno: 2, ban_no: 1, ban_meisyou: '選択中の盤' }),
    ]
    const estimatePanels = [
      makeEstimatePanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '他の盤', model: 'OS2', box_type_analysis: makeBoxTypeAnalysis() }),
      makeEstimatePanel({ ban_menno: 2, ban_no: 1, ban_meisyou: '選択中の盤', model: 'IS2K', box_type_analysis: null }),
    ]
    render(
      <PanelInfo
        panel={null}
        panels={panels}
        estimatePanels={estimatePanels}
        selectedPanel={{ key: panelKey(panels[1], 1), panel: panels[1] }}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getAllByText('IS2K').length).toBeGreaterThan(0)
    expect(screen.queryByText('解析済み')).not.toBeInTheDocument()
  })

  it('places 箱体型式 and 鋼材 side by side above the panel list', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel({ model: 'IS2', box_type_analysis: makeBoxTypeAnalysis() })]}
        steel={{
          status: 'ok',
          source_page: '5',
          source_drawing_name: '外形図(2)',
          items: [{ symbol_name: 'BSP-STEELA-H', cabtype: 'IS2', component_name: '基礎ベース', material_spec: 'TEST-MAT-A 10x20' }],
        }}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const summaryGrid = document.querySelector('.panel-info__summary-grid') as HTMLElement
    expect(summaryGrid).not.toHaveClass('panel-info__summary-grid--single') // 鋼材データがあるときだけ2列
    const listScroll = document.querySelector('.panel-info__list-scroll') as HTMLElement
    expect(summaryGrid.children[0]).toHaveClass('panel-info__summary-card')
    expect(summaryGrid.children[1]).toHaveClass('steel-section')
    expect(summaryGrid.compareDocumentPosition(listScroll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: /箱体型式/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /鋼材/ })).toHaveAttribute('aria-expanded', 'true')
    expect(listScroll.className).not.toContain('panel-info__list-scroll--compact')
  })

  it('lets 箱体型式 and 鋼材 grow to their full content height: no max-height and no internal scrollbar on either card (the outer panel body scrolls instead)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel({ model: 'IS2', box_type_analysis: makeBoxTypeAnalysis() })]}
        steel={{
          status: 'ok',
          source_page: '5',
          source_drawing_name: '外形図(2)',
          items: Array.from({ length: 40 }, (_, i) => ({
            symbol_name: 'S',
            cabtype: 'IS2',
            component_name: `部品${i}`,
            material_spec: 'TEST-MAT',
          })),
        }}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const cards = document.querySelectorAll<HTMLElement>('.panel-info__summary-card')
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      const style = getComputedStyle(card)
      expect(style.maxHeight).toBe('none')
      expect(['visible', '']).toContain(style.overflowY)
    }
    for (const sel of ['.steel-section__body', '.box-type-detail', '.box-type-detail__table-scroll']) {
      const el = document.querySelector<HTMLElement>(sel)
      if (el) expect(getComputedStyle(el).overflowY).toBe('visible')
    }
    expect(screen.getAllByTestId('steel-group').length).toBeGreaterThan(0)
    expect(screen.getByText('部品39')).toBeInTheDocument() // 全行が DOM にあり、隠されない
  })

  describe('箱体型式と鋼材の開閉は互いに独立', () => {
    function renderBoth() {
      return render(
        <PanelInfo
          panel={null}
          panels={[makeProductPanel()]}
          estimatePanels={[makeEstimatePanel({ model: 'IS2', box_type_analysis: makeBoxTypeAnalysis() })]}
          steel={{
            status: 'ok',
            source_page: '5',
            source_drawing_name: '外形図(2)',
            items: Array.from({ length: 12 }, (_, i) => ({ symbol_name: 'S', cabtype: 'IS2', component_name: `部品${i}`, material_spec: 'TEST-MAT' })),
          }}
          selectedPanel={null}
          onSelectPanel={() => {}}
        />,
      )
    }
    const box = () => screen.getByRole('button', { name: /箱体型式/ })
    const steel = () => screen.getByRole('button', { name: /鋼材/ })
    const state = () => [box().getAttribute('aria-expanded'), steel().getAttribute('aria-expanded')]

    it('starts with both open (current behaviour) and shows all rows', () => {
      renderBoth()
      expect(state()).toEqual(['true', 'true'])
      expect(screen.getByText('部品11')).toBeInTheDocument()
      expect(document.querySelector('.box-type-detail__symbol')).not.toBeNull()
    })

    it('can fold both at the same time', () => {
      renderBoth()
      fireEvent.click(box())
      fireEvent.click(steel())
      expect(state()).toEqual(['false', 'false'])
      expect(screen.queryByText('部品11')).not.toBeInTheDocument()
      expect(document.querySelector('.box-type-detail__symbol')).toBeNull()
    })

    it('keeps only 箱体型式 open / only 鋼材 open, and toggling one never changes the other', () => {
      renderBoth()
      fireEvent.click(steel()) // 箱体型式だけ開
      expect(state()).toEqual(['true', 'false'])
      expect(document.querySelector('.box-type-detail__symbol')).not.toBeNull()
      expect(screen.queryByText('部品0')).not.toBeInTheDocument()
      fireEvent.click(box()) // 両方閉
      expect(state()).toEqual(['false', 'false'])
      fireEvent.click(steel()) // 鋼材だけ開
      expect(state()).toEqual(['false', 'true'])
      expect(screen.getByText('部品11')).toBeInTheDocument()
      expect(document.querySelector('.box-type-detail__symbol')).toBeNull()
      fireEvent.click(steel()) // 鋼材を閉じても箱体型式(閉)は変わらない
      expect(state()).toEqual(['false', 'false'])
      fireEvent.click(box())
      expect(state()).toEqual(['true', 'false'])
    })

    it('keeps the cards without max-height / internal scroll when reopened, and the folded card is not stretched', () => {
      renderBoth()
      fireEvent.click(box())
      fireEvent.click(box())
      for (const card of document.querySelectorAll<HTMLElement>('.panel-info__summary-card')) {
        expect(getComputedStyle(card).maxHeight).toBe('none')
        expect(['visible', '']).toContain(getComputedStyle(card).overflowY)
      }
    })
  })

  it.each([
    ['外形図なし', { status: 'no_outline', source_page: null, source_drawing_name: null, items: [] } as SteelOutline],
    ['読み込み失敗', { status: 'invalid', source_page: null, source_drawing_name: null, items: [] } as SteelOutline],
    ['取得できない', { status: 'unavailable', source_page: null, source_drawing_name: null, items: [] } as SteelOutline],
  ])('stacks the two cards in one full-width column instead of leaving a half-width column holding one line when 鋼材 has no data (%s)', (_label, steel) => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel({ model: 'IS2', box_type_analysis: makeBoxTypeAnalysis() })]}
        steel={steel}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(document.querySelector('.panel-info__summary-grid')).toHaveClass('panel-info__summary-grid--single')
    expect(screen.getByLabelText('鋼材')).toBeInTheDocument() // 欄(固定の理由文)は残す
  })

  it('does not render the 材料情報 section any more, while keeping the 鋼材 column', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel({ model: 'IS2', box_type_analysis: makeBoxTypeAnalysis() })]}
        steel={{
          status: 'ok',
          source_page: '5',
          source_drawing_name: '外形図(2)',
          items: [{ symbol_name: 'S', cabtype: 'IS2', component_name: '基礎ベース', material_spec: 'TEST-MAT-A 10x20' }],
        }}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /材料情報/ })).not.toBeInTheDocument()
    expect(document.querySelector('.panel-info__materials-disclosure')).toBeNull()
    expect(screen.getByRole('button', { name: /鋼材/ })).toBeInTheDocument()
  })
})

// 主回路銅帯の選択(4段階)。面(ban_menno)ごとに 1 つ、その面の代表行に配置し、面ごとに独立した複数行を持つ。
describe('PanelInfo: 主回路銅帯の選択欄は1面(ban_menno)につき1つ・面ごとに独立', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  function renderThreePanels(
    onSelectPanel: () => void = () => {},
    productNo?: string,
    addRows = true,
  ) {
    const result = render(
      <PanelInfo
        panel={null}
        panels={[
          makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: 'パネルA', ban_type: '正面図' }),
          makeProductPanel({ ban_menno: 1, ban_no: 2, ban_meisyou: 'パネルB', ban_type: '正面図' }),
          makeProductPanel({ ban_menno: 2, ban_no: 3, ban_meisyou: 'パネルC', ban_type: '正面図' }),
        ]}
        estimatePanels={[]}
        productNo={productNo}
        selectedPanel={null}
        onSelectPanel={onSelectPanel}
      />,
    )
    // 既存の選択・編集テストは、利用者が＋を押した状態から始める。
    if (addRows) {
      if (!screen.queryByRole('combobox', { name: '面1 銅帯1 仕様' })) {
        if (screen.queryByRole('button', { name: '面1の銅帯設定を開く' })) {
          fireEvent.click(screen.getByRole('button', { name: '面1の銅帯設定を開く' }))
        }
        fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
      }
      if (!screen.queryByRole('combobox', { name: '面2 銅帯1 仕様' })) {
        if (screen.queryByRole('button', { name: '面2の銅帯設定を開く' })) {
          fireEvent.click(screen.getByRole('button', { name: '面2の銅帯設定を開く' }))
        }
        fireEvent.click(screen.getByRole('button', { name: '面2に銅帯の選択行を追加' }))
      }
    }
    return result
  }

  const getRow = (name: string) => screen.getByText(name).closest('button') as HTMLElement
  const pick = (label: string, value: string) =>
    fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value } })
  const selectFace1 = (row: string) => {
    pick(`面1 銅帯${row} 仕様`, '標準仕様')
    pick(`面1 銅帯${row} 相数`, '3Φ')
    pick(`面1 銅帯${row} 電圧区分`, '200V級')
    pick(`面1 銅帯${row} 容量（kVA）`, '100')
  }

  it('starts unregistered faces folded with no input rows, then shows the first row only after plus is pressed', () => {
    renderThreePanels(() => {}, undefined, false)

    for (const face of ['1', '2']) {
      expect(screen.getByRole('button', { name: `面${face}の銅帯設定を開く` })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('region', { name: `面${face} 主回路銅帯` })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: `面${face}に銅帯の選択行を追加` })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(document.querySelectorAll('.busbar-selector__row')).toHaveLength(0)

    // 行末の開閉ボタンで欄全体が開き、ここで初めて見出しと＋が現れる。
    fireEvent.click(screen.getByRole('button', { name: '面1の銅帯設定を開く' }))
    expect(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' })).toBeVisible()
    expect(screen.queryByRole('combobox', { name: '面1 銅帯1 仕様' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
    expect(screen.getByRole('button', { name: '面1の銅帯設定を閉じる' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('combobox', { name: '面1 銅帯1 仕様' })).toBeVisible()
    expect(screen.getByRole('button', { name: '面2の銅帯設定を開く' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('combobox', { name: '面2 銅帯1 仕様' })).not.toBeInTheDocument()
    expect(getRow('パネルA')).toBeVisible()
  })

  it('shows exactly one selector per distinct ban_menno, on the representative (first) row only', () => {
    renderThreePanels()
    expect(screen.getByText('パネルA')).toBeInTheDocument()
    expect(screen.getByText('パネルB')).toBeInTheDocument()
    expect(screen.getByText('パネルC')).toBeInTheDocument()
    expect(screen.getAllByRole('region', { name: /主回路銅帯/ })).toHaveLength(2)
    const rowA = screen.getByText('パネルA').closest('li') as HTMLElement
    const rowB = screen.getByText('パネルB').closest('li') as HTMLElement
    const rowC = screen.getByText('パネルC').closest('li') as HTMLElement
    expect(rowA.querySelector('.busbar-selector')).not.toBeNull()
    expect(rowB.querySelector('.busbar-selector')).toBeNull()
    expect(rowC.querySelector('.busbar-selector')).not.toBeNull()
  })

  it('puts an independent open/close control at each face row end and preserves selections while folded', () => {
    renderThreePanels()
    const face1Toggle = screen.getByRole('button', { name: '面1の銅帯設定を閉じる' })
    const face2Toggle = screen.getByRole('button', { name: '面2の銅帯設定を閉じる' })
    expect(face1Toggle.closest('.panel-info__data-line')).not.toBeNull()
    expect(face1Toggle.closest('.panel-info__data-row')).toBeNull()
    expect(face1Toggle).toHaveAttribute('aria-expanded', 'true')
    expect(face2Toggle).toHaveAttribute('aria-expanded', 'true')

    pick('面1 銅帯1 仕様', '標準仕様')
    fireEvent.click(face1Toggle)
    expect(screen.queryByRole('region', { name: '面1 主回路銅帯' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '面2 主回路銅帯' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '面1の銅帯設定を開く' })).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(screen.getByRole('button', { name: '面1の銅帯設定を開く' }))
    expect((screen.getByRole('combobox', { name: '面1 銅帯1 仕様' }) as HTMLSelectElement).value).toBe('標準仕様')
  })

  it('keeps every panel dimension row visible when a face is folded; only the folded face busbar section hides, and the caret turns left', () => {
    renderThreePanels()
    const face1Toggle = screen.getByRole('button', { name: '面1の銅帯設定を閉じる' })
    const face2Toggle = screen.getByRole('button', { name: '面2の銅帯設定を閉じる' })
    expect(face1Toggle).toHaveTextContent('▾')
    expect(face2Toggle).toHaveTextContent('▾')

    fireEvent.click(face1Toggle)

    // 折りたたんだ面の記号だけ左向き(◂)になり、右向き(▸)は使われない。
    const folded = screen.getByRole('button', { name: '面1の銅帯設定を開く' })
    expect(folded).toHaveTextContent('◂')
    expect(folded).not.toHaveTextContent('▸')
    expect(screen.getByRole('button', { name: '面2の銅帯設定を閉じる' })).toHaveTextContent('▾')

    // 盤寸法の行(面/盤・盤名称・高さ・幅・奥行・接続の6セル)は、折りたたんだ面の
    // 代表行・同じ面の他の盤・他の面のいずれも表示されたまま。
    for (const name of ['パネルA', 'パネルB', 'パネルC']) {
      const row = getRow(name)
      expect(row).toBeVisible()
      expect(within(row).getAllByRole('cell')).toHaveLength(6)
    }
    // 隠れるのは面1の銅帯設定欄だけ。面2の設定欄・入力値は影響を受けない。
    expect(screen.queryByRole('region', { name: '面1 主回路銅帯' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '面2 主回路銅帯' })).toBeVisible()

    // 展開すると面1の設定欄が戻り、記号は▾に戻る。
    fireEvent.click(folded)
    expect(screen.getByRole('region', { name: '面1 主回路銅帯' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '面1の銅帯設定を閉じる' })).toHaveTextContent('▾')
  })

  it('starts with all four items unselected and no code shown', () => {
    renderThreePanels()
    for (const label of ['仕様', '相数', '電圧区分', '容量（kVA）']) {
      expect((screen.getByRole('combobox', { name: `面1 銅帯1 ${label}` }) as HTMLSelectElement).value).toBe('')
    }
    expect(document.querySelector('.busbar-selector__code')).toBeNull()
  })

  it('does not persist a blank row, but persists selected code and factor changes', () => {
    const onBusbarRowsChange = vi.fn()
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: 'パネルA', ban_type: '正面図' })]}
        estimatePanels={[]}
        productNo="A1BUSBAR001"
        selectedPanel={null}
        onSelectPanel={() => {}}
        onBusbarRowsChange={onBusbarRowsChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '面1の銅帯設定を開く' }))
    fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
    expect(onBusbarRowsChange).not.toHaveBeenCalled()

    selectFace1('1')
    expect(onBusbarRowsChange).toHaveBeenCalledTimes(1)
    expect(onBusbarRowsChange.mock.lastCall?.[2]).toEqual(
      expect.arrayContaining([expect.objectContaining({ factor: 1 })]),
    )

    fireEvent.change(screen.getByRole('combobox', { name: '面1 銅帯1 係数' }), { target: { value: '0.8' } })
    expect(onBusbarRowsChange).toHaveBeenCalledTimes(2)
    expect(onBusbarRowsChange.mock.lastCall?.[2]).toEqual(
      expect.arrayContaining([expect.objectContaining({ factor: 0.8 })]),
    )

    fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
    expect(onBusbarRowsChange).toHaveBeenCalledTimes(2)
  })

  it('keeps the cell structure (6 cells per row) and does not select the panel when the selector is operated', () => {
    const onSelectPanel = vi.fn()
    renderThreePanels(onSelectPanel)
    for (const name of ['パネルA', 'パネルB', 'パネルC']) {
      expect(within(getRow(name)).getAllByRole('cell')).toHaveLength(6)
    }
    selectFace1('1')
    fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
    expect(onSelectPanel).not.toHaveBeenCalled()
  })

  it('shows the unique code (44815) when four items are chosen and does not affect face 2; panel selection keeps the choice', () => {
    const onSelectPanel = vi.fn()
    renderThreePanels(onSelectPanel)
    selectFace1('1')
    const codes = () => [...document.querySelectorAll('.busbar-selector__code')].map((e) => e.textContent)
    expect(codes()).toEqual(['44815'])
    expect(document.querySelector('.busbar-selector__summary')?.textContent).toContain('標準仕様 (307A)')
    // 面2は未選択のまま。
    expect((screen.getByRole('combobox', { name: '面2 銅帯1 仕様' }) as HTMLSelectElement).value).toBe('')
    fireEvent.click(getRow('パネルB'))
    expect(onSelectPanel).toHaveBeenCalledTimes(1)
    expect(codes()).toEqual(['44815'])
  })

  it('adds a row to a face (initially unselected) and removes it individually without touching other rows or faces', () => {
    renderThreePanels()
    selectFace1('1')
    pick('面2 銅帯1 仕様', '公共建築')
    fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
    expect((screen.getByRole('combobox', { name: '面1 銅帯2 仕様' }) as HTMLSelectElement).value).toBe('')
    expect(screen.getByRole('button', { name: '面2 銅帯1を削除' })).toBeInTheDocument() // 唯一の行も削除できる
    // 追加行を選択してから、1行目を削除しても 2 行目は残る。
    pick('面1 銅帯2 仕様', '公共建築')
    fireEvent.click(screen.getByRole('button', { name: '面1 銅帯1を削除' }))
    expect(screen.queryByRole('combobox', { name: '面1 銅帯2 仕様' })).not.toBeInTheDocument()
    expect((screen.getByRole('combobox', { name: '面1 銅帯1 仕様' }) as HTMLSelectElement).value).toBe('公共建築')
    expect((screen.getByRole('combobox', { name: '面2 銅帯1 仕様' }) as HTMLSelectElement).value).toBe('公共建築')
  })

  it('deletes the only row of a face: notifies the parent with no rows, keeps the face open for re-adding, leaves other faces alone, and stays empty after reload', () => {
    const onBusbarRowsChange = vi.fn()
    const render3 = (productNo = 'A1DEL001') =>
      render(
        <PanelInfo
          panel={null}
          panels={[
            makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: 'パネルA', ban_type: '正面図' }),
            makeProductPanel({ ban_menno: 2, ban_no: 3, ban_meisyou: 'パネルC', ban_type: '正面図' }),
          ]}
          estimatePanels={[]}
          productNo={productNo}
          selectedPanel={null}
          onSelectPanel={() => {}}
          onBusbarRowsChange={onBusbarRowsChange}
        />,
      )
    const first = render3()
    for (const face of ['1', '2']) {
      fireEvent.click(screen.getByRole('button', { name: `面${face}の銅帯設定を開く` }))
      fireEvent.click(screen.getByRole('button', { name: `面${face}に銅帯の選択行を追加` }))
    }
    // 面1・面2とも、4項目を選んで確定させる。
    for (const face of ['1', '2']) {
      pick(`面${face} 銅帯1 仕様`, '標準仕様')
      pick(`面${face} 銅帯1 相数`, '3Φ')
      pick(`面${face} 銅帯1 電圧区分`, '200V級')
      pick(`面${face} 銅帯1 容量（kVA）`, '100')
    }
    onBusbarRowsChange.mockClear()

    // 面1の唯一の行を削除。
    fireEvent.click(screen.getByRole('button', { name: '面1 銅帯1を削除' }))
    expect(onBusbarRowsChange).toHaveBeenCalledTimes(1)
    expect(onBusbarRowsChange).toHaveBeenCalledWith('A1DEL001', 1, [], undefined)
    expect(screen.queryByRole('combobox', { name: '面1 銅帯1 仕様' })).not.toBeInTheDocument()
    // 面1は開いたまま「＋」だけが残り、再追加できる。面2は変わらない。
    expect(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' })).toBeVisible()
    expect((screen.getByRole('combobox', { name: '面2 銅帯1 仕様' }) as HTMLSelectElement).value).toBe('標準仕様')
    first.unmount()

    // 再読込: 面1は空のまま(行を復元しない)、面2は復元される。
    render3()
    expect(screen.queryByRole('combobox', { name: '面1 銅帯1 仕様' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '面1の銅帯設定を開く' })).toHaveAttribute('aria-expanded', 'false')
    expect((screen.getByRole('combobox', { name: '面2 銅帯1 仕様' }) as HTMLSelectElement).value).toBe('標準仕様')
    // 再読込しても保存API(onBusbarRowsChange)は呼ばれない(表示の復元と保存操作を分離)。
    expect(onBusbarRowsChange).toHaveBeenCalledTimes(1)
  })

  it('does not notify the parent when an unconfirmed (incomplete) only row is deleted, since nothing was persisted for it', () => {
    const onBusbarRowsChange = vi.fn()
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: 'パネルA', ban_type: '正面図' })]}
        estimatePanels={[]}
        productNo="A1DEL002"
        selectedPanel={null}
        onSelectPanel={() => {}}
        onBusbarRowsChange={onBusbarRowsChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '面1の銅帯設定を開く' }))
    fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
    pick('面1 銅帯1 仕様', '標準仕様') // 途中まで(未確定)
    fireEvent.click(screen.getByRole('button', { name: '面1 銅帯1を削除' }))
    expect(onBusbarRowsChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('combobox', { name: '面1 銅帯1 仕様' })).not.toBeInTheDocument()
  })

  describe('サーバー保存済みの銅帯選択の復元(別ブラウザー・localStorage空でも表示。復元ではPUTしない)', () => {
    const PRODUCT = 'A1SYNC01'
    const serverRow = (face: number, rowId: string, code = '44815', factor = 1.0) => ({
      ban_menno: face,
      row_id: rowId,
      code,
      factor,
    })
    const localRow = (
      id: string,
      factor = 1.0,
      selection: { spec: string | null; phase: string | null; voltage: string | null; kva: string | null } = {
        spec: '標準仕様',
        phase: '3Φ',
        voltage: '200V級',
        kva: '100',
      },
    ) => ({ id, factor, selection })
    function renderWithServer(
      busbarServer: ComponentProps<typeof PanelInfo>['busbarServer'],
      onBusbarRowsChange = vi.fn(),
    ) {
      const view = render(
        <PanelInfo
          panel={null}
          panels={[
            makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: 'パネルA', ban_type: '正面図' }),
            makeProductPanel({ ban_menno: 2, ban_no: 3, ban_meisyou: 'パネルC', ban_type: '正面図' }),
          ]}
          estimatePanels={[]}
          productNo={PRODUCT}
          selectedPanel={null}
          onSelectPanel={() => {}}
          onBusbarRowsChange={onBusbarRowsChange}
          busbarServer={busbarServer}
        />,
      )
      return { view, onBusbarRowsChange }
    }
    const factorOf = (face: number) =>
      (screen.getByRole('combobox', { name: `面${face} 銅帯1 係数` }) as HTMLSelectElement).value
    const codesOf = (face: number) =>
      [...document.querySelectorAll(`#busbar-selector-face-${face} .busbar-selector__code-value`)].map((e) => e.textContent)
    const syncNotice = () => screen.getByRole('status', { name: /サーバー保存内容/ })
    const stored = () =>
      JSON.parse(window.localStorage.getItem('sekisan-navi:busbar-selections:v1') ?? '{}')[PRODUCT] ?? {}
    const seedLocal = (byFace: Record<string, unknown[]>) =>
      window.localStorage.setItem('sekisan-navi:busbar-selections:v1', JSON.stringify({ [PRODUCT]: byFace }))

    it('restores the server rows (code and factor) in a browser whose localStorage is empty, without any save call', () => {
      window.localStorage.clear()
      const { onBusbarRowsChange } = renderWithServer({
        productNo: PRODUCT,
        status: 'ok',
        rows: [serverRow(1, 'row-1', '44815', 0.7), serverRow(2, 'row-1', '44816', 1.4)],
      })
      expect(screen.getByRole('button', { name: '面1の銅帯設定を閉じる' })).toHaveAttribute('aria-expanded', 'true')
      expect(codesOf(1)).toEqual(['44815'])
      expect(codesOf(2)).toEqual(['44816'])
      expect(factorOf(1)).toBe('0.7')
      expect(factorOf(2)).toBe('1.4')
      expect(onBusbarRowsChange).not.toHaveBeenCalled() // 表示の復元ではPUTしない
      expect(screen.queryByRole('status', { name: /サーバー保存内容/ })).not.toBeInTheDocument()
      // 復元内容は localStorage にも反映される(次回のGET失敗時の表示用)。
      expect(Object.keys(stored()).sort()).toEqual(['1', '2'])
    })

    it('does not revive deleted rows from an old localStorage when the server returns an empty list, and tells the user', () => {
      seedLocal({ '1': [localRow('row-1', 0.5)] })
      const { onBusbarRowsChange } = renderWithServer({ productNo: PRODUCT, status: 'ok', rows: [] })
      expect(screen.queryByRole('combobox', { name: '面1 銅帯1 仕様' })).not.toBeInTheDocument()
      expect(document.querySelectorAll('.busbar-selector__row')).toHaveLength(0)
      expect(syncNotice()).toHaveTextContent('サーバーに保存されていない')
      expect(syncNotice()).toHaveTextContent('サーバーへは何も送っていません')
      expect(onBusbarRowsChange).not.toHaveBeenCalled()
      expect(stored()).toEqual({}) // 古い保存内容も消える(次回以降に復活しない)
    })

    it('keeps an unfinished local input row when the server has nothing, so typing is not silently lost', () => {
      seedLocal({ '1': [localRow('row-1', 1, { spec: '標準仕様', phase: null, voltage: null, kva: null })] })
      const { onBusbarRowsChange } = renderWithServer({ productNo: PRODUCT, status: 'ok', rows: [] })
      expect((screen.getByRole('combobox', { name: '面1 銅帯1 仕様' }) as HTMLSelectElement).value).toBe('標準仕様')
      expect(onBusbarRowsChange).not.toHaveBeenCalled()
    })

    it('keeps the localStorage display and shows the failure when the server read failed (nothing is lost, nothing is sent)', () => {
      seedLocal({ '1': [localRow('row-1', 0.8)] })
      const { onBusbarRowsChange } = renderWithServer({
        productNo: PRODUCT,
        status: 'error',
        rows: [],
        message: 'サーバーに接続できませんでした',
      })
      expect(codesOf(1)).toEqual(['44815'])
      expect(factorOf(1)).toBe('0.8')
      expect(syncNotice()).toHaveTextContent('取得できなかったため、このブラウザーの保存内容を表示しています')
      expect(syncNotice()).toHaveTextContent('サーバーに接続できませんでした')
      expect(onBusbarRowsChange).not.toHaveBeenCalled()
      expect(Object.keys(stored())).toEqual(['1']) // localStorageは失われない
    })

    it('prefers the server value and reports a conflict when a complete local row differs (no silent overwrite or resend)', () => {
      seedLocal({ '1': [localRow('row-1', 0.5)] })
      const { onBusbarRowsChange } = renderWithServer({
        productNo: PRODUCT,
        status: 'ok',
        rows: [serverRow(1, 'row-1', '44815', 1.4)],
      })
      expect(factorOf(1)).toBe('1.4')
      expect(syncNotice()).toHaveTextContent('サーバーの値を表示しています')
      expect(onBusbarRowsChange).not.toHaveBeenCalled()
    })

    it('after restoring, edit / add / delete go through the save call per face and the screen matches what is sent', () => {
      window.localStorage.clear()
      const { onBusbarRowsChange } = renderWithServer({
        productNo: PRODUCT,
        status: 'ok',
        rows: [serverRow(1, 'row-1', '44815', 0.7), serverRow(2, 'row-1', '44816', 1.0)],
      })
      // 係数の編集 → 面1だけ保存(復元した行IDのまま、係数0.5)。
      fireEvent.change(screen.getByRole('combobox', { name: '面1 銅帯1 係数' }), { target: { value: '0.5' } })
      expect(onBusbarRowsChange).toHaveBeenCalledTimes(1)
      const [product, face, rows] = onBusbarRowsChange.mock.calls[0]
      expect([product, face, rows.map((r: { id: string; factor: number }) => [r.id, r.factor])]).toEqual([
        PRODUCT,
        1,
        [['row-1', 0.5]],
      ])
      expect(factorOf(2)).toBe('1') // 面2は変わらない
      // 面1に行を追加(未確定のためPUTしない)→ 復元行を削除 → 確定済みの行は無くなる。
      fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
      expect(onBusbarRowsChange).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: '面1 銅帯1を削除' }))
      expect(onBusbarRowsChange).toHaveBeenCalledTimes(2)
      expect(onBusbarRowsChange.mock.calls[1][1]).toBe(1)
      expect(
        onBusbarRowsChange.mock.calls[1][2].filter((r: { selection: { kva: string | null } }) => r.selection.kva !== null),
      ).toEqual([])
      // 面2の唯一の行を削除 → 面2だけ空で保存。
      fireEvent.click(screen.getByRole('button', { name: '面2 銅帯1を削除' }))
      expect(onBusbarRowsChange).toHaveBeenCalledTimes(3)
      expect(onBusbarRowsChange.mock.calls[2][1]).toBe(2)
      expect(onBusbarRowsChange.mock.calls[2][2]).toEqual([])
      expect(document.querySelectorAll('#busbar-selector-face-2 .busbar-selector__row')).toHaveLength(0)
    })

    it('passes server rows that cannot be shown (code not in the table) along with the face save so they are not deleted', () => {
      window.localStorage.clear()
      const { onBusbarRowsChange } = renderWithServer({
        productNo: PRODUCT,
        status: 'ok',
        rows: [serverRow(1, 'row-1', '44815', 1.0), serverRow(1, 'row-z', '99999', 0.8)],
      })
      expect(syncNotice()).toHaveTextContent('コード99999は選択欄の対応表に無いため表示できません')
      fireEvent.change(screen.getByRole('combobox', { name: '面1 銅帯1 係数' }), { target: { value: '0.5' } })
      expect(onBusbarRowsChange).toHaveBeenCalledTimes(1)
      expect(onBusbarRowsChange.mock.calls[0][3]).toEqual([serverRow(1, 'row-z', '99999', 0.8)])
    })

    it('ignores a server result that belongs to a different product, and applies the matching one once', () => {
      window.localStorage.clear()
      const { view, onBusbarRowsChange } = renderWithServer({
        productNo: 'OTHER',
        status: 'ok',
        rows: [serverRow(1, 'row-1')],
      })
      expect(document.querySelectorAll('.busbar-selector__row')).toHaveLength(0)
      view.rerender(
        <PanelInfo
          panel={null}
          panels={[makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: 'パネルA', ban_type: '正面図' })]}
          estimatePanels={[]}
          productNo={PRODUCT}
          selectedPanel={null}
          onSelectPanel={() => {}}
          onBusbarRowsChange={onBusbarRowsChange}
          busbarServer={{ productNo: PRODUCT, status: 'ok', rows: [serverRow(1, 'row-1')] }}
        />,
      )
      expect(document.querySelectorAll('.busbar-selector__row')).toHaveLength(1)
      expect(onBusbarRowsChange).not.toHaveBeenCalled()
    })

    describe('取得完了までは銅帯の追加・編集・削除を無効にする(取得結果との競合で入力・保存済みの選択を失わない)', () => {
      const makePanels = () => [
        makeProductPanel({ ban_menno: 1, ban_no: 1, ban_meisyou: 'パネルA', ban_type: '正面図' }),
        makeProductPanel({ ban_menno: 2, ban_no: 3, ban_meisyou: 'パネルC', ban_type: '正面図' }),
      ]
      const renderFor = (
        productNo: string,
        busbarServer: ComponentProps<typeof PanelInfo>['busbarServer'],
        onBusbarRowsChange = vi.fn(),
        onSelectPanel = vi.fn(),
      ) => {
        const ui = (pn: string, server: ComponentProps<typeof PanelInfo>['busbarServer']) => (
          <PanelInfo
            panel={null}
            panels={makePanels()}
            estimatePanels={[]}
            productNo={pn}
            selectedPanel={null}
            onSelectPanel={onSelectPanel}
            onBusbarRowsChange={onBusbarRowsChange}
            busbarServer={server}
          />
        )
        const view = render(ui(productNo, busbarServer))
        return { view, ui, onBusbarRowsChange, onSelectPanel }
      }
      const seedLocalRow = (productNo: string, factor = 0.8) =>
        window.localStorage.setItem(
          'sekisan-navi:busbar-selections:v1',
          JSON.stringify({
            [productNo]: {
              '1': [{ id: 'row-1', factor, selection: { spec: '標準仕様', phase: '3Φ', voltage: '200V級', kva: '100' } }],
            },
          }),
        )
      const loadingTexts = () => screen.queryAllByText(/サーバーの保存内容を読み込み中です/)

      it('1. while the server read is pending, plus / select / factor / delete are all disabled, a loading notice is shown, and nothing is saved', () => {
        window.localStorage.clear()
        seedLocalRow('A1GATE01')
        const { onBusbarRowsChange } = renderFor('A1GATE01', null)
        // 取得中: 銅帯欄(面1は保存済み行があるため展開、面2は未登録のため開いて確認)に読み込み中表示。
        expect(loadingTexts().length).toBeGreaterThan(0)
        expect(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' })).toBeDisabled()
        expect(screen.getByRole('button', { name: '面1 銅帯1を削除' })).toBeDisabled()
        for (const label of ['仕様', '相数', '電圧区分', '容量（kVA）', '係数']) {
          expect(screen.getByRole('combobox', { name: `面1 銅帯1 ${label}` })).toBeDisabled()
        }
        fireEvent.click(screen.getByRole('button', { name: '面2の銅帯設定を開く' }))
        expect(screen.getByRole('button', { name: '面2に銅帯の選択行を追加' })).toBeDisabled()
        // 無効化の抜け道(イベントの直接発火)でも、変更は受け付けない。
        fireEvent.click(screen.getByRole('button', { name: '面2に銅帯の選択行を追加' }))
        fireEvent.change(screen.getByRole('combobox', { name: '面1 銅帯1 係数' }), { target: { value: '0.5' } })
        fireEvent.click(screen.getByRole('button', { name: '面1 銅帯1を削除' }))
        expect(document.querySelectorAll('#busbar-selector-face-2 .busbar-selector__row')).toHaveLength(0)
        expect((screen.getByRole('combobox', { name: '面1 銅帯1 係数' }) as HTMLSelectElement).value).toBe('0.8')
        expect(onBusbarRowsChange).not.toHaveBeenCalled()
        expect(JSON.parse(window.localStorage.getItem('sekisan-navi:busbar-selections:v1') ?? '{}')['A1GATE01']['1']).toHaveLength(1)
      })

      it('keeps the other operations of the drawing info panel usable while the busbar read is pending (panel selection, folding)', () => {
        window.localStorage.clear()
        const { onSelectPanel, onBusbarRowsChange } = renderFor('A1GATE02', null)
        fireEvent.click(screen.getByText('パネルA').closest('button') as HTMLElement)
        expect(onSelectPanel).toHaveBeenCalledTimes(1)
        const toggle = screen.getByRole('button', { name: '面1の銅帯設定を開く' })
        fireEvent.click(toggle)
        expect(screen.getByRole('button', { name: '面1の銅帯設定を閉じる' })).toHaveAttribute('aria-expanded', 'true')
        expect(onBusbarRowsChange).not.toHaveBeenCalled()
      })

      it('2. once the server read succeeds, the saved rows and factors are shown and the controls become enabled (and nothing is sent by the restore)', () => {
        window.localStorage.clear()
        const { view, ui, onBusbarRowsChange } = renderFor('A1GATE03', null)
        expect(loadingTexts().length).toBeGreaterThan(0)
        view.rerender(ui('A1GATE03', { productNo: 'A1GATE03', status: 'ok', rows: [serverRow(1, 'row-1', '44815', 0.7)] }))
        expect(loadingTexts()).toHaveLength(0)
        expect(codesOf(1)).toEqual(['44815'])
        expect(factorOf(1)).toBe('0.7')
        expect(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' })).toBeEnabled()
        expect(screen.getByRole('button', { name: '面1 銅帯1を削除' })).toBeEnabled()
        expect(screen.getByRole('combobox', { name: '面1 銅帯1 係数' })).toBeEnabled()
        expect(onBusbarRowsChange).not.toHaveBeenCalled()
        // 有効になった後の編集は、従来どおり保存される。
        fireEvent.change(screen.getByRole('combobox', { name: '面1 銅帯1 係数' }), { target: { value: '0.5' } })
        expect(onBusbarRowsChange).toHaveBeenCalledTimes(1)
      })

      it('3. when the server read fails, the localStorage display is kept, the failure is shown, and the controls become enabled', () => {
        window.localStorage.clear()
        seedLocalRow('A1GATE04', 0.8)
        const { view, ui, onBusbarRowsChange } = renderFor('A1GATE04', null)
        expect(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' })).toBeDisabled()
        view.rerender(ui('A1GATE04', { productNo: 'A1GATE04', status: 'error', rows: [], message: '接続できませんでした' }))
        expect(loadingTexts()).toHaveLength(0)
        expect(codesOf(1)).toEqual(['44815'])
        expect(factorOf(1)).toBe('0.8')
        expect(syncNotice()).toHaveTextContent('取得できなかったため、このブラウザーの保存内容を表示しています')
        expect(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' })).toBeEnabled()
        expect(screen.getByRole('combobox', { name: '面1 銅帯1 係数' })).toBeEnabled()
        expect(onBusbarRowsChange).not.toHaveBeenCalled()
        expect(Object.keys(JSON.parse(window.localStorage.getItem('sekisan-navi:busbar-selections:v1') ?? '{}')['A1GATE04'] ?? {})).toEqual(['1'])
      })

      it('4. after switching product, the previous product result / completion never enables or restores into the new product, even if the old result arrives late', () => {
        window.localStorage.clear()
        const { view, ui, onBusbarRowsChange } = renderFor('A1GATE05', null)
        view.rerender(ui('A1GATE05', { productNo: 'A1GATE05', status: 'ok', rows: [serverRow(1, 'row-1', '44815', 0.7)] }))
        expect(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' })).toBeEnabled()
        expect(codesOf(1)).toEqual(['44815'])

        // 製番を切り替えた直後: 新しい製番の取得は未完了。前の製番の完了状態(まだ props に残っている)では有効にならない。
        view.rerender(ui('A1GATE06', { productNo: 'A1GATE05', status: 'ok', rows: [serverRow(1, 'row-1', '44815', 0.7)] }))
        expect(loadingTexts().length).toBeGreaterThan(0)
        fireEvent.click(screen.getByRole('button', { name: '面1の銅帯設定を開く' })) // 新製番は未登録のため折りたたみ
        expect(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' })).toBeDisabled()
        expect(document.querySelectorAll('.busbar-selector__row')).toHaveLength(0) // 前の製番の行は新製番に出ない

        // 取得中(null)になっても、旧製番の応答が遅れて届いても、新製番は取得中のまま(復元もされない)。
        view.rerender(ui('A1GATE06', null))
        view.rerender(ui('A1GATE06', { productNo: 'A1GATE05', status: 'ok', rows: [serverRow(1, 'row-late', '44816', 1.4)] }))
        expect(loadingTexts().length).toBeGreaterThan(0)
        expect(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' })).toBeDisabled()
        expect(document.querySelectorAll('.busbar-selector__row')).toHaveLength(0)

        // 新製番自身の取得が完了して初めて、新製番の内容が表示され操作が有効になる。
        view.rerender(ui('A1GATE06', { productNo: 'A1GATE06', status: 'ok', rows: [serverRow(2, 'row-b', '44816', 1.0)] }))
        expect(loadingTexts()).toHaveLength(0)
        expect(codesOf(2)).toEqual(['44816'])
        expect(codesOf(1)).toEqual([])
        expect(screen.getByRole('button', { name: '面2に銅帯の選択行を追加' })).toBeEnabled()
        expect(onBusbarRowsChange).not.toHaveBeenCalled() // 切替・復元のどの段階でも保存しない
      })

      it('5. returning to a product re-gates it until its own read completes (no stale completion state is reused)', () => {
        window.localStorage.clear()
        const { view, ui } = renderFor('A1GATE07', { productNo: 'A1GATE07', status: 'ok', rows: [] })
        view.rerender(ui('A1GATE08', null))
        view.rerender(ui('A1GATE07', null))
        expect(loadingTexts().length).toBeGreaterThan(0)
        fireEvent.click(screen.getByRole('button', { name: '面1の銅帯設定を開く' }))
        expect(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' })).toBeDisabled()
      })
    })
  })

  it('keeps an empty row folded by default after reload and lets plus reopen it', () => {
    const first = renderThreePanels(() => {}, 'A1EMPTY001', false)
    fireEvent.click(screen.getByRole('button', { name: '面1の銅帯設定を開く' }))
    fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
    expect(screen.getByRole('combobox', { name: '面1 銅帯1 仕様' })).toBeVisible()
    first.unmount()

    renderThreePanels(() => {}, 'A1EMPTY001', false)
    expect(screen.getByRole('button', { name: '面1の銅帯設定を開く' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('combobox', { name: '面1 銅帯1 仕様' })).not.toBeInTheDocument()

    // 保存済みの未選択行が残っていても、欄を開いて＋を押せば入力欄を表示する。
    fireEvent.click(screen.getByRole('button', { name: '面1の銅帯設定を開く' }))
    fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
    expect(screen.getByRole('button', { name: '面1の銅帯設定を閉じる' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('combobox', { name: '面1 銅帯1 仕様' })).toBeVisible()
  })

  it('saves per product number and restores the selections on re-display', () => {
    const first = renderThreePanels(() => {}, 'A1TEST001')
    selectFace1('1')
    fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
    first.unmount()

    renderThreePanels(() => {}, 'A1TEST001')
    expect([...document.querySelectorAll('.busbar-selector__code')].map((e) => e.textContent)).toEqual(['44815'])
    expect(screen.getByRole('combobox', { name: '面1 銅帯2 仕様' })).toBeInTheDocument()
  })

  it('does not share saved selections between product numbers', () => {
    const first = renderThreePanels(() => {}, 'A1TEST001')
    selectFace1('1')
    first.unmount()
    renderThreePanels(() => {}, 'A1TEST002')
    expect(document.querySelector('.busbar-selector__code')).toBeNull()
  })
})

describe('PanelInfo: 選択図面に盤情報が無いときの同一製番内フォールバック', () => {
  const otherPagePanels = [
    makeProductPanel({ page_no: 8, ban_menno: 1, ban_no: 1, ban_meisyou: '高圧受電盤' }),
    makeProductPanel({ page_no: 9, ban_menno: 1, ban_no: 1, ban_meisyou: '高圧受電盤' }), // 別ページの同一盤は重複除去
    makeProductPanel({ page_no: 9, ban_menno: 2, ban_no: 2, ban_meisyou: '低圧電灯盤' }),
  ]

  it('prefers the current page panels and shows no fallback notice when the page has its own panels', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel({ ban_menno: 3, ban_no: 3, ban_meisyou: '当ページ盤' })]}
        fallbackPanels={otherPagePanels}
        estimatePanels={[]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByText('当ページ盤')).toBeInTheDocument()
    expect(screen.queryByText('高圧受電盤')).not.toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('falls back to panels of other drawings of the same product (deduplicated), with a notice and without guessing values', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[]}
        fallbackPanels={otherPagePanels}
        estimatePanels={[makeEstimatePanel({ ban_menno: 1, ban_no: 1, ban_meisyou: '高圧受電盤', ban_w: 800, ban_d: 600 })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getAllByText('高圧受電盤')).toHaveLength(1)
    expect(screen.getByText('低圧電灯盤')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /図面情報/ })).toHaveTextContent('2件')
    expect(screen.getByRole('note')).toHaveTextContent('同じ製番')
    expect(screen.queryByText('盤情報を取得できません')).not.toBeInTheDocument()
    // 製番共通データ(estcode)に値がある面1はその値を表示する。
    const rowOne = screen.getByText('高圧受電盤').closest('button') as HTMLElement
    expect(within(rowOne).getByText('800')).toBeInTheDocument()
    expect(within(rowOne).getByText('600')).toBeInTheDocument()
  })

  it('uses product-wide estimate rows when no drawing of the product has panels, leaving unknown dimensions as "-"', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[]}
        fallbackPanels={[]}
        estimatePanels={[
          makeEstimatePanel({ ban_menno: 4, ban_no: 1, ban_meisyou: '共通データ盤', ban_h: null, ban_w: null, ban_d: null, ban_connect: null }),
        ]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const row = screen.getByText('共通データ盤').closest('button') as HTMLElement
    const cells = within(row).getAllByRole('cell')
    expect(cells).toHaveLength(6)
    expect(cells.slice(2).map((c) => c.textContent)).toEqual(['-', '-', '-', '-'])
  })

  it('does not link fallback rows to the viewer selection (they are not panels of the current page)', () => {
    const onSelectPanel = vi.fn()
    render(
      <PanelInfo
        panel={null}
        panels={[]}
        fallbackPanels={otherPagePanels}
        estimatePanels={[]}
        selectedPanel={null}
        onSelectPanel={onSelectPanel}
      />,
    )
    fireEvent.click(screen.getByText('高圧受電盤').closest('button') as HTMLElement)
    expect(onSelectPanel).not.toHaveBeenCalled()
  })

  it('keeps the legacy panel table priority over the fallback (existing behaviour)', () => {
    render(
      <PanelInfo
        panel={{ id: 1, panel_no: 'P-1', name: '旧ダミー盤', attributes: [] } as never}
        panels={[]}
        fallbackPanels={otherPagePanels}
        estimatePanels={[]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByText(/P-1 \/ 旧ダミー盤/)).toBeInTheDocument()
    expect(screen.queryByText('高圧受電盤')).not.toBeInTheDocument()
  })

  it('keeps the per-face busbar section, fold toggle (◂/▾) and dimension rows working in fallback mode', () => {
    window.localStorage.clear()
    render(
      <PanelInfo
        panel={null}
        panels={[]}
        fallbackPanels={otherPagePanels}
        estimatePanels={[]}
        productNo="A1TEST001"
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '面1の銅帯設定を開く' }))
    fireEvent.click(screen.getByRole('button', { name: '面1に銅帯の選択行を追加' }))
    fireEvent.click(screen.getByRole('button', { name: '面2の銅帯設定を開く' }))
    fireEvent.click(screen.getByRole('button', { name: '面2に銅帯の選択行を追加' }))
    expect(screen.getAllByRole('region', { name: /主回路銅帯/ })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '面1の銅帯設定を閉じる' }))
    expect(screen.getByRole('button', { name: '面1の銅帯設定を開く' })).toHaveTextContent('◂')
    expect(screen.queryByRole('region', { name: '面1 主回路銅帯' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '面2 主回路銅帯' })).toBeVisible()
    expect(screen.getByText('高圧受電盤').closest('button')).toBeVisible()
    expect(screen.getByText('低圧電灯盤').closest('button')).toBeVisible()
  })
})
