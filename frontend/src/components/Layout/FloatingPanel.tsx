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
  /** [Issue #25] 現在表示中の全floating panelの種別一覧(固定の宣言順:
   * 盤情報→積算集約→積算明細→部品台帳でフィルタ済み)。このpanel自身が
   * 表示ONになった瞬間の「何番目に表示されたか」(=右端積み重ねの段数)を
   * 決めるために使う。`App.tsx`が4つの表示ON/OFF stateから毎回導出して渡す。 */
  visibleKinds: FloatingPanelKind[]
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
// panelの「高さの伸びやすさ」の目安(コンテナ高さに対する割合)。指示25章由来の
// 既存値をそのまま踏襲する(Issue #25は位置ロジックのみが対象で、高さの決め方
// 自体は変更しない)。
const HEIGHT_FRACTION_BY_KIND: Record<FloatingPanelKind, number> = {
  panelInfo: 0.34,
  aggregation: 0.32,
  detail: 0.38,
  master: 0.34,
}
// [追加修正: floating panelの初期幅を実ブラウザ実測ベースで再調整]
// Playwrightで実データ(製番A1GV2421 P16)を使い、各表の列ごとに「隠しnowrap
// 要素へ同じfont-size/family/weightでセル文字列を複製し、実際の自然幅
// (折り返し無し)をgetBoundingClientRect()で測る」手法で、ヘッダ文言・実データの
// うち最長のセルの自然幅を列ごとに測定し、そこへcell paddingや外周
// padding・縦スクロールバー分の余白を積み上げてpanel全体の必要幅を算出した
// (詳細な実測値・計算根拠はIssue #19への報告コメント参照)。
// [Issue #25] 初期配置が全kind右端寄せの縦積みへ変わったことに伴い、以前
// あった「同じ行に並ぶ相方panelの幅を考慮して初期幅を控えめにする」ロジック
// (ROW_GAP)は不要になった(縦に積むだけで、同じ行に並ぶ2panelという概念自体が
// 無くなったため)。kind別の初期幅の値そのものは変更していない。
const DEFAULT_WIDTH_BY_KIND: Record<FloatingPanelKind, number> = {
  panelInfo: 300,
  aggregation: 480,
  detail: 770,
  master: 320,
}
const SIDE_MARGIN = 20
// DrawingCanvas自身のtoolbar(図面名+Zoom/Fit/BBox削除、Viewer上端いっぱいの1行)を
// クリアするための既定オフセット。
const TOP_CLEARANCE = 48
const BOTTOM_MARGIN = 12
// [Issue #25] 新たに表示したpanelを、既に表示中のpanel群より少し下へずらす際の
// 1段あたりのオフセット。完全に重ならず、かつ見出し(h2、ドラッグハンドルを兼ねる)
// が確実に見える程度の量として、実ブラウザ確認のうえ採用した値。
const STACK_OFFSET = 40

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

/**
 * [Issue #25] 新規表示時の既定配置を計算する。
 *
 * 配置ルール(指示1章):
 * - 基本的にViewer右端寄せ(`left`は常に`container.width - SIDE_MARGIN - width`)。
 * - その時点で表示中のfloating panelが他に無ければ右上(`stackIndex===0`)。
 * - 既に表示中のpanelがあれば、その分だけ`STACK_OFFSET`ずつ下へずらす
 *   (`stackIndex`は「自分より前に表示されている他panelの数」。呼び出し側
 *   (`FloatingPanel`本体)が`visibleKinds`から算出して渡す)。
 * - Viewer下端を超える場合は、最低でも`MIN_HEIGHT_BY_KIND`分は収まる位置まで
 *   `top`をclampする(指示: 「Viewer下端を超える場合はclamp」)。
 *
 * kind別の初期幅(`DEFAULT_WIDTH_BY_KIND`)・高さの伸び方(`HEIGHT_FRACTION_BY_KIND`)
 * 自体は既存の値を維持する(指示: 「kindごとの初期幅は維持する」)。
 */
function computeInitialRect(kind: FloatingPanelKind, container: Size, stackIndex: number): FloatingPanelRect {
  const minHeight = MIN_HEIGHT_BY_KIND[kind]
  const width = Math.max(MIN_WIDTH, Math.min(DEFAULT_WIDTH_BY_KIND[kind], container.width - SIDE_MARGIN * 2))
  const left = Math.max(0, container.width - SIDE_MARGIN - width)

  const maxTop = Math.max(TOP_CLEARANCE, container.height - BOTTOM_MARGIN - minHeight)
  const top = Math.min(TOP_CLEARANCE + Math.max(0, stackIndex) * STACK_OFFSET, maxTop)

  const desiredHeight = Math.max(minHeight, container.height * HEIGHT_FRACTION_BY_KIND[kind])
  const height = Math.min(desiredHeight, Math.max(minHeight, container.height - BOTTOM_MARGIN - top))

  return clampPosition(clampSize({ top, left, width, height }, container, kind), container)
}

/**
 * [Issue #25] Viewerサイズ変更時に、pixel座標をそのまま据え置く(＝相対位置が
 * 崩れる)のではなく、直前のコンテナサイズを基準にした「最も近い辺からの距離」を
 * 保ったまま新しいコンテナサイズへ位置を追従させる。
 *
 * 実装方針(指示2章で例示された3案のうち、「右端/左端/上端/下端への距離
 * (anchor offset)を保持する」を採用): X軸は左端距離と右端距離のうち小さい方、
 * Y軸は上端距離と下端距離のうち小さい方を「その時点でより近い辺」とみなし、
 * その辺からの距離を新しいコンテナサイズに対しても維持する。
 *
 * - 右上に置いたpanel(右端距離・上端距離とも小さい)は、コンテナが広がっても
 *   右端距離・上端距離が変わらないため、見た目上「右上のまま」になる。
 * - 幅・高さ(サイズ)自体はここでは変更しない(ユーザーが行ったdrag/resizeの
 *   結果はそのまま)。最終的な`clampPosition`/`clampSize`で、万一新しい
 *   コンテナに収まりきらない場合のみ最小限補正する。
 * - 縮小时にclampで位置が動いた場合、次に拡大したときはその「clamp後の距離」を
 *   基準に戻すため、クランプが発生しない範囲であれば拡大時に元の相対位置へ
 *   ちょうど復元される(指示: 「可能な範囲で元の位置関係へ戻す」)。
 */
function reflowForResize(
  rect: FloatingPanelRect,
  prevContainer: Size,
  nextContainer: Size,
  kind: FloatingPanelKind,
): FloatingPanelRect {
  const leftGap = rect.left
  const rightGap = prevContainer.width - (rect.left + rect.width)
  const topGap = rect.top
  const bottomGap = prevContainer.height - (rect.top + rect.height)

  const anchorRight = rightGap <= leftGap
  const anchorBottom = bottomGap <= topGap

  const left = anchorRight ? nextContainer.width - rightGap - rect.width : leftGap
  const top = anchorBottom ? nextContainer.height - bottomGap - rect.height : topGap

  return clampPosition(clampSize({ ...rect, left, top }, nextContainer, kind), nextContainer)
}

/**
 * 盤情報・積算集約・積算明細・積算コードMasterをViewer上へ重ねて表示するための
 * floating panelシェル (Issue #19 Phase 2/4で新設・拡張、追加修正でドラッグ移動・
 * リサイズに対応、さらなる追加修正で積算コードMasterも対象に追加、Issue #25で
 * 初期配置(右端寄せの積み重ね)・Viewerサイズ変更時の相対位置追従を追加)。
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
 * **初期配置(Issue #25)**: panelを表示ONにした瞬間、その時点で他に表示中の
 * floating panelが無ければViewer右上、既にあれば右端寄せを保ったまま
 * `STACK_OFFSET`ずつ下へずらして配置する(`computeInitialRect`)。この
 * 「表示ONにした瞬間の再配置」は、以前の「非表示→表示で直前の位置へ戻る」
 * という挙動を置き換えるものである(指示1章の「新たに表示したpanelは…
 * 配置する」を、表示ON操作のたびに評価する形で実装した)。表示中のdrag/resize
 * 自体・表示中のままのViewerサイズ変更時の追従(`reflowForResize`)は、
 * 従来どおりrectをそのまま保持・追従する。
 *
 * **位置・サイズの保持**: `rect`はこのcomponent自身のstateではなく`App.tsx`側で
 * 保持するcontrolled値。非表示(`visible=false`)でunmountされても値は消えない
 * (セッション内のみ、localStorage永続化はしない)。
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
export function FloatingPanel({ visible, kind, visibleKinds, containerRef, rect, onRectChange, children }: Props) {
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

  // Viewerサイズ変更時の相対位置追従(reflowForResize)の基準にする、直前に
  // 測定したコンテナサイズ。表示ONで新規配置した直後にも更新する。
  const prevContainerSizeRef = useRef<Size | null>(null)
  // 直前レンダー時点の`visible`値。falseからtrueへ変わった瞬間(表示ONにした
  // 瞬間、初回マウント時を含む)を検知するためだけに使う。
  const wasVisibleRef = useRef(false)

  // コンテナ(Viewer)のサイズ変化に追従した再配置 (指示2章: 相対位置を保って
  // 追従する)。表示中(`visible`)の間だけ動かす(非表示中のpanelはどのみち
  // 描画されないため、コンテナ変化を追う必要が無い)。
  //
  // useLayoutEffectではなくuseEffect(passive)を使う理由は既存どおり:
  // `containerRef`は親(`App.tsx`側の`.app-workspace__viewer-wrap`)が持つrefの
  // ため、Reactのcommit順序上、useLayoutEffectだと初回マウント時に
  // `containerRef.current`がまだnullのままになる(floating panelが一切
  // 描画されない不具合として顕在化した実績がある)。
  useEffect(() => {
    const container = containerRef.current
    if (!container || !visible) return

    function reflow() {
      const { width, height } = container!.getBoundingClientRect()
      const nextContainer = { width, height }
      const prevContainer = prevContainerSizeRef.current
      onRectChange((prev) => {
        if (prev == null) return prev // 初期配置は表示ON検知用のeffectが担当する
        if (prevContainer == null) return clampPosition(clampSize(prev, nextContainer, kind), nextContainer)
        return reflowForResize(prev, prevContainer, nextContainer, kind)
      })
      prevContainerSizeRef.current = nextContainer
    }

    reflow()
    const observer = new ResizeObserver(reflow)
    observer.observe(container)
    return () => observer.disconnect()
    // containerRef自体・kindが変わらない限り再計測の仕組み自体は張り直さなくてよい
    // (onRectChangeは`App.tsx`のuseStateセッターで安定した参照のため依存に含めない)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, kind, visible])

  // [Issue #25] 表示ONにした瞬間(初回マウント時を含む)、既存panel群を踏まえた
  // 右端寄せ+積み重ねの初期配置を計算し直す。`visibleKinds`(他panelの表示
  // ON/OFFで変化する)自体が変わっただけではこの効果を再実行しない
  // (`wasVisibleRef`によるガードで、自分自身が「非表示→表示」に変わった
  // 瞬間だけに限定している)。
  useEffect(() => {
    const container = containerRef.current
    const justShown = visible && !wasVisibleRef.current
    wasVisibleRef.current = visible
    if (!justShown || !container) return

    const { width, height } = container.getBoundingClientRect()
    const nextContainer = { width, height }
    // `visibleKinds`は固定の宣言順(盤情報→積算集約→積算明細→部品台帳)で
    // フィルタ済みのため、そのリスト内での自分の位置(0始まり)がそのまま
    // 積み重ねの段数になる。「自分を除いた表示中の他panelの数」を数える方式
    // だと、4panelが同時にvisible=trueへ変わる既定の初回表示時に全kindが
    // 同じ値(3)を返してしまい、4枚とも同じ位置へ重なってしまう不具合が
    // あったため、この宣言順ベースの方式を採用している(実ブラウザで発見・
    // 修正)。個別に順番どおりON/OFFする場合も、この宣言順は
    // `PanelVisibilityToggles`のボタン表示順と一致しているため、
    // 「表示した順に下へ積み重なる」という見た目と結果的に一致する。
    const stackIndex = Math.max(0, visibleKinds.indexOf(kind))
    onRectChange(computeInitialRect(kind, nextContainer, stackIndex))
    prevContainerSizeRef.current = nextContainer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, visibleKinds])

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
