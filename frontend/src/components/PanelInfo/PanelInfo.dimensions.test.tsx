import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PanelInfo } from './PanelInfo'
import type { EstimatePanelInfo, PanelPreview } from '../../types/domain'

// A1GE4568 の実データで確認した状況: estcode_df.csv の BAN_H/W/D が全盤 0(未設定)で、
// 同じ盤の「外形図(1)・正面図」行(product_df.csv)には正の値がある。

function previewPanel(overrides: Partial<PanelPreview>): PanelPreview {
  return {
    page_no: 8,
    ban_menno: 1,
    ban_no: 1,
    ban_meisyou: '高圧受電盤',
    ban_type: '正面図',
    ban_h1: null,
    ban_h2: null,
    ban_w: null,
    ban_d: null,
    normalized_rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
    ...overrides,
  }
}

function estimate(overrides: Partial<EstimatePanelInfo>): EstimatePanelInfo {
  return {
    model: 'OS2ZAVD',
    ban_menno: 1,
    ban_no: 1,
    ban_meisyou: '高圧受電盤',
    ban_h: 0,
    ban_w: 0,
    ban_d: 0,
    ban_connect: '箱・左右(L)',
    sort_order: 1,
    box_type_analysis: null,
    ...overrides,
  }
}

const outlineFront = previewPanel({ ban_h1: 2365, ban_h2: 2275, ban_w: 900, ban_d: 2000 })

function dimensionCells(name: string): string[] {
  const row = screen.getByText(name).closest('button') as HTMLElement
  return within(row).getAllByRole('cell').slice(2, 5).map((c) => c.textContent ?? '')
}

describe('PanelInfo: 寸法の取得ルール(estcode_df が 0/未設定のとき、外形図・正面図の product_df 行で補う)', () => {
  it('current-page panels: shows the 外形図・正面図 values instead of "0" when estcode_df is 0', () => {
    render(
      <PanelInfo
        panel={null}
        // 現在ページは基礎図(寸法なし)。以前は estcode_df の 0 がそのまま「0」と表示された。
        panels={[previewPanel({ page_no: 10, ban_type: '基礎図' })]}
        dimensionSourcePanels={[outlineFront]}
        estimatePanels={[estimate({})]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(dimensionCells('高圧受電盤')).toEqual(['2365 / 2275', '900', '2000'])
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('fallback rows (preview pages without panels) use the same rule', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[]}
        fallbackPanels={[previewPanel({ page_no: 10, ban_type: '基礎図' })]}
        dimensionSourcePanels={[outlineFront]}
        estimatePanels={[estimate({})]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(dimensionCells('高圧受電盤')).toEqual(['2365 / 2275', '900', '2000'])
  })

  it('shows "-" (never "0" or another panel\'s value) when no 外形図・正面図 row matches the panel', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[previewPanel({ page_no: 10, ban_type: '基礎図' })]}
        // 別の盤(面2・盤2)の値は使わない。
        dimensionSourcePanels={[previewPanel({ ban_menno: 2, ban_no: 2, ban_w: 1100, ban_d: 2000, ban_h1: 2365 })]}
        estimatePanels={[estimate({})]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(dimensionCells('高圧受電盤')).toEqual(['-', '-', '-'])
  })

  it('does not use the dimensions of the current page row itself unless it is an 外形図・正面図 row', () => {
    render(
      <PanelInfo
        panel={null}
        // 内部機器配置図の行(外形図ではない)は、値があっても補完元にならない。
        panels={[previewPanel({ page_no: 11, ban_h1: 2365, ban_w: 900, ban_d: 2000 })]}
        dimensionSourcePanels={[]}
        estimatePanels={[estimate({})]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(dimensionCells('高圧受電盤')).toEqual(['-', '-', '-'])
  })

  it('fills only the missing items: a positive estcode_df width is kept, depth and height come from the outline row', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[previewPanel({ page_no: 10, ban_type: '基礎図' })]}
        dimensionSourcePanels={[previewPanel({ ban_h1: 2365, ban_h2: null, ban_w: 0, ban_d: 2000 })]}
        estimatePanels={[estimate({ ban_w: 1700 })]}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    expect(dimensionCells('高圧受電盤')).toEqual(['2365', '1700', '2000'])
  })
})
