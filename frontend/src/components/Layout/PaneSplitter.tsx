import { useEffect, useRef, useState } from 'react'
import './PaneSplitter.css'

interface Props {
  /** ドラッグによる移動量(px)を都度通知する。呼び出し側で符号を解釈する
   * (左ペイン境界は+delta=拡大、右ペイン境界は-delta=拡大、等)。
   * `axis`が`'y'`の場合は垂直方向(clientYの差分)を渡す (Phase 1.11 指示書24章)。 */
  onDrag: (deltaPx: number) => void
  ariaLabel: string
  /** 'x' (既定): 左右ペイン境界の縦線、ドラッグは水平方向。
   * 'y': 上下領域境界の横線、ドラッグは垂直方向 (Phase 1.11: Master領域の高さ変更)。 */
  axis?: 'x' | 'y'
}

/**
 * ペイン境界に置くResize Handle (UIレイアウト追加修正指示 4章/5章/9章/14章、
 * Phase 1.11 指示書24章でMaster領域の高さ変更にも再利用できるよう`axis`を追加)。
 *
 * - mousedown〜mouseupの間、windowレベルのmousemoveで移動量を都度計算し、
 *   直前位置からの差分(delta)のみを呼び出し側へ渡す (DrawingCanvasのPan実装と同様、
 *   refで最新のコールバックを保持し、リスナーを都度張り直さない)。
 * - ドラッグ中は `document.body` に `cursor: col-resize`/`row-resize` /
 *   `user-select: none` を適用し、テキスト選択やカーソルのちらつきを防ぐ。
 * - このハンドル自体はDrawing Viewer (DrawingCanvas) の外側の別要素であり、
 *   mousedownがDrawingCanvas側のPan/Manual BBox作成ロジックへバブリングすることは
 *   構造上ない。念のためこのハンドル上のmousedownでは伝播を止め、他の要素の
 *   クリック判定に影響しないようにする (要件14)。
 *
 * UI視覚階層改善 指示14章〜19章: 図面一覧↔Viewer・Viewer↔右ペイン・Viewer↔Master・
 * 盤情報↔積算集約・積算集約↔積算明細——現在存在するすべてのresize境界がこの
 * 1つの共通コンポーネントを使っているため、見た目(通常時/hover時/drag時)を
 * ここだけで統一する(指示19章「同じSplitterなのに場所によってバラバラにしない」)。
 * hit area(このdiv自体の幅/高さ)は指示15章どおり広く保ったまま、実際に見える線・
 * gripはCSS側で細く小さく描く。drag中かどうかはCSSの:hoverだけでは表現できない
 * (ドラッグ中はポインタがハンドル外に出ることがあるため)ため、`isDragging`state
 * を持ち、`pane-splitter--dragging`修飾classとしてJSX側から明示的に付与する。
 */
export function PaneSplitter({ onDrag, ariaLabel, axis = 'x' }: Props) {
  const onDragRef = useRef(onDrag)
  onDragRef.current = onDrag
  const draggingRef = useRef<{ last: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      const dragging = draggingRef.current
      if (!dragging) return
      const clientPos = axis === 'y' ? e.clientY : e.clientX
      const delta = clientPos - dragging.last
      dragging.last = clientPos
      if (delta !== 0) onDragRef.current(delta)
    }
    function handleMouseUp() {
      if (draggingRef.current) {
        draggingRef.current = null
        setIsDragging(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [axis])

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    draggingRef.current = { last: axis === 'y' ? e.clientY : e.clientX }
    setIsDragging(true)
    document.body.style.cursor = axis === 'y' ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div
      className={
        'pane-splitter' +
        (axis === 'y' ? ' pane-splitter--horizontal' : '') +
        (isDragging ? ' pane-splitter--dragging' : '')
      }
      role="separator"
      aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
      aria-label={ariaLabel}
      onMouseDown={handleMouseDown}
    >
      {/* 指示16章: 中央に小さいgripを表示する(縦境界=⋮、横境界=⋯)。装飾のみで
          操作対象そのものではないため、aria-hidden+pointer-events:noneにし、
          スクリーンリーダーの読み上げやクリック判定に一切影響しないようにする
          (指示36章: 既存のz-index/pointer-events設計に触れずに済ませる)。 */}
      <span className="pane-splitter__grip" aria-hidden="true">
        {axis === 'y' ? '⋯' : '⋮'}
      </span>
    </div>
  )
}
