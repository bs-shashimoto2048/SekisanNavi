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

describe('PanelInfo (次work指示: 複数盤対応・コンパクト化)', () => {
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

  it('shows a card with the matched estcode_df fields for a single panel', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByText('5/5')).toBeInTheDocument()
    expect(screen.getByText('No.2-1低圧動力盤')).toBeInTheDocument()
    expect(screen.getByText('IS2')).toBeInTheDocument()
    expect(screen.getByText('H 2300 : W 1700 : D 2200')).toBeInTheDocument()
    expect(screen.getByText('箱・左右(L)')).toBeInTheDocument()
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

  it('collapses multiple views (矢視) of the same panel (same ban_menno+ban_no) into a single card', () => {
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
        panels={[makeProductPanel()]}
        estimatePanels={[
          makeEstimatePanel({ model: null, ban_meisyou: null, ban_connect: null, ban_h: null }),
        ]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.queryByText('null')).not.toBeInTheDocument()
    expect(screen.queryByText('undefined')).not.toBeInTheDocument()
    expect(screen.queryByText('NaN')).not.toBeInTheDocument()
    // 寸法は項目ごとに"-"を出す (指示書8章)。
    expect(screen.getByText('H - : W 1700 : D 2200')).toBeInTheDocument()
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

  it('omits the model/connect fields cleanly (no stray "-") when they are absent, rather than cluttering the compact secondary line', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel({ model: null, ban_connect: null })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const card = screen.getByText('No.2-1低圧動力盤').closest('button') as HTMLElement
    const row = card.querySelector('.panel-info__card-row') as HTMLElement
    // 寸法のみが残り、値の無い型式・接続情報はスパンごと出さない
    // (盤情報1行化・3領域リサイズ拡張・Redo時引出線回帰修正 指示1章で
    // 主情報/副情報の行分けを廃止し、1行(.panel-info__card-row)へ統合した)。
    expect(row.querySelectorAll('.panel-info__meta')).toHaveLength(1)
    expect(row.querySelector('.panel-info__meta')?.textContent).toBe('H 2300 : W 1700 : D 2200')
  })

  it('formats BAN_H/W/D as a single "H x : W x : D x mm" line, not separate rows, with "-" for missing dimensions individually (指示書5章/8章)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel({ ban_h: 2300, ban_w: null, ban_d: 2200 })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.getByText('H 2300 : W - : D 2200')).toBeInTheDocument()
    expect(screen.queryByText(/㎜/)).not.toBeInTheDocument()
  })

  it('shows whole numbers without a trailing ".0" even if the source value came from a float column (指示書9章)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel({ ban_menno: 5, ban_no: 5 })]}
        estimatePanels={[makeEstimatePanel({ ban_h: 2300 })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(screen.queryByText(/2300\.0/)).not.toBeInTheDocument()
    expect(screen.queryByText(/5\.0/)).not.toBeInTheDocument()
  })

  it('shows "該当する積算盤情報がありません" for a panel with no matching estcode_df row, without dropping the card itself (指示書14章)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    // カード自体(盤名称)はproduct_df由来の値で表示され続ける。
    expect(screen.getByText('No.2-1低圧動力盤')).toBeInTheDocument()
    expect(screen.getByText('該当する積算盤情報がありません')).toBeInTheDocument()
  })

  it('marks the panel matching the current Viewer selection as selected, and no other card (指示書6章)', () => {
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
    const selectedCard = screen.getByText('高圧受電盤').closest('button') as HTMLElement
    const otherCard = screen.getByText('低圧動力盤').closest('button') as HTMLElement
    expect(selectedCard.className).toContain('panel-info__card--selected')
    expect(otherCard.className).not.toContain('panel-info__card--selected')
  })

  it('shows no card as selected when selectedPanel is null', () => {
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
    const card = screen.getByText('高圧受電盤').closest('button') as HTMLElement
    expect(card.className).not.toContain('panel-info__card--selected')
  })

  it('calls onSelectPanel with the same key/panel a Viewer click would use, when a card is clicked (指示書3章: 既存クリック動作の再利用)', () => {
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
    fireEvent.click(screen.getByText('高圧受電盤').closest('button') as HTMLElement)
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

  it('prioritizes the card list over the dummy Detection-linked panel when both are present (要件11相当)', () => {
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

  it('does not crash and shows a long panel name in full without truncation markers (実画面確認: 長い盤名称)', () => {
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
    expect(screen.getByText(longName)).toBeInTheDocument()
  })

  it('shows the model/dimensions/connect fields without a leading label, separated visually rather than as label:value rows (指示書5章)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    // 旧来の"型式"/"面番号"/"接続情報"等のラベル文言は、新デザインでは表示しない
    // (指示書5章: 単純なラベル:値の縦並びから脱却する)。
    expect(screen.queryByText('型式')).not.toBeInTheDocument()
    expect(screen.queryByText('接続情報')).not.toBeInTheDocument()
    expect(screen.queryByText('並び順')).not.toBeInTheDocument()
  })

  it('renders the secondary meta line inside the same secondary block (via aria-pressed reflecting selection state)', () => {
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
    const card = screen.getByText('高圧受電盤').closest('button') as HTMLElement
    expect(within(card).getByText('該当する積算盤情報がありません')).toBeInTheDocument()
    expect(card.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('PanelInfo: 1行表示レイアウト (盤情報1行化・3領域リサイズ拡張・Redo時引出線回帰修正 指示1章/2章)', () => {
  it('places 面/盤番号・盤名称・型式・寸法・接続情報 all as siblings in a single flex row (not split into 2 stacked rows)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const card = screen.getByText('No.2-1低圧動力盤').closest('button') as HTMLElement
    // 旧: .panel-info__card-primary(面/盤+名称) と .panel-info__card-secondary
    // (型式/寸法/接続情報)の2つのdivに分かれていた。指示1章で1行(.panel-info__
    // card-row)へ統合したため、そのdivが1つだけ存在し、旧2分割用のクラスは
    // どちらも存在しない。
    expect(card.querySelectorAll('.panel-info__card-row')).toHaveLength(1)
    expect(card.querySelector('.panel-info__card-primary')).toBeNull()
    expect(card.querySelector('.panel-info__card-secondary')).toBeNull()

    const row = card.querySelector('.panel-info__card-row') as HTMLElement
    // flex-wrapのみで折り返し制御するため、実際に折り返すかはCSSレイアウト
    // (実ブラウザ)側の話になるが、DOM構造としては全項目が同じ行(親要素)の
    // 直接の子として並んでいることを確認する。
    expect(within(row).getByText('5/5')).toBeInTheDocument()
    expect(within(row).getByText('No.2-1低圧動力盤')).toBeInTheDocument()
    expect(within(row).getByText('IS2')).toBeInTheDocument()
    expect(within(row).getByText('H 2300 : W 1700 : D 2200')).toBeInTheDocument()
    expect(within(row).getByText('箱・左右(L)')).toBeInTheDocument()
  })

  it('keeps the heading (件数) fixed outside the scrollable card list area', () => {
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
    // 見出しはスクロール領域の外にある (指示4章: 見出し固定・一覧のみスクロール)。
    expect(scrollArea?.contains(heading)).toBe(false)
  })

  it('makes the card list area the internally scrolling part (overflow-y: auto), while the section itself fills 100% of its externally-controlled height', () => {
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
    // 指示5章: 盤情報の高さは今後App.tsx側のラッパーdivが外部から指定する
    // (EstimateAggregation/EstimateDetailと同じ設計)。このコンポーネント自身は
    // 100%を使い切るだけで、独自のmax-height/固定比率は持たない。
    expect(getComputedStyle(section).height).toBe('100%')
    expect(getComputedStyle(scrollArea).overflowY).toBe('auto')
  })
})

describe('PanelInfo: 折りたたみ (Issue #6: Improve estimation target visibility and collapsible right pane sections)', () => {
  it('defaults to expanded (collapsed prop omitted) and shows the card list', () => {
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
    expect(screen.getByRole('button', { name: /盤情報/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('hides the body (card list) but keeps the heading when collapsed=true, without touching onSelectPanel/selectedPanel logic', () => {
    const onSelectPanel = vi.fn()
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={onSelectPanel}
        collapsed
        onToggleCollapsed={() => {}}
      />,
    )
    expect(screen.queryByText('No.2-1低圧動力盤')).not.toBeInTheDocument()
    expect(document.querySelector('.panel-info__heading')?.textContent).toContain('盤情報　1件')
    expect(screen.getByRole('button', { name: /盤情報/ })).toHaveAttribute('aria-expanded', 'false')
    expect(onSelectPanel).not.toHaveBeenCalled()
  })

  it('calls onToggleCollapsed when the heading is clicked, without the component managing its own collapse state', () => {
    const onToggleCollapsed = vi.fn()
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
        collapsed={false}
        onToggleCollapsed={onToggleCollapsed}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /盤情報/ }))
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1)
  })

  it('does not add padding/margin to the heading toggle button itself (指示: 見出しの高さを変えない)', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makeProductPanel()]}
        estimatePanels={[makeEstimatePanel()]}
        selectedPanel={null}
        onSelectPanel={() => {}}
        collapsed={false}
        onToggleCollapsed={() => {}}
      />,
    )
    const toggle = screen.getByRole('button', { name: /盤情報/ })
    const style = getComputedStyle(toggle)
    expect(style.padding).toBe('0px')
    expect(style.margin).toBe('0px')
  })
})
