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
// [追加修正: floating panelの初期幅を実ブラウザ実測ベースで再調整]
// 前回(360/360/440/300px)の値は「それぞれのカラムが見えるサイズ」という
// 指示に対して未達だった。今回はPlaywrightで実データ(製番A1GV2421 P16)を
// 使い、各表の列ごとに「隠しnowrap要素へ同じfont-size/family/weightで
// セル文字列を複製し、実際の自然幅(折り返し無し)をgetBoundingClientRect()で
// 測る」手法(既存の他panelでも使ってきた手法)で、ヘッダ文言・実データの
// うち最長のセルの自然幅を列ごとに測定し、そこへcell paddingや外周
// padding・縦スクロールバー分の余白を積み上げてpanel全体の必要幅を算出した
// (詳細な実測値・計算根拠はIssue #19への報告コメント参照)。
// - panelInfo: カード1行の主要項目(バッジ+盤名称+型式)の自然幅は約250px
//   程度で、以前の360pxには十分すぎる余裕があった。「最小限」の指示に
//   合わせて300pxへ縮小しても主要項目は1行に収まる(寸法・接続情報は
//   意図的に2行目へ折り返す設計のまま)。
// - aggregation: 5列(コード/内容/単価/数量/金額)の自然幅合計+パディング+
//   縦スクロールバー分で約456px必要だったため、360pxでは常に窮屈だった。
//   480pxへ拡大した(列幅配分も実測比率に合わせてCSS側を再配分)。
// - detail: 8列(min-width 730pxは維持、列配分もP23実データの定格実測に
//   基づく既存値を維持)全体が収まるにはpanel幅として約770px必要。ただし
//   下段で部品台帳と横に並ぶため、後述の「同じ行の相方panel幅を考慮した
//   動的な上限」で実際の初期幅はコンテナ幅に応じて変わる(1600pxでは
//   ほぼ全列、1024/1280pxでは一部を内部横スクロールに任せる。物理的な
//   幅の制約であり、指示の「パネル自体を無理に広げて解決しない」方針とも
//   整合する)。
// - master(部品台帳): 3列(コード/型式/定格)の自然幅合計+パディング+
//   縦スクロールバー分で約299px。旧300pxはほぼこの必要量ちょうどだったが
//   バッファが薄かったため320pxへ微増した(列幅配分比率も実測に合わせて
//   再配分し、定格列の不足を解消)。
const DEFAULT_WIDTH_BY_KIND: Record<FloatingPanelKind, number> = {
  panelInfo: 300,
  aggregation: 480,
  detail: 770,
  master: 320,
}
const SIDE_MARGIN = 20
// 同じ行に並ぶ2panel(盤情報+積算集約、部品台帳+積算明細)が初期表示で
// 重ならないよう最低限確保する隙間。
const ROW_GAP = 12
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

/** kind単体の既定幅(相方panelを考慮しない、コンテナ幅によるクランプのみ)。 */
function baseWidthFor(kind: FloatingPanelKind, container: Size): number {
  return Math.max(MIN_WIDTH, Math.min(DEFAULT_WIDTH_BY_KIND[kind], container.width - SIDE_MARGIN * 2))
}

/** 初期配置(既定位置)を計算する。盤情報=左上寄り、積算集約=右上寄り、
 * 積算明細=右下寄り(Issue #19 Phase 2/4から踏襲)。積算コードMaster([追加修正]
 * floating化)は左下寄りとし、4panelが対角に分散する既定レイアウトにする。 */
function defaultRectFor(kind: FloatingPanelKind, container: Size): FloatingPanelRect {
  const minHeight = MIN_HEIGHT_BY_KIND[kind]
  let width = baseWidthFor(kind, container)
  // [追加修正: floating panelの初期幅を実ブラウザ実測ベースで再調整]
  // 積算集約(右上)は盤情報(左上)と、積算明細(右下)は部品台帳(左下)と
  // それぞれ同じ行に並ぶ。両者の既定幅をそのまま合計するとコンテナ幅が
  // 狭い(1024px等)場合に重なってしまうため、「左側panel(盤情報/部品台帳)は
  // 自身の既定幅を優先確保し、右側panel(積算集約/積算明細)はコンテナの
  // 残り幅に収まる範囲まで初期幅を控えめにする」形で、重なりを避けつつ
  // 可能な限り実測に基づく幅に近づける(指示: 初期幅変更で4panel同時表示時に
  // 不自然な重なりが増えないよう、必要なら初期位置も最小限調整する)。
  if (kind === 'aggregation') {
    const partnerWidth = baseWidthFor('panelInfo', container)
    width = Math.min(width, Math.max(MIN_WIDTH, container.width - SIDE_MARGIN * 2 - partnerWidth - ROW_GAP))
  }
  if (kind === 'detail') {
    const partnerWidth = baseWidthFor('master', container)
    width = Math.min(width, Math.max(MIN_WIDTH, container.width - SIDE_MARGIN * 2 - partnerWidth - ROW_GAP))
  }
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
