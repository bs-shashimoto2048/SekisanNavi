import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DrawingNavigator } from './DrawingNavigator'
import type { PanelPreview, ProductDrawing } from '../../types/domain'

function makeRect(overrides: Partial<PanelPreview['normalized_rect']> = {}) {
  return { x: 0.1, y: 0.2, w: 0.05, h: 0.1, ...overrides }
}

function makePanel(overrides: Partial<PanelPreview> = {}): PanelPreview {
  return {
    page_no: 1,
    ban_menno: 1,
    ban_no: 1,
    ban_meisyou: '高圧受電盤',
    ban_type: '正面図',
    ban_h1: null,
    ban_h2: null,
    ban_w: null,
    ban_d: null,
    normalized_rect: makeRect(),
    ...overrides,
  }
}

function makePage(overrides: Partial<ProductDrawing> = {}): ProductDrawing {
  return {
    page_no: 1,
    thumbnail_url: '/api/products/A1TEST01/drawings/1/thumbnail',
    drawing_type: '外形図',
    drawing_name: '外形図',
    panels: [],
    ...overrides,
  }
}

describe('DrawingNavigator (Phase 1.8: PNGサムネイル表示)', () => {
  it('groups pages by drawing_type (要件27)', () => {
    const pages = [
      makePage({ page_no: 13, drawing_type: '外形図' }),
      makePage({ page_no: 14, drawing_type: '外形図' }),
      makePage({ page_no: 27, drawing_type: '正面図' }),
    ]

    render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )

    expect(screen.getByText('外形図')).toBeInTheDocument()
    expect(screen.getByText('正面図')).toBeInTheDocument()
  })

  it('groups pages with no drawing_type under an "その他" fallback group', () => {
    const pages = [makePage({ page_no: 99, drawing_type: null })]
    render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    expect(screen.getByText('その他')).toBeInTheDocument()
  })

  it('shows the drawing-list legend text once, using 面番号/盤番号 (not クロスリファレンス番号) (図面一覧の説明表記を共通化・簡素化 指示1章)', () => {
    const pages = [
      makePage({
        page_no: 16,
        drawing_type: '外形図',
        panels: [makePanel({ ban_menno: 5, ban_no: 5 })],
      }),
    ]
    render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    expect(screen.getByText('P：ページ、面番号 / 盤番号')).toBeInTheDocument()
    expect(screen.queryByText(/クロスリファレンス番号/)).not.toBeInTheDocument()
  })

  it('shows the same legend text regardless of whether a group has BAN info (no per-group text variation, 指示1章/2章)', () => {
    const pages = [makePage({ page_no: 18, drawing_type: '基礎図', panels: [] })]
    render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    expect(screen.getByText('P：ページ、面番号 / 盤番号')).toBeInTheDocument()
    expect(screen.queryByText('P：ページ番号')).not.toBeInTheDocument()
  })

  it('shows the legend exactly once for the whole section, even with multiple drawing-type groups (指示2章: グループごとの繰り返し表示を廃止)', () => {
    const pages = [
      makePage({ page_no: 16, drawing_type: '外形図', panels: [makePanel({ ban_menno: 5, ban_no: 5 })] }),
      makePage({ page_no: 18, drawing_type: '基礎図', panels: [] }),
      makePage({ page_no: 21, drawing_type: null }), // 「その他」グループ
    ]
    render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    expect(screen.getAllByText('P：ページ、面番号 / 盤番号')).toHaveLength(1)
    // グループ見出し(外形図/基礎図/その他)自体は従来どおり複数表示される。
    expect(screen.getByText('外形図')).toBeInTheDocument()
    expect(screen.getByText('基礎図')).toBeInTheDocument()
    expect(screen.getByText('その他')).toBeInTheDocument()
  })

  it('places the legend directly under the "図面一覧" heading, before any group', () => {
    const pages = [makePage({ page_no: 16, drawing_type: '外形図' })]
    const { container } = render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    const children = Array.from(container.querySelector('.drawing-navigator')!.children)
    const headingIndex = children.findIndex((c) => c.className.includes('drawing-navigator__heading'))
    const legendIndex = children.findIndex((c) => c.className.includes('drawing-navigator__legend'))
    const groupIndex = children.findIndex((c) => c.className.includes('drawing-navigator__group'))
    expect(headingIndex).toBe(0)
    expect(legendIndex).toBe(1)
    expect(groupIndex).toBeGreaterThan(legendIndex)
  })

  it('keeps the legend short (not a long sentence)', () => {
    const pages = [makePage({ page_no: 16, drawing_type: '外形図' })]
    render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    const legend = document.querySelector('.drawing-navigator__legend')
    expect(legend?.textContent?.length ?? 0).toBeLessThanOrEqual(30)
  })

  it('renders a PNG thumbnail img sourced from thumbnail_url', () => {
    const pages = [makePage({ page_no: 16, thumbnail_url: '/api/products/A1TEST01/drawings/16/thumbnail' })]
    render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    const img = screen.getByRole('img', { name: 'P16' }) as HTMLImageElement
    expect(img.src).toContain('/api/products/A1TEST01/drawings/16/thumbnail')
  })

  it('falls back to a placeholder when the PNG fails to load, without breaking the whole screen', () => {
    const pages = [makePage({ page_no: 25 })]
    const { container } = render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    const img = screen.getByRole('img', { name: 'P25' })
    fireEvent.error(img)

    expect(screen.queryByRole('img', { name: 'P25' })).not.toBeInTheDocument()
    const fallback = container.querySelector('.drawing-navigator__thumb-fallback') as HTMLElement
    expect(fallback).not.toBeNull()
    expect(fallback.textContent).toContain('画像なし')
    expect(fallback.textContent).toContain('P25')
  })

  it('shows the page number and BAN_MENNO/BAN_NO as two compact lines when a single panel exists (Phase 1.9 UI改修指示1章)', () => {
    const pages = [makePage({ page_no: 25, panels: [makePanel({ ban_menno: 3, ban_no: 1 })] })]
    render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    expect(screen.getByText('P25')).toBeInTheDocument()
    expect(screen.getByText('3/1')).toBeInTheDocument()
  })

  it('shows all distinct BAN_MENNO/BAN_NO pairs joined by "、" when a page has multiple panels (要件11/12。Phase 1.11 UI改修指示21章で区切りを読点へ変更)', () => {
    const pages = [
      makePage({
        page_no: 25,
        panels: [
          makePanel({ ban_menno: 3, ban_no: 1 }),
          makePanel({ ban_menno: 3, ban_no: 2 }),
          makePanel({ ban_menno: 4, ban_no: 1 }),
        ],
      }),
    ]
    render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    expect(screen.getByText('P25')).toBeInTheDocument()
    expect(screen.getByText('3/1、3/2、4/1')).toBeInTheDocument()
  })

  it('does not show a long BAN_MEISYOU/BAN_TYPE description on the thumbnail (要件1: 簡潔にする)', () => {
    const pages = [
      makePage({
        page_no: 25,
        panels: [makePanel({ ban_menno: 3, ban_no: 1, ban_meisyou: 'No.2-1低圧動力盤', ban_type: '正面図' })],
      }),
    ]
    render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    expect(screen.queryByText(/No\.2-1低圧動力盤/)).not.toBeInTheDocument()
    expect(screen.queryByText(/正面図/)).not.toBeInTheDocument()
  })

  it('regression: the label must actually be visible (not just present in the DOM) — line-height must not be 0', () => {
    // 修正依頼の再修正指示: 「サムネイル上に表示」がテスト・DOM上では確認できても
    // 実UI上で見えていなかった不具合の根本原因は、親要素(.thumb-wrap)が
    // img下の余白除去のため指定している line-height:0 が継承プロパティのため
    // ラベルにもそのまま適用され、line-height:0の行ボックス(高さ実質0)と
    // overflow:hidden(text-overflow:ellipsis用)の組み合わせで文字が
    // 実質的にクリップされていたこと。line-heightを明示的に上書きしたことを
    // 実際のCSSカスケード解決 (getComputedStyle, vite.config.tsのcss:true) で確認する。
    const pages = [makePage({ page_no: 18, panels: [makePanel({ ban_menno: 1, ban_no: 1 })] })]
    const { container } = render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    const wrap = container.querySelector('.drawing-navigator__thumb-wrap') as HTMLElement
    const label = container.querySelector('.drawing-navigator__thumb-label') as HTMLElement
    // 親のline-height:0そのものは維持されていること (imgの余白除去自体は壊さない)。
    expect(getComputedStyle(wrap).lineHeight).toBe('0')
    // ラベル側は明示的に上書きされ、0を継承していないこと。
    expect(getComputedStyle(label).lineHeight).not.toBe('0')
  })

  it('regression: PAGE/BAN labels are not rendered at an unreadably small size (実画面未達 修正指示3章)', () => {
    // ルートfont-sizeは14px (index.css)。5〜8px相当の極小表示 (0.5rem前後) を禁止し、
    // PAGE行は13px前後、BAN行は12px前後を最低限とする (指示書の目安)。
    const pages = [makePage({ page_no: 16, panels: [makePanel({ ban_menno: 5, ban_no: 5 })] })]
    const { container } = render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    const pageLine = container.querySelector(
      '.drawing-navigator__thumb-label-line--page',
    ) as HTMLElement
    const banLine = container.querySelector(
      '.drawing-navigator__thumb-label-line--ban',
    ) as HTMLElement
    // jsdomのgetComputedStyleは実ブラウザと異なりrem→px解決を行わず、指定値
    // (例: "0.95rem") をそのまま文字列で返す。ルートfont-size (index.css: 15px。
    // 全体フォント拡大・BBox編集追従回帰修正 指示1章で14px→15pxへ引き上げ) を
    // 掛けて概算pxへ変換して比較する。
    const ROOT_FONT_SIZE_PX = 15
    const pagePx = parseFloat(getComputedStyle(pageLine).fontSize) * ROOT_FONT_SIZE_PX
    const banPx = parseFloat(getComputedStyle(banLine).fontSize) * ROOT_FONT_SIZE_PX
    expect(pagePx).toBeGreaterThanOrEqual(12)
    expect(banPx).toBeGreaterThanOrEqual(11)
  })

  it('the thumbnail label background is much more transparent than before, so the drawing underneath is visible (追加修正 第4ラウンド11章〜13章)', () => {
    const pages = [makePage({ page_no: 16, panels: [makePanel({ ban_menno: 5, ban_no: 5 })] })]
    const { container } = render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    const label = container.querySelector('.drawing-navigator__thumb-label') as HTMLElement
    const bg = getComputedStyle(label).backgroundColor
    const alpha = Number(bg.match(/[\d.]+\)$/)?.[0].replace(')', ''))
    // 旧0.82(濃色でほぼ不透明)から、指示書の目安(0.35〜0.50)へ薄くしたこと。
    expect(alpha).toBeGreaterThanOrEqual(0.35)
    expect(alpha).toBeLessThanOrEqual(0.5)
    // 薄くしても文字自体は読めるよう、白文字であることは維持する。
    expect(getComputedStyle(label).color).toMatch(/255, 255, 255|#fff/i)
  })

  it('does NOT render red panel-area overlays on the left pane, even with multiple panel rows (実画面未反映調査・修正指示 1章/7章)', () => {
    const pages = [
      makePage({
        page_no: 25,
        panels: [
          makePanel({ ban_menno: 1, ban_no: 1, normalized_rect: makeRect({ x: 0.1 }) }),
          makePanel({ ban_menno: 2, ban_no: 1, normalized_rect: makeRect({ x: 0.2 }) }),
          makePanel({ ban_menno: 3, ban_no: 1, normalized_rect: makeRect({ x: 0.3 }) }),
        ],
      }),
    ]
    const { container } = render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    // 赤色盤領域Overlayは中央Drawing Viewer側 (ProductPanelOverlay) にのみ表示し、
    // 左ペインのサムネイルには一切表示しない。
    expect(container.querySelectorAll('.drawing-navigator__panel-overlay')).toHaveLength(0)
    expect(container.querySelector('.product-panel-overlay')).toBeNull()
    // データ自体 (panels) はラベル表示のために保持されている (BAN情報は消えていない)。
    expect(screen.getByText('1/1、2/1、3/1')).toBeInTheDocument()
  })

  it('calls onSelectPage when a thumbnail card is clicked', () => {
    const pages = [makePage({ page_no: 42 })]
    const onSelectPage = vi.fn()
    render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={null}
        onSelectPage={onSelectPage}
        loading={false}
        error={null}
      />,
    )
    fireEvent.click(screen.getByRole('img', { name: 'P42' }))
    expect(onSelectPage).toHaveBeenCalledWith(42)
  })

  it('marks the currently selected page visually (要件26)', () => {
    const pages = [makePage({ page_no: 1 }), makePage({ page_no: 2 })]
    render(
      <DrawingNavigator
        pages={pages}
        selectedPageNo={2}
        onSelectPage={() => {}}
        loading={false}
        error={null}
      />,
    )
    const selectedButton = screen.getByRole('img', { name: 'P2' }).closest('button') as HTMLElement
    const otherButton = screen.getByRole('img', { name: 'P1' }).closest('button') as HTMLElement
    expect(selectedButton.className).toContain('drawing-navigator__card--selected')
    expect(otherButton.className).not.toContain('drawing-navigator__card--selected')
  })

  it('shows a loading state instead of stale content', () => {
    render(
      <DrawingNavigator pages={[]} selectedPageNo={null} onSelectPage={() => {}} loading error={null} />,
    )
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('shows an error message instead of crashing the whole screen', () => {
    render(
      <DrawingNavigator
        pages={[]}
        selectedPageNo={null}
        onSelectPage={() => {}}
        loading={false}
        error="製番が見つかりません"
      />,
    )
    expect(screen.getByText('製番が見つかりません')).toBeInTheDocument()
  })

  describe('visiblePageNosによる積算対象連動の絞り込み (積算対象連動の金額表示・図面一覧絞り込み 指示4章〜6章)', () => {
    it('shows all pages when visiblePageNos is not provided (default: no filtering, 総合計)', () => {
      const pages = [makePage({ page_no: 16 }), makePage({ page_no: 18 })]
      render(
        <DrawingNavigator pages={pages} selectedPageNo={null} onSelectPage={() => {}} loading={false} error={null} />,
      )
      expect(screen.getByRole('img', { name: 'P16' })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'P18' })).toBeInTheDocument()
    })

    it('shows all pages when visiblePageNos is explicitly null (総合計へ戻した場合、絞り込み残留なし、指示10章)', () => {
      const pages = [makePage({ page_no: 16 }), makePage({ page_no: 18 })]
      render(
        <DrawingNavigator
          pages={pages}
          selectedPageNo={null}
          onSelectPage={() => {}}
          loading={false}
          error={null}
          visiblePageNos={null}
        />,
      )
      expect(screen.getByRole('img', { name: 'P16' })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'P18' })).toBeInTheDocument()
    })

    it('shows only the pages included in visiblePageNos, hiding the rest', () => {
      const pages = [makePage({ page_no: 16 }), makePage({ page_no: 18 }), makePage({ page_no: 29 })]
      render(
        <DrawingNavigator
          pages={pages}
          selectedPageNo={null}
          onSelectPage={() => {}}
          loading={false}
          error={null}
          visiblePageNos={new Set([16, 29])}
        />,
      )
      expect(screen.getByRole('img', { name: 'P16' })).toBeInTheDocument()
      expect(screen.getByRole('img', { name: 'P29' })).toBeInTheDocument()
      expect(screen.queryByRole('img', { name: 'P18' })).not.toBeInTheDocument()
    })

    it('shows a dedicated "該当する図面はありません" message (not "ページが見つかりません") when filtering results in zero pages, so it is not mistaken for a bug (指示5章)', () => {
      const pages = [makePage({ page_no: 16 }), makePage({ page_no: 18 })]
      render(
        <DrawingNavigator
          pages={pages}
          selectedPageNo={null}
          onSelectPage={() => {}}
          loading={false}
          error={null}
          visiblePageNos={new Set()}
        />,
      )
      expect(screen.getByText('該当する図面はありません')).toBeInTheDocument()
      expect(screen.queryByText('ページが見つかりません')).not.toBeInTheDocument()
    })

    it('still shows "ページが見つかりません" (not the filter-empty message) when the underlying page list itself is genuinely empty', () => {
      render(
        <DrawingNavigator
          pages={[]}
          selectedPageNo={null}
          onSelectPage={() => {}}
          loading={false}
          error={null}
          visiblePageNos={new Set([16])}
        />,
      )
      expect(screen.getByText('ページが見つかりません')).toBeInTheDocument()
      expect(screen.queryByText('該当する図面はありません')).not.toBeInTheDocument()
    })
  })
})

describe('DrawingNavigator: 「図面一覧」見出しデザイン統一 (Sekisan Navi 追加UI修正指示)', () => {
  // 注記: jsdom(cssstyle)は`border-left: 3px solid var(--accent-section)`のように
  // shorthand内にvar(...)を含む宣言全体を解決できず(width/styleを含め初期値
  // 'medium'/'none'のまま)、EstimateMasterPicker.test.tsx等の既存の注記と同じ
  // 制約に当たる。ここでは確実に解決できるbackground-color(リテラル値)のみで
  // 検証し、border-leftの実際の描画は実ブラウザ確認で行う。
  it('gives the "図面一覧" heading the same section-header background as the right pane (盤情報/積算集約/積算明細): pale blue background (12章/13章)', () => {
    render(
      <DrawingNavigator pages={[]} selectedPageNo={null} onSelectPage={() => {}} loading={false} error={null} />,
    )
    const heading = screen.getByText('図面一覧')
    const style = getComputedStyle(heading)
    expect(style.backgroundColor).toBe('rgb(239, 246, 255)') // #eff6ff、右ペイン3見出しと同じ
    expect(style.fontWeight).toBe('700')
  })

  it('keeps the group title (外形図/基礎図/内部機器配置図) visually distinct from — and lighter than — the new section-header design (16章/17章: Level1/Level2の階層を維持する)', () => {
    const pages = [makePage({ page_no: 16, drawing_type: '外形図' })]
    render(
      <DrawingNavigator pages={pages} selectedPageNo={null} onSelectPage={() => {}} loading={false} error={null} />,
    )
    const groupTitle = screen.getByText('外形図')
    const style = getComputedStyle(groupTitle)
    // group titleには青背景を付けない(セクション見出しと同じ濃さにしない)。
    expect(style.backgroundColor).not.toBe('rgb(239, 246, 255)')
    expect(style.fontWeight).not.toBe('700')
  })

  it('does not reduce the number of rendered thumbnails after the heading style change (22章)', () => {
    const pages = [makePage({ page_no: 16 }), makePage({ page_no: 18 }), makePage({ page_no: 21 })]
    render(
      <DrawingNavigator pages={pages} selectedPageNo={null} onSelectPage={() => {}} loading={false} error={null} />,
    )
    expect(screen.getAllByRole('img')).toHaveLength(3)
  })

  it('keeps thumbnail click behavior unaffected by the heading style change (22章)', () => {
    const pages = [makePage({ page_no: 42 })]
    const onSelectPage = vi.fn()
    render(
      <DrawingNavigator pages={pages} selectedPageNo={null} onSelectPage={onSelectPage} loading={false} error={null} />,
    )
    fireEvent.click(screen.getByRole('img', { name: 'P42' }))
    expect(onSelectPage).toHaveBeenCalledWith(42)
  })

  it('does not increase the heading padding/margin beyond what right-pane section headers already use (23章: 情報密度を増やさない)', () => {
    render(
      <DrawingNavigator pages={[]} selectedPageNo={null} onSelectPage={() => {}} loading={false} error={null} />,
    )
    const heading = screen.getByText('図面一覧')
    expect(getComputedStyle(heading).padding).toBe('0.3rem 0.5rem')
  })
})
