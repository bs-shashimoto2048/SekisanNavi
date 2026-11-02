import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DesignPageList } from './DesignPageList'
import type { DesignDocument, DesignPage, DesignPages } from '../../types/domain'

const SPEC: DesignDocument = { key: '0_S0', kind: 'spec_sheet', label: '共通製作仕様書' }
const CHECK: DesignDocument = { key: '0_A1', kind: 'check_sheet', label: '設計作図完了シート' }

function item(over: Partial<DesignPage> = {}): DesignPage {
  return { key: '1', page_label: '1', drawing_name: '単線系統図', mode: 'preview', inference_page_no: null, ban_labels: [], ...over }
}

function pages(items: DesignPage[], documents?: DesignDocument[]): DesignPages {
  return { status: 'ok', items, skipped_rows: 0, documents }
}

function renderList(designPages: DesignPages, over: Partial<Parameters<typeof DesignPageList>[0]> = {}) {
  return render(
    <DesignPageList
      designPages={designPages}
      selectedKey={null}
      onSelect={() => {}}
      thumbnailUrl={(k) => `/img/${k}`}
      documentThumbnailUrl={(k) => `/documents/${k}.png`}
      onSelectDocument={() => {}}
      {...over}
    />,
  )
}

describe('design documents (共通製作仕様書 / 設計作図完了シート)', () => {
  it('shows the spec sheet first, then the check sheet, then the normal drawings', () => {
    renderList(pages([item({ key: '1' }), item({ key: '2', page_label: '2' })], [SPEC, CHECK]))
    const docs = Array.from(document.querySelectorAll('[data-design-document]')).map((e) => e.getAttribute('data-design-document'))
    expect(docs).toEqual(['0_S0', '0_A1'])
    const list = within(screen.getByRole('navigation'))
    const all = Array.from(document.querySelectorAll('[data-design-document], [data-design-key]')).map(
      (e) => e.getAttribute('data-design-document') ?? e.getAttribute('data-design-key'),
    )
    expect(all).toEqual(['0_S0', '0_A1', '1', '2'])                 // 書類 → 通常の図面
    expect(list.getByText('共通製作仕様書')).toBeInTheDocument()
    expect(list.getByText('設計作図完了シート')).toBeInTheDocument()
  })

  it('a missing file is simply not shown (no dead link, no error)', () => {
    renderList(pages([item()], [CHECK]))                           // 仕様書は無い
    expect(document.querySelector('[data-design-document="0_S0"]')).toBeNull()
    expect(document.querySelector('[data-design-document="0_A1"]')).not.toBeNull()
    expect(screen.queryByText('共通製作仕様書')).toBeNull()
    expect(screen.queryByText(/エラー|見つかりません/)).toBeNull()
  })

  it('shows no documents block when there are none, or when the list has no document callback', () => {
    renderList(pages([item()], []))
    expect(document.querySelector('[data-design-document]')).toBeNull()
    renderList(pages([item()]))                                    // documents 未指定でも壊れない
    expect(document.querySelectorAll('[data-design-document]').length).toBe(0)
  })

  it('does not treat the documents as page numbers: clicking selects the document (like any drawing card), not a drawing page', () => {
    const onSelectDocument = vi.fn()
    const onSelect = vi.fn()
    renderList(pages([item()], [SPEC, CHECK]), { onSelectDocument, onSelect })
    fireEvent.click(document.querySelector('[data-design-document="0_A1"]') as HTMLElement)
    expect(onSelectDocument).toHaveBeenCalledWith(CHECK)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows separate lazy PNG thumbnails for each document', () => {
    renderList(pages([item()], [SPEC, CHECK]))
    const spec = document.querySelector('[data-design-document="0_S0"]') as HTMLButtonElement
    const check = document.querySelector('[data-design-document="0_A1"]') as HTMLButtonElement
    expect(spec.querySelector('img')?.getAttribute('src')).toBe('/documents/0_S0.png')
    expect(check.querySelector('img')?.getAttribute('src')).toBe('/documents/0_A1.png')
    expect(spec.querySelector('img')?.getAttribute('loading')).toBe('lazy')
    expect(spec).toHaveAttribute('title', '共通製作仕様書の表示用プレビューを中央に表示')
  })

  it('keeps a normal page 0 row (design.csv) separate from the documents', () => {
    renderList(pages([item({ key: '0', page_label: '0', drawing_name: '設計作図完了チェックシート(従来)', mode: 'unavailable' })], [CHECK]))
    expect(document.querySelector('[data-design-document="0_A1"]')).not.toBeNull()
    expect(document.querySelector('[data-design-key="0"]')).not.toBeNull()    // 通常の 0 は図面の行のまま(書類と混ざらない)
    expect(document.querySelector('[data-design-key="0_A1"]')).toBeNull()
  })

  it('shows the documents even while the drawing selection is still awaited, but not counted in 表示 N / M 件', () => {
    renderList(pages([item(), item({ key: '2', page_label: '2' })], [SPEC]), { awaitingSelection: true, onOpenPicker: () => {} })
    expect(document.querySelector('[data-design-document="0_S0"]')).not.toBeNull()
    renderList(pages([item(), item({ key: '2', page_label: '2' })], [SPEC, CHECK]), { onOpenPicker: () => {}, totalCount: 2 })
    expect(screen.getByText('表示 2 / 2 件')).toBeInTheDocument()
  })
})

describe('書類カードの選択(通常の図面のカードと同じ操作)', () => {
  it('has no PDF action: there is exactly one button per document and no 「PDFを開く」', () => {
    renderList(pages([item()], [SPEC, CHECK]))
    expect(screen.queryByText('PDFを開く')).toBeNull()
    expect(document.querySelector('[data-design-document-pdf]')).toBeNull()
    expect(document.querySelectorAll('[aria-label="書類"] button')).toHaveLength(2)
    expect(document.querySelector('.design-page-list__badge--document')).toBeNull()
  })

  it('marks the selected document with aria-current (as the normal drawing cards do) and nothing else', () => {
    renderList(pages([item()], [SPEC, CHECK]), { selectedDocumentKey: '0_A1' })
    expect(document.querySelector('[data-design-document="0_A1"]')).toHaveAttribute('aria-current', 'true')
    expect(document.querySelector('[data-design-document="0_S0"]')).not.toHaveAttribute('aria-current')
  })

  it('shows 「画像なし」 for a document whose preview image fails to load, without breaking the list', () => {
    renderList(pages([item()], [SPEC, CHECK]))
    const img = document.querySelector('[data-design-document="0_S0"] img') as HTMLImageElement
    fireEvent.error(img)
    expect(within(document.querySelector('[data-design-document="0_S0"]') as HTMLElement).getByText('画像なし')).toBeInTheDocument()
    expect(document.querySelector('[data-design-document="0_A1"] img')).not.toBeNull()       // 他の書類・図面は影響を受けない
    expect(document.querySelector('[data-design-key="1"]')).not.toBeNull()
  })
})
