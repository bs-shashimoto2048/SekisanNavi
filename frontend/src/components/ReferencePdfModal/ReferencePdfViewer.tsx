import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { PDF_DOCUMENT_RESOURCE_OPTIONS, pdfjsLib } from '../../pdf/pdfjs'

interface Props {
  /** 選択中のPDFファイルのURL。未選択の場合は`null`。 */
  fileUrl: string | null
  /** 指示: 「資料、ページ番号、倍率、一覧切替、×を上部の1行にまとめる」。
   * ページ番号/倍率の表示(状態の単一の真実源はこのcomponent自身=
   * `SinglePageView`が引き続き持つ)を、`ReferencePdfModal`側のタイトルバー内
   * (1行にまとめた中)へ`createPortal`で描画するための差し込み先。
   * 未指定(`ReferencePdfViewer`を単体で使う場合、単体テスト含む)の場合は、
   * 従来どおりこのcomponent自身の内側(表示領域の上)にステータスバーを
   * 描画する(後方互換)。 */
  statusBarContainer?: HTMLElement | null
}

/** `ReferencePdfModal`側のキーボードハンドラ(←/→)から、このcomponent内部の
 * ページ送りを呼び出すための最小限の命令的API。ページ番号そのものの保持は
 * 引き続き`SinglePageView`内部stateのみが担い、外部(Modal)へは公開しない
 * (指示: 上下キーによる一覧選択とキー処理を分離しつつ、ページ番号の
 * 単一の真実源は保つ)。 */
export interface ReferencePdfViewerHandle {
  goToNextPage: () => void
  goToPrevPage: () => void
}

type LoadState = 'idle' | 'loading' | 'loaded' | 'error'

/**
 * 「資料」ウィンドウのPDF表示領域 (PDF.js化)。
 *
 * 旧実装はブラウザ標準の`<iframe>`に委譲していたため、ダウンロード・印刷
 * ボタンを含むPDF操作ツールバーを非表示にできなかった。ここでは`pdfjs-dist`
 * (`DrawingCanvas.tsx`が図面PDF描画に使っているのと同じ`pdfjsLib`セットアップ、
 * `../../pdf/pdfjs`参照)で直接ページをcanvasへ描画し、ツールバーを一切持たない
 * 専用の表示領域にする。
 *
 * **1ページ表示・ボタンを使わない操作**: 常に「選択中の1ページだけ」を描画する。
 * ページ送り・拡大縮小は専用ボタンを置かず(指示: 「操作用スペースを減らす」)、
 * このウィンドウにフォーカスがある間の←/→キー(ページ送り、`ReferencePdfViewerHandle`
 * 経由で`ReferencePdfModal`のキー処理から呼ばれる)と、表示領域上でのマウス
 * ホイール(拡大縮小)で操作する。現在ページ/総ページ数の表示だけは残す。
 * ページを切り替えるたびに直前のページのcanvas描画bitmapを解放する
 * (指示: 「選択中の表示ページだけを描画し、ページ切替時に不要な描画
 * データを解放する」)。
 *
 * **拡大・縮小・パン**: ホイール操作はこのcomponentだけのローカルstateで
 * 完結し、DrawingCanvas.tsxのzoom stateとは無関係(指示: 「操作対象は資料
 * ウィンドウ内のPDFだけとし、背後の図面ビューや既存の拡大縮小操作には
 * 影響させない」)。表示領域(stage)へ直接`wheel`(`{ passive: false }`)を
 * 登録し`preventDefault`することで、ブラウザの既定スクロール・背後要素への
 * 伝播を止める(Reactの合成`onWheel`はReact 17以降rootへpassiveで登録される
 * ため`preventDefault`が効かないので、ネイティブaddEventListenerを使う)。
 * ページ送り・ファイル切替時は必ずFit倍率・パン位置ゼロへ戻す。拡大して
 * ページの一部が見切れる場合は、表示領域内のドラッグでパンできる
 * (縦横スクロールバーは出さず、`overflow: hidden`+transformで表示位置だけを
 * 動かす)。表示領域内で中央ボタン(マウスホイール押し込み)をダブルクリック
 * すると、`DrawingCanvas.tsx`の「中ボタンダブルクリックでFit」と同じ判定
 * ロジックでFit倍率・パン位置ゼロへ戻す。中央ボタンpress時点で常に
 * `preventDefault`し、ブラウザ標準のmiddle-click auto-scrollを抑止する
 * (単発クリックでは何も起きない。ダブルクリック判定もこの表示領域(stage)に
 * 閉じている)。
 *
 * **ドキュメントの解放**: `fileUrl`が変わるたび(ファイル切替)・unmount時に、
 * それまで読み込んでいた`PDFDocumentProxy`を`destroy()`する。表示中は常に
 * 選択中の1ファイル分のドキュメントだけを保持する(指示: 「PDFを切り替えたときは
 * 前のPDFの描画データを解放し、新しいPDFだけを表示する」)。
 *
 * **ページ番号/倍率表示の位置**: 「資料」ウィンドウの上部(タイトルバー)を
 * 1行にまとめる指示に伴い、ページ番号/倍率の表示はこのcomponent自身の内側の
 * 専用行ではなく、親の`ReferencePdfModal`が用意したタイトルバー内の差し込み先
 * (`statusBarContainer`)へ`createPortal`する。状態の保持場所(単一の真実源)は
 * 変わらずこのcomponent(実体は`SinglePageView`)のまま。`statusBarContainer`が
 * 無い場合(単体使用・単体テスト)は、従来どおり自身の内側に描画する。
 */
export const ReferencePdfViewer = forwardRef<ReferencePdfViewerHandle, Props>(function ReferencePdfViewer(
  { fileUrl, statusBarContainer },
  ref,
) {
  const [state, setState] = useState<LoadState>('idle')
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  // `doc`と必ず同じタイミングで更新する、読み込み完了時点のURL。`SinglePageView`の
  // keyに使うことで、ファイル切替のたびに現在ページを1ページ目・Fit倍率へ
  // 初期化する(doc/stateと別のタイミングで更新されるkeyを使わない)。
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const singlePageRef = useRef<SinglePageViewHandle>(null)

  useImperativeHandle(
    ref,
    () => ({
      goToNextPage: () => singlePageRef.current?.goToNextPage(),
      goToPrevPage: () => singlePageRef.current?.goToPrevPage(),
    }),
    [],
  )

  useEffect(() => {
    if (fileUrl == null) {
      setState('idle')
      setDoc(null)
      setLoadedUrl(null)
      return
    }

    let cancelled = false
    setState('loading')
    setErrorMessage(null)

    // `destroy()`は(解決前/解決後いずれの状態でも)`PDFDocumentProxy`にではなく
    // `getDocument()`が返す`PDFDocumentLoadingTask`自体に生えている(pdfjs-dist
    // の仕様)。解決済みの`doc.loadingTask`からも辿れるが、ここでは読み込み開始時点の
    // `loadingTask`をそのままcleanupで使えるよう直接保持する。
    const loadingTask = pdfjsLib.getDocument({ url: fileUrl, ...PDF_DOCUMENT_RESOURCE_OPTIONS })

    loadingTask.promise
      .then((d) => {
        if (cancelled) return
        setDoc(d)
        setLoadedUrl(fileUrl)
        setState('loaded')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setErrorMessage(e instanceof Error ? e.message : String(e))
        setState('error')
      })

    return () => {
      cancelled = true
      // 切替・unmountのいずれでも、直前に読み込んでいた(読み込み中含む)
      // documentは必ず解放する(指示: 「前のPDFの描画データを解放し、新しい
      // PDFだけを表示する」)。
      void loadingTask.destroy()
    }
  }, [fileUrl])

  if (fileUrl == null) {
    return <p className="reference-pdf-viewer__message">表示するPDFがありません。</p>
  }
  if (state === 'loading' || state === 'idle') {
    return <p className="reference-pdf-viewer__message">読み込み中...</p>
  }
  if (state === 'error') {
    return <p className="reference-pdf-viewer__message">PDFを表示できませんでした: {errorMessage}</p>
  }
  if (!doc) return null

  return (
    <SinglePageView key={loadedUrl} doc={doc} ref={singlePageRef} statusBarContainer={statusBarContainer} />
  )
})

interface SinglePageViewHandle {
  goToNextPage: () => void
  goToPrevPage: () => void
}

interface SinglePageViewProps {
  doc: PDFDocumentProxy
  statusBarContainer?: HTMLElement | null
}

interface Size {
  width: number
  height: number
}

// 手動ズーム(ホイール)の刻み幅・範囲。DrawingCanvas.tsx(図面Viewer)の
// ZOOM_STEP(1.25)と同じ考え方だが、完全に独立した定数(資料ウィンドウの
// PDFにしか影響しない)。
const ZOOM_STEP = 1.25
const MIN_ZOOM = 0.1
const MAX_ZOOM = 6
// 中央ボタン(マウスホイール押し込み)ダブルクリックでFitへ戻す判定用。
// `DrawingCanvas.tsx`の「中ボタンダブルクリックでFit」と同じ考え方・同じ値
// (OS標準のダブルクリック判定間隔を踏まえた400ms、クリックとみなす許容ずれ)を
// 流用する、完全に独立した定数。
const DBLCLICK_MS = 400
const MIDDLE_CLICK_POS_TOLERANCE = 6

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

/** 常に1ページだけを、表示領域に収まる倍率(Fit)または手動ズーム倍率で描画する。
 * ページ送り・ズームいずれも専用ボタンは持たず、`ref`経由のページ送り
 * (`ReferencePdfModal`の←/→キー処理から)とホイール(ズーム)で操作する。
 * 拡大時は表示領域内のドラッグでパンできる。 */
const SinglePageView = forwardRef<SinglePageViewHandle, SinglePageViewProps>(function SinglePageView(
  { doc, statusBarContainer },
  ref,
) {
  const [pageNumber, setPageNumber] = useState(1)
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  // ページ固有のネイティブ寸法(scale=1)。表示領域サイズと組み合わせてfit倍率を
  // 算出する(指示のscale計算式のうち「ページ幅/ページ高さ」側)。
  const [pageNativeSize, setPageNativeSize] = useState<Size | null>(null)
  // 表示領域(stage)の実measured寸法。ウィンドウのリサイズに追従させるため
  // ResizeObserverで更新する(指示のscale計算式のうち「表示領域幅/高さ」側)。
  const [stageSize, setStageSize] = useState<Size | null>(null)
  // true(既定・ページ送り直後)の間は、fitScaleの変化に常に追従する。
  // ホイールズームでfalseになり、以後はウィンドウリサイズでは倍率を変えない
  // (典型的なPDF viewerの「手動ズームは次にFitへ戻すまで固定」という挙動)。
  const [isFit, setIsFit] = useState(true)
  // 手動ズーム時の絶対倍率(1 = 原寸100%)。Fit中はfitScaleをそのまま使うため
  // 参照しない。
  const [manualScale, setManualScale] = useState(1)
  // 拡大時、表示領域内ドラッグで動かす表示位置のオフセット(px、中央基準)。
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  // 直近の描画結果の表示サイズ(パン範囲のクランプに使う)。
  const [displaySize, setDisplaySize] = useState<Size | null>(null)

  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<ReturnType<PDFPageProxy['render']> | null>(null)
  const panDragRef = useRef<{ pointerId: number; startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  // 中央ボタンダブルクリック判定用(指示: 「PDF表示領域内でマウスホイール
  // ボタン(中央ボタン)をダブルクリックすると、Fit倍率に戻す」)。
  // 直前の中央ボタンクリック(press+release、移動なし)の時刻・位置を覚えておく。
  const middleClickRef = useRef<{ time: number; x: number; y: number } | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      goToNextPage: () => setPageNumber((p) => Math.min(doc.numPages, p + 1)),
      goToPrevPage: () => setPageNumber((p) => Math.max(1, p - 1)),
    }),
    [doc],
  )

  // ページ切替のたびに、そのページのproxyとネイティブ寸法を取得し、
  // Fit倍率・パン位置へ戻す(指示: 「ページ切替時は、新しいページが全体表示
  // されるFit倍率に戻す」)。
  useEffect(() => {
    let cancelled = false
    setPage(null)
    setPageNativeSize(null)
    setIsFit(true)
    setPanOffset({ x: 0, y: 0 })
    doc
      .getPage(pageNumber)
      .then((p) => {
        if (cancelled) return
        setPage(p)
        const viewport = p.getViewport({ scale: 1 })
        setPageNativeSize({ width: viewport.width, height: viewport.height })
      })
      .catch(() => {
        // ページ取得失敗はローディング表示のまま止まる(個別ページの失敗で
        // ウィンドウ全体を壊さない。致命的な失敗は呼び出し元のdoc読み込み
        // エラー表示側で担保する)。
      })
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber])

  // 表示領域(stage)のサイズを測定する。マウント時に実測値を1度セットし(初回
  // レンダリング前にResizeObserverの初回発火を待たない)、以後は資料ウィンドウの
  // リサイズに追従してResizeObserverで更新する(`DrawingCanvas.tsx`のViewer
  // 自動Fitと同じ考え方)。
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    setStageSize({ width: stage.clientWidth, height: stage.clientHeight })
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setStageSize({ width, height })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  // 指示: 「scale = min(表示領域幅 / ページ幅, 表示領域高さ / ページ高さ)」。
  // 縦横比を保ったまま表示領域全体に収まる最大倍率。
  const fitScale =
    pageNativeSize && stageSize && stageSize.width > 0 && stageSize.height > 0 && pageNativeSize.width > 0
      ? Math.min(stageSize.width / pageNativeSize.width, stageSize.height / pageNativeSize.height)
      : null

  const scale = isFit ? fitScale : manualScale

  // ホイールハンドラ(マウント後に一度だけ登録する native listener)が常に
  // 最新のisFit/fitScaleを読めるようにするためのrefミラー(App.tsxの
  // handleUndoRef/handleRedoRefと同じ「refへ毎回同期する」パターン)。
  const isFitRef = useRef(isFit)
  useEffect(() => {
    isFitRef.current = isFit
  }, [isFit])
  const fitScaleRef = useRef(fitScale)
  useEffect(() => {
    fitScaleRef.current = fitScale
  }, [fitScale])

  // 倍率が変わるたびにパン位置をリセットする(指示の対象外の挙動を防ぐための
  // 単純化。新しい倍率でのクランプ範囲と無関係な古いオフセットを持ち越さない)。
  useEffect(() => {
    setPanOffset({ x: 0, y: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale])

  useEffect(() => {
    if (!page || scale == null || scale <= 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const displayViewport = page.getViewport({ scale })
    const renderViewport = page.getViewport({ scale: scale * dpr })
    canvas.width = renderViewport.width
    canvas.height = renderViewport.height
    canvas.style.width = `${displayViewport.width}px`
    canvas.style.height = `${displayViewport.height}px`
    setDisplaySize({ width: displayViewport.width, height: displayViewport.height })
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    renderTaskRef.current?.cancel()
    const task = page.render({ canvas, canvasContext: ctx, viewport: renderViewport })
    renderTaskRef.current = task
    task.promise.catch(() => {
      // ページ切替・リサイズ・ズームによる再描画キャンセルは正常系。ここでは無視する。
    })

    return () => {
      task.cancel()
      renderTaskRef.current = null
      // 指示: 「選択中の表示ページだけを描画し、ページ切替時に不要な描画
      // データを解放する」。表示を離れるページのcanvas bitmapを都度解放する。
      canvas.width = 0
      canvas.height = 0
    }
  }, [page, scale])

  // 指示: 「PDF表示領域にポインターがある状態でマウスホイールを操作すると、
  // 資料ウィンドウ内のPDFだけを拡大・縮小する」「ホイール操作時はブラウザの
  // ページスクロールなどを抑止し、背後の図面ビューや他の画面要素を動かさない」。
  // Reactの合成`onWheel`はReact 17以降、root要素へpassiveリスナーとして
  // 登録されるため`preventDefault()`が効かない(既知の制約)。表示領域
  // (stage)要素自身へネイティブ`addEventListener('wheel', ..., {passive:
  // false})`を使う。stopPropagation()も呼ぶため、このイベントが資料
  // ウィンドウの外(背後の図面Viewer等)まで伝播することもない。
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    function handleWheel(e: WheelEvent) {
      e.preventDefault()
      e.stopPropagation()
      const base = isFitRef.current ? (fitScaleRef.current ?? 1) : undefined
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
      setIsFit(false)
      setManualScale((prev) => clampZoom((base ?? prev) * factor))
    }
    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => stage.removeEventListener('wheel', handleWheel)
  }, [])

  // 指示: 「拡大時にページの一部が見切れる場合は、PDF表示領域内でドラッグして
  // 表示位置を動かせるようにする」「PDF表示領域に縦横スクロールバーを出さない」。
  // ハンドラはstage要素自身にのみ付けており(window/documentへは何も登録しない)、
  // 資料ウィンドウ外の要素(背後の図面・他floating panel等)で始まった
  // ドラッグがこのパン操作として扱われることはない
  // (指示: 「PDF表示領域外のドラッグではPDFのパン操作を開始しない」)。
  // タイトルバー移動・リサイズハンドルと同じ、setPointerCaptureパターンを使う。
  function clampPanOffset(x: number, y: number): { x: number; y: number } {
    const stage = stageSize
    const size = displaySize
    if (!stage || !size) return { x: 0, y: 0 }
    const maxX = Math.max(0, (size.width - stage.width) / 2)
    const maxY = Math.max(0, (size.height - stage.height) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    }
  }

  function handleStagePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // 指示: 「ブラウザの自動スクロールなどが発生しないよう、PDF表示領域内の
    // 中央ボタン操作を適切に処理する」。DrawingCanvas.tsxの中ボタン処理と同じく、
    // press時点で即座にpreventDefault/stopPropagationし、ブラウザ標準の
    // middle-click auto-scrollを抑止する。ダブルクリック判定はrelease
    // (pointerup)側で行うため、ここではpointer captureだけ行って終える
    // (既存のパン操作は左ボタンのみのまま維持する。中央ボタンはパンしない)。
    if (e.button === 1) {
      e.preventDefault()
      e.stopPropagation()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      return
    }
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setIsPanning(true)
    panDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startOffsetX: panOffset.x,
      startOffsetY: panOffset.y,
    }
  }

  function handleStagePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = panDragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    setPanOffset(clampPanOffset(drag.startOffsetX + dx, drag.startOffsetY + dy))
  }

  function endStagePan(e: ReactPointerEvent<HTMLDivElement>) {
    // 指示: 「PDF表示領域内でマウスホイールボタン(中央ボタン)をダブルクリック
    // すると、PDFをFit倍率に戻す」「Fit時はパン位置も初期位置に戻す」
    // 「中央ボタンの通常クリックは維持する(=単発では何もしない)」。
    // DrawingCanvas.tsxの中ボタンダブルクリック判定と同じロジック:
    // 直前のクリックからDBLCLICK_MS以内・ほぼ同じ位置ならダブルクリック成立。
    if (e.button === 1) {
      e.preventDefault()
      e.stopPropagation()
      const now = Date.now()
      const last = middleClickRef.current
      const distFromLast =
        last != null ? Math.max(Math.abs(e.clientX - last.x), Math.abs(e.clientY - last.y)) : Infinity
      if (last != null && now - last.time <= DBLCLICK_MS && distFromLast < MIDDLE_CLICK_POS_TOLERANCE) {
        middleClickRef.current = null
        // Fitへ戻す。パン位置はscale変化をトリガーに既存effect([scale]依存)が
        // 自動的に(0, 0)へリセットする(Fit状態を作る処理を二重実装しない)。
        setIsFit(true)
      } else {
        middleClickRef.current = { time: now, x: e.clientX, y: e.clientY }
      }
      return
    }
    if (panDragRef.current?.pointerId !== e.pointerId) return
    panDragRef.current = null
    setIsPanning(false)
  }

  const zoomPercent = scale != null ? Math.round(scale * 100) : null

  // 指示: 「ページ送りボタンと拡大縮小ボタンは削除し、操作用スペースを
  // 減らす」「現在ページ/総ページ数の表示は残す」。ボタンは置かず、
  // ページ番号と倍率の表示だけを残した薄いステータスバーにする。
  //
  // 指示(タイトルバー1行化): `statusBarContainer`が渡されている場合
  // (`ReferencePdfModal`からの通常の利用時)は、このJSXをcomponent自身の
  // 内側ではなく、タイトルバー側が用意した差し込み先へ`createPortal`する。
  // 状態(pageNumber/zoomPercent)の保持場所自体は変えず、表示位置だけを
  // タイトルバーの1行へ移す。`statusBarContainer`が無い場合(単体使用時)は
  // 従来どおりこのcomponent自身の内側に描画する(後方互換)。
  const statusBar = (
    <div className="reference-pdf-viewer__status-bar">
      <span className="reference-pdf-viewer__page-nav-count">
        {pageNumber} / {doc.numPages}
      </span>
      <span className="reference-pdf-viewer__zoom-percent">{zoomPercent != null ? `${zoomPercent}%` : '—'}</span>
    </div>
  )

  return (
    <div className="reference-pdf-viewer__container">
      {statusBarContainer ? createPortal(statusBar, statusBarContainer) : statusBar}
      <div
        className={'reference-pdf-viewer__stage' + (isPanning ? ' reference-pdf-viewer__stage--panning' : '')}
        ref={stageRef}
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={endStagePan}
        onPointerCancel={endStagePan}
      >
        <canvas
          ref={canvasRef}
          className="reference-pdf-viewer__canvas"
          style={{ transform: `translate(${panOffset.x}px, ${panOffset.y}px)` }}
        />
      </div>
    </div>
  )
})
