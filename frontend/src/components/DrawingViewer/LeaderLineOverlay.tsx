import { useEffect, useRef, useState } from 'react'
import type { Detection, EstimateMasterItem } from '../../types/domain'
import type { NormalizedRect, Point } from '../../utils/bbox'
import { clamp01, computeInitialLabelPosition, topRightCorner } from '../../utils/bbox'
import { getCategoryPresentation, toCssVars } from '../../domain/masterCategoryPresentation'
import type { PreviewBBox } from './DetectionOverlay'

// クリック(選択)とラベル帯dragの誤認防止 (DetectionOverlay/DrawingCanvasと同じ考え方)。
const MIN_DRAG_PX = 6

// [第3ラウンド追加修正 7章〜14章] ラベル帯(水平線+文字)の幅は、実際の描画幅
// (`CanvasRenderingContext2D.measureText`) を基準に計算する。文字数だけに基づく
// 概算(旧実装)では、実際の文字幅と水平線の長さが一致せず「水平線が長すぎる」
// 見た目になっていたため、実測ベースへ切り替える。
// 以下はコンテナ幅(px)が0(=`overlayRef`がまだDOMへ未マウント。初回レンダー1回のみ
// 起こりうる)の場合、または`document`/canvasが使えない環境の場合にのみ使う
// フォールバック値であり、通常の実行経路では使われない。
const CHAR_WIDTH_FRACTION = 0.0075 // フォールバック1: コンテナ幅px自体が未確定な場合の概算(正規化割合を直接返す)
const AVERAGE_CHAR_WIDTH_PX_FALLBACK = 8 // フォールバック2: canvas 2d contextが使えない場合の1文字あたりのpx概算
const MIN_LABEL_WIDTH_FRACTION = 0.01 // 空文字列等の異常系で線が完全に潰れないための下限

// ラベルの実フォント (`.leader-line-overlay__label`のCSSと必ず一致させること。
// 追加修正3章〜5章: 現状より約15〜25%大きいサイズへ。フォントファミリ自体は
// Phase 1.10のUIフォント方針(`index.css`の`:root`)をそのまま流用し、引出線だけ
// 別フォントにはしない)。
const LABEL_FONT_WEIGHT = 600
// 全体フォント拡大・BBox編集追従回帰修正 指示1章: ルートfont-sizeを14px→15pxへ
// 引き上げたことに伴い、`.leader-line-overlay__label`(font-size: 1rem)の実際の
// 描画サイズも14px→15pxになった。ここが実CSSとずれると、水平線の長さ計算
// (measureLabelWidthPx)が実際の文字幅と一致しなくなる(指示書の調査対象「LeaderLine
// Overlayのラベル座標計算」に該当する不整合の一つ)ため、必ず一致させる。
const LABEL_FONT_SIZE_PX = 15
const LABEL_FONT_FAMILY =
  `'Yu Gothic UI', 'Meiryo UI', 'Meiryo', 'Segoe UI', system-ui, 'Hiragino Sans', 'Yu Gothic', sans-serif`

// 水平線の左右余白 (指示書12章: 4〜8px程度の候補から中間値を採用)。
const HORIZONTAL_LINE_PADDING_PX = 6

// テキスト幅計測用のcanvas 2d contextを遅延生成してキャッシュする
// (`document.createElement('canvas')`のコストを毎レンダー払わないため)。
// jsdom環境(単体テスト)は`canvas`パッケージが無い場合`getContext('2d')`が
// `null`を返すため、その場合は`AVERAGE_CHAR_WIDTH_PX_FALLBACK`ベースの
// 概算へフォールバックする (実ブラウザでは常に実測値が使われる)。
let cachedMeasureCtx: CanvasRenderingContext2D | null | undefined
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (cachedMeasureCtx !== undefined) return cachedMeasureCtx
  if (typeof document === 'undefined') {
    cachedMeasureCtx = null
    return cachedMeasureCtx
  }
  cachedMeasureCtx = document.createElement('canvas').getContext('2d')
  return cachedMeasureCtx
}

/** ラベル文字列の実描画幅(px)を計測する。`.leader-line-overlay__label`のCSSと
 * 同じfont-weight/size/familyを指定することで、実際に画面へ描画される幅と一致させる。 */
function measureLabelWidthPx(text: string): number {
  const ctx = getMeasureCtx()
  if (!ctx) return text.length * AVERAGE_CHAR_WIDTH_PX_FALLBACK
  ctx.font = `${LABEL_FONT_WEIGHT} ${LABEL_FONT_SIZE_PX}px ${LABEL_FONT_FAMILY}`
  return ctx.measureText(text).width
}

interface Props {
  detections: Detection[]
  selectedDetectionId: number | null
  hoveredDetectionId: number | null
  onHoverDetection: (detectionId: number | null) => void
  onSelectDetection: (detectionId: number) => void
  /** 引出線ラベル帯をドラッグして移動した時、mouseup時に一度だけ呼ばれる
   * (Phase 1.11 指示書10章/12章)。 */
  onMoveLabel: (detectionId: number, x: number, y: number) => void
  /** ドラッグ中(未確定)のBBoxプレビュー。DrawingViewer.tsxが保持するstateを
   * DetectionOverlayと共有で受け取る (Phase 1.11 追加修正11章〜17章)。
   * 引出線の「アンカー(BBox右上角)」はこの値をmouseupを待たずリアルタイムに
   * 反映する。ラベル自体の位置(`resolveLabel`)も、全体フォント拡大・BBox編集
   * 追従回帰修正 指示3章により、このアンカーの移動量ぶんだけ保存済み位置を
   * リアルタイムにずらして追従させる(「BBoxだけ動いてラベルは元の場所に残る」
   * という回帰の修正)。確定(mouseup)後はApp.tsx側が`leader_label_x/y`自体を
   * 同じ移動量で更新して保存するため、ここでの見た目とズレない。 */
  previewBBox?: PreviewBBox | null
  /** 積算コードMaster全件のid引きMap (次work指示1章)。省略時(未指定/単体テスト等)は
   * 定格が常に「-」表示になるだけで、コード/分類/型式の表示・既存の引出線描画自体は
   * 影響を受けない。 */
  masterItemById?: Map<number, EstimateMasterItem>
}

function bboxOf(detection: Detection): NormalizedRect {
  return { x: detection.bbox_x, y: detection.bbox_y, w: detection.bbox_w, h: detection.bbox_h }
}

/**
 * 引出線ラベルの文字列「コード 型式」を組み立てる (指示書11章/14章)。
 *
 * 可能な限りBackendが`master_item_id`から都度JOINして返す
 * `master_item_code`/`master_item_model` (Master Itemの現在の正式な値) を使い、
 * `class_name`(Manual BBox登録時点でコピーされた値。将来Master Item側のcodeが
 * 変わっても追従しない)への依存を減らす (追加修正12章/14章)。
 * `master_item_code`が取得できない異常系のみ`class_name`へフォールバックする。
 * 型式(`master_item_model`)がnull/空文字の場合はコード単独表示にする (指示書13章)。
 */
function buildLabelText(detection: Detection): string {
  const code = detection.master_item_code ?? detection.class_name
  const model = detection.master_item_model?.trim()
  return model ? `${code} ${model}` : code
}

// Hover Tooltipで値が無い項目に出す代替表示 (PanelInfo.tsx等、他コンポーネントと
// 同じ"-"表記に揃える。null/undefined/空文字を出し分けず一律この値にする)。
const MISSING_VALUE_PLACEHOLDER = '-'

/** Hover Tooltipの1行 (ラベル:値)。次work指示1章。 */
interface DetectionInfoRow {
  label: string
  value: string
}

/** Detectionのmaster_item_idから、Master全件Map経由で定格(rating)を引く。
 * Detection自体にはBackend側で code/model/category のみJOIN済みで rating は
 * 含まれないため (`app/repositories/detections.py`参照)、Frontend側で
 * 既存の`/api/master-items`全件取得結果と突き合わせる。Backend API仕様は
 * 変更しない方針 (次work指示7章) のための対応。 */
function resolveRating(
  detection: Detection,
  masterItemById: Map<number, EstimateMasterItem>,
): string | null {
  if (detection.master_item_id == null) return null
  return masterItemById.get(detection.master_item_id)?.rating ?? null
}

/**
 * 積算コードHover Tooltip用の詳細行を組み立てる (次work指示1章: コード/型式/定格を
 * 最低限表示)。
 *
 * 実データ調査の結果、積算コードMaster(estimate_master_items)には「品名」に
 * 相当する独立列が存在しない(code/category/model/rating/noteのみ)。category
 * (分類)を「品名」と読み替えて表示することはせず、正直に「分類」ラベルで表示する
 * (指示: 実データを捏造しない)。model列は種別により型式番号(例:"OS2- 816")だったり、
 * 附属品では品名的テキスト(例:"換気扇")だったりするが、値はそのまま表示するだけで
 * 変換・言い換えはしない。
 *
 * 将来Backend側に正式な「品名」列が追加された場合は、この配列へ
 * `{ label: '品名', value: ... }` の行を1つ足すだけで対応できる構造にしている。
 */
function buildDetectionInfoRows(
  detection: Detection,
  masterItemById: Map<number, EstimateMasterItem>,
): DetectionInfoRow[] {
  const rating = resolveRating(detection, masterItemById)
  return [
    { label: 'コード', value: detection.master_item_code ?? detection.class_name },
    { label: '分類', value: detection.master_item_category ?? MISSING_VALUE_PLACEHOLDER },
    { label: '型式', value: detection.master_item_model?.trim() || MISSING_VALUE_PLACEHOLDER },
    { label: '定格', value: rating?.trim() || MISSING_VALUE_PLACEHOLDER },
  ]
}

// Hover Tooltipのサイズ見積もり (概算)。ProductPanelOverlay/DetectedPreviewOverlayと
// 同じ考え方のクランプ計算に使う。4行表示のため、他2つのTooltipより少し高さの
// 見積もりを大きくしている。
const TOOLTIP_WIDTH_ESTIMATE = 260
const TOOLTIP_HEIGHT_ESTIMATE = 160
const TOOLTIP_OFFSET = 14

function clampDetectionTooltipPosition(clientX: number, clientY: number): { left: number; top: number } {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800
  const maxLeft = Math.max(8, viewportWidth - TOOLTIP_WIDTH_ESTIMATE - 8)
  const maxTop = Math.max(8, viewportHeight - TOOLTIP_HEIGHT_ESTIMATE - 8)
  return {
    left: Math.min(clientX + TOOLTIP_OFFSET, maxLeft),
    top: Math.min(clientY + TOOLTIP_OFFSET, maxTop),
  }
}

/** フォールバック専用: コンテナ幅(px)自体がまだ取得できない場合
 * (`overlayRef`未マウントの初回レンダー等)にのみ使う、文字数ベースの概算
 * (正規化割合を直接返す。旧実装の計算式そのもの)。 */
function estimateLabelWidthFraction(text: string): number {
  return Math.max(MIN_LABEL_WIDTH_FRACTION, text.length * CHAR_WIDTH_FRACTION)
}

/**
 * ラベル帯(水平線)の幅を正規化割合で計算する (追加修正 第3ラウンド 7章〜14章)。
 *
 * `containerWidthPx`(`.leader-line-overlay`要素の現在の実表示px幅。zoom/pane
 * リサイズ/Viewer Fitに応じて都度変わる) を基準に、実測した文字幅(px)を
 * 正規化割合へ変換する。「px→normalized」の変換に同じ基準(現在のコンテナ幅)を
 * 使うため、zoomが変わっても実際の文字幅と水平線の長さの対応関係は崩れない
 * (文字自体はCSS上固定pxサイズのため、zoomで見た目上のコンテナpx幅が変わっても
 * 「文字幅px ÷ コンテナ幅px」の比は正しく変化し、結果として画面上の水平線の
 * 長さは常に実際の文字幅pxと一致する。指示書14章)。
 */
function computeLabelWidthFraction(text: string, containerWidthPx: number): number {
  if (containerWidthPx <= 0) return estimateLabelWidthFraction(text)
  const widthPx = measureLabelWidthPx(text) + HORIZONTAL_LINE_PADDING_PX
  return Math.max(MIN_LABEL_WIDTH_FRACTION, widthPx / containerWidthPx)
}

interface LeaderGeometry {
  anchor: Point
  elbow: Point
  end: Point
}

/**
 * 引出線のジオメトリ(アンカー・折れ点・水平線のもう一方の端)を計算する
 * (Phase 1.11 追加修正6章〜9章)。
 *
 * 折れ点(elbow)と水平線の端(end)は、ラベルがアンカーの右側にあるか左側にあるかで
 * 入れ替える (追加修正16章: `labelX >= anchorX` と `labelX < anchorX` の両方で
 * 線が破綻しないようにする)。
 *   - ラベルが右側 (labelX >= anchorX): 折れ点=ラベル帯の左端、水平線はそこから
 *     右(文字の下)へ伸びる。
 *   - ラベルが左側 (labelX < anchorX): 折れ点=ラベル帯の右端、水平線は左端から
 *     そこへ伸びる。
 * どちらの場合も、斜線は必ず折れ点からアンカーへ直接つながり、水平線と斜線の間に
 * 隙間ができない (1本の折れ線として`M end L elbow L anchor`で描画する。9章)。
 *
 * `widthFraction`(水平線の正規化幅)は呼び出し側(`computeLabelWidthFraction`)が
 * 実測した文字幅を基に計算済みの値を渡す (追加修正 第3ラウンド11章: このコンポーネント
 * 単体では文字列そのものではなく、計算済みの幅のみを受け取ることで、
 * ジオメトリの折れ線計算(責務A)と文字幅の実測(責務B)を分離している)。
 */
function computeLeaderGeometry(anchor: Point, label: Point, widthFraction: number): LeaderGeometry {
  if (label.x >= anchor.x) {
    return {
      anchor,
      elbow: { x: label.x, y: label.y },
      end: { x: label.x + widthFraction, y: label.y },
    }
  }
  return {
    anchor,
    elbow: { x: label.x + widthFraction, y: label.y },
    end: { x: label.x, y: label.y },
  }
}

function pathD(geometry: LeaderGeometry): string {
  // end → elbow → anchor の順で描く。marker-endをanchor側に置くことで、
  // SVGが経路の進行方向(elbow→anchor)から矢印の向きを自動計算し、
  // 矢印の先端が常にBBox右上角(anchor)を指すようにする (追加修正7章/8章)。
  return `M ${geometry.end.x} ${geometry.end.y} L ${geometry.elbow.x} ${geometry.elbow.y} L ${geometry.anchor.x} ${geometry.anchor.y}`
}

/**
 * 積算Master Itemに紐づくManual BBoxの「引出線」表示 (Phase 1.11、追加修正で
 * 形状・表示文字を修正)。
 *
 * BBox(対象範囲を保持する内部・編集情報)とは表示上分離し、通常時はこちらの
 * 引出線のみを表示する (指示書5章〜7章)。構成要素:
 *   1. BBox右上角のアンカー (`utils/bbox.ts::topRightCorner`。BBoxをmove/resizeすると
 *      自動追従する。指示書11章)
 *   2. アンカー→折れ点→水平線端 を1本の連続したpolyline (`<path>`) として描画
 *      (追加修正9章: 斜線と水平線を別要素にせず隙間を作らない)。矢印head
 *      (SVG `marker`) をアンカー側に置き、必ずBBox右上角を指す (追加修正7章/8章)。
 *   3. 水平線 (上記polylineの一部。ラベルの下線として機能する)
 *   4. 「コード 型式」の文字列 (指示書14章。price/ratingは表示しない)
 *
 * ラベル帯の位置(`leader_label_x/y`)はBBox本体の座標とは独立して保持し
 * (指示書10章)、Detectionへ保存済みの値が無ければ`computeInitialLabelPosition`で
 * 都度算出する (指示書13章)。帯・線いずれかへのhoverで対応BBoxを表示可能にする
 * (`onHoverDetection`。実際の表示可否の判定はDetectionOverlay側が
 * `hoveredDetectionId`を見て行う)。
 *
 * 色は`master_item_category`から`masterCategoryPresentation.ts`経由で解決し、
 * CSSカスタムプロパティ/SVG属性として注入する (要件2/30: HEX値をCSSへ書かない)。
 *
 * 見た目の線幅(細)とは別に、hover/dragの対象を広く取るためSVG側で透明な
 * 太いヒットエリアを重ねている (指示書15章/18章。斜線・水平線の全体に沿わせる)。
 */
// masterItemById省略時の既定値。毎レンダー新規Mapを作らないよう、モジュール
// スコープに固定のインスタンスを1つだけ持つ (propsのデフォルト値としてのみ使う。
// 書き換えは行わない)。
const EMPTY_MASTER_ITEM_MAP: Map<number, EstimateMasterItem> = new Map()

export function LeaderLineOverlay({
  detections,
  selectedDetectionId,
  hoveredDetectionId,
  onHoverDetection,
  onSelectDetection,
  onMoveLabel,
  previewBBox = null,
  masterItemById = EMPTY_MASTER_ITEM_MAP,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  // 積算コードHover Tooltip用のローカル状態 (次work指示1章)。onHoverDetection自体は
  // 従来通りDrawingViewer.tsx側(通常非表示のBBoxを一時表示するため)へ伝播させつつ、
  // Tooltipの表示位置(マウス座標)はこのコンポーネント内だけで完結させる
  // (ProductPanelOverlay/DetectedPreviewOverlayと同じ設計)。
  const [tooltipHover, setTooltipHover] = useState<{
    detectionId: number
    clientX: number
    clientY: number
  } | null>(null)
  const dragRef = useRef<{
    detectionId: number
    startClientX: number
    startClientY: number
    startNormX: number
    startNormY: number
    originalLabel: Point
    moved: boolean
  } | null>(null)
  const [dragPreview, setDragPreview] = useState<{ detectionId: number; pos: Point } | null>(null)

  // 水平線の長さは`overlayRef`の現在の実表示px幅(zoom/pane resize/Viewer Fitで
  // 変わる)を基準に計算するため、その値が変化した時に再計算(再レンダー)が
  // 走るようにする (追加修正 第3ラウンド14章: Zoomしても文字/水平線/斜線/矢印の
  // 位置関係が崩れないこと)。`DrawingCanvas.tsx`のViewer自動Fit機能と同じ
  // ResizeObserverパターンを踏襲する。実ブラウザの`ResizeObserver`は
  // `observe()`呼び出し直後にも1度発火する仕様のため、初回マウント時の
  // (まだrefが無い状態での)概算値も速やかに実測値へ補正される。
  const [, forceRerenderTick] = useState(0)
  useEffect(() => {
    const el = overlayRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      forceRerenderTick((n) => n + 1)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    function normalizedPoint(clientX: number, clientY: number): Point | null {
      const el = overlayRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height }
    }

    function handleMouseMove(e: MouseEvent) {
      const drag = dragRef.current
      if (!drag) return
      const point = normalizedPoint(e.clientX, e.clientY)
      if (!point) return
      const movedPx = Math.max(
        Math.abs(e.clientX - drag.startClientX),
        Math.abs(e.clientY - drag.startClientY),
      )
      if (movedPx >= MIN_DRAG_PX) drag.moved = true
      const dx = point.x - drag.startNormX
      const dy = point.y - drag.startNormY
      const pos = {
        x: Math.max(0, Math.min(1, drag.originalLabel.x + dx)),
        y: Math.max(0, Math.min(1, drag.originalLabel.y + dy)),
      }
      setDragPreview({ detectionId: drag.detectionId, pos })
    }

    function handleMouseUp() {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      setDragPreview((current) => {
        // BBox位置は変えず、ラベル位置のみ保存する (指示書10章)。移動量が
        // 閾値未満の場合はクリック(選択)とみなし、位置は保存しない。
        if (drag.moved && current && current.detectionId === drag.detectionId) {
          onMoveLabel(drag.detectionId, current.pos.x, current.pos.y)
        }
        return null
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMoveLabel])

  // PAGE切替等でdetections自体が入れ替わった時、古いTooltip状態を持ち越さない
  // (DetectedPreviewOverlay.tsxと同じ考え方)。
  useEffect(() => {
    setTooltipHover(null)
  }, [detections])

  // 積算コードHover Tooltip (次work指示1章)。線本体・ラベルどちらをhoverしても
  // 同じ情報が出るよう、両方の要素から共通のこの3関数を呼ぶ。
  function handleDetectionHoverEnter(e: React.MouseEvent, detectionId: number) {
    onHoverDetection(detectionId)
    setTooltipHover({ detectionId, clientX: e.clientX, clientY: e.clientY })
  }
  function handleDetectionHoverMove(e: React.MouseEvent, detectionId: number) {
    setTooltipHover((current) =>
      current && current.detectionId === detectionId
        ? { ...current, clientX: e.clientX, clientY: e.clientY }
        : current,
    )
  }
  function handleDetectionHoverLeave(detectionId: number) {
    onHoverDetection(null)
    setTooltipHover((current) => (current?.detectionId === detectionId ? null : current))
  }

  function handleLabelMouseDown(e: React.MouseEvent, detection: Detection, label: Point) {
    // ラベル帯のdragは編集中(選択中)のみ有効にする (指示書10章はediting状態の
    // 操作として説明されている)。未選択時のmousedownは通常のクリック(選択)に任せる。
    if (detection.id !== selectedDetectionId) return
    if (e.button !== 0) return
    const el = overlayRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    dragRef.current = {
      detectionId: detection.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startNormX: (e.clientX - rect.left) / rect.width,
      startNormY: (e.clientY - rect.top) / rect.height,
      originalLabel: label,
      moved: false,
    }
  }

  const masterLinked = detections.filter((d) => d.master_item_id != null)

  /** 引出線の「アンカー」= BBox右上角。ドラッグ中(未確定)のプレビューがあれば
   * そちらをリアルタイムに使い、なければ確定済み(persisted)のBBoxを使う
   * (Phase 1.11 追加修正11章〜13章: move/resize中も引出線が追従する)。 */
  function resolveAnchor(detection: Detection): Point {
    const rect = previewBBox?.detectionId === detection.id ? previewBBox.rect : bboxOf(detection)
    return topRightCorner(rect)
  }

  /** ラベルの表示位置を決める。優先順位:
   * 1. ラベル帯自体をユーザーがドラッグ中 (`dragPreview`) → そちらを最優先。
   * 2. BBox本体がドラッグ中(未確定、`previewBBox`) → 保存済み位置(`saved`)を
   *    アンカーの移動量ぶんだけリアルタイムにずらして追従させる
   *    (全体フォント拡大・BBox編集追従回帰修正 指示3章:
   *    「ドラッグ中にもリアルタイム追従させる」)。確定(mouseup)後は
   *    App.tsx側が`shiftLabelWithBBox`で`leader_label_x/y`自体をこの移動量ぶん
   *    更新して保存するため、previewBBoxがnullに戻ってもラベルが元の位置へ
   *    ジャンプして戻ることはない。
   * 3. どちらもドラッグ中でなければ保存済み位置(`saved`)をそのまま使う。 */
  function resolveLabel(detection: Detection, persistedAnchor: Point): Point {
    const saved =
      detection.leader_label_x != null && detection.leader_label_y != null
        ? { x: detection.leader_label_x, y: detection.leader_label_y }
        : computeInitialLabelPosition(persistedAnchor)
    if (dragPreview?.detectionId === detection.id) return dragPreview.pos
    if (previewBBox?.detectionId === detection.id) {
      const liveAnchor = topRightCorner(previewBBox.rect)
      return {
        x: clamp01(saved.x + (liveAnchor.x - persistedAnchor.x)),
        y: clamp01(saved.y + (liveAnchor.y - persistedAnchor.y)),
      }
    }
    return saved
  }

  // 水平線の長さ計算の基準となる、現在のコンテナ実表示px幅
  // (追加修正 第3ラウンド13章: pxのまま扱わずnormalizedへ変換する基準値)。
  // `overlayRef.current`は初回レンダー時点ではまだ`null`のことがあるが、
  // `computeLabelWidthFraction`側で0以下の場合のフォールバックを持つ。
  const containerWidthPx = overlayRef.current?.getBoundingClientRect().width ?? 0

  return (
    <div className="leader-line-overlay" ref={overlayRef}>
      <svg className="leader-line-overlay__svg" preserveAspectRatio="none" viewBox="0 0 1 1">
        {masterLinked.map((detection) => {
          // ラベル自身の位置は常に確定済みBBoxのアンカーから計算する(drag中の
          // ジッター防止。要件16)。引出線(anchor)はresolveAnchorで別途、
          // ドラッグ中ならpreviewBBoxを使ってリアルタイムに追従させる。
          const persistedAnchor = topRightCorner(bboxOf(detection))
          const anchor = resolveAnchor(detection)
          const label = resolveLabel(detection, persistedAnchor)
          const text = buildLabelText(detection)
          const widthFraction = computeLabelWidthFraction(text, containerWidthPx)
          const geometry = computeLeaderGeometry(anchor, label, widthFraction)
          const d = pathD(geometry)
          const colors = getCategoryPresentation(detection.master_item_category).colors
          const markerId = `leader-arrow-${detection.id}`
          return (
            <g key={detection.id}>
              <defs>
                {/* 一般的なCAD引出線の矢印head (追加修正6章/8章)。orient="auto"により
                    経路の進行方向(elbow→anchor)へ自動的に向きを合わせるため、
                    向きの計算をこちら側で個別に行う必要はない。 */}
                <marker
                  id={markerId}
                  viewBox="0 0 10 10"
                  refX={9}
                  refY={5}
                  // 矢印headの大きさ (追加修正指示1章〜4章)。旧0.018はBBox四隅の
                  // リサイズハンドルより大きく図面の文字を隠しやすかったため、
                  // 約55%の0.010へ縮小 (指示の50〜65%範囲内)。markerUnitsは
                  // 意図的に"userSpaceOnUse"のままとし、線の太さ(strokeWidth)の
                  // チューニングから矢印の大きさを独立させ、挙動を予測しやすくする。
                  markerWidth={0.01}
                  markerHeight={0.01}
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  <path d="M0,0 L10,5 L0,10 Z" fill={colors.leaderColor} />
                </marker>
              </defs>
              {/* 透明な太いヒットエリア (指示書15章/18章)。斜線・水平線の全体に沿わせ、
                  hoverで対応BBoxを表示できるようにする (要件8)。 */}
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={0.014}
                style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                onMouseEnter={(e) => handleDetectionHoverEnter(e, detection.id)}
                onMouseMove={(e) => handleDetectionHoverMove(e, detection.id)}
                onMouseLeave={() => handleDetectionHoverLeave(detection.id)}
                onClick={() => onSelectDetection(detection.id)}
              />
              {/* 見た目の引出線 (アンカー→折れ点→水平線端の1本の連続したpolyline。
                  追加修正9章: 斜線と水平線の間に隙間を作らない)。 */}
              <path
                d={d}
                fill="none"
                stroke={colors.leaderColor}
                strokeWidth={0.0018}
                markerEnd={`url(#${markerId})`}
                style={{ pointerEvents: 'none' }}
              />
            </g>
          )
        })}
      </svg>
      {masterLinked.map((detection) => {
        const anchor = topRightCorner(bboxOf(detection))
        const label = resolveLabel(detection, anchor)
        const colors = getCategoryPresentation(detection.master_item_category).colors
        const text = buildLabelText(detection)
        const isHovered = detection.id === hoveredDetectionId
        const isSelected = detection.id === selectedDetectionId
        return (
          <button
            key={detection.id}
            type="button"
            className={
              'leader-line-overlay__label' +
              (isSelected ? ' leader-line-overlay__label--selected' : '') +
              (isHovered ? ' leader-line-overlay__label--hovered' : '')
            }
            style={{
              left: `${label.x * 100}%`,
              top: `${label.y * 100}%`,
              ...toCssVars(colors),
            }}
            onMouseEnter={(e) => handleDetectionHoverEnter(e, detection.id)}
            onMouseMove={(e) => handleDetectionHoverMove(e, detection.id)}
            onMouseLeave={() => handleDetectionHoverLeave(detection.id)}
            onClick={() => onSelectDetection(detection.id)}
            onMouseDown={(e) => handleLabelMouseDown(e, detection, label)}
            title={isSelected ? 'ドラッグしてラベル位置を移動' : undefined}
          >
            {text}
          </button>
        )
      })}
      {/* 積算コードHover Tooltip (次work指示1章)。他Overlayのtooltipと同じ
          position:fixed + viewport端クランプ実装。pointer-events:noneで
          Tooltip自体がクリック/hoverを奪わない。line-lengthに関わる引出線の
          描画(SVG側)には一切影響しない、純粋な表示専用の追加要素。 */}
      {tooltipHover &&
        (() => {
          const detection = masterLinked.find((d) => d.id === tooltipHover.detectionId)
          if (!detection) return null
          const rows = buildDetectionInfoRows(detection, masterItemById)
          return (
            <div
              className="leader-line-overlay__tooltip"
              role="tooltip"
              style={clampDetectionTooltipPosition(tooltipHover.clientX, tooltipHover.clientY)}
            >
              {rows.map((row) => (
                <div key={row.label} className="leader-line-overlay__tooltip-row">
                  <span className="leader-line-overlay__tooltip-label">{row.label}</span>
                  <span className="leader-line-overlay__tooltip-value">{row.value}</span>
                </div>
              ))}
            </div>
          )
        })()}
    </div>
  )
}
