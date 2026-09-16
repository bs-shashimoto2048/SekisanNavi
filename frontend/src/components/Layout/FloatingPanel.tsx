import { useEffect, useRef, useState, type ReactNode } from 'react'
import './FloatingPanel.css'

export type FloatingPanelKind = 'panelInfo' | 'aggregation' | 'detail' | 'master'

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
// [追加修正: 積算コードMasterのfloating化 / 最小高さのさらなる縮小]
// 従来は全kind共通の単一MIN_HEIGHT(180px)だったが、各panelの実際の構成
// (見出し+最低限の操作UI+1〜2行程度が成立するライン)は種別ごとに異なるため、
// kind別のmin-heightへ変更した。いずれも「タイトル+最低限の操作+1〜2行の
// データ」が入りきる範囲で、実ブラウザ確認のうえ調整した値。
// - panelInfo: 見出し+カード1枚分。操作UIが無く最も軽いため最小。
// - aggregation: 見出し+確定操作+製番合計/対象select+表1行分。4panel中もっとも
//   上部の固定UIが多いため、4種の中では最大の下限を確保する。
// - detail: 見出し+情報源タブ+表1行分。
// - master: 見出し+検索欄+カテゴリタブ+表1行分。
const MIN_HEIGHT_BY_KIND: Record<FloatingPanelKind, number> = {
  panelInfo: 120,
  aggregation: 160,
  detail: 150,
  master: 150,
}
// [追加修正: 各floating panelの初期幅を内容に合わせて調整]
// 全kind共通の360pxを既定としていたが、panelごとに「通常必要なカラムが
// 無理なく見える幅」は異なるため、実ブラウザ確認のうえkind別の値へ変更した
// (あくまで既定値。ユーザーは自由にリサイズでき、4panelを同じ幅へ揃える
// 必要は無い)。
// - panelInfo: カード1枚が2行程度で収まり、360pxで既に折り返しが自然。
// - aggregation: 5列の表(コード/内容/単価/数量/金額)が360pxで無理なく
//   収まる(内容列を最優先で広く取る配分のため)。上部の確定操作・製番合計・
//   対象selectも360pxで1行にまとまる。
// - detail: 8列の表(min-width 730px)は360pxだと4列目(型式)の途中までしか
//   見えず、以前は横スクロールが常時必要だった。図面Viewerを過度に圧迫しない
//   範囲で440pxへ拡大し、より多くの列が見えるようにした(730pxへは広げない。
//   残りは既存の内部横スクロールに任せる)。
// - master(部品台帳): 追加修正でコード/型式/定格の3列のみになり、検索欄も
//   廃止したため、旧来の480pxは明らかに広すぎた(実測で全列に大きな余白)。
//   3列が無理なく見える最小限として300pxへ大幅に縮小した(指示4章
//   「旧Master表より明確にコンパクトな初期幅を狙う」)。
// 既定位置は積算明細・部品台帳とも下段(bottom基準)で左右に分かれるため、
// 1024px幅でも両者の合計幅+左右マージンがViewerコンテナ幅に収まるよう
// (実測: 1024px幅で798px)、detail 440px+master 300pxで検証している
// (740px、798pxに対して十分な余白がある。実ブラウザ確認済み)。
const DEFAULT_WIDTH_BY_KIND: Record<FloatingPanelKind, number> = {
  panelInfo: 360,
  aggregation: 360,
  detail: 440,
  master: 300,
}
const SIDE_MARGIN = 20
// DrawingCanvas自身のtoolbar(図面名+Zoom/Fit/BBox削除、Viewer上端いっぱいの1行)を
// クリアするための既定オフセット。
const TOP_CLEARANCE = 48
const BOTTOM_MARGIN = 12

// 4つのfloating panelインスタンス間で共有する、単調増加のz-indexカウンタ
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

function clampSize(rect: FloatingPanelRect, container: Size, kind: FloatingPanelKind): FloatingPanelRect {
  const minHeight = MIN_HEIGHT_BY_KIND[kind]
  const maxWidth = Math.max(MIN_WIDTH, container.width - rect.left)
  const maxHeight = Math.max(minHeight, container.height - rect.top)
  return {
    ...rect,
    width: Math.min(Math.max(MIN_WIDTH, rect.width), maxWidth),
    height: Math.min(Math.max(minHeight, rect.height), maxHeight),
  }
}

/** 初期配置(既定位置)を計算する。盤情報=左上寄り、積算集約=右上寄り、
 * 積算明細=右下寄り(Issue #19 Phase 2/4から踏襲)。積算コードMaster([追加修正]
 * floating化)は左下寄りとし、4panelが対角に分散する既定レイアウトにする。 */
function defaultRectFor(kind: FloatingPanelKind, container: Size): FloatingPanelRect {
  const minHeight = MIN_HEIGHT_BY_KIND[kind]
  const width = Math.max(MIN_WIDTH, Math.min(DEFAULT_WIDTH_BY_KIND[kind], container.width - SIDE_MARGIN * 2))
  const availableHeight = Math.max(minHeight, container.height - TOP_CLEARANCE - BOTTOM_MARGIN)

  if (kind === 'panelInfo') {
    const height = Math.min(availableHeight, Math.max(minHeight, container.height * 0.34))
    return clampPosition({ top: TOP_CLEARANCE, left: SIDE_MARGIN, width, height }, container)
  }
  if (kind === 'aggregation') {
    const height = Math.min(availableHeight, Math.max(minHeight, container.height * 0.32))
    return clampPosition({ top: TOP_CLEARANCE, left: container.width - SIDE_MARGIN - width, width, height }, container)
  }
  if (kind === 'master') {
    const height = Math.min(availableHeight, Math.max(minHeight, container.height * 0.34))
    return clampPosition(
      { top: container.height - BOTTOM_MARGIN - height, left: SIDE_MARGIN, width, height },
      container,
    )
  }
  const height = Math.min(availableHeight, Math.max(minHeight, container.height * 0.38))
  return clampPosition(
    { top: container.height - BOTTOM_MARGIN - height, left: container.width - SIDE_MARGIN - width, width, height },
    container,
  )
}

/**
 * 盤情報・積算集約・積算明細・積算コードMasterをViewer上へ重ねて表示するための
 * floating panelシェル (Issue #19 Phase 2/4で新設・拡張、追加修正でドラッグ移動・
 * リサイズに対応、さらなる追加修正で積算コードMasterも対象に追加)。
 *
 * `PanelInfo`/`EstimateAggregation`/`EstimateDetail`/`EstimateMasterPicker`自体は
 * 一切変更していない(前3コンポーネント自身の折りたたみ機能はPhase 4追加修正で
 * 廃止済み。表示/非表示は`PanelVisibilityToggles`のみで行う)。
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
 *
 * **前面化(z-index)**: 以下いずれの操作でも、このpanelを他panelより確実に
 * 前面へ出す(モジュール共有の単調増加カウンタ`zCounter`を使う、[追加修正]で
 * 4パターンへ拡張)。
 * - panel本体のどこかをpointerdown(`onPointerDownCapture`、キャプチャフェーズの
 *   ため子要素のstopPropagationに関わらず必ず発火する。本体クリック・ドラッグ
 *   開始・リサイズ開始のいずれもこれ1つでカバーできる)
 * - 表示トグルをONにした瞬間(`visible`がtrueへ変わったことを検知するuseEffect。
 *   このcomponentインスタンス自体は`visible=false`の間も内部で`return null`
 *   しているだけでunmountはされないため、明示的な検知が必要)
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
          : clampPosition(clampSize(prev, { width, height }, kind), { width, height }),
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

  // [追加修正: 表示ONにしたfloating panelを必ず最前面へ]
  // 本体クリック・ドラッグ開始・リサイズ開始は`onPointerDownCapture={bringToFront}`
  // (下記JSX、キャプチャフェーズのため子要素へのバブリング経路に関わらず必ず発火する)
  // で既にカバーしている。唯一カバーできていなかったのが「表示トグルをONにした
  // 瞬間」で、このcomponentインスタンス自体はApp.tsx側で常時マウントされたまま
  // (`visible`がfalseの間は内部で`return null`しているだけで、unmount/remountは
  // 発生しない)ため、`visible`が真に変わったタイミングを検知して明示的に
  // 前面化する必要がある。
  useEffect(() => {
    if (visible) bringToFront()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

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
      startHeight: rect?.height ?? MIN_HEIGHT_BY_KIND[kind],
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
        : clampSize(
            { ...prev, width: resize.startWidth + dx, height: resize.startHeight + dy },
            { width, height },
            kind,
          ),
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
