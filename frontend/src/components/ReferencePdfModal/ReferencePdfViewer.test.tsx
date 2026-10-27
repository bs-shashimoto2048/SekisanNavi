import { createRef } from 'react'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReferencePdfViewer } from './ReferencePdfViewer'
import type { ReferencePdfViewerHandle } from './ReferencePdfViewer'
import { getLatestMockResizeObserver, MockResizeObserver } from '../../testUtils/mockResizeObserver'
// `.reference-pdf-viewer__status-bar`等のスタイルは`ReferencePdfModal.css`
// (このcomponent自体は見た目を持たず、兄弟componentのReferencePdfModal.tsx側で
// 読み込んでいる)。white-space: nowrapの検証にgetComputedStyleを使うため、
// この単体テストでも明示的に読み込む(通常の実行経路ではReferencePdfModalを
// 経由して読み込まれる)。
import './ReferencePdfModal.css'

// PDF.js自体はネットワーク越しにPDFを取得するため、単体テストでは実描画には依存せず、
// 固定ページ数・固定サイズを返すフェイクに差し替える
// (DrawingCanvas.test.tsxと同じ方針)。既定は縦長(portrait)ページ。
const PAGE_WIDTH = 600
const PAGE_HEIGHT = 800

function makeFakePage(width = PAGE_WIDTH, height = PAGE_HEIGHT) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  }
}

function makeFakeDoc(numPages: number, pageSize?: { width: number; height: number }) {
  const getPageCalls: number[] = []
  return {
    numPages,
    getPage: (pageNumber: number) => {
      getPageCalls.push(pageNumber)
      return Promise.resolve(pageSize ? makeFakePage(pageSize.width, pageSize.height) : makeFakePage())
    },
    getPageCalls,
  }
}

// jsdomはlayoutを計算しないため、表示領域(`.reference-pdf-viewer__stage`)の
// 初回マウント時点での`clientWidth/clientHeight`実測は常に0になる
// (DrawingCanvas.test.tsxと同じ既知の制約)。本componentは表示領域のサイズを
// 必ずResizeObserver経由でも受け取るため、テストからはこのヘルパーで
// 「資料ウィンドウのリサイズでstageのサイズが変わった」状況を明示的に起こす。
// `waitFor`でinstance登録を待ってから`trigger`する(フルテストスイート実行時、
// 環境負荷が高いとReactのeffectコミットがわずかに遅れることがあり、
// `getLatestMockResizeObserver`が「まだ無い」で例外を投げる競合が稀に発生する
// ため)。
async function triggerStageResize(container: HTMLElement, width: number, height: number) {
  await waitFor(() => expect(MockResizeObserver.instances.length).toBeGreaterThan(0))
  const stage = container.querySelector('.reference-pdf-viewer__stage') as HTMLElement
  getLatestMockResizeObserver().trigger(stage, { width, height })
}

/** ホイールでのズームイン/アウト(指示: 「PDF表示領域にポインターがある状態で
 * マウスホイールを操作すると、資料ウィンドウ内のPDFだけを拡大・縮小する」)。
 * `deltaY<0`(上スクロール、一般的なトラックパッド/マウスの慣習)でズームイン。 */
function wheelZoomIn(container: HTMLElement) {
  const stage = container.querySelector('.reference-pdf-viewer__stage') as HTMLElement
  return fireEvent.wheel(stage, { deltaY: -100 })
}

function wheelZoomOut(container: HTMLElement) {
  const stage = container.querySelector('.reference-pdf-viewer__stage') as HTMLElement
  return fireEvent.wheel(stage, { deltaY: 100 })
}

/** 中央ボタン(マウスホイール押し込み、button=1)の1回のクリック(press+release、
 * 移動なし)。`pointerId`は呼び出しごとに変える(実ブラウザでも1回のクリックの
 * 都度新しいpointerIdが振られるのが自然な前提のため)。 */
function middleClick(target: HTMLElement, pointerId: number, x = 50, y = 50) {
  fireEvent.pointerDown(target, { button: 1, clientX: x, clientY: y, pointerId })
  fireEvent.pointerUp(target, { button: 1, clientX: x, clientY: y, pointerId })
}

const destroyMock = vi.fn(() => Promise.resolve())
let getDocumentImpl: (args: { url: string }) => { promise: Promise<unknown>; destroy: () => Promise<void> }

vi.mock('../../pdf/pdfjs', () => ({
  pdfjsLib: {
    getDocument: (args: { url: string }) => getDocumentImpl(args),
  },
  // [資料PDF表示 日本語文字化け修正] component側が`...PDF_DOCUMENT_RESOURCE_OPTIONS`を
  // spreadするため、named exportとして存在だけ合わせておく(値自体はこのmockの
  // getDocument実装では使わない)。
  PDF_DOCUMENT_RESOURCE_OPTIONS: {},
}))

beforeEach(() => {
  destroyMock.mockClear()
  getDocumentImpl = (_args) => ({ promise: Promise.resolve(makeFakeDoc(1)), destroy: destroyMock })
})

describe('ReferencePdfViewer', () => {
  it('shows a "no PDF selected" message when fileUrl is null (指示: PDF未選択の状態を表示する)', () => {
    render(<ReferencePdfViewer fileUrl={null} />)
    expect(screen.getByText('表示するPDFがありません。')).toBeInTheDocument()
  })

  it('shows a loading message while the document is being fetched (指示: 読み込み中の状態を表示する)', () => {
    getDocumentImpl = () => ({ promise: new Promise(() => {}), destroy: destroyMock })
    render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/a_b.pdf" />)
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('shows an error message when the document fails to load (指示: 表示エラーの状態を表示する)', async () => {
    getDocumentImpl = () => ({ promise: Promise.reject(new Error('破損したPDFです')), destroy: destroyMock })
    render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/broken.pdf" />)
    await waitFor(() => expect(screen.getByText(/PDFを表示できませんでした/)).toBeInTheDocument())
    expect(screen.getByText(/破損したPDFです/)).toBeInTheDocument()
  })

  it('renders exactly one page (<canvas>) at a time, never the whole document at once (指示: PDFは一度に1ページだけ表示する)', async () => {
    getDocumentImpl = () => ({ promise: Promise.resolve(makeFakeDoc(3)), destroy: destroyMock })
    const { container } = render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/multi.pdf" />)
    await waitFor(() => expect(container.querySelectorAll('canvas').length).toBe(1))
  })

  it('shows the current page / total pages, with no page-turn or zoom buttons in the DOM (指示: ページ送り・拡大縮小ボタンは削除し、ページ番号表示だけ残す)', async () => {
    getDocumentImpl = () => ({ promise: Promise.resolve(makeFakeDoc(3)), destroy: destroyMock })
    const { container } = render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/multi.pdf" />)
    await waitFor(() => expect(screen.getByText('1 / 3')).toBeInTheDocument())
    expect(container.querySelectorAll('button').length).toBe(0)
  })

  it('turns to the next/previous page via the imperative handle (←/→, driven by ReferencePdfModal), clamping at both ends (指示: ←/→キーで前後のページへ移動)', async () => {
    getDocumentImpl = () => ({ promise: Promise.resolve(makeFakeDoc(2)), destroy: destroyMock })
    const ref = createRef<ReferencePdfViewerHandle>()
    render(<ReferencePdfViewer ref={ref} fileUrl="/api/help/reference-pdfs/multi.pdf" />)
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument())

    act(() => ref.current?.goToPrevPage()) // 先頭で前へ: 変化しない
    expect(screen.getByText('1 / 2')).toBeInTheDocument()

    act(() => ref.current?.goToNextPage())
    await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument())

    act(() => ref.current?.goToNextPage()) // 末尾で次へ: 変化しない
    expect(screen.getByText('2 / 2')).toBeInTheDocument()

    act(() => ref.current?.goToPrevPage())
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument())
  })

  it('releases the previous page\'s canvas bitmap when turning the page (指示: ページ切替時に不要な描画データを解放する)', async () => {
    getDocumentImpl = () => ({ promise: Promise.resolve(makeFakeDoc(2)), destroy: destroyMock })
    const ref = createRef<ReferencePdfViewerHandle>()
    const { container } = render(<ReferencePdfViewer ref={ref} fileUrl="/api/help/reference-pdfs/multi.pdf" />)
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument())
    await triggerStageResize(container, 500, 500)

    const canvas = container.querySelector('canvas') as HTMLCanvasElement
    await waitFor(() => expect(canvas.width).toBeGreaterThan(0))

    act(() => ref.current?.goToNextPage())
    // 同じ<canvas>要素を使い回す(ページごとに別要素を増やさない)。遷移の瞬間、
    // 直前ページのbitmapはeffect cleanupで一旦0にリセットされ、新しいページの
    // 描画が終わると再び非0になる。
    await waitFor(() => expect(canvas.width).toBeGreaterThan(0))
    expect(container.querySelectorAll('canvas').length).toBe(1)
  })

  describe('表示領域へのfit (指示: scale = min(表示領域幅/ページ幅, 表示領域高さ/ページ高さ)で縦横比を保って収める)', () => {
    it('fits a portrait page by its height when the stage is wide and short (高さが制約になる場合)', async () => {
      // ページ 600x800(縦長)、stage 1000x400 → scaleはmin(1000/600, 400/800)=0.5(高さ基準)
      getDocumentImpl = () => ({
        promise: Promise.resolve(makeFakeDoc(1, { width: 600, height: 800 })),
        destroy: destroyMock,
      })
      const { container } = render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/portrait.pdf" />)
      await waitFor(() => expect(screen.getByText('1 / 1')).toBeInTheDocument())
      await triggerStageResize(container, 1000, 400)

      const canvas = container.querySelector('canvas') as HTMLCanvasElement
      await waitFor(() => expect(canvas.style.height).toBe('400px'))
      expect(canvas.style.width).toBe('300px') // 600 * 0.5、縦横比(3:4)を維持
    })

    it('fits a landscape page by its width when the stage is narrow and tall (幅が制約になる場合)', async () => {
      // ページ 800x600(横長)、stage 400x1000 → scaleはmin(400/800, 1000/600)=0.5(幅基準)
      getDocumentImpl = () => ({
        promise: Promise.resolve(makeFakeDoc(1, { width: 800, height: 600 })),
        destroy: destroyMock,
      })
      const { container } = render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/landscape.pdf" />)
      await waitFor(() => expect(screen.getByText('1 / 1')).toBeInTheDocument())
      await triggerStageResize(container, 400, 1000)

      const canvas = container.querySelector('canvas') as HTMLCanvasElement
      await waitFor(() => expect(canvas.style.width).toBe('400px'))
      expect(canvas.style.height).toBe('300px') // 600 * 0.5、縦横比(4:3)を維持
    })

    it('re-fits the page, preserving aspect ratio, when the window (stage) is resized (指示: リサイズ時にページを表示領域へ自動調整する)', async () => {
      getDocumentImpl = () => ({
        promise: Promise.resolve(makeFakeDoc(1, { width: 600, height: 800 })),
        destroy: destroyMock,
      })
      const { container } = render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/portrait.pdf" />)
      await waitFor(() => expect(screen.getByText('1 / 1')).toBeInTheDocument())

      await triggerStageResize(container, 300, 400)
      const canvas = container.querySelector('canvas') as HTMLCanvasElement
      await waitFor(() => expect(canvas.style.height).toBe('400px'))
      expect(canvas.style.width).toBe('300px')

      await triggerStageResize(container, 300, 1600)
      await waitFor(() => expect(canvas.style.width).toBe('300px'))
      expect(canvas.style.height).toBe('400px')

      await triggerStageResize(container, 2000, 1600)
      await waitFor(() => expect(canvas.style.width).toBe('1200px'))
      expect(canvas.style.height).toBe('1600px')
    })

    it('re-fits to a wider/narrower scale when the stage changes size the way it does when the file list is hidden/shown (指示: 一覧の表示/非表示切替時、Fit表示状態なら新しい表示領域に合わせてFitを再計算する)', async () => {
      // `ReferencePdfModal`は一覧(list-pane)を`display: none`にするだけで
      // Viewer自体は再マウントしない。Viewerから見える効果は「表示領域(stage)の
      // 幅が広がる/狭まる」ことだけであり、それは本componentの`ResizeObserver`が
      // 検知して再fitする(一覧の表示/非表示という概念自体はReferencePdfViewer
      // 側では扱わない。`ReferencePdfModal.test.tsx`側でボタン操作・DOM構造・
      // 選択状態の維持を検証し、こちらでは「stageの幅変化→Fit再計算」という
      // 実際の計算そのものを検証する、という役割分担)。
      getDocumentImpl = () => ({
        promise: Promise.resolve(makeFakeDoc(1, { width: 600, height: 800 })),
        destroy: destroyMock,
      })
      const { container } = render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/portrait.pdf" />)
      await waitFor(() => expect(screen.getByText('1 / 1')).toBeInTheDocument())

      // 一覧表示中(狭い表示領域、幅300x高さ800)でのFit: scale=min(300/600,
      // 800/800)=0.5 → 50%。
      await triggerStageResize(container, 300, 800)
      await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument())
      const canvas = container.querySelector('canvas') as HTMLCanvasElement
      const widthWhileListVisible = canvas.style.width
      expect(widthWhileListVisible).toBe('300px')

      // 一覧を隠した後(list-paneぶんstageが広がった想定、幅580x高さ800)の
      // サイズ: scale=min(580/600, 800/800)=0.9667 → 97%、ページが大きく表示される。
      await triggerStageResize(container, 580, 800)
      await waitFor(() => expect(screen.getByText('97%')).toBeInTheDocument())
      expect(canvas.style.width).toBe('580px')
      expect(canvas.style.width).not.toBe(widthWhileListVisible)

      // 再び一覧を表示した(stageが元の幅へ戻った)サイズ。
      await triggerStageResize(container, 300, 800)
      await waitFor(() => expect(canvas.style.width).toBe(widthWhileListVisible))
    })

    it('never produces a canvas larger than the stage in either dimension (指示: ページを切り取らない)', async () => {
      getDocumentImpl = () => ({
        promise: Promise.resolve(makeFakeDoc(1, { width: 600, height: 800 })),
        destroy: destroyMock,
      })
      const { container } = render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/portrait.pdf" />)
      await waitFor(() => expect(screen.getByText('1 / 1')).toBeInTheDocument())
      await triggerStageResize(container, 333, 777)

      const canvas = container.querySelector('canvas') as HTMLCanvasElement
      await waitFor(() => expect(canvas.style.width).not.toBe(''))
      // 浮動小数点演算の誤差(例: 333.00000000000006)を許容する微小なepsilon。
      expect(parseFloat(canvas.style.width)).toBeLessThanOrEqual(333 + 1e-6)
      expect(parseFloat(canvas.style.height)).toBeLessThanOrEqual(777 + 1e-6)
    })
  })

  it('destroys the previous loading task when switching to a different file (指示: 前のPDFの描画データを解放し、新しいPDFだけを表示する)', async () => {
    getDocumentImpl = () => ({ promise: Promise.resolve(makeFakeDoc(1)), destroy: destroyMock })
    const { rerender } = render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/a.pdf" />)
    await waitFor(() => expect(destroyMock).not.toHaveBeenCalled())

    const secondDestroy = vi.fn(() => Promise.resolve())
    getDocumentImpl = () => ({ promise: Promise.resolve(makeFakeDoc(1)), destroy: secondDestroy })
    rerender(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/b.pdf" />)

    await waitFor(() => expect(destroyMock).toHaveBeenCalledTimes(1))
    expect(secondDestroy).not.toHaveBeenCalled()
  })

  it('resets to page 1 when switching to a different file', async () => {
    getDocumentImpl = () => ({ promise: Promise.resolve(makeFakeDoc(3)), destroy: destroyMock })
    const ref = createRef<ReferencePdfViewerHandle>()
    const { rerender } = render(<ReferencePdfViewer ref={ref} fileUrl="/api/help/reference-pdfs/a.pdf" />)
    await waitFor(() => expect(screen.getByText('1 / 3')).toBeInTheDocument())
    act(() => ref.current?.goToNextPage())
    await waitFor(() => expect(screen.getByText('2 / 3')).toBeInTheDocument())

    getDocumentImpl = () => ({ promise: Promise.resolve(makeFakeDoc(2)), destroy: vi.fn(() => Promise.resolve()) })
    rerender(<ReferencePdfViewer ref={ref} fileUrl="/api/help/reference-pdfs/b.pdf" />)
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument())
  })

  it('destroys the current loading task on unmount', async () => {
    const { unmount } = render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/a.pdf" />)
    await waitFor(() => expect(destroyMock).not.toHaveBeenCalled())
    unmount()
    expect(destroyMock).toHaveBeenCalledTimes(1)
  })

  it('destroys the loading task when the file is deselected (fileUrl becomes null)', async () => {
    const { rerender } = render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/a.pdf" />)
    await waitFor(() => expect(destroyMock).not.toHaveBeenCalled())
    rerender(<ReferencePdfViewer fileUrl={null} />)
    expect(destroyMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('表示するPDFがありません。')).toBeInTheDocument()
  })

  describe('マウスホイールでの拡大・縮小 (指示: 操作対象は資料ウィンドウ内のPDFだけ。ホイール操作時はブラウザの既定スクロール・背後要素への伝播を止める)', () => {
    async function renderAtFit50(numPages = 1) {
      getDocumentImpl = () => ({
        promise: Promise.resolve(makeFakeDoc(numPages, { width: 600, height: 800 })),
        destroy: destroyMock,
      })
      const ref = createRef<ReferencePdfViewerHandle>()
      const utils = render(<ReferencePdfViewer ref={ref} fileUrl="/api/help/reference-pdfs/portrait.pdf" />)
      await waitFor(() => expect(screen.getByText('1 / ' + numPages)).toBeInTheDocument())
      await triggerStageResize(utils.container, 300, 400) // fitScale = min(300/600, 400/800) = 0.5 → 50%
      await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument())
      return { ...utils, ref }
    }

    it('zooms in/out with the wheel, changing only this PDF\'s displayed size (指示: 背後の図面ビューや既存の拡大縮小操作には影響させない)', async () => {
      const { container } = await renderAtFit50()
      const canvas = container.querySelector('canvas') as HTMLCanvasElement

      wheelZoomIn(container)
      await waitFor(() => expect(screen.getByText('63%')).toBeInTheDocument()) // 0.5 * 1.25 = 0.625
      expect(canvas.style.width).toBe('375px')
      expect(canvas.style.height).toBe('500px')

      wheelZoomOut(container)
      await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument())
      expect(canvas.style.width).toBe('300px')
    })

    it('prevents the default page scroll and does not let the wheel event bubble past the stage (指示: ブラウザのページスクロールなどを抑止し、背後の画面要素を動かさない)', async () => {
      const { container } = await renderAtFit50()
      const outerWheelSpy = vi.fn()
      document.addEventListener('wheel', outerWheelSpy)
      try {
        const notCanceled = wheelZoomIn(container)
        // fireEvent.wheel(=dispatchEvent)はpreventDefault()が呼ばれるとfalseを返す。
        expect(notCanceled).toBe(false)
        expect(outerWheelSpy).not.toHaveBeenCalled() // stopPropagation済み
      } finally {
        document.removeEventListener('wheel', outerWheelSpy)
      }
    })

    it('clamps at the minimum/maximum zoom', async () => {
      const { container } = await renderAtFit50()
      for (let i = 0; i < 20; i++) wheelZoomOut(container)
      await waitFor(() => expect(screen.getByText('10%')).toBeInTheDocument()) // MIN_ZOOM=0.1

      for (let i = 0; i < 40; i++) wheelZoomIn(container)
      await waitFor(() => expect(screen.getByText('600%')).toBeInTheDocument()) // MAX_ZOOM=6
    })

    it('resets to the Fit percentage when turning the page, even after manually zooming (指示: ページ切替時は新しいページがFit倍率になる)', async () => {
      const { container, ref } = await renderAtFit50(2)
      wheelZoomIn(container)
      await waitFor(() => expect(screen.getByText('63%')).toBeInTheDocument())

      act(() => ref.current?.goToNextPage())
      await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument())
      await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument())
    })

    it('ignores window(stage) resizes after a manual zoom (手動ズーム後はウィンドウリサイズで倍率を変えない)', async () => {
      const { container } = await renderAtFit50()
      wheelZoomIn(container)
      await waitFor(() => expect(screen.getByText('63%')).toBeInTheDocument())

      await triggerStageResize(container, 900, 900) // 広げても手動ズーム中は倍率不変
      await waitFor(() => expect(screen.getByText('63%')).toBeInTheDocument())
    })
  })

  describe('拡大時のドラッグパン (指示: 表示領域内でドラッグして表示位置を動かせる。縦横スクロールバーは出さない)', () => {
    it('moves the canvas via a drag transform when zoomed in beyond the stage size, clamped to the overflow amount', async () => {
      getDocumentImpl = () => ({
        promise: Promise.resolve(makeFakeDoc(1, { width: 600, height: 800 })),
        destroy: destroyMock,
      })
      const { container } = render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/portrait.pdf" />)
      await waitFor(() => expect(screen.getByText('1 / 1')).toBeInTheDocument())
      await triggerStageResize(container, 300, 400)
      await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument())

      wheelZoomIn(container) // 62.5% → canvas 375x500、stage 300x400
      await waitFor(() => expect(screen.getByText('63%')).toBeInTheDocument())

      const canvas = container.querySelector('canvas') as HTMLCanvasElement
      expect(canvas.style.transform).toBe('translate(0px, 0px)')

      const stage = container.querySelector('.reference-pdf-viewer__stage') as HTMLElement
      fireEvent.pointerDown(stage, { button: 0, clientX: 0, clientY: 0, pointerId: 1 })
      fireEvent.pointerMove(stage, { clientX: 100, clientY: 100, pointerId: 1 })
      fireEvent.pointerUp(stage, { clientX: 100, clientY: 100, pointerId: 1 })

      // overflow = (375-300)/2=37.5, (500-400)/2=50 → ドラッグ量(100,100)はその範囲へclampされる。
      expect(canvas.style.transform).toBe('translate(37.5px, 50px)')
    })

    it('does not move the canvas when it already fits entirely within the stage (no overflow to pan)', async () => {
      getDocumentImpl = () => ({
        promise: Promise.resolve(makeFakeDoc(1, { width: 600, height: 800 })),
        destroy: destroyMock,
      })
      const { container } = render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/portrait.pdf" />)
      await waitFor(() => expect(screen.getByText('1 / 1')).toBeInTheDocument())
      await triggerStageResize(container, 300, 400)
      await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument())

      const stage = container.querySelector('.reference-pdf-viewer__stage') as HTMLElement
      const canvas = container.querySelector('canvas') as HTMLCanvasElement
      fireEvent.pointerDown(stage, { button: 0, clientX: 0, clientY: 0, pointerId: 2 })
      fireEvent.pointerMove(stage, { clientX: 150, clientY: 150, pointerId: 2 })
      fireEvent.pointerUp(stage, { clientX: 150, clientY: 150, pointerId: 2 })

      expect(canvas.style.transform).toBe('translate(0px, 0px)')
    })

    it('resets the pan position after turning the page back to Fit', async () => {
      getDocumentImpl = () => ({
        promise: Promise.resolve(makeFakeDoc(2, { width: 600, height: 800 })),
        destroy: destroyMock,
      })
      const ref = createRef<ReferencePdfViewerHandle>()
      const { container } = render(<ReferencePdfViewer ref={ref} fileUrl="/api/help/reference-pdfs/portrait.pdf" />)
      await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument())
      await triggerStageResize(container, 300, 400)
      await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument())
      wheelZoomIn(container)
      await waitFor(() => expect(screen.getByText('63%')).toBeInTheDocument())

      const stage = container.querySelector('.reference-pdf-viewer__stage') as HTMLElement
      const canvas = container.querySelector('canvas') as HTMLCanvasElement
      fireEvent.pointerDown(stage, { button: 0, clientX: 0, clientY: 0, pointerId: 3 })
      fireEvent.pointerMove(stage, { clientX: 100, clientY: 100, pointerId: 3 })
      fireEvent.pointerUp(stage, { clientX: 100, clientY: 100, pointerId: 3 })
      expect(canvas.style.transform).toBe('translate(37.5px, 50px)')

      act(() => ref.current?.goToNextPage())
      await waitFor(() => expect(screen.getByText('2 / 2')).toBeInTheDocument())
      await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument())
      expect(canvas.style.transform).toBe('translate(0px, 0px)')
    })
  })

  describe('中央ボタンダブルクリックでFitへ戻す (指示: PDF表示領域内のみ対象。単発クリック・既存のホイール/パン/ページ送りは維持する)', () => {
    async function renderZoomedAndPanned() {
      getDocumentImpl = () => ({
        promise: Promise.resolve(makeFakeDoc(1, { width: 600, height: 800 })),
        destroy: destroyMock,
      })
      const utils = render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/portrait.pdf" />)
      await waitFor(() => expect(screen.getByText('1 / 1')).toBeInTheDocument())
      await triggerStageResize(utils.container, 300, 400)
      await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument())
      wheelZoomIn(utils.container) // 62.5% → canvas 375x500、stage 300x400(はみ出す)
      await waitFor(() => expect(screen.getByText('63%')).toBeInTheDocument())

      const stage = utils.container.querySelector('.reference-pdf-viewer__stage') as HTMLElement
      const canvas = utils.container.querySelector('canvas') as HTMLCanvasElement
      fireEvent.pointerDown(stage, { button: 0, clientX: 0, clientY: 0, pointerId: 50 })
      fireEvent.pointerMove(stage, { clientX: 100, clientY: 100, pointerId: 50 })
      fireEvent.pointerUp(stage, { clientX: 100, clientY: 100, pointerId: 50 })
      expect(canvas.style.transform).toBe('translate(37.5px, 50px)') // パン位置がゼロでないことを確認

      return { ...utils, stage, canvas }
    }

    it('resets the zoom percentage and pan position to Fit on a middle-button double-click inside the PDF display area', async () => {
      const { stage, canvas } = await renderZoomedAndPanned()

      middleClick(stage, 1)
      middleClick(stage, 2) // 直前のクリックから十分短い間隔・同じ位置 → ダブルクリック成立

      await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument()) // Fit倍率へ復帰
      expect(canvas.style.transform).toBe('translate(0px, 0px)') // パン位置もゼロへ
    })

    it('does nothing on a single middle-button click (指示: 中央ボタンの通常クリックは維持する=単発では何も起きない)', async () => {
      const { stage, canvas } = await renderZoomedAndPanned()

      middleClick(stage, 1)
      // 1回だけでは何も変わらない(ダブルクリック成立前)。
      expect(screen.getByText('63%')).toBeInTheDocument()
      expect(canvas.style.transform).toBe('translate(37.5px, 50px)')
    })

    it('does not treat two middle-button clicks as a double-click when they are too far apart in time', async () => {
      const { stage, canvas } = await renderZoomedAndPanned()
      // レンダリング・状態遷移の待機(waitFor)がすべて終わってから、
      // タイマーだけをfakeに差し替える(waitFor自体は実タイマーのポーリングに
      // 依存するため、待機中にfake timersへ切り替えない)。
      vi.useFakeTimers()
      try {
        middleClick(stage, 1)
        vi.advanceTimersByTime(1000) // DBLCLICK_MS(400ms)を大きく超える間隔
        middleClick(stage, 2)

        expect(screen.getByText('63%')).toBeInTheDocument() // Fitへは戻らない
        expect(canvas.style.transform).toBe('translate(37.5px, 50px)')
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not reset when the double-click happens outside the PDF display area (指示: 表示領域外の操作では反応させない)', async () => {
      const { container, canvas } = await renderZoomedAndPanned()
      const outside = container.querySelector('.reference-pdf-viewer__status-bar') as HTMLElement

      middleClick(outside, 1)
      middleClick(outside, 2)

      expect(screen.getByText('63%')).toBeInTheDocument()
      expect(canvas.style.transform).toBe('translate(37.5px, 50px)')
    })

    it('prevents the default browser middle-click auto-scroll inside the display area', async () => {
      const { stage } = await renderZoomedAndPanned()
      const downCanceled = fireEvent.pointerDown(stage, { button: 1, clientX: 10, clientY: 10, pointerId: 9 })
      const upCanceled = fireEvent.pointerUp(stage, { button: 1, clientX: 10, clientY: 10, pointerId: 9 })
      // fireEvent(=dispatchEvent)はpreventDefault()が呼ばれるとfalseを返す。
      expect(downCanceled).toBe(false)
      expect(upCanceled).toBe(false)
    })

    it('still allows the existing wheel zoom, drag pan and left-button interactions after a middle-button click (指示: 既存のホイール拡大・縮小、パン操作、ページ送りは維持する)', async () => {
      const { stage, canvas, container } = await renderZoomedAndPanned()

      middleClick(stage, 1) // 単発クリック(ダブルクリックにはしない)

      // 既存のホイールズームが引き続き効く。
      wheelZoomIn(container)
      await waitFor(() => expect(screen.getByText('78%')).toBeInTheDocument())

      // 既存の左ボタンドラッグパンも引き続き効く。
      fireEvent.pointerDown(stage, { button: 0, clientX: 0, clientY: 0, pointerId: 60 })
      fireEvent.pointerMove(stage, { clientX: 10, clientY: 10, pointerId: 60 })
      fireEvent.pointerUp(stage, { clientX: 10, clientY: 10, pointerId: 60 })
      expect(canvas.style.transform).not.toBe('translate(0px, 0px)')
    })
  })

  describe('ステータス表示(ページ番号・倍率)の折り返し防止 (指示: 狭い幅でも1行に収める)', () => {
    it('renders the page count and zoom percentage inside a single non-wrapping status bar', async () => {
      getDocumentImpl = () => ({
        promise: Promise.resolve(makeFakeDoc(2, { width: 600, height: 800 })),
        destroy: destroyMock,
      })
      const { container } = render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/multi.pdf" />)
      await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument())
      await triggerStageResize(container, 150, 400) // 資料ウィンドウの最小幅相当の狭い表示領域

      const bar = container.querySelector('.reference-pdf-viewer__status-bar') as HTMLElement
      expect(getComputedStyle(bar).whiteSpace).toBe('nowrap')
      // ページ番号・倍率の両方が同じステータスバー要素の中に収まっている
      // (別要素・別行に分かれていない)ことを確認する。
      expect(bar).toHaveTextContent('1 / 2')
      await waitFor(() => expect(bar.textContent).toMatch(/%$/))
    })
  })

  describe('statusBarContainer経由でのステータス表示の差し込み (指示: 資料ウィンドウのタイトルバー1行へページ番号/倍率をまとめる)', () => {
    it('portals the status bar into the given container instead of rendering it inside its own DOM subtree', async () => {
      getDocumentImpl = () => ({
        promise: Promise.resolve(makeFakeDoc(2, { width: 600, height: 800 })),
        destroy: destroyMock,
      })
      const portalTarget = document.createElement('div')
      document.body.appendChild(portalTarget)

      const { container } = render(
        <ReferencePdfViewer fileUrl="/api/help/reference-pdfs/multi.pdf" statusBarContainer={portalTarget} />,
      )
      await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument())

      // ステータスバー自体はcomponent自身のDOM配下ではなく、渡したcontainer側にある。
      expect(container.querySelector('.reference-pdf-viewer__status-bar')).toBeNull()
      const bar = portalTarget.querySelector('.reference-pdf-viewer__status-bar') as HTMLElement
      expect(bar).not.toBeNull()
      expect(bar).toHaveTextContent('1 / 2')

      document.body.removeChild(portalTarget)
    })

    it('still renders the status bar inline (previous behavior) when statusBarContainer is not provided (後方互換: 単体使用時)', async () => {
      getDocumentImpl = () => ({ promise: Promise.resolve(makeFakeDoc(1)), destroy: destroyMock })
      const { container } = render(<ReferencePdfViewer fileUrl="/api/help/reference-pdfs/a_b.pdf" />)
      await waitFor(() => expect(screen.getByText('1 / 1')).toBeInTheDocument())
      expect(container.querySelector('.reference-pdf-viewer__status-bar')).not.toBeNull()
    })
  })
})
