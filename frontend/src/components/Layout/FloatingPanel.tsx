import { useEffect, useRef, useState, type ReactNode } from 'react'
import './FloatingPanel.css'

export type FloatingPanelKind = 'panelInfo' | 'aggregation' | 'detail'

/** floating panelの位置・大きさ (px、`containerRef`の要素基準)。 */
export interface FloatingPanelRect {
  top: number
  left: number
  width: number
  height: number
}

interface Size {
  width: number
  height: number
}

interface Props {
  /** 表示中かどうか (Viewer操作のヒットテスト対象から外すため、非表示中は
   * DOMへ描画しない)。 */
  visible: boolean
  /** 既定配置・drag/resize後の最小サイズを決めるための種別。 */
  kind: FloatingPanelKind
  /** 位置・大きさのクランプ基準にするコンテナ要素(`app-workspace__viewer-wrap`)。 */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 現在の位置・大きさ (Issue #19 追加修正: 移動/リサイズ後もセッション中は
   * 保持する必要があるため、`App.tsx`側のstateとして持ち上げてcontrolledにする。
   * `visible`がfalseになりこのcomponentがunmountされても値は消えない)。
   * `null`は「まだ初期配置が計算されていない」ことを表す。 */
  rect: FloatingPanelRect | null
  onRectChange: (update: FloatingPanelRect | ((prev: FloatingPanelRect | null) => FloatingPanelRect | null)) => void
  children: ReactNode
}

const MIN_WIDTH = 260
const MIN_HEIGHT = 180
const DEFAULT_WIDTH = 360
const SIDE_MARGIN = 20
// DrawingCanvas自身のtoolbar(図面名+Zoom/Fit/BBox削除、Viewer上端いっぱいの1行)を
// クリアするための既定オフセット。
const TOP_CLEARANCE = 48
const BOTTOM_MARGIN = 12

// 3つのfloating panelインスタンス間で共有する、単調増加のz-indexカウンタ
// (Issue #19 追加修正: 操作したパネルが前面へ来る)。永続化不要のセッション内
// UI状態のため、React stateではなくモジュールスコープの変数で十分
// (`App.tsx`の`editSequenceRef`と同じ考え方)。
let zCounter = 100

function clampPosition(rect: FloatingPanelRect, container: Size): FloatingPanelRect {
  const maxLeft = Math.max(0, container.width - rect.width)
  const maxTop = Math.max(0, container.height - rect.height)
  return {
    ...rect,
    left: Math.min(Math.max(0, rect.left), maxLeft),
    top: Math.min(Math.max(0, rect.top), maxTop),
  }
}

function clampSize(rect: FloatingPanelRect, container: Size): FloatingPanelRect {
  const maxWidth = Math.max(MIN_WIDTH, container.width - rect.left)
  const maxHeight = Math.max(MIN_HEIGHT, container.height - rect.top)
  return {
    ...rect,
    width: Math.min(Math.max(MIN_WIDTH, rect.width), maxWidth),
    height: Math.min(Math.max(MIN_HEIGHT, rect.height), maxHeight),
  }
}

/** 初期配置(既定位置)を計算する。盤情報=左上寄り、積算集約=右上寄り、
 * 積算明細=右下寄り(Issue #19 Phase 2/4から踏襲)。 */
function defaultRectFor(kind: FloatingPanelKind, container: Size): FloatingPanelRect {
  const width = Math.max(MIN_WIDTH, Math.min(DEFAULT_WIDTH, container.width - SIDE_MARGIN * 2))
  const availableHeight = Math.max(MIN_HEIGHT, container.height - TOP_CLEARANCE - BOTTOM_MARGIN)

  if (kind === 'panelInfo') {
    const height = Math.min(availableHeight, Math.max(MIN_HEIGHT, container.height * 0.34))
    return clampPosition({ top: TOP_CLEARANCE, left: SIDE_MARGIN, width, height }, container)
  }
  if (kind === 'aggregation') {
    const height = Math.min(availableHeight, Math.max(MIN_HEIGHT, container.height * 0.32))
    return clampPosition({ top: TOP_CLEARANCE, left: container.width - SIDE_MARGIN - width, width, height }, container)
  }
  const height = Math.min(availableHeight, Math.max(MIN_HEIGHT, container.height * 0.38))
  return clampPosition(
    { top: container.height - BOTTOM_MARGIN - height, left: container.width - SIDE_MARGIN - width, width, height },
    container,
  )
}

/**
 * 盤情報・積算集約・積算明細をViewer上へ重ねて表示するためのfloating panel
 * シェル (Issue #19 Phase 2/4で新設・拡張、追加修正でドラッグ移動・リサイズに対応)。
 *
 * `PanelInfo`/`EstimateAggregation`/`EstimateDetail`自体は一切変更していない
 * (これら3コンポーネント自身の折りたたみ機能はPhase 4追加修正で廃止済み。
 * 表示/非表示は`PanelVisibilityToggles`のみで行う)。
 *
 * **ドラッグ移動**: 各componentが自分自身で描画する見出し(`<h2>`)領域を
 * ドラッグハンドルとして使う。`FloatingPanel`はchildrenの内部構造を知らないため、
 * pointerdownのevent delegationで`e.target.closest('h2')`を見て「見出しが
 * 押されたか」だけを判定する(表・Select・button等は`<h2>`の外側にあるため、
 * 誤ってドラッグが始まることはない)。
 *
 * **リサイズ**: 右下角の専用ハンドル(`.floating-panel__resize-handle`)のみで
 * 対応する(複数辺からのリサイズは今回対象外)。
 *
 * **位置・サイズの保持**: `rect`はこのcomponent自身のstateではなく`App.tsx`側で
 * 保持するcontrolled値。非表示(`visible=false`)でunmountされても値は消えず、
 * 再表示時に直前の位置・サイズへ戻る(セッション内のみ、localStorage永続化はしない)。
 */
export function FloatingPanel({ visible, kind, containerRef, rect, onRectChange, children }: Props) {
  const [zIndex, setZIndex] = useState(100)
  const [interacting, setInteracting] = useState(false)
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

  // 初期配置の計算 + コンテナ(Viewer)のサイズ変化に追従した再クランプ
  // (指示: 画面サイズ変更時も、少なくとも見出しが操作可能な範囲に残るよう補正する)。
  //
  // useLayoutEffectではなくuseEffect(passive)を使う: `containerRef`はこの
  // componentの「親」(App.tsx側の`.app-workspace__viewer-wrap`)が持つrefのため、
  // Reactのcommit順序(子のlayout effectは親自身のref付与より先に走る)により、
  // useLayoutEffectだと初回マウント時に`containerRef.current`がまだnullのままになる
  // (実際にfloating panelが一切描画されない不具合として顕在化した)。useEffectは
  // ツリー全体のref付与・layout effectが完了した後にまとめて発火するため、
  // ここでは`containerRef.current`が確実に取得できる。
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    function reclamp() {
      const { width, height } = container!.getBoundingClientRect()
      onRectChange((prev) =>
        prev == null
          ? defaultRectFor(kind, { width, height })
          : clampPosition(clampSize(prev, { width, height }), { width, height }),
      )
    }

    reclamp()
    const observer = new ResizeObserver(reclamp)
    observer.observe(container)
    return () => observer.disconnect()
    // containerRef自体・kindが変わらない限り再計測の仕組み自体は張り直さなくてよい
    // (onRectChangeは`App.tsx`のuseStateセッターで安定した参照のため依存に含めない)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, kind])

  function bringToFront() {
    zCounter += 1
    setZIndex(zCounter)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const heading = (e.target as HTMLElement).closest('h2')
    if (!heading) return
    e.preventDefault() // ドラッグ中にテキスト選択が始まらないようにする
    // jsdom(テスト環境)はsetPointerCaptureを実装していないため、存在確認してから呼ぶ
    // (実ブラウザ(Chrome/Edge/Firefox)ではいずれも実装済みで、通常通り動作する)。
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setInteracting(true)
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTop: rect?.top ?? 0,
      startLeft: rect?.left ?? 0,
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const container = containerRef.current
    if (!container) return
    const { width, height } = container.getBoundingClientRect()
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    onRectChange((prev) =>
      prev == null ? prev : clampPosition({ ...prev, top: drag.startTop + dy, left: drag.startLeft + dx }, { width, height }),
    )
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== e.pointerId) return
    dragRef.current = null
    setInteracting(false)
  }

  function handleResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.stopPropagation() // 親(floating-panel本体)のドラッグ判定へ伝播させない
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setInteracting(true)
    resizeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: rect?.width ?? MIN_WIDTH,
      startHeight: rect?.height ?? MIN_HEIGHT,
    }
  }

  function handleResizePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current
    if (!resize || resize.pointerId !== e.pointerId) return
    e.stopPropagation()
    const container = containerRef.current
    if (!container) return
    const { width, height } = container.getBoundingClientRect()
    const dx = e.clientX - resize.startX
    const dy = e.clientY - resize.startY
    onRectChange((prev) =>
      prev == null
        ? prev
        : clampSize({ ...prev, width: resize.startWidth + dx, height: resize.startHeight + dy }, { width, height }),
    )
  }

  function endResize(e: React.PointerEvent<HTMLDivElement>) {
    if (resizeRef.current?.pointerId !== e.pointerId) return
    resizeRef.current = null
    setInteracting(false)
    e.stopPropagation()
  }

  if (!visible || rect == null) return null

  return (
    <div
      className={
        'floating-panel' +
        ` floating-panel--${kind}` +
        (interacting ? ' floating-panel--interacting' : '')
      }
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height, zIndex }}
      onPointerDownCapture={bringToFront}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="floating-panel__body">{children}</div>
      <div
        className="floating-panel__resize-handle"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        aria-hidden="true"
      />
    </div>
  )
}
