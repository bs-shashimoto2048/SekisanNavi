import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PanelInfo } from './PanelInfo'
import { panelKey } from '../../utils/panel'
import type { EstimatePanelInfo, Panel, PanelPreview } from '../../types/domain'

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
  it('shows the empty message when the current page has no product_df panels and no legacy panel', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[]}
        estimatePanels={[]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByText('このページには盤情報がありません')).toBeInTheDocument()
  })

  it('renders a fixed header row with the 7 columns in order, outside the scrollable list', () => {
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
    expect(labels).toEqual(['面/盤', '盤名称', '型式', '高さ', '幅', '奥行', '接続'])

    const scrollArea = document.querySelector('.panel-info__list-scroll')
    expect(scrollArea?.contains(header)).toBe(false)
  })

  it('always renders exactly 7 cells per row, showing "-" for missing values instead of omitting the cell (指示書8章: 列ズレ禁止)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
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
    expect(cells).toHaveLength(7)
    // 型式・接続はestcode_df側の値が無く、product_dfにも対応fieldが無いため"-"。
    expect(cells[2].textContent).toBe('-') // 型式
    expect(cells[6].textContent).toBe('-') // 接続
    // 高さ/幅/奥行はestcode_dfがnullでもproduct_df側(ban_h1=2100, ban_w=1900, ban_d=1200)へ
    // fallbackするため"-"にはならない。
    expect(cells[3].textContent).toBe('2100') // 高さ (ban_h1のみ、ban_h2はnull)
    expect(cells[4].textContent).toBe('1900') // 幅
    expect(cells[5].textContent).toBe('1200') // 奥行
  })

  it('shows the matched estcode_df fields for a single panel across the 7 columns', () => {
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
    const cells = within(row).getAllByRole('cell')
    expect(cells[0].textContent).toBe('5/5') // 面/盤
    expect(cells[1].textContent).toBe('No.2-1低圧動力盤') // 盤名称
    expect(cells[2].textContent).toBe('IS2') // 型式
    // 高さ: product_df側 ban_h1=2100/ban_h2=null が優先されるため、
    // estcode_df側のban_h=2300は使われない (指示書3章の優先順位)。
    expect(cells[3].textContent).toBe('2100')
    // 幅/奥行: estcode_df側が優先 (指示書4章)。
    expect(cells[4].textContent).toBe('1700')
    expect(cells[5].textContent).toBe('2200')
    expect(cells[6].textContent).toBe('箱・左右(L)')
    // 見出しに件数が出る (指示書4章の表示例「盤情報 5件」に相当)。
    expect(document.querySelector('.panel-info__heading')?.textContent).toContain('盤情報　1件')
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
    expect(document.querySelector('.panel-info__heading')?.textContent).toContain('盤情報　3件')
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
    expect(document.querySelector('.panel-info__heading')?.textContent).toContain('盤情報　1件')
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

  it('shows "-" for 型式/接続 (and falls back for 幅/奥行) for a panel with no matching estcode_df row, without dropping the row itself (指示書10章)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    // 行自体(盤名称)はproduct_df由来の値で表示され続ける。
    const row = getRow('No.2-1低圧動力盤')
    const cells = within(row).getAllByRole('cell')
    expect(cells[2].textContent).toBe('-') // 型式(estcode_df専用、fallback無し)
    expect(cells[3].textContent).toBe('2100') // 高さ: product_df ban_h1へfallback
    expect(cells[4].textContent).toBe('1900') // 幅: product_dfへfallback
    expect(cells[5].textContent).toBe('1200') // 奥行: product_dfへfallback
    expect(cells[6].textContent).toBe('-') // 接続(estcode_df専用、fallback無し)
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
    const connectCell = within(row).getAllByRole('cell')[6]
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

describe('PanelInfo: 高さ表示の5分岐 (Issue #38 Phase 2 指示3章)', () => {
  function heightCellFor(panels: PanelPreview[], estimatePanels: EstimatePanelInfo[]): string {
    render(
      <PanelInfo
        panel={null}
        panels={panels}
        estimatePanels={estimatePanels}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const row = getRow(panels[0].ban_meisyou)
    return within(row).getAllByRole('cell')[3].textContent ?? ''
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
    expect(cells[4].textContent).toBe('1700')
    expect(cells[5].textContent).toBe('2200')
  })

  it('falls back to PanelPreview.ban_w/ban_d when EstimatePanelInfo values are missing', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel({ ban_w: 1900, ban_d: 1200 })]}
        estimatePanels={[makeEstimatePanel({ ban_w: null, ban_d: null })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const row = getRow('No.2-1低圧動力盤')
    const cells = within(row).getAllByRole('cell')
    expect(cells[4].textContent).toBe('1900')
    expect(cells[5].textContent).toBe('1200')
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
    expect(cells[4].textContent).toBe('-')
    expect(cells[5].textContent).toBe('-')
  })
})

describe('PanelInfo: レイアウト構造 (Issue #38 Phase 2: CSS Gridベースのカラム型1行一覧)', () => {
  it('makes each data row (button) a CSS Grid container carrying all 7 cells as direct children', () => {
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
    expect(within(row).getAllByRole('cell')).toHaveLength(7)
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
    const heading = screen.getByText(/盤情報.*1件/)
    const scrollArea = document.querySelector('.panel-info__list-scroll')
    expect(scrollArea).not.toBeNull()
    expect(scrollArea?.contains(heading)).toBe(false)
  })

  it('makes the row list area the internally scrolling part (overflow-y: auto, overflow-x: hidden), while the section itself fills 100% of its externally-controlled height', () => {
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
    expect(getComputedStyle(scrollArea).overflowX).toBe('hidden')
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
    expect(document.querySelector('.panel-info__heading')?.textContent).toContain('盤情報　1件')
    // 折りたたみ用のchevronトグルボタンは存在しない (見出しは<h2>のプレーンテキスト)。
    expect(screen.queryByRole('button', { name: /盤情報/ })).not.toBeInTheDocument()
  })
})
