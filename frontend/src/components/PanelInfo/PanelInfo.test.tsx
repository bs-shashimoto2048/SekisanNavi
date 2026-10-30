import { render, screen, fireEvent, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PanelInfo } from './PanelInfo'
import { panelKey } from '../../utils/panel'
import type {
  BoxTypeAnalysis,
  EstimatePanelInfo,
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
    expect(screen.getByText('このページには図面情報がありません')).toBeInTheDocument()
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

  function renderThreePanels(onSelectPanel: () => void = () => {}, productNo?: string) {
    return render(
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

  it('starts with all four items unselected and no code shown', () => {
    renderThreePanels()
    for (const label of ['仕様', '相数', '電圧区分', '容量（kVA）']) {
      expect((screen.getByRole('combobox', { name: `面1 銅帯1 ${label}` }) as HTMLSelectElement).value).toBe('')
    }
    expect(document.querySelector('.busbar-selector__code')).toBeNull()
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
    expect(screen.getByText('標準仕様', { selector: '.busbar-selector__spec' })).toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: '面2 銅帯1を削除' })).not.toBeInTheDocument() // 面2は1行のみ
    // 追加行を選択してから、1行目を削除しても 2 行目は残る。
    pick('面1 銅帯2 仕様', '公共建築')
    fireEvent.click(screen.getByRole('button', { name: '面1 銅帯1を削除' }))
    expect(screen.queryByRole('combobox', { name: '面1 銅帯2 仕様' })).not.toBeInTheDocument()
    expect((screen.getByRole('combobox', { name: '面1 銅帯1 仕様' }) as HTMLSelectElement).value).toBe('公共建築')
    expect((screen.getByRole('combobox', { name: '面2 銅帯1 仕様' }) as HTMLSelectElement).value).toBe('公共建築')
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
