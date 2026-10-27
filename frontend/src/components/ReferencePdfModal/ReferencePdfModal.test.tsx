import { forwardRef, useImperativeHandle, useState } from 'react'
import type { Ref } from 'react'
import { createPortal } from 'react-dom'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReferencePdfModal } from './ReferencePdfModal'
import { ApiError, fetchReferencePdfs, referencePdfFileUrl } from '../../api/client'
import type { ReferencePdfItem } from '../../types/domain'

// [技術的ブロッカー解消] PDF表示自体はReferencePdfViewer(pdfjs-dist)側の責務のため、
// ここではファイル一覧・選択・ウィンドウ移動/リサイズ・キー操作の振り分けの
// ロジックのみを検証する(ReferencePdfViewer自身の検証はReferencePdfViewer.test.tsx
// 参照)。実コンポーネントは`forwardRef`で`goToNextPage`/`goToPrevPage`を公開して
// いるため、このstubも同じ形(forwardRef + useImperativeHandle)にし、呼び出し
// 履歴を`data-calls`属性に出して、ReferencePdfModal側の←/→キー処理が正しく
// 委譲していることを検証できるようにする。
// 指示(タイトルバー1行化): 実コンポーネントは`statusBarContainer`が渡されると
// ページ番号/倍率表示をそこへ`createPortal`する。ここではstub側でも同じ
// 挙動の最小限の再現(固定テキストをportalするだけ)をし、
// ReferencePdfModal側が正しいDOM位置(タイトルバー内)へ差し込み先を用意して
// いることだけを検証できるようにする(実際のページ/倍率算出ロジック自体は
// 検証しない=ReferencePdfViewer.test.tsx側の責務のまま)。
vi.mock('./ReferencePdfViewer', () => ({
  ReferencePdfViewer: forwardRef(function ReferencePdfViewerStub(
    {
      fileUrl,
      statusBarContainer,
    }: { fileUrl: string | null; statusBarContainer?: HTMLElement | null },
    ref: Ref<{ goToNextPage: () => void; goToPrevPage: () => void }>,
  ) {
    const [calls, setCalls] = useState<string[]>([])
    useImperativeHandle(ref, () => ({
      goToNextPage: () => setCalls((c) => [...c, 'next']),
      goToPrevPage: () => setCalls((c) => [...c, 'prev']),
    }))
    return (
      <div data-testid="pdf-viewer-stub" data-calls={calls.join(',')}>
        {fileUrl ?? 'none'}
        {statusBarContainer && fileUrl
          ? createPortal(<span data-testid="viewer-status-stub">1 / 2 85%</span>, statusBarContainer)
          : null}
      </div>
    )
  }),
}))

vi.mock('../../api/client', () => ({
  fetchReferencePdfs: vi.fn(),
  referencePdfFileUrl: vi.fn((filename: string) => `/api/help/reference-pdfs/${filename}`),
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

const mockFetchList = vi.mocked(fetchReferencePdfs)
const mockFileUrl = vi.mocked(referencePdfFileUrl)

function item(partial: Partial<ReferencePdfItem> & { filename: string }): ReferencePdfItem {
  return { code: null, target: null, valid: false, ...partial }
}

beforeEach(() => {
  mockFetchList.mockReset()
  mockFileUrl.mockReset().mockImplementation((filename: string) => `/api/help/reference-pdfs/${filename}`)
  // jsdomの既定viewportサイズ(1024x768)を明示しておく(初期配置・clamp計算の前提)。
  window.innerWidth = 1024
  window.innerHeight = 768
})

describe('ReferencePdfModal', () => {
  it('shows a loading message before the list fetch resolves', () => {
    mockFetchList.mockReturnValue(new Promise(() => {})) // 未解決のまま
    render(<ReferencePdfModal onClose={() => {}} />)
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('shows a clear "folder not found" message when folder_exists=false (指示: フォルダが存在しない場合)', async () => {
    mockFetchList.mockResolvedValue({ folder_exists: false, items: [] })
    render(<ReferencePdfModal onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText(/資料フォルダが見つかりません/)).toBeInTheDocument())
  })

  it('shows a clear "no PDFs" message when the folder exists but is empty (指示: PDFがない場合)', async () => {
    mockFetchList.mockResolvedValue({ folder_exists: true, items: [] })
    render(<ReferencePdfModal onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText(/資料フォルダにPDFがありません/)).toBeInTheDocument())
  })

  it('shows a describeFetchError-formatted message when the list fetch itself fails', async () => {
    mockFetchList.mockRejectedValue(new ApiError(503, 'サーバーに接続できませんでした。'))
    render(<ReferencePdfModal onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText(/資料一覧の取得に失敗しました/)).toBeInTheDocument())
  })

  it('lists valid PDFs as code/target rows, selects the first row, and passes its URL to the viewer (指示: 正常なPDFが複数ある場合 / 初期表示では先頭行を選択)', async () => {
    mockFetchList.mockResolvedValue({
      folder_exists: true,
      items: [
        item({ filename: '44249_主回路銅帯_入力.pdf', code: '44249', target: '主回路銅帯_入力', valid: true }),
        item({ filename: '50100_端子台.pdf', code: '50100', target: '端子台', valid: true }),
      ],
    })
    render(<ReferencePdfModal onClose={() => {}} />)

    await screen.findByText('44249')
    expect(screen.getByText('主回路銅帯_入力')).toBeInTheDocument()
    expect(screen.getByText('50100')).toBeInTheDocument()

    const firstRow = screen.getByText('44249').closest('tr') as HTMLElement
    expect(firstRow.className).toContain('reference-pdf-window__row--selected')
    expect(screen.getByTestId('pdf-viewer-stub')).toHaveTextContent(
      '/api/help/reference-pdfs/44249_主回路銅帯_入力.pdf',
    )
    expect(mockFileUrl).toHaveBeenCalledWith('44249_主回路銅帯_入力.pdf')
  })

  it('lists a malformed (no underscore) filename as its own row with a 形式不正 notice, not as a fabricated code/target (指示: ファイル名にアンダーバーがないPDF)', async () => {
    mockFetchList.mockResolvedValue({
      folder_exists: true,
      items: [item({ filename: 'broken.pdf', code: null, target: null, valid: false })],
    })
    render(<ReferencePdfModal onClose={() => {}} />)

    await screen.findByText(/broken\.pdf.*形式不正/)
  })

  it('selects a row on click and switches the viewer URL accordingly', async () => {
    mockFetchList.mockResolvedValue({
      folder_exists: true,
      items: [
        item({ filename: 'a_target-a.pdf', code: 'a', target: 'target-a', valid: true }),
        item({ filename: 'b_target-b.pdf', code: 'b', target: 'target-b', valid: true }),
      ],
    })
    render(<ReferencePdfModal onClose={() => {}} />)

    await screen.findByText('target-a')
    fireEvent.click(screen.getByText('target-b'))

    expect(screen.getByTestId('pdf-viewer-stub')).toHaveTextContent('/api/help/reference-pdfs/b_target-b.pdf')
    expect(screen.getByText('b').closest('tr')!.className).toContain('reference-pdf-window__row--selected')
  })

  it('moves the selection down/up with arrow keys while the window is focused, and syncs the viewer URL (指示: 上下キーで一覧の選択行を移動)', async () => {
    mockFetchList.mockResolvedValue({
      folder_exists: true,
      items: [
        item({ filename: 'a_target-a.pdf', code: 'a', target: 'target-a', valid: true }),
        item({ filename: 'b_target-b.pdf', code: 'b', target: 'target-b', valid: true }),
        item({ filename: 'c_target-c.pdf', code: 'c', target: 'target-c', valid: true }),
      ],
    })
    const { container } = render(<ReferencePdfModal onClose={() => {}} />)
    await screen.findByText('target-a')

    const win = container.querySelector('.reference-pdf-window') as HTMLElement

    fireEvent.keyDown(win, { key: 'ArrowDown' })
    expect(screen.getByTestId('pdf-viewer-stub')).toHaveTextContent('b_target-b.pdf')

    fireEvent.keyDown(win, { key: 'ArrowDown' })
    expect(screen.getByTestId('pdf-viewer-stub')).toHaveTextContent('c_target-c.pdf')

    fireEvent.keyDown(win, { key: 'ArrowUp' })
    expect(screen.getByTestId('pdf-viewer-stub')).toHaveTextContent('b_target-b.pdf')
  })

  it('clamps arrow-key navigation at the list boundaries instead of wrapping or erroring', async () => {
    mockFetchList.mockResolvedValue({
      folder_exists: true,
      items: [
        item({ filename: 'a_target-a.pdf', code: 'a', target: 'target-a', valid: true }),
        item({ filename: 'b_target-b.pdf', code: 'b', target: 'target-b', valid: true }),
      ],
    })
    const { container } = render(<ReferencePdfModal onClose={() => {}} />)
    await screen.findByText('target-a')
    const win = container.querySelector('.reference-pdf-window') as HTMLElement

    fireEvent.keyDown(win, { key: 'ArrowUp' })
    expect(screen.getByTestId('pdf-viewer-stub')).toHaveTextContent('a_target-a.pdf')

    fireEvent.keyDown(win, { key: 'ArrowDown' })
    fireEvent.keyDown(win, { key: 'ArrowDown' })
    expect(screen.getByTestId('pdf-viewer-stub')).toHaveTextContent('b_target-b.pdf')
  })

  it('forwards ←/→ to the viewer as page-turn commands, without touching the list selection (指示: ←/→キーでページ送り。↑/↓は一覧選択に使い競合させない)', async () => {
    mockFetchList.mockResolvedValue({
      folder_exists: true,
      items: [item({ filename: 'a_target-a.pdf', code: 'a', target: 'target-a', valid: true })],
    })
    const { container } = render(<ReferencePdfModal onClose={() => {}} />)
    await screen.findByText('target-a')
    const win = container.querySelector('.reference-pdf-window') as HTMLElement
    const stub = screen.getByTestId('pdf-viewer-stub')

    fireEvent.keyDown(win, { key: 'ArrowRight' })
    expect(stub).toHaveAttribute('data-calls', 'next')

    fireEvent.keyDown(win, { key: 'ArrowLeft' })
    expect(stub).toHaveAttribute('data-calls', 'next,prev')

    // ↑/↓は引き続き一覧選択(1件だけなので選択は変化しないが、viewerへは
    // 転送されない=data-callsが増えないことで確認する)。
    fireEvent.keyDown(win, { key: 'ArrowDown' })
    fireEvent.keyDown(win, { key: 'ArrowUp' })
    expect(stub).toHaveAttribute('data-calls', 'next,prev')
  })

  it('does not intercept ←/→/↑/↓ while focus is on an editable element (指示: キー操作は入力欄など文字入力中には横取りしない)', async () => {
    mockFetchList.mockResolvedValue({
      folder_exists: true,
      items: [
        item({ filename: 'a_target-a.pdf', code: 'a', target: 'target-a', valid: true }),
        item({ filename: 'b_target-b.pdf', code: 'b', target: 'target-b', valid: true }),
      ],
    })
    const { container } = render(<ReferencePdfModal onClose={() => {}} />)
    await screen.findByText('target-a')
    const win = container.querySelector('.reference-pdf-window') as HTMLElement

    const input = document.createElement('input')
    win.appendChild(input)
    input.focus()

    fireEvent.keyDown(input, { key: 'ArrowRight' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })

    expect(screen.getByTestId('pdf-viewer-stub')).not.toHaveAttribute('data-calls', 'next')
    expect(screen.getByText('a').closest('tr')!.className).toContain('reference-pdf-window__row--selected')
  })

  it('does nothing on arrow keys when there are no items (指示: 一覧0件時の安全性)', async () => {
    mockFetchList.mockResolvedValue({ folder_exists: true, items: [] })
    const { container } = render(<ReferencePdfModal onClose={() => {}} />)
    await screen.findByText(/資料フォルダにPDFがありません/)
    const win = container.querySelector('.reference-pdf-window') as HTMLElement

    expect(() => fireEvent.keyDown(win, { key: 'ArrowDown' })).not.toThrow()
    expect(screen.getByTestId('pdf-viewer-stub')).toHaveTextContent('none')
  })

  it('calls onClose when the × button is clicked', () => {
    mockFetchList.mockReturnValue(new Promise(() => {}))
    const onClose = vi.fn()
    render(<ReferencePdfModal onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('has no backdrop element (指示: 背景を操作不能にする真のmodalではない非ブロッキングウィンドウ)', () => {
    mockFetchList.mockReturnValue(new Promise(() => {}))
    const { container } = render(<ReferencePdfModal onClose={() => {}} />)
    expect(container.querySelector('.reference-pdf-window__backdrop')).toBeNull()
    expect(container.querySelectorAll('[class*="backdrop"]').length).toBe(0)
  })

  it('has a heading distinct from "積算資料" (単一固定PDFのHelpとは別機能であることの表示上の確認)', () => {
    mockFetchList.mockReturnValue(new Promise(() => {}))
    render(<ReferencePdfModal onClose={() => {}} />)
    expect(screen.getByRole('heading', { name: '資料' })).toBeInTheDocument()
  })

  it('puts the heading, page/zoom status, list toggle and close button all inside one non-wrapping titlebar row (指示: 資料、ページ番号、倍率、一覧切替、×を上部の1行にまとめる。独立した2行目のステータスバーを残さない。ウィンドウ幅が狭くなっても2行に折り返さない)', async () => {
    mockFetchList.mockResolvedValue({
      folder_exists: true,
      items: [item({ filename: 'a_target-a.pdf', code: 'a', target: 'target-a', valid: true })],
    })
    const { container } = render(<ReferencePdfModal onClose={() => {}} />)
    await screen.findByText('target-a')

    const titlebar = container.querySelector('.reference-pdf-window__titlebar') as HTMLElement
    expect(titlebar).toBeInTheDocument()

    // 見出し「資料」もタイトルバー内にある。
    expect(titlebar.contains(screen.getByRole('heading', { name: '資料' }))).toBe(true)

    // ページ番号/倍率(ReferencePdfViewerからportalされる)もタイトルバー内にある
    // (資料ウィンドウ本体側=viewer-pane側には無い、独立した2行目を残さない)。
    const statusStub = await screen.findByTestId('viewer-status-stub')
    expect(titlebar.contains(statusStub)).toBe(true)
    const viewerPane = container.querySelector('.reference-pdf-window__viewer-pane') as HTMLElement
    expect(viewerPane.contains(statusStub)).toBe(false)

    // 一覧切替・×ボタンもタイトルバー内にある。
    expect(titlebar.contains(screen.getByRole('button', { name: '一覧を隠す' }))).toBe(true)
    expect(titlebar.contains(screen.getByRole('button', { name: '閉じる' }))).toBe(true)

    // 折り返さない(指示: ウィンドウ幅が狭くなっても2行に折り返さない)。
    expect(getComputedStyle(titlebar).flexWrap).toBe('nowrap')

    // タイトルバー自体は「見出し+ステータスのグループ」「操作ボタンのグループ」
    // の2つの直接の子要素だけで構成される(新しい独立した行を追加していない)。
    expect(titlebar.children.length).toBe(2)
  })

  it('gives the × close button a persistently visible background and border, distinct from the plain list-toggle text button (指示: ×は、クリック可能な範囲が分かる背景・境界・ホバー表示を付け、明確なボタンとして見せる)', () => {
    mockFetchList.mockReturnValue(new Promise(() => {}))
    render(<ReferencePdfModal onClose={() => {}} />)
    const closeButton = screen.getByRole('button', { name: '閉じる' })
    expect(closeButton).toHaveClass('reference-pdf-window__close-button')
    expect(getComputedStyle(closeButton).borderStyle).toBe('solid')
    expect(getComputedStyle(closeButton).backgroundColor).not.toBe('')
    expect(getComputedStyle(closeButton).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(closeButton).backgroundColor).not.toBe('transparent')
  })

  it('does not start a titlebar drag from the close button, and clicking it still calls onClose (指示: ×はウィンドウのドラッグ移動と競合しない)', () => {
    mockFetchList.mockReturnValue(new Promise(() => {}))
    const onClose = vi.fn()
    const { container } = render(<ReferencePdfModal onClose={onClose} />)
    const titlebar = container.querySelector('.reference-pdf-window__titlebar') as HTMLElement
    const closeButton = screen.getByRole('button', { name: '閉じる' })
    const before = { top: titlebar.closest('.reference-pdf-window')!.getAttribute('style') }

    fireEvent.pointerDown(closeButton, { button: 0, clientX: 10, clientY: 10, pointerId: 11 })
    fireEvent.pointerMove(titlebar, { clientX: 300, clientY: 300, pointerId: 11 })
    fireEvent.pointerUp(titlebar, { clientX: 300, clientY: 300, pointerId: 11 })

    const after = { top: titlebar.closest('.reference-pdf-window')!.getAttribute('style') }
    expect(after).toEqual(before) // ドラッグは発生していない

    fireEvent.click(closeButton)
    expect(onClose).toHaveBeenCalled()
  })

  it('hiding the file list hides it and does not remount the viewer or change the selection (指示: 一覧を隠すとPDF表示領域が広がる。再表示後も選択中のPDFとページを維持する)', async () => {
    mockFetchList.mockResolvedValue({
      folder_exists: true,
      items: [
        item({ filename: 'a_target-a.pdf', code: 'a', target: 'target-a', valid: true }),
        item({ filename: 'b_target-b.pdf', code: 'b', target: 'target-b', valid: true }),
      ],
    })
    const { container } = render(<ReferencePdfModal onClose={() => {}} />)
    await screen.findByText('target-a')

    fireEvent.click(screen.getByText('target-b'))
    expect(screen.getByTestId('pdf-viewer-stub')).toHaveTextContent('b_target-b.pdf')
    const viewerBeforeCollapse = screen.getByTestId('pdf-viewer-stub')

    expect(container.querySelector('.reference-pdf-window__list-pane')).not.toHaveClass(
      'reference-pdf-window__list-pane--collapsed',
    )

    // 指示: 「一覧表示中のボタン表示: 一覧を隠す」「一覧非表示中のボタン表示:
    // 一覧を表示」。
    expect(screen.queryByRole('button', { name: '一覧を表示' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '一覧を隠す' }))

    expect(container.querySelector('.reference-pdf-window__list-pane')).toHaveClass(
      'reference-pdf-window__list-pane--collapsed',
    )
    // 一覧が隠れてもViewerは同一DOM要素のまま(unmount/remountしていない=指示の
    // 「選択中のPDFとページを維持する」をコンポーネントのunmount有無で保証する)。
    expect(screen.getByTestId('pdf-viewer-stub')).toBe(viewerBeforeCollapse)
    expect(screen.getByTestId('pdf-viewer-stub')).toHaveTextContent('b_target-b.pdf')
    expect(screen.queryByRole('button', { name: '一覧を隠す' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '一覧を表示' }))
    expect(container.querySelector('.reference-pdf-window__list-pane')).not.toHaveClass(
      'reference-pdf-window__list-pane--collapsed',
    )
    expect(screen.getByTestId('pdf-viewer-stub')).toBe(viewerBeforeCollapse)
    expect(screen.getByTestId('pdf-viewer-stub')).toHaveTextContent('b_target-b.pdf')
  })

  it('overlays the list on top of a full-size PDF preview, instead of splitting the window into two panes (指示: PDFプレビューをウィンドウ全体に表示し、その上に一覧を重ねる。左右に分割しない)', async () => {
    mockFetchList.mockResolvedValue({
      folder_exists: true,
      items: [item({ filename: 'a_target-a.pdf', code: 'a', target: 'target-a', valid: true })],
    })
    const { container } = render(<ReferencePdfModal onClose={() => {}} />)
    await screen.findByText('target-a')

    const viewerPane = container.querySelector('.reference-pdf-window__viewer-pane') as HTMLElement
    const listPane = container.querySelector('.reference-pdf-window__list-pane') as HTMLElement

    // viewer-paneは左右分割用のflex子要素ではなく、bodyいっぱいに重なる
    // 絶対配置(指示: 「一覧表示の有無で幅・倍率・位置を変えない」の前提となる
    // レイアウト)。
    expect(getComputedStyle(viewerPane).position).toBe('absolute');
    ['top', 'right', 'bottom', 'left'].forEach((side) => {
      expect(getComputedStyle(viewerPane)[side as 'top']).toBe('0px')
    })

    // list-paneは同じく絶対配置で、PDFの「右側」に重ねて表示する(指示:
    // 「資料プレビュー内の一覧は右側に出るようにする」)。不透明な背景と
    // 見やすい枠線を持つ(指示: 「見やすいように一覧にも枠線を付ける」)。
    expect(getComputedStyle(listPane).position).toBe('absolute')
    expect(getComputedStyle(listPane).right).toBe('0.5rem')
    expect(getComputedStyle(listPane).left).toBe('auto')
    expect(getComputedStyle(listPane).backgroundColor).not.toBe('')
    expect(getComputedStyle(listPane).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(getComputedStyle(listPane).borderStyle).toBe('solid')
    expect(parseFloat(getComputedStyle(listPane).borderWidth)).toBeGreaterThanOrEqual(2)

    // 両方とも同時に見えている(どちらかがもう一方を隠さない。一覧がPDFの
    // 「上」に重なるだけで、PDF自体は全面に描画され続ける)。
    expect(getComputedStyle(listPane).display).not.toBe('none')
    expect(getComputedStyle(viewerPane).display).not.toBe('none')
  })

  it('never wraps text inside the list columns (指示: 一覧のカラム内は折り返さないように)', async () => {
    mockFetchList.mockResolvedValue({
      folder_exists: true,
      items: [
        item({
          filename: '18313-14_トランス架台(チャンネルベース).pdf',
          code: '18313-14',
          target: '引出機器VCB・VT・LA・ZPC(IA・OAのみ)のとても長い積算対象名',
          valid: true,
        }),
        item({ filename: 'broken-file-name-no-underscore.pdf', code: null, target: null, valid: false }),
      ],
    })
    const { container } = render(<ReferencePdfModal onClose={() => {}} />)
    await screen.findByText('18313-14')

    const table = container.querySelector('.reference-pdf-window__table') as HTMLElement
    // white-spaceはinheritedプロパティのため、tableへの指定だけでコード列・
    // 積算対象列・形式不正時のファイル名セル(colSpan=2)のすべてに及ぶ。
    expect(getComputedStyle(table).whiteSpace).toBe('nowrap')

    const codeCell = screen.getByText('18313-14').closest('td') as HTMLElement
    const targetCell = screen.getByText(/引出機器VCB/).closest('td') as HTMLElement
    const invalidCell = screen.getByText(/broken-file-name-no-underscore\.pdf/).closest('td') as HTMLElement
    expect(getComputedStyle(codeCell).whiteSpace).toBe('nowrap')
    expect(getComputedStyle(targetCell).whiteSpace).toBe('nowrap')
    expect(getComputedStyle(invalidCell).whiteSpace).toBe('nowrap')

    // 折り返さない分、内容が一覧パネルの幅を超える場合があるため、パネル自体は
    // 横スクロールできる(切り詰め・省略はしない)。
    const listPane = container.querySelector('.reference-pdf-window__list-pane') as HTMLElement
    expect(getComputedStyle(listPane).overflowX).toBe('auto')
  })

  it('fixes the list-pane height to ~2/3 of the window body height via a static percentage, and keeps that ratio after the window is resized (指示: 一覧パネルの高さを資料ウィンドウ内側の高さの約2/3に固定し、リサイズ後も比率を保つ)', async () => {
    mockFetchList.mockResolvedValue({
      folder_exists: true,
      items: [item({ filename: 'a_target-a.pdf', code: 'a', target: 'target-a', valid: true })],
    })
    const { container } = render(<ReferencePdfModal onClose={() => {}} />)
    await screen.findByText('target-a')

    const listPane = container.querySelector('.reference-pdf-window__list-pane') as HTMLElement
    const heightBefore = getComputedStyle(listPane).height
    // 2/3 ≈ 66.6667%を固定px値ではなく親要素(資料ウィンドウの内側=body)に対する
    // 割合(calc式)で指定している。
    expect(heightBefore).toContain('66.6667%')

    // ウィンドウをリサイズしても、高さ指定はCSSの%指定のまま変わらない(ブラウザの
    // 実レイアウトでは%指定が親要素の新しいサイズに対して自動的に再計算される
    // ため、JS側で追従処理を書かなくても比率は保たれる。jsdomには実レイアウト
    // エンジンがないため、ここでは「リサイズ後もJSが決め打ちのpx値へ書き換えて
    // いないこと(=同じCSS比率のままであること)」を確認する。実ブラウザでの
    // ピクセル単位の比率維持はPlaywrightで別途確認する)。
    const handle = container.querySelector('.reference-pdf-window__resize-handle') as HTMLElement
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, clientY: 400, pointerId: 9 })
    fireEvent.pointerMove(handle, { clientX: 700, clientY: 600, pointerId: 9 })
    fireEvent.pointerUp(handle, { clientX: 700, clientY: 600, pointerId: 9 })

    const heightAfter = getComputedStyle(listPane).height
    expect(heightAfter).toBe(heightBefore)
  })

  describe('一覧パネルのキーボードフォーカス (指示: 一覧にフォーカスがある状態での↑/↓は選択行移動+自動スクロール。←/→やPDF側のページ送り・ズームには影響させない)', () => {
    it('moves the selection with ↑/↓ while the list pane itself has focus, without forwarding ←/→ to the PDF viewer', async () => {
      mockFetchList.mockResolvedValue({
        folder_exists: true,
        items: [
          item({ filename: 'a_target-a.pdf', code: 'a', target: 'target-a', valid: true }),
          item({ filename: 'b_target-b.pdf', code: 'b', target: 'target-b', valid: true }),
          item({ filename: 'c_target-c.pdf', code: 'c', target: 'target-c', valid: true }),
        ],
      })
      const { container } = render(<ReferencePdfModal onClose={() => {}} />)
      await screen.findByText('target-a')
      const listPane = container.querySelector('.reference-pdf-window__list-pane') as HTMLElement
      const stub = screen.getByTestId('pdf-viewer-stub')

      fireEvent.keyDown(listPane, { key: 'ArrowDown' })
      expect(stub).toHaveTextContent('b_target-b.pdf')

      fireEvent.keyDown(listPane, { key: 'ArrowDown' })
      expect(stub).toHaveTextContent('c_target-c.pdf')

      fireEvent.keyDown(listPane, { key: 'ArrowUp' })
      expect(stub).toHaveTextContent('b_target-b.pdf')

      // 一覧にフォーカスがある間は←/→がPDFのページ送りに渡らない
      // (data-callsが増えない=stub側のgoToNextPage/goToPrevPageが
      // 呼ばれていないことで確認する)。
      fireEvent.keyDown(listPane, { key: 'ArrowRight' })
      fireEvent.keyDown(listPane, { key: 'ArrowLeft' })
      expect(stub.getAttribute('data-calls') ?? '').toBe('')
    })

    it('does not propagate list keydown events up to the window (listPane handler stops propagation, so the outer handler never double-applies the move)', async () => {
      mockFetchList.mockResolvedValue({
        folder_exists: true,
        items: [
          item({ filename: 'a_target-a.pdf', code: 'a', target: 'target-a', valid: true }),
          item({ filename: 'b_target-b.pdf', code: 'b', target: 'target-b', valid: true }),
          item({ filename: 'c_target-c.pdf', code: 'c', target: 'target-c', valid: true }),
        ],
      })
      const { container } = render(<ReferencePdfModal onClose={() => {}} />)
      await screen.findByText('target-a')
      const listPane = container.querySelector('.reference-pdf-window__list-pane') as HTMLElement
      const stub = screen.getByTestId('pdf-viewer-stub')

      fireEvent.keyDown(listPane, { key: 'ArrowDown' })
      // 一覧側ハンドラのみで1行だけ移動する(外側ウィンドウのhandleKeyDownにも
      // 伝播して二重に移動してしまわないこと)。
      expect(stub).toHaveTextContent('b_target-b.pdf')
    })

    it('scrolls the selected row into view in both directions, correctly accounting for the sticky header when scrolling up (指示: 選択行が領域外へ移動したら自動スクロールして追従させる。戻り(上り)方向だけスクロールが足りずフォーカス行が置いて行かれる不具合の回帰確認)', async () => {
      mockFetchList.mockResolvedValue({
        folder_exists: true,
        items: Array.from({ length: 10 }, (_, i) =>
          item({ filename: `${i}_target-${i}.pdf`, code: String(i), target: `target-${i}`, valid: true }),
        ),
      })
      const { container } = render(<ReferencePdfModal onClose={() => {}} />)
      await screen.findByText('target-0')
      const listPane = container.querySelector('.reference-pdf-window__list-pane') as HTMLElement
      const thead = listPane.querySelector('thead') as HTMLElement

      // 一覧パネルの可視領域(見出し行を除く本文部分)を模した仮想レイアウト。
      // 見出し行(`<thead>`)は`position: sticky; top: 0`で常にパネル上端(100)に
      // 重なり続ける前提(HEADER_HEIGHT分、本文の実効的な可視開始位置は下がる)。
      const HEADER_HEIGHT = 30
      const ROW_HEIGHT = 30
      const PANE_TOP = 100
      const PANE_HEIGHT = 300 // 可視領域: y=[100, 400]

      let scrollTopValue = 0
      Object.defineProperty(listPane, 'scrollTop', {
        configurable: true,
        get: () => scrollTopValue,
        set: (v: number) => {
          scrollTopValue = v
        },
      })
      Object.defineProperty(listPane, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          top: PANE_TOP,
          bottom: PANE_TOP + PANE_HEIGHT,
          left: 0,
          right: 300,
          width: 300,
          height: PANE_HEIGHT,
        }),
      })
      Object.defineProperty(thead, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          top: PANE_TOP,
          bottom: PANE_TOP + HEADER_HEIGHT,
          left: 0,
          right: 300,
          width: 300,
          height: HEADER_HEIGHT,
        }),
      })
      // 各行は「スクロールしていない状態での位置」を基準に、現在のscrollTopぶん
      // 上へずれた位置を返す(実ブラウザのスクロール挙動と同じ計算)。
      for (let i = 0; i < 10; i++) {
        const row = screen.getByText(`target-${i}`).closest('tr') as HTMLElement
        const unscrolledTop = PANE_TOP + HEADER_HEIGHT + i * ROW_HEIGHT
        Object.defineProperty(row, 'getBoundingClientRect', {
          configurable: true,
          value: () => {
            const top = unscrolledTop - scrollTopValue
            return { top, bottom: top + ROW_HEIGHT, left: 0, right: 300, width: 300, height: ROW_HEIGHT }
          },
        })
      }

      const visibleTop = PANE_TOP + HEADER_HEIGHT
      const visibleBottom = PANE_TOP + PANE_HEIGHT

      // 下方向(進む)へ末尾まで移動する。最後の行(見出しを除く可視9行ぶんを
      // 超える10行目)でスクロールが発生するはず。
      for (let i = 0; i < 9; i++) {
        fireEvent.keyDown(listPane, { key: 'ArrowDown' })
      }
      expect(scrollTopValue).toBeGreaterThan(0)

      // 上方向(戻る)へ先頭まで1行ずつ戻る。どの時点でも選択行は見出しに
      // 隠れず(top >= visibleTop)、かつパネル下端にもはみ出さない
      // (bottom <= visibleBottom)ことを確認する(指示: 戻り方向のスクロールが
      // フォーカス行に追従していなかった不具合の回帰確認)。
      for (let i = 8; i >= 0; i--) {
        fireEvent.keyDown(listPane, { key: 'ArrowUp' })
        const row = screen.getByText(`target-${i}`).closest('tr') as HTMLElement
        const rect = row.getBoundingClientRect()
        expect(rect.top).toBeGreaterThanOrEqual(visibleTop - 0.01)
        expect(rect.bottom).toBeLessThanOrEqual(visibleBottom + 0.01)
      }
      // 先頭行まで戻りきった時点で、スクロール位置も完全に最上部へ戻っている。
      expect(scrollTopValue).toBe(0)
    })
  })

  // 指示: 「資料ウィンドウの枠が、Adobe Acrobatを連想できる赤色で視認しやすく
  // 表示される」。`.reference-pdf-window`のborderに共通エラー色token
  // (`var(--status-error)`, index.css)を使って実装している。jsdom
  // (cssstyle)はshorthand中の`var()`解決を正しくサポートしておらず
  // (docs/coding-conventions.md「テスト」節に記載の既知の制約)、ここでは
  // 検証できないため、実ブラウザでのスクリーンショット確認のみで担保する。

  describe('ウィンドウの移動・リサイズ (指示: タイトルバードラッグで移動、右下端ドラッグでリサイズ、画面外へ出ない)', () => {
    function getWindowStyle(container: HTMLElement) {
      const win = container.querySelector('.reference-pdf-window') as HTMLElement
      return { top: win.style.top, left: win.style.left, width: win.style.width, height: win.style.height }
    }

    it('dragging the titlebar moves the window by the drag delta', () => {
      mockFetchList.mockReturnValue(new Promise(() => {}))
      const { container } = render(<ReferencePdfModal onClose={() => {}} />)
      const titlebar = container.querySelector('.reference-pdf-window__titlebar') as HTMLElement
      const before = getWindowStyle(container)

      // 既定配置はViewer右端寄せ(left ≈ viewportWidth - SIDE_MARGIN - width)のため、
      // +方向の大きな移動だとすぐ右端clampにかかってしまう。clampの影響を受けない
      // 小さな-方向(左上へ)のドラッグで、移動量どおりに動くことを検証する。
      fireEvent.pointerDown(titlebar, { button: 0, clientX: 200, clientY: 150, pointerId: 1 })
      fireEvent.pointerMove(titlebar, { clientX: 180, clientY: 130, pointerId: 1 })
      fireEvent.pointerUp(titlebar, { clientX: 180, clientY: 130, pointerId: 1 })

      const after = getWindowStyle(container)
      expect(parseFloat(after.left)).toBe(parseFloat(before.left) - 20)
      expect(parseFloat(after.top)).toBe(parseFloat(before.top) - 20)
    })

    it('does not start a drag when the pointerdown originates from the close button', () => {
      mockFetchList.mockReturnValue(new Promise(() => {}))
      const onClose = vi.fn()
      const { container } = render(<ReferencePdfModal onClose={onClose} />)
      const titlebar = container.querySelector('.reference-pdf-window__titlebar') as HTMLElement
      const closeButton = screen.getByRole('button', { name: '閉じる' })
      const before = getWindowStyle(container)

      fireEvent.pointerDown(closeButton, { button: 0, clientX: 10, clientY: 10, pointerId: 2 })
      fireEvent.pointerMove(titlebar, { clientX: 100, clientY: 100, pointerId: 2 })
      fireEvent.pointerUp(titlebar, { clientX: 100, clientY: 100, pointerId: 2 })

      expect(getWindowStyle(container)).toEqual(before)
    })

    it('resizing via the bottom-right handle changes the window size, clamped to the minimum size', () => {
      mockFetchList.mockReturnValue(new Promise(() => {}))
      const { container } = render(<ReferencePdfModal onClose={() => {}} />)
      const handle = container.querySelector('.reference-pdf-window__resize-handle') as HTMLElement
      const before = getWindowStyle(container)

      fireEvent.pointerDown(handle, { button: 0, clientX: 500, clientY: 400, pointerId: 3 })
      fireEvent.pointerMove(handle, { clientX: 600, clientY: 500, pointerId: 3 })
      fireEvent.pointerUp(handle, { clientX: 600, clientY: 500, pointerId: 3 })

      const after = getWindowStyle(container)
      expect(parseFloat(after.width)).toBe(parseFloat(before.width) + 100)
      expect(parseFloat(after.height)).toBe(parseFloat(before.height) + 100)

      // 最小サイズ未満までは縮小できない。
      fireEvent.pointerDown(handle, { button: 0, clientX: 600, clientY: 500, pointerId: 4 })
      fireEvent.pointerMove(handle, { clientX: -10000, clientY: -10000, pointerId: 4 })
      fireEvent.pointerUp(handle, { clientX: -10000, clientY: -10000, pointerId: 4 })

      const shrunk = getWindowStyle(container)
      expect(parseFloat(shrunk.width)).toBe(480) // MIN_WIDTH
      expect(parseFloat(shrunk.height)).toBe(340) // MIN_HEIGHT
    })

    it('keeps the window within the viewport bounds even with an extreme drag (指示: 画面外へ完全に移動できないようにする)', () => {
      mockFetchList.mockReturnValue(new Promise(() => {}))
      const { container } = render(<ReferencePdfModal onClose={() => {}} />)
      const titlebar = container.querySelector('.reference-pdf-window__titlebar') as HTMLElement

      fireEvent.pointerDown(titlebar, { button: 0, clientX: 0, clientY: 0, pointerId: 5 })
      fireEvent.pointerMove(titlebar, { clientX: 100000, clientY: 100000, pointerId: 5 })
      fireEvent.pointerUp(titlebar, { clientX: 100000, clientY: 100000, pointerId: 5 })

      const after = getWindowStyle(container)
      const win = container.querySelector('.reference-pdf-window') as HTMLElement
      expect(parseFloat(after.left) + win.offsetWidth).not.toBeGreaterThan(window.innerWidth + 1)
      // jsdomはレイアウトを持たないためoffsetWidthは常に0になりうる。ここでは
      // 「clamp後のleft/topが負やinnerWidth/innerHeightを超えた異常値のまま
      // 放置されないこと」をwidth/height自体の数値(style文字列から取得)で検証する。
      const width = parseFloat(after.width)
      const height = parseFloat(after.height)
      expect(parseFloat(after.left)).toBeLessThanOrEqual(window.innerWidth - Math.min(width, window.innerWidth))
      expect(parseFloat(after.top)).toBeLessThanOrEqual(window.innerHeight - Math.min(height, window.innerHeight))
      expect(parseFloat(after.left)).toBeGreaterThanOrEqual(0)
      expect(parseFloat(after.top)).toBeGreaterThanOrEqual(0)
    })
  })
})
