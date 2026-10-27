import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { fetchReferencePdfs, referencePdfFileUrl } from '../../api/client'
import { describeFetchError } from '../../api/errors'
import type { ReferencePdfItem } from '../../types/domain'
import { ReferencePdfViewer } from './ReferencePdfViewer'
import type { ReferencePdfViewerHandle } from './ReferencePdfViewer'
import './ReferencePdfModal.css'

interface Props {
  onClose: () => void
}

// App.tsxのisEditableTargetと同じ単純な判定(入力欄・contentEditable中は
// 既存の操作用ショートカットを横取りしない方針)。資料ウィンドウ内に現時点で
// 文字入力欄は無いが、指示で明示されているため同じガードをここにも置く。
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

type LoadState = 'loading' | 'loaded' | 'error'

interface WindowRect {
  top: number
  left: number
  width: number
  height: number
}

const MIN_WIDTH = 480
const MIN_HEIGHT = 340
const DEFAULT_WIDTH = 900
const DEFAULT_HEIGHT = 600
const SIDE_MARGIN = 24
const TOP_MARGIN = 64

function clampRect(rect: WindowRect, viewport: { width: number; height: number }): WindowRect {
  const width = Math.min(Math.max(MIN_WIDTH, rect.width), Math.max(MIN_WIDTH, viewport.width))
  const height = Math.min(Math.max(MIN_HEIGHT, rect.height), Math.max(MIN_HEIGHT, viewport.height))
  const maxLeft = Math.max(0, viewport.width - width)
  const maxTop = Math.max(0, viewport.height - height)
  return {
    width,
    height,
    left: Math.min(Math.max(0, rect.left), maxLeft),
    top: Math.min(Math.max(0, rect.top), maxTop),
  }
}

function computeInitialRect(): WindowRect {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, viewportWidth - SIDE_MARGIN * 2))
  const height = Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, viewportHeight - TOP_MARGIN - SIDE_MARGIN))
  const left = Math.max(0, viewportWidth - SIDE_MARGIN - width)
  return clampRect({ top: TOP_MARGIN, left, width, height }, { width: viewportWidth, height: viewportHeight })
}

/**
 * 「資料」フローティングウィンドウ(複数PDF参照、Issue #40関連 追加機能)。
 *
 * [技術的ブロッカー解消] 旧実装は背景を操作不能にするbackdrop付きmodalだった
 * (旧「積算資料」ボタン・HelpPdfModalと同じパターン。資料機能の一本化で
 * HelpPdfModal自体は廃止した)が、指示により「作業と同時に使える表示窓」へ
 * 変更した。背景を覆うbackdropは持たず、このwindow自身の矩形領域の外側への
 * クリックは素通りして背後の図面・他floating panel等をそのまま操作できる。
 *
 * **Viewer専用`FloatingPanel`(`components/Layout/FloatingPanel.tsx`)を
 * 再利用しない理由**: あちらは「Viewer領域(`containerRef`=`.app-workspace__
 * viewer-wrap`)基準」「5種のkindで共有するz-index/前面化/右端カスケード
 * 配置」等、既存4+1panel間の連携に強く結び付いた専用設計であり、`kind`の
 * 列挙・各種Recordへ新規追加すると、既存panel群の挙動(回帰させやすい既知の
 * ポイント)に影響する範囲が広い。「資料」はProjectHeaderから独立して開く、
 * 他panelと連携しない単独windowのため、ここでは同じ考え方(タイトルバー
 * ドラッグ・右下角リサイズ・viewport内clamp)だけを踏襲した専用の最小実装を持つ。
 *
 * **キーボード**: 上下キーによる一覧の選択行移動・左右キーによるページ送りは、
 * このwindow自身にフォーカスがある間だけ有効にする(`tabIndex={-1}`+
 * マウント時autofocus、既存のEscape/Undo-Redoの「他モーダル使用中は何もしない」
 * ガードには含めない。指示: 「資料ウィンドウが開いているだけで、App全体の
 * Undo/Redoや既存の作業用ショートカットを一律に無効化しない」)。左右キーの
 * 実際のページ送りは`ReferencePdfViewerHandle`経由でViewer側へ委譲する
 * (ページ番号の保持場所を分散させない)。
 *
 * **一覧パネル自体へのフォーカス**: 一覧パネル(`tabIndex={0}`)がフォーカスを
 * 持つ間は、矢印キーをすべて一覧パネル側(`handleListKeyDown`)で処理し切る
 * (↑/↓は選択移動+自動スクロール、←/→は何もしない=PDFのページ送りを
 * 起こさない)。`stopPropagation`によりwindow側の`handleKeyDown`(←/→で
 * ページ送り)へは伝播しないため、「一覧上の矢印キー操作でPDFのページ送りや
 * ズームが起きないようにする」という指示を、新たなfocus状態管理を増やさず
 * イベント伝播の制御だけで実現している。
 */
export function ReferencePdfModal({ onClose }: Props) {
  const [state, setState] = useState<LoadState>('loading')
  const [folderExists, setFolderExists] = useState(true)
  const [items, setItems] = useState<ReferencePdfItem[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [rect, setRect] = useState<WindowRect>(() => computeInitialRect())
  const [interacting, setInteracting] = useState(false)
  // 指示: 「一覧を隠すとPDF表示領域をウィンドウ幅いっぱいに広げる。再表示すると
  // 右側に一覧を戻す。切替時に選択中のPDFとページ番号を維持する」。一覧はCSSで
  // 非表示にするだけで`ReferencePdfViewer`自体はunmountしないため、
  // `selectedIndex`(選択中PDF)もViewer内部のページ番号も、表示/非表示の
  // 切替では一切リセットされない。
  const [isListCollapsed, setListCollapsed] = useState(false)
  // 指示: 「資料、ページ番号、倍率、一覧切替、×を上部の1行にまとめる。独立した
  // 2行目のステータスバーを残さない」。ページ番号・倍率の状態そのものは
  // 引き続き`ReferencePdfViewer`(実体は内部の`SinglePageView`)側だけが持つが、
  // 表示位置だけをタイトルバーの1行の中へ`createPortal`で移す。差し込み先の
  // DOM要素はマウント後でなければ参照を取れないため、callback ref経由で
  // stateへ保持する(ref.currentへ直接入れるだけでは、要素ができたタイミングで
  // ReferencePdfViewer側の再描画がトリガーされない)。
  const [statusSlot, setStatusSlot] = useState<HTMLDivElement | null>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  // 指示: 「一覧にキーボードフォーカスがある状態で↑/↓キーを押すと、選択行が
  // 一覧領域外へ移動した場合は自動スクロールする」。選択行のDOM要素を
  // `scrollIntoView`するために一覧パネル自体への参照を持つ。
  const listPaneRef = useRef<HTMLDivElement>(null)
  // 指示: 「←/→キーで前後のページへ移動できるようにする」。ページ番号自体の
  // 保持は引き続きReferencePdfViewer(実際にはその中のSinglePageView)側に
  // 閉じ込めたまま、この命令的APIだけを呼び出す(「単一の真実源」を保つ)。
  const viewerRef = useRef<ReferencePdfViewerHandle>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startTop: number
    startLeft: number
  } | null>(null)
  const resizeRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startWidth: number
    startHeight: number
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchReferencePdfs()
      .then((result) => {
        if (cancelled) return
        setFolderExists(result.folder_exists)
        setItems(result.items)
        setSelectedIndex(result.items.length > 0 ? 0 : null)
        setState('loaded')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setErrorMessage(describeFetchError(e, '資料一覧の取得に失敗しました'))
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ウィンドウを開いたら自動でフォーカスする(指示: 上下キー操作は「資料
  // ウィンドウがフォーカスされているとき」のみ有効にするため)。
  useEffect(() => {
    windowRef.current?.focus()
  }, [])

  // ブラウザwindow自体が縮小された場合でも、資料ウィンドウが画面外へ出た
  // ままにならないようにする(指示: 「画面外へ完全に移動できないようにする」)。
  useEffect(() => {
    function handleViewportResize() {
      setRect((prev) => clampRect(prev, { width: window.innerWidth, height: window.innerHeight }))
    }
    window.addEventListener('resize', handleViewportResize)
    return () => window.removeEventListener('resize', handleViewportResize)
  }, [])

  // 指示: 「選択行が一覧領域外へ移動した場合は、自動スクロールして選択行と
  // フォーカス位置が常に見えるようにする」。選択行(`selectedIndex`)が変わる
  // たびに、現在選択中の<tr>を一覧パネル内で可視範囲に収まるようスクロール
  // する。
  //
  // `scrollIntoView({ block: 'nearest' })`には使わない: 一覧の見出し行
  // (`<thead> th`)は`position: sticky; top: 0`でスクロール中も常にパネル
  // 上端に重なり続けるが、`scrollIntoView`の可視判定はスクロールコンテナの
  // 幾何学的な範囲だけを見ており、sticky要素に隠れている領域を考慮しない。
  // そのため↑方向(前の行へ戻る)でだけ、見出しの下に隠れた位置を「見えている」
  // と誤判定し、スクロールが足りずフォーカス行が見出しの裏に置き去りになる
  // 不具合が起きる(↓方向は底辺を覆う要素が無いため症状が出ない)。
  // 見出しの実測高さぶんを可視範囲の上端から差し引いて、自前でscrollTopを
  // 補正することで、どちら方向でも確実に選択行を見える位置まで追従させる。
  useEffect(() => {
    if (isListCollapsed) return
    const pane = listPaneRef.current
    const row = pane?.querySelector('.reference-pdf-window__row--selected') as HTMLElement | null
    if (!pane || !row) return

    const headerHeight = pane.querySelector('thead')?.getBoundingClientRect().height ?? 0
    const paneRect = pane.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    const visibleTop = paneRect.top + headerHeight
    const visibleBottom = paneRect.bottom

    if (rowRect.top < visibleTop) {
      pane.scrollTop -= visibleTop - rowRect.top
    } else if (rowRect.bottom > visibleBottom) {
      pane.scrollTop += rowRect.bottom - visibleBottom
    }
  }, [selectedIndex, isListCollapsed])

  // 指示: 「一覧にキーボードフォーカスがある状態で↑/↓キーを押すと、選択行を
  // 移動する」。資料ウィンドウ自体にフォーカスがある場合(既定、開いた直後)と
  // 一覧パネル自体にフォーカスがある場合の両方から呼べるよう、選択行移動の
  // ロジックを1箇所にまとめる(重複実装を避ける)。
  function moveSelection(direction: 1 | -1) {
    if (items.length === 0) return
    if (direction > 0) {
      setSelectedIndex((prev) => Math.min((prev ?? -1) + 1, items.length - 1))
    } else {
      setSelectedIndex((prev) => Math.max((prev ?? 1) - 1, 0))
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // 指示: 「キー操作は入力欄など文字入力中には横取りしない」。
    if (isEditableTarget(e.target)) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (items.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      moveSelection(e.key === 'ArrowDown' ? 1 : -1)
      return
    }
    // 指示: 「←/→キーで前後のページへ移動できるようにする」「PDF側に
    // フォーカスがあるときの←/→ページ送りなど、一覧外の既存操作は維持する」。
    // ページ番号そのものはReferencePdfViewer側が保持するため、ここでは
    // 命令的APIを呼ぶだけ。一覧パネル自体にフォーカスがある間は、下の
    // `handleListKeyDown`が先にこのイベントを捕まえて`stopPropagation`する
    // ため、ここへは到達しない(指示: 「一覧上の矢印キー操作でPDFのページ送りや
    // ズームが起きないようにする」)。
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      e.stopPropagation()
      viewerRef.current?.goToPrevPage()
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
      viewerRef.current?.goToNextPage()
    }
  }

  // 指示: 「一覧にキーボードフォーカスがある状態で↑/↓キーを押すと、選択行を
  // 移動する」「一覧上の矢印キー操作でPDFのページ送りやズームが起きないように
  // する」。一覧パネル自体(`tabIndex={0}`)にフォーカスがある間は、矢印キーは
  // すべてここで処理し尽くす(↑/↓は選択移動、←/→は何もしない)。
  // `stopPropagation`により、資料ウィンドウ側の`handleKeyDown`(←/→でページ送り)
  // へは伝播しない。一覧の外(資料ウィンドウ自体やPDF表示領域)にフォーカスが
  // 戻れば、既存の`handleKeyDown`がそのまま働く(例: PDF表示領域をクリックすると
  // 最寄りのfocusable祖先である資料ウィンドウ自体へフォーカスが移る)。
  function handleListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (isEditableTarget(e.target)) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      moveSelection(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  function handleTitleBarPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return // 閉じるボタンはドラッグ対象外
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setInteracting(true)
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTop: rect.top,
      startLeft: rect.left,
    }
  }

  function handleTitleBarPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    setRect((prev) =>
      clampRect(
        { ...prev, top: drag.startTop + dy, left: drag.startLeft + dx },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }

  function endTitleBarDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== e.pointerId) return
    dragRef.current = null
    setInteracting(false)
  }

  function handleResizePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setInteracting(true)
    resizeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
    }
  }

  function handleResizePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== e.pointerId) return
    e.stopPropagation()
    const dx = e.clientX - resize.startX
    const dy = e.clientY - resize.startY
    setRect((prev) =>
      clampRect(
        { ...prev, width: resize.startWidth + dx, height: resize.startHeight + dy },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    )
  }

  function endResize(e: ReactPointerEvent<HTMLDivElement>) {
    if (resizeRef.current?.pointerId !== e.pointerId) return
    resizeRef.current = null
    setInteracting(false)
    e.stopPropagation()
  }

  const selectedItem = selectedIndex != null ? (items[selectedIndex] ?? null) : null

  return (
    <div
      className={'reference-pdf-window' + (interacting ? ' reference-pdf-window--interacting' : '')}
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      onKeyDown={handleKeyDown}
      ref={windowRef}
      tabIndex={-1}
    >
      <div
        className="reference-pdf-window__titlebar"
        onPointerDown={handleTitleBarPointerDown}
        onPointerMove={handleTitleBarPointerMove}
        onPointerUp={endTitleBarDrag}
        onPointerCancel={endTitleBarDrag}
      >
        {/* 指示: 「資料、ページ番号、倍率、一覧切替、×を上部の1行にまとめる。
            ウィンドウ幅が狭くなっても2行に折り返さない」。タイトル文字列と
            ページ番号/倍率の差し込み先を1つのグループにまとめ、タイトルバー
            自体は従来どおり「左グループ/右(操作ボタン)グループ」の2要素
            space-betweenのまま保つ(中央に余計な大きい空白ができない)。 */}
        <div className="reference-pdf-window__titlebar-main">
          <h2>資料</h2>
          <div className="reference-pdf-window__viewer-status-slot" ref={setStatusSlot} />
        </div>
        <div className="reference-pdf-window__titlebar-actions">
          <button
            type="button"
            className="reference-pdf-window__list-toggle"
            onClick={() => setListCollapsed((prev) => !prev)}
            aria-pressed={isListCollapsed}
          >
            {isListCollapsed ? '一覧を表示' : '一覧を隠す'}
          </button>
          {/* 指示: 「×は、クリック可能な範囲が分かる背景・境界・ホバー表示を
              付け、明確なボタンとして見せる」。タイトルバーのドラッグ開始処理
              (`handleTitleBarPointerDown`)は`<button>`要素全般をドラッグ対象外に
              しているため、見た目を変えるだけでドラッグとの競合は発生しない。 */}
          <button type="button" className="reference-pdf-window__close-button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
      </div>

      {/* 指示: 「PDFプレビューをウィンドウ全体に表示し、その上に一覧を重ねる
          レイアウトへ修正する」「PDF表示領域を左右に分割しない」。
          viewer-paneは一覧の表示/非表示に関わらず常にbody全体を占める
          (position: absolute; inset: 0、`.reference-pdf-window__body`参照)。
          list-paneはその手前に重ねるoverlayで、JSX順をviewer-paneの後ろに
          することで同じスタッキング文脈内で後勝ちに上へ重なる
          (CSS側のz-indexでも明示的に保証している)。 */}
      <div className="reference-pdf-window__body">
        <div className="reference-pdf-window__viewer-pane">
          <ReferencePdfViewer
            ref={viewerRef}
            fileUrl={selectedItem ? referencePdfFileUrl(selectedItem.filename) : null}
            statusBarContainer={statusSlot}
          />
        </div>

        <div
          className={
            'reference-pdf-window__list-pane' +
            (isListCollapsed ? ' reference-pdf-window__list-pane--collapsed' : '')
          }
          ref={listPaneRef}
          onKeyDown={handleListKeyDown}
          tabIndex={0}
        >
          {state === 'loading' && <p className="reference-pdf-window__message">読み込み中...</p>}
          {state === 'error' && <p className="reference-pdf-window__message">{errorMessage}</p>}
          {state === 'loaded' && !folderExists && (
            <p className="reference-pdf-window__message">資料フォルダが見つかりません。</p>
          )}
          {state === 'loaded' && folderExists && items.length === 0 && (
            <p className="reference-pdf-window__message">資料フォルダにPDFがありません。</p>
          )}
          {state === 'loaded' && items.length > 0 && (
            <table className="reference-pdf-window__table">
              <thead>
                <tr>
                  <th className="reference-pdf-window__code-col">コード</th>
                  <th>積算対象</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr
                    key={item.filename}
                    className={
                      'reference-pdf-window__row' +
                      (index === selectedIndex ? ' reference-pdf-window__row--selected' : '')
                    }
                    onClick={() => setSelectedIndex(index)}
                  >
                    {item.valid ? (
                      <>
                        <td className="reference-pdf-window__code-col">{item.code}</td>
                        <td>{item.target}</td>
                      </>
                    ) : (
                      // 指示: アンダーバーが無い(=分割できない)PDFは、コード/積算対象の
                      // 列へ誤った値を出さず、ファイル名+「形式不正」であることを明示する。
                      <td colSpan={2} className="reference-pdf-window__invalid-cell">
                        {item.filename}(形式不正)
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div
        className="reference-pdf-window__resize-handle"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        aria-hidden="true"
      />
    </div>
  )
}
