import { useEffect, useRef } from 'react'
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
 */
export function PaneSplitter({ onDrag, ariaLabel, axis = 'x' }: Props) {
  const onDragRef = useRef(onDrag)
  onDragRef.current = onDrag
  const draggingRef = useRef<{ last: number } | null>(null)

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
    document.body.style.cursor = axis === 'y' ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
  }

  return (
    <div
      className={'pane-splitter' + (axis === 'y' ? ' pane-splitter--horizontal' : '')}
      role="separator"
      aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
      aria-label={ariaLabel}
      onMouseDown={handleMouseDown}
    />
  )
}
