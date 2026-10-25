import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DesignPageList } from './DesignPageList'
import type { DesignPage, DesignPages } from '../../types/domain'

function item(over: Partial<DesignPage> = {}): DesignPage {
  return { key: '1', page_label: '1', drawing_name: '単線系統図', mode: 'preview', inference_page_no: null, ban_labels: [], ...over }
}

function pages(items: DesignPage[], status: DesignPages['status'] = 'ok'): DesignPages {
  return { status, items, skipped_rows: 0 }
}

const thumbUrl = (key: string) => `/img/${encodeURIComponent(key)}`

function row(key: string): HTMLElement {
  return document.querySelector(`[data-design-key="${key}"]`) as HTMLElement
}

function renderList(designPages: DesignPages | null, over: Partial<Parameters<typeof DesignPageList>[0]> = {}) {
  return render(
    <DesignPageList designPages={designPages} selectedKey={null} onSelect={() => {}} thumbnailUrl={thumbUrl} {...over} />,
  )
}

describe('DesignPageList', () => {
  it('shows a loading note before the list is fetched', () => {
    renderList(null)
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('lists page numbers as strings (01 and 1 are different rows) with names and a badge per display mode', () => {
    renderList(
      pages([
        item({ key: '2', page_label: '2', drawing_name: '外形図', mode: 'inference', inference_page_no: 2 }),
        item({ key: '01', page_label: '01', drawing_name: '質量計算書' }),
        item({ key: '1', page_label: '1' }),
        item({ key: 'mk01', page_label: 'MK01', drawing_name: '金具', mode: 'unavailable' }),
      ]),
      { selectedKey: '01' },
    )
    const rows = Array.from(document.querySelectorAll('[data-design-key]')) as HTMLElement[]
    expect(rows.map((r) => r.getAttribute('data-design-key'))).toEqual(['2', '01', '1', 'mk01'])
    expect(rows[1].querySelector('.design-page-list__no')?.textContent).toBe('01')
    expect(rows[2].querySelector('.design-page-list__no')?.textContent).toBe('1')
    expect(within(rows[0]).getByText('推論')).toBeInTheDocument()
    expect(within(rows[1]).getByText('プレビュー')).toBeInTheDocument()
    expect(within(rows[3]).getByText('画像なし', { selector: '.design-page-list__badge' })).toBeInTheDocument()
    expect(rows[1]).toHaveAttribute('aria-current', 'true')
    expect(rows[2]).not.toHaveAttribute('aria-current')
  })

  it('shows each row\'s own thumbnail (inference PNG or preview PNG by key), lazily loaded, never swapping 01 and 1', () => {
    renderList(
      pages([
        item({ key: '9', page_label: '9', mode: 'inference', inference_page_no: 9, drawing_name: '外形図' }),
        item({ key: '01', page_label: '01', drawing_name: '質量計算書' }),
        item({ key: '1', page_label: '1', drawing_name: '単線系統図' }),
        item({ key: 'MB01', page_label: 'mb01', drawing_name: '銅帯' }),
      ]),
    )
    const srcOf = (key: string) => (row(key).querySelector('img') as HTMLImageElement).getAttribute('src')
    expect(srcOf('9')).toBe('/img/9')
    expect(srcOf('01')).toBe('/img/01')
    expect(srcOf('1')).toBe('/img/1')
    expect(srcOf('MB01')).toBe('/img/MB01')               // 表示ラベル(mb01)ではなく、PDF名の綴りのキーで引く
    for (const key of ['9', '01', '1', 'MB01']) {
      const img = row(key).querySelector('img') as HTMLImageElement
      expect(img.getAttribute('loading')).toBe('lazy')    // 大量の画像を一度に読み込まない
      expect(img.getAttribute('alt')).toContain(`ページ番号 ${key === 'MB01' ? 'mb01' : key}`)
    }
    expect(row('01').querySelector('img')?.getAttribute('src')).not.toBe(row('1').querySelector('img')?.getAttribute('src'))
  })

  it('shows a fixed placeholder (no image request) for a page without a display image, and when an image fails to load, without breaking the list', () => {
    renderList(
      pages([
        item({ key: 'ms01', page_label: 'MS01', mode: 'unavailable' }),
        item({ key: '5', page_label: '5' }),
        item({ key: '6', page_label: '6' }),
      ]),
    )
    expect(row('ms01').querySelector('img')).toBeNull()
    expect(within(row('ms01')).getAllByText('画像なし').length).toBe(2)   // プレースホルダー+バッジ
    const img5 = row('5').querySelector('img') as HTMLImageElement
    fireEvent.error(img5)
    expect(row('5').querySelector('img')).toBeNull()
    expect(within(row('5')).getByText('画像なし')).toBeInTheDocument()
    // 他の行は影響を受けない
    expect(row('6').querySelector('img')).not.toBeNull()
    expect(document.querySelectorAll('[data-design-key]')).toHaveLength(3)
    expect(document.body.textContent).not.toMatch(/Error|Traceback|[A-Za-z]:\\/)
  })

  it('reports the clicked row (with its string key) from the thumbnail or the text, and shows a placeholder for an empty drawing name', () => {
    const onSelect = vi.fn()
    renderList(pages([item({ key: 'MB01', page_label: 'mb01', drawing_name: '' })]), { onSelect })
    expect(screen.getByText('(図名なし)')).toBeInTheDocument()
    fireEvent.click(row('MB01').querySelector('img') as HTMLElement)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ key: 'MB01', page_label: 'mb01' }))
    fireEvent.click(screen.getByText('mb01'))
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('puts the 面番号/盤番号 (as in the source data) and the drawing name above the thumbnail, never inventing or reformatting a number', () => {
    renderList(
      pages([
        item({ key: '9', page_label: '9', drawing_name: '外形図(1)', mode: 'inference', inference_page_no: 9, ban_labels: ['1/1', '2/2', '3/3'] }),
        item({ key: '01', page_label: '01', drawing_name: '質量計算書' }),
      ]),
    )
    const head9 = row('9').querySelector('.design-page-list__head') as HTMLElement
    const thumb9 = row('9').querySelector('.design-page-list__thumb') as HTMLElement
    // 上部(ヘッダー)がサムネイルより前にある
    expect(head9.compareDocumentPosition(thumb9) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(head9).getByText('1/1、2/2、3/3')).toBeInTheDocument()   // 元データの表記のまま(P接頭辞なし・再採番なし)
    expect(within(head9).getByText('外形図(1)')).toBeInTheDocument()
    expect(head9.textContent).not.toMatch(/(^|\s)P\d/)
    // 元データに面/盤が無い書類ページには、番号を出さない(推測しない)。図名と、ページ番号(元の表記)だけ。
    const head01 = row('01').querySelector('.design-page-list__head') as HTMLElement
    expect(head01.querySelector('.design-page-list__ban')).toBeNull()
    expect(within(head01).getByText('質量計算書')).toBeInTheDocument()
    expect(row('01').querySelector('.design-page-list__no')?.textContent).toBe('01')
  })

  it('draws every card as its own bordered card (one button per row, separate list items) and marks only the selected one', () => {
    renderList(pages([item({ key: 'a', page_label: 'a' }), item({ key: 'b', page_label: 'b' }), item({ key: 'c', page_label: 'c' })]), { selectedKey: 'b' })
    const lis = document.querySelectorAll('.design-page-list__items > li')
    expect(lis).toHaveLength(3)
    lis.forEach((li) => expect(li.querySelectorAll('button.design-page-list__item')).toHaveLength(1))
    expect(document.querySelectorAll('.design-page-list__item--selected')).toHaveLength(1)
    expect(row('b')).toHaveClass('design-page-list__item--selected')
    expect(within(row('b')).getByText('表示中')).toBeInTheDocument()
    expect(screen.getAllByText('表示中')).toHaveLength(1)
  })
  it('shows the page number (as in design.csv, no prefix) BEFORE the drawing name in the card header, e.g. "01　質量計算書"', () => {
    renderList(
      pages([
        item({ key: '01', page_label: '01', drawing_name: '質量計算書' }),
        item({ key: 'a1', page_label: 'a1', drawing_name: '外形図' }),
        item({ key: 'MB01', page_label: 'mb01', drawing_name: '銅帯' }),
      ]),
    )
    const title = (key: string) => (row(key).querySelector('.design-page-list__title') as HTMLElement).textContent
    expect(title('01')).toBe('01　質量計算書')
    expect(title('a1')).toBe('a1　外形図')
    expect(title('MB01')).toBe('mb01　銅帯')                         // 表記は design.csv のまま(キーの綴り MB01 ではない)
    const no = row('01').querySelector('.design-page-list__no') as HTMLElement
    const name = row('01').querySelector('.design-page-list__name') as HTMLElement
    expect(no.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(row('01').querySelector('.design-page-list__head')?.textContent).not.toMatch(/(^|[^A-Za-z0-9])P\d/)   // P接頭辞を付けない
  })

  it('keeps the order it is given (the API returns design.csv page-number order) and never merges 01 with 1', () => {
    renderList(
      pages(['0', '01', '02', '1', '2', 'a1', 'b1', 'c'].map((n) => item({ key: n, page_label: n, drawing_name: `図${n}` }))),
    )
    expect(Array.from(document.querySelectorAll('.design-page-list__no')).map((e) => e.textContent)).toEqual([
      '0', '01', '02', '1', '2', 'a1', 'b1', 'c',
    ])
  })
  it('filters to inference pages by visiblePageNos (estimate target filter) and says so when nothing matches', () => {
    const items = [
      item({ key: '2', page_label: '2', mode: 'inference', inference_page_no: 2 }),
      item({ key: '3', page_label: '3', mode: 'inference', inference_page_no: 3 }),
      item({ key: '01', page_label: '01' }),
    ]
    const { rerender } = renderList(pages(items), { visiblePageNos: new Set([3]) })
    expect(Array.from(document.querySelectorAll('[data-design-key]')).map((e) => e.getAttribute('data-design-key'))).toEqual(['3'])
    rerender(
      <DesignPageList designPages={pages(items)} selectedKey={null} onSelect={() => {}} thumbnailUrl={thumbUrl} visiblePageNos={new Set([99])} />,
    )
    expect(screen.getByText('該当する図面はありません')).toBeInTheDocument()
  })
})
