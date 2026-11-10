import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './EstimateResultNotePopover.css'

interface Props {
  /** ボタンの表示文言(「理由」「根拠」)。 */
  label: string
  /** ボタンのaria-label(「判定理由」「根拠」)。 */
  ariaLabel: string
  /** ポップオーバーの見出し(読み上げ・視認用)。 */
  heading: string
  /** ポップオーバーに表示する本文。システムが持つ判定理由・根拠の整形済みテキスト
   * (読み取り専用。自由入力欄ではない)。改行は保持する。 */
  text: string
}

const GAP = 6
const VIEWPORT_MARGIN = 8

/** 積算明細の「理由」「根拠」ボタン。hoverのtitleではなく、押下で内容を読める
 * ポップオーバーを開く。
 *
 * - 表の`overflow: auto`で切れないよう`document.body`へportalし、`position: fixed`で
 *   ボタンの直下(収まらなければ上)へ置く。
 * - 外側のpointerdown・Escape・ウィンドウのリサイズ・スクロールで閉じる(位置が
 *   ボタンから外れたまま残らないようにするため)。ポップオーバー内のスクロールでは閉じない。
 * - ポップオーバー内のクリックは、React上の親(行`<tr>`)の行選択へ伝えない。 */
export function EstimateResultNotePopover({ label, ariaLabel, heading, text }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const id = useId()

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    setPos(null)
    if (restoreFocus) buttonRef.current?.focus()
  }, [])

  // 実寸を測ってからボタン直下(収まらなければ上)へ配置する。
  useLayoutEffect(() => {
    if (!open) return
    const button = buttonRef.current
    const popover = popoverRef.current
    if (!button || !popover) return
    const b = button.getBoundingClientRect()
    const w = popover.offsetWidth
    const h = popover.offsetHeight
    let top = b.bottom + GAP
    if (top + h > window.innerHeight - VIEWPORT_MARGIN && b.top - GAP - h >= VIEWPORT_MARGIN) top = b.top - GAP - h
    top = Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - VIEWPORT_MARGIN - h))
    const left = Math.max(VIEWPORT_MARGIN, Math.min(b.left, window.innerWidth - VIEWPORT_MARGIN - w))
    setPos({ top, left })
  }, [open, text])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      close(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close(true)
      }
    }
    const onScroll = (e: Event) => {
      if (popoverRef.current?.contains(e.target as Node)) return
      close(false)
    }
    const onResize = () => close(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open, close])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="estimate-detail__reason-button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            id={id}
            role="dialog"
            aria-label={heading}
            className="estimate-note-popover"
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
            // portalしたReact子孫のクリックが、親の行(<tr>)の行選択へ伝わらないようにする。
            onClick={(e) => e.stopPropagation()}
          >
            <div className="estimate-note-popover__heading">{heading}</div>
            <div className="estimate-note-popover__body">{text}</div>
          </div>,
          document.body,
        )}
    </>
  )
}
