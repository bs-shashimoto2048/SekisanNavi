import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { PDFPageProxy } from 'pdfjs-dist'
import { pdfjsLib } from '../../pdf/pdfjs'
import './DrawingCanvas.css'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 6
const ZOOM_STEP = 1.25
const FIT_MARGIN = 0.98
// クリックとドラッグの誤認を防ぐための最小移動量 (画面ピクセル、zoom非依存)。
// これ未満の移動量ではManual BBoxを作成しない (要件14)。
const MIN_DRAG_PX = 6

interface NativeSize {
  width: number
  height: number
}

interface NormalizedRect {
  x: number
  y: number
  w: number
  h: number
}

interface Props {
  /** 表示対象ファイルのURL。ページ切替のたびに変わる。 */
  fileUrl: string
  /** 表示方式。'pdf'=PDF.js描画 (既定)、'png'=画像をそのまま表示。
   * Phase 1.8重要仕様訂正: 実製番の中央Viewerはproduct_df由来の盤領域Overlayとの
   * 座標整合のため、左ペインと同じ{page}.pngを表示する ('png'モード)。
   * PDF表示自体は既存API・機能ともに削除しておらず、'pdf'モードとして残置している。 */
  mode?: 'pdf' | 'png'
  /** ロード前の仮表示に使うフォールバックサイズ (バックエンドの page_width/page_height)。 */
  fallbackSize: NativeSize
  children?: ReactNode
  /** overlay(BBox等)が原寸を基準に描画できるよう、ロードできたサイズを通知する。 */
  onNativeSizeChange?: (size: NativeSize) => void
  /** true の間、Viewer上のドラッグはPanではなくManual BBox作成として扱う (Phase 1.6)。 */
  bboxAddMode?: boolean
  /** Manual BBox作成が確定した時に呼ばれる。矩形は0.0〜1.0の正規化座標。 */
  onCreateBBox?: (rect: NormalizedRect) => void
  /** 選択中Detection (Phase 1.7)。ツールバー右端の削除ボタンの活性/表示制御に使う。 */
  selectedDetectionLabel?: string | null
  onDeleteSelectedDetection?: () => void
  /** Pan相当の空白領域を(ドラッグせず)クリックした時に呼ばれる。選択解除に使う (要件26)。 */
  onBackgroundClick?: () => void
}

/**
 * 図面ページの描画領域。
 *
 * Overlay座標系の設計方針 (architecture.md参照):
 *   Detection/PanelArea の座標は 0.0〜1.0 の正規化座標として保持し、
 *   このコンポーネントが管理する「表示コンテンツ原寸 x zoom」のコンテンツ領域に対する
 *   割合(%)としてオーバーレイを配置する。ズーム・パン・ウィンドウサイズ変更が
 *   起きても、この座標系自体は一切変化しない (要件5/6: 実際に表示されている
 *   画像/PDF領域そのものを座標基準にし、Viewerの余白・ツールバー等は含めない)。
 *
 * Phase 1.5: PDF.jsによる実PDF表示 ('pdf'モード)。
 * Phase 1.8重要仕様訂正: 実製番の中央Viewerでは、左ペインと同一の{page}.pngを
 * 表示する ('pngモード')。product_df由来の盤領域Overlayは、この画像の実ピクセル寸法
 * (naturalWidth/naturalHeight) を正規化の基準にしているため、PDF表示のままでは
 * 余白・原点の違いにより位置がずれる可能性がある。PDF表示機能自体は削除せず、
 * modeで切り替えられる形で残している。
 *
 * Phase 1.6: 積算コードMasterで行が選択されている間 (bboxAddMode) は、
 * 同じドラッグ操作をPanではなくManual BBox作成として扱う (要件9/13)。
 */
export function DrawingCanvas({
  fileUrl,
  mode = 'pdf',
  fallbackSize,
  children,
  onNativeSizeChange,
  bboxAddMode = false,
  onCreateBBox,
  selectedDetectionLabel = null,
  onDeleteSelectedDetection,
  onBackgroundClick,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const renderTaskRef = useRef<ReturnType<PDFPageProxy['render']> | null>(null)
  const dragRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(
    null,
  )
  const wheelAnchorRef = useRef<{ nativeX: number; nativeY: number; clientX: number; clientY: number } | null>(
    null,
  )
  const drawRef = useRef<{
    startClientX: number
    startClientY: number
    startNativeX: number
    startNativeY: number
  } | null>(null)

  const [pdfPage, setPdfPage] = useState<PDFPageProxy | null>(null)
  // pngモードでの「画像の読み込み完了」フラグ (pdfPageに相当)。
  const [imageReady, setImageReady] = useState(false)
  const [nativeSize, setNativeSize] = useState<NativeSize>(fallbackSize)
  const [zoom, setZoom] = useState(1)
  // Viewer自動Fit仕様 (実画面未達 追加修正指示18章〜35章)。
  // 'fit'   : Viewer利用可能領域(ResizeObserverで実測)へ左上基点で自動的に最大Fitする。
  //           左右ペイン・Master高さ・ブラウザwindowのリサイズで再計算される。
  // 'manual': ユーザーが+/-・ホイール・Panで明示的にZoom/Panした状態。
  //           この間はレイアウト変更で勝手にFitへ戻さない (要件27)。
  // ページ切替のたびにDrawingCanvas自体がkey付きで再マウントされるため
  // (DrawingViewer.tsx参照)、新しいページは常にviewMode='fit'から始まる (要件30)。
  const [viewMode, setViewMode] = useState<'fit' | 'manual'>('fit')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // ドラッグ中のManual BBoxプレビュー (native座標系)。
  const [draftRect, setDraftRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  )

  // モード共通の「コンテンツ読み込み完了」フラグ。
  const contentReady = mode === 'png' ? imageReady : pdfPage != null

  // 最新の zoom/nativeSize/bboxAddMode/onCreateBBox を、購読を張り直さない
  // window イベントリスナーからも参照できるようにrefへ都度反映する。
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const nativeSizeRef = useRef(nativeSize)
  nativeSizeRef.current = nativeSize
  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode
  const bboxAddModeRef = useRef(bboxAddMode)
  bboxAddModeRef.current = bboxAddMode
  const onCreateBBoxRef = useRef(onCreateBBox)
  onCreateBBoxRef.current = onCreateBBox
  const onBackgroundClickRef = useRef(onBackgroundClick)
  onBackgroundClickRef.current = onBackgroundClick

  // PDFファイルのロード ('pdf'モードのみ)
  useEffect(() => {
    if (mode !== 'pdf') return
    let cancelled = false
    setLoading(true)
    setError(null)
    setPdfPage(null)

    pdfjsLib
      .getDocument({ url: fileUrl })
      .promise.then((doc) => doc.getPage(1))
      .then((page) => {
        if (cancelled) return
        const viewport = page.getViewport({ scale: 1 })
        const size = { width: viewport.width, height: viewport.height }
        setNativeSize(size)
        onNativeSizeChange?.(size)
        setPdfPage(page)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [fileUrl, mode, onNativeSizeChange])

  // PNG画像のロード ('png'モードのみ)。Phase 1.8重要仕様訂正。
  // 非表示のプリロード用<img>でnaturalWidth/naturalHeight (=画像の実ピクセル寸法) を
  // 取得する。product_df由来の盤領域Overlayはこの寸法を正規化の基準にしている
  // (指示書5章: PNG画像そのものを座標基準にする)。
  useEffect(() => {
    if (mode !== 'png') return
    setLoading(true)
    setError(null)
    setImageReady(false)
  }, [fileUrl, mode])

  function handlePngPreloadLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget
    const size = { width: img.naturalWidth, height: img.naturalHeight }
    setNativeSize(size)
    onNativeSizeChange?.(size)
    setImageReady(true)
    setLoading(false)
  }

  function handlePngPreloadError() {
    setError('画像を読み込めませんでした。')
    setLoading(false)
  }

  // コンテンツ (PDF/PNG) の読み込みが完了した時点でFitを適用する
  // (実画面未達 追加修正指示30章: 製番/Pageを開いた直後はfit状態で表示する。
  // DrawingCanvas自体がページ切替のたびにkey付きで再マウントされるため、
  // viewModeは常にこの時点で既定値'fit'になっている)。
  useEffect(() => {
    if (!contentReady) return
    if (viewModeRef.current !== 'fit') return
    const viewport = viewportRef.current
    if (!viewport) return
    applyFit(viewport.clientWidth, viewport.clientHeight)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentReady])

  // Viewer利用可能領域のサイズ変化をResizeObserverで検知し、fitモード中のみ
  // 自動的に再Fitする (実画面未達 追加修正指示18章〜29章/34章/35章)。
  // 左右ペイン幅変更・下部Master高さ変更・ブラウザwindowのリサイズは、
  // いずれも最終的にこの`.drawing-canvas__viewport`要素自身のCSS計算サイズを
  // 変化させるため、個々のイベントを別々に監視・手計算する必要がない
  // (window.innerWidth等から左右ペイン幅・Master高さを差し引く重複計算を避ける)。
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      if (viewModeRef.current !== 'fit') return
      const { width, height } = entry.contentRect
      applyFit(width, height)
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  // zoom / pdfPage 変更時にCanvasを再描画する ('pdf'モードのみ。'png'モードは
  // ブラウザのCSSスケーリングに任せるため再描画処理は不要)。
  useEffect(() => {
    if (mode !== 'pdf' || !pdfPage) return
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    const viewport = pdfPage.getViewport({ scale: zoom * dpr })
    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.style.width = `${zoom * nativeSize.width}px`
    canvas.style.height = `${zoom * nativeSize.height}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    renderTaskRef.current?.cancel()
    const task = pdfPage.render({ canvas, canvasContext: ctx, viewport })
    renderTaskRef.current = task
    task.promise.catch(() => {
      // ズーム連打時のレンダーキャンセルは正常系。ここでは無視する。
    })

    return () => {
      task.cancel()
    }
  }, [mode, pdfPage, zoom, nativeSize])

  // ホイールズーム後、カーソル位置を基準にスクロール位置を補正する
  useEffect(() => {
    const anchor = wheelAnchorRef.current
    const viewport = viewportRef.current
    if (!anchor || !viewport) return
    viewport.scrollLeft = anchor.nativeX * zoom - anchor.clientX
    viewport.scrollTop = anchor.nativeY * zoom - anchor.clientY
    wheelAnchorRef.current = null
  }, [zoom])

  function clampZoom(z: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
  }

  /** 指定されたViewer利用可能領域のサイズへ、アスペクト比を維持して最大Fitする
   * zoomを計算・適用する (実画面未達 追加修正指示21章)。viewModeは変更しない
   * (呼び出し側の責務。ボタンクリック時は明示的に'fit'へ切り替え、
   * ResizeObserver/初期表示時は既にfitモードであることを確認済みの上で呼ぶ)。
   * Fit後は左上基点(スクロール位置0,0)に戻す (要件19/22)。 */
  function applyFit(viewportWidth: number, viewportHeight: number) {
    const size = nativeSizeRef.current
    if (viewportWidth <= 0 || viewportHeight <= 0 || size.width <= 0 || size.height <= 0) return
    const scaleX = viewportWidth / size.width
    const scaleY = viewportHeight / size.height
    setZoom(clampZoom(Math.min(scaleX, scaleY) * FIT_MARGIN))
    requestAnimationFrame(() => {
      if (viewportRef.current) {
        viewportRef.current.scrollLeft = 0
        viewportRef.current.scrollTop = 0
      }
    })
  }

  /** ツールバーの「Fit」ボタン。fitモードへ明示的に戻し、現在のViewer利用可能領域へ
   * 即座に再Fitする (要件28)。 */
  function handleFitClick() {
    setViewMode('fit')
    const viewport = viewportRef.current
    if (viewport) applyFit(viewport.clientWidth, viewport.clientHeight)
  }

  function zoomIn() {
    setViewMode('manual') // 明示的なZoom操作 (要件27)。
    setZoom((z) => clampZoom(z * ZOOM_STEP))
  }

  function zoomOut() {
    setViewMode('manual')
    setZoom((z) => clampZoom(z / ZOOM_STEP))
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    e.preventDefault()
    const viewport = viewportRef.current
    if (!viewport) return
    setViewMode('manual') // ホイールZoomも明示的なZoom操作として扱う (要件27)。
    const rect = viewport.getBoundingClientRect()
    const clientX = e.clientX - rect.left
    const clientY = e.clientY - rect.top
    const contentX = clientX + viewport.scrollLeft
    const contentY = clientY + viewport.scrollTop

    wheelAnchorRef.current = {
      nativeX: contentX / zoom,
      nativeY: contentY / zoom,
      clientX,
      clientY,
    }
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
    setZoom((z) => clampZoom(z * factor))
  }

  /** クライアント座標(画面上のマウス位置)を、そのページのnative(原寸)座標へ変換する。 */
  function clientToNative(clientX: number, clientY: number): { x: number; y: number } | null {
    const viewport = viewportRef.current
    if (!viewport) return null
    const rect = viewport.getBoundingClientRect()
    const contentX = clientX - rect.left + viewport.scrollLeft
    const contentY = clientY - rect.top + viewport.scrollTop
    return { x: contentX / zoomRef.current, y: contentY / zoomRef.current }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return

    if (bboxAddModeRef.current) {
      const native = clientToNative(e.clientX, e.clientY)
      if (!native) return
      drawRef.current = {
        startClientX: e.clientX,
        startClientY: e.clientY,
        startNativeX: native.x,
        startNativeY: native.y,
      }
      setDraftRect({ x0: native.x, y0: native.y, x1: native.x, y1: native.y })
      return
    }

    const viewport = viewportRef.current
    if (!viewport) return
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    }
  }

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (drawRef.current) {
        const native = clientToNative(e.clientX, e.clientY)
        if (!native) return
        setDraftRect({
          x0: drawRef.current.startNativeX,
          y0: drawRef.current.startNativeY,
          x1: native.x,
          y1: native.y,
        })
        return
      }
      const drag = dragRef.current
      const viewport = viewportRef.current
      if (!drag || !viewport) return
      // 実際に意味のある移動量に達した時点で明示的なPanとみなし、manualモードへ切り替える
      // (要件27。空白クリック=ほぼ動いていない場合はここを通らず、fitモードのままにする)。
      const movedPx = Math.max(Math.abs(e.clientX - drag.x), Math.abs(e.clientY - drag.y))
      if (movedPx >= MIN_DRAG_PX) setViewMode('manual')
      viewport.scrollLeft = drag.scrollLeft - (e.clientX - drag.x)
      viewport.scrollTop = drag.scrollTop - (e.clientY - drag.y)
    }

    function handleMouseUp(e: MouseEvent) {
      const draw = drawRef.current
      if (draw) {
        drawRef.current = null
        setDraftRect(null)
        const movedPx = Math.max(
          Math.abs(e.clientX - draw.startClientX),
          Math.abs(e.clientY - draw.startClientY),
        )
        if (movedPx < MIN_DRAG_PX) return // クリックとみなし、BBoxは作成しない (要件14)

        const native = clientToNative(e.clientX, e.clientY)
        if (!native) return
        const size = nativeSizeRef.current
        const x0 = Math.min(draw.startNativeX, native.x)
        const y0 = Math.min(draw.startNativeY, native.y)
        const x1 = Math.max(draw.startNativeX, native.x)
        const y1 = Math.max(draw.startNativeY, native.y)
        const rect: NormalizedRect = {
          x: Math.max(0, Math.min(1, x0 / size.width)),
          y: Math.max(0, Math.min(1, y0 / size.height)),
          w: Math.max(0, Math.min(1, (x1 - x0) / size.width)),
          h: Math.max(0, Math.min(1, (y1 - y0) / size.height)),
        }
        onCreateBBoxRef.current?.(rect)
        return
      }
      const drag = dragRef.current
      dragRef.current = null
      if (drag) {
        const movedPx = Math.max(Math.abs(e.clientX - drag.x), Math.abs(e.clientY - drag.y))
        // ほぼ動いていない = 空白領域のクリックとみなし、選択解除を通知する (要件26)。
        if (movedPx < MIN_DRAG_PX) {
          onBackgroundClickRef.current?.()
        }
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const contentWidth = zoom * nativeSize.width
  const contentHeight = zoom * nativeSize.height

  const draftRectStyle = draftRect
    ? {
        left: `${(Math.min(draftRect.x0, draftRect.x1) / nativeSize.width) * 100}%`,
        top: `${(Math.min(draftRect.y0, draftRect.y1) / nativeSize.height) * 100}%`,
        width: `${(Math.abs(draftRect.x1 - draftRect.x0) / nativeSize.width) * 100}%`,
        height: `${(Math.abs(draftRect.y1 - draftRect.y0) / nativeSize.height) * 100}%`,
      }
    : null

  return (
    <div className="drawing-canvas">
      {/* pngモード専用の非表示プリロード<img>。naturalWidth/naturalHeightの検出のみに使う
          (指示書5章/6章: 実際に表示されるPNG画像そのものを座標基準にするため、
          原寸検出とレイアウト計算を同じ画像ソースから行う)。 */}
      {mode === 'png' && (
        <img
          src={fileUrl}
          alt=""
          aria-hidden="true"
          className="drawing-canvas__preload-img"
          onLoad={handlePngPreloadLoad}
          onError={handlePngPreloadError}
        />
      )}
      <div className="drawing-canvas__toolbar">
        <button type="button" onClick={zoomOut} title="縮小">
          −
        </button>
        <span className="drawing-canvas__zoom-label">{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={zoomIn} title="拡大">
          ＋
        </button>
        <button type="button" onClick={handleFitClick} title="Fit to View">
          Fit
        </button>
        {bboxAddMode && (
          <span className="drawing-canvas__mode-badge" title="積算コードMasterで選択中の行がManual BBoxの追加対象になります">
            ✎ BBox追加モード
          </span>
        )}
        {selectedDetectionLabel != null && (
          <span className="drawing-canvas__selection-badge">BBox編集: {selectedDetectionLabel}</span>
        )}
        <button
          type="button"
          className="drawing-canvas__delete-button"
          disabled={selectedDetectionLabel == null}
          onClick={onDeleteSelectedDetection}
          title="選択中のBBoxを削除します (Deleteキーでも削除できます)"
        >
          BBox削除
        </button>
      </div>
      <div
        ref={viewportRef}
        className={
          'drawing-canvas__viewport' + (bboxAddMode ? ' drawing-canvas__viewport--draw' : '')
        }
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
      >
        {loading && <div className="drawing-canvas__status">図面を読み込み中...</div>}
        {error && (
          <div className="drawing-canvas__status drawing-canvas__status--error">
            図面ファイルを読み込めませんでした。
            <br />
            {error}
          </div>
        )}
        {!loading && !error && (
          <div
            className="drawing-canvas__content"
            style={{ width: contentWidth, height: contentHeight }}
          >
            {mode === 'png' ? (
              <img
                src={fileUrl}
                alt=""
                className="drawing-canvas__canvas"
                style={{ width: '100%', height: '100%', display: 'block' }}
                draggable={false}
              />
            ) : (
              <canvas ref={canvasRef} className="drawing-canvas__canvas" />
            )}
            {children}
            {draftRectStyle && (
              <div className="drawing-canvas__draft-rect" style={draftRectStyle} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
