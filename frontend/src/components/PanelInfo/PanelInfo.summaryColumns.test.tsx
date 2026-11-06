import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PanelInfo } from './PanelInfo'
import panelInfoCss from './PanelInfo.css?raw'
import type { PanelPreview } from '../../types/domain'

// 箱体型式と鋼材の列幅は、jsdom ではレイアウトを計算できないため、
//  (1) 長い材料仕様でも 2 列(箱体型式カード + 鋼材カード)の構造が崩れないこと、
//  (2) 2 列を「均等幅のグリッド」で定義している CSS の契約、
// をテストで固定する。実際の列幅(狭い幅・自然幅・最大幅で左右が等しい)は実ブラウザーで確認する。

function cssBlock(selector: string): string {
  const css = panelInfoCss.split(String.fromCharCode(13)).join('')
  const start = css.indexOf(String.fromCharCode(10) + selector + ' {')
  if (start < 0) throw new Error(`CSS block not found: ${selector}`)
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

const longSpec = '匚100x50x5 SS400 溶融亜鉛めっき仕上げ(膜厚 HDZ55 以上) / 内外面メラミン焼付塗装 5Y7/1 半ツヤ 厚さ60μm 以上'

function makePanel(): PanelPreview {
  return {
    page_no: 16, ban_menno: 1, ban_no: 1, ban_meisyou: '盤', ban_type: '正面図',
    ban_h1: 2100, ban_h2: null, ban_w: 1900, ban_d: 1200,
    normalized_rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
  }
}

describe('PanelInfo: 箱体型式と鋼材は同じ幅の2列で並ぶ', () => {
  it('keeps the two summary cards as equal-width grid columns, so a long steel spec cannot take width from the box-type card', () => {
    const grid = cssBlock('.panel-info__summary-grid')
    expect(grid).toMatch(/display:\s*grid/)
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
    // 内容量に比例して幅を分ける指定(flex-basis: max-content 等)を使わない。
    expect(cssBlock('.panel-info__summary-card')).not.toMatch(/flex\s*:/)
    expect(cssBlock('.panel-info__summary-card')).toMatch(/min-width:\s*0/)
    // 鋼材データが無いときの全幅1列も、同じグリッドで表す。
    expect(cssBlock('.panel-info__summary-grid--single')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
  })

  it('renders both cards side by side as the grid children even when the steel material spec is very long', () => {
    render(
      <PanelInfo
        panel={null}
        panels={[makePanel()]}
        estimatePanels={[]}
        steel={{
          status: 'ok',
          source_page: '8',
          source_drawing_name: '外形図(1)',
          items: [{ symbol_name: 'BSP-STEELA-H', cabtype: 'OS2ZAVD', component_name: '基礎ベース', material_spec: longSpec }],
        }}
        selectedPanel={null}
        onSelectPanel={() => {}}
      />,
    )
    const grid = document.querySelector('.panel-info__summary-grid') as HTMLElement
    expect(grid).not.toHaveClass('panel-info__summary-grid--single')
    expect(grid.children).toHaveLength(2)
    expect(grid.children[0]).toHaveClass('panel-info__summary-card')
    expect(grid.children[1]).toHaveClass('steel-section')
    expect(grid.children[1]).toHaveTextContent(longSpec)
  })
})
