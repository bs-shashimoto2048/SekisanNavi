import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DesignPageList } from './DesignPageList'
import { DesignDocumentModal } from './DesignDocumentModal'
import { designDocumentFileUrl } from '../../api/client'
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
      onOpenDocument={() => {}}
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

  it('does not treat the documents as page numbers: clicking opens the document, not a drawing page', () => {
    const onOpenDocument = vi.fn()
    const onSelect = vi.fn()
    renderList(pages([item()], [SPEC, CHECK]), { onOpenDocument, onSelect })
    fireEvent.click(document.querySelector('[data-design-document="0_A1"]') as HTMLElement)
    expect(onOpenDocument).toHaveBeenCalledWith(CHECK)
    expect(onSelect).not.toHaveBeenCalled()
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

describe('DesignDocumentModal', () => {
  it('shows the PDF through the dedicated document route (never the page-number route)', () => {
    render(<DesignDocumentModal productNo="A1TEST01" document={SPEC} onClose={() => {}} />)
    const frame = screen.getByTitle('共通製作仕様書のPDF') as HTMLIFrameElement
    expect(frame.getAttribute('src')).toBe(designDocumentFileUrl('A1TEST01', '0_S0'))
    expect(frame.getAttribute('src')).toContain('/design-documents/0_S0/file')
    expect(frame.getAttribute('src')).not.toContain('/drawings/')
  })

  it('closes with the button and the backdrop only', () => {
    const onClose = vi.fn()
    render(<DesignDocumentModal productNo="A1TEST01" document={CHECK} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
