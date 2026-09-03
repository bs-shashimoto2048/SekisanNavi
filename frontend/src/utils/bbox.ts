// BBox (0.0〜1.0 正規化座標) に関する共通ロジック (Phase 1.7)。
//
// DetectionOverlayの四隅リサイズ操作から利用する。Zoom/Pan/Fit/ウィンドウリサイズに
// 一切依存しない、純粋な正規化座標同士の計算のみを行う (architecture.md「Overlay座標系」参照)。

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface NormalizedRect {
  x: number
  y: number
  w: number
  h: number
}

// 各ハンドルが「矩形のどの角にあたるか」。ドラッグ中は、ここで示した軸が
// 可動側 (xIsMin=true なら左辺=最小x、false なら右辺=最大x)、逆側の角が固定される。
const CORNER_ROLES: Record<Corner, { xIsMin: boolean; yIsMin: boolean }> = {
  'top-left': { xIsMin: true, yIsMin: true },
  'top-right': { xIsMin: false, yIsMin: true },
  'bottom-left': { xIsMin: true, yIsMin: false },
  'bottom-right': { xIsMin: false, yIsMin: false },
}

/**
 * 四隅ハンドルのドラッグから新しい正規化矩形を計算する (要件16-20)。
 *
 * - ドラッグしたハンドルの対角にあたる角を固定点として扱う (要件17)。
 * - 座標は 0.0〜1.0 の範囲へclampする (要件19)。
 * - 反対側の辺を越えるようなドラッグでは、ハンドルの役割を反転させず、
 *   最低サイズ(minSize)で止める (要件20)。
 */
export function resizeRect(
  original: NormalizedRect,
  corner: Corner,
  pointerX: number,
  pointerY: number,
  minSize: number,
): NormalizedRect {
  const role = CORNER_ROLES[corner]
  const fixedX = role.xIsMin ? original.x + original.w : original.x
  const fixedY = role.yIsMin ? original.y + original.h : original.y
  const clampedPointerX = Math.max(0, Math.min(1, pointerX))
  const clampedPointerY = Math.max(0, Math.min(1, pointerY))

  let xMin: number
  let xMax: number
  if (role.xIsMin) {
    xMax = fixedX
    xMin = Math.max(0, Math.min(clampedPointerX, fixedX - minSize))
  } else {
    xMin = fixedX
    xMax = Math.min(1, Math.max(clampedPointerX, fixedX + minSize))
  }

  let yMin: number
  let yMax: number
  if (role.yIsMin) {
    yMax = fixedY
    yMin = Math.max(0, Math.min(clampedPointerY, fixedY - minSize))
  } else {
    yMin = fixedY
    yMax = Math.min(1, Math.max(clampedPointerY, fixedY + minSize))
  }

  return { x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin }
}

/**
 * BBox内部ドラッグによる移動 (Phase 1.11 UI改修指示4章)。
 *
 * 幅・高さ(w/h)は維持したままx/yだけを変更する。0.0〜1.0の範囲(図面領域)から
 * 出ないようclampする — resizeRectと異なり、対角固定ではなく矩形全体を平行移動
 * するため、x/yそれぞれ独立に「矩形が完全に収まる範囲」でclampすればよい。
 */
export function moveRect(original: NormalizedRect, dx: number, dy: number): NormalizedRect {
  const maxX = Math.max(0, 1 - original.w)
  const maxY = Math.max(0, 1 - original.h)
  return {
    x: Math.max(0, Math.min(maxX, original.x + dx)),
    y: Math.max(0, Math.min(maxY, original.y + dy)),
    w: original.w,
    h: original.h,
  }
}

export interface Point {
  x: number
  y: number
}

/**
 * BBox右上角の正規化座標 (Phase 1.11 UI改修指示11章)。
 *
 * 引出線の矢印先端(アンカー)はこの点に固定する。BBoxをmove/resizeした場合、
 * この関数を呼び直すだけで新しいアンカー位置が得られる (= 自動追従)。
 * 正規化座標はDOM/画像と同じ左上原点のため、「右上」はx最大・y最小の角になる。
 */
export function topRightCorner(rect: NormalizedRect): Point {
  return { x: rect.x + rect.w, y: rect.y }
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

// 引出線ラベルの初期配置に使う概算オフセット (0.0〜1.0正規化座標)。
// 高度な自動衝突回避は実装せず、BBoxや図面を過度に隠さない程度の単純なオフセットに
// とどめる (Phase 1.11 UI改修指示13章)。ユーザーが帯部分をドラッグして修正できる。
const LABEL_INITIAL_OFFSET_X = 0.03
const LABEL_INITIAL_OFFSET_Y = 0.05

/** ラベルの初期位置を計算する。BBox右上角(アンカー)から右上方向へ少しずらすだけの
 * 単純な規則とし、ページ端に近い場合のみ内側へ折り返す (指示書13章)。
 * `LeaderLineOverlay.tsx`(描画時のフォールバック)と`App.tsx`(BBox編集確定時の
 * ラベル位置保存)の両方から同じ計算を再利用するため、ここに一元化している
 * (全体フォント拡大・BBox編集追従回帰修正 指示3章: 表示文字列/座標計算の
 * 二重管理をしない)。 */
export function computeInitialLabelPosition(anchor: Point): Point {
  let x = anchor.x + LABEL_INITIAL_OFFSET_X
  let y = anchor.y - LABEL_INITIAL_OFFSET_Y
  if (x > 0.85) x = anchor.x - LABEL_INITIAL_OFFSET_X - 0.1 // 右端に近い場合は左側へ
  if (y < 0.05) y = anchor.y + LABEL_INITIAL_OFFSET_Y // 上端に近い場合は下側へ
  return { x: clamp01(x), y: clamp01(y) }
}

/**
 * BBox移動/リサイズが確定した際、引出線ラベル(`leader_label_x/y`)をBBoxの
 * アンカー(右上角)の移動量と同じだけ平行移動させる (全体フォント拡大・BBox編集
 * 追従回帰修正 指示3章:「BBoxとともに積算コード表示の相対的な配置関係を維持して
 * 移動する」)。
 *
 * ラベルがまだ一度も保存されていない場合(currentLabel===null)は、そもそも
 * 「相対配置」という概念がまだ無いため、移動後のアンカーから初期位置を
 * 算出し直す。それ以外は「現在保存されている位置 + アンカーの移動量」を返す。
 *
 * ユーザーが引出線ラベル自体を個別にドラッグして配置を変えられる既存機能
 * (`onMoveLabel`)とは独立しており、この関数はBBox本体の移動/リサイズ確定時にのみ
 * 呼ばれる想定 (指示4章: Undo/Redoでも同じ関数を使うことで、逆方向にも正しく戻る)。
 */
export function shiftLabelWithBBox(
  currentLabel: Point | null,
  beforeRect: NormalizedRect,
  afterRect: NormalizedRect,
): Point {
  const afterAnchor = topRightCorner(afterRect)
  if (currentLabel == null) return computeInitialLabelPosition(afterAnchor)
  const beforeAnchor = topRightCorner(beforeRect)
  return {
    x: clamp01(currentLabel.x + (afterAnchor.x - beforeAnchor.x)),
    y: clamp01(currentLabel.y + (afterAnchor.y - beforeAnchor.y)),
  }
}

/**
 * 2つの正規化矩形の交差面積 (積算集約: 根拠BBox×盤BBoxの所属判定指示)。
 *
 * 中心点判定ではなく「面積を持った交差があるか」を基準とするため、交差幅・
 * 交差高さの両方が0より大きい場合のみ正の面積を返す。辺や点が触れているだけ
 * (交差幅または交差高さが0)の場合は0を返し、「交差なし」として扱う。
 */
export function intersectionArea(a: NormalizedRect, b: NormalizedRect): number {
  const ix = Math.max(a.x, b.x)
  const iy = Math.max(a.y, b.y)
  const iw = Math.min(a.x + a.w, b.x + b.w) - ix
  const ih = Math.min(a.y + a.h, b.y + b.h) - iy
  if (iw > 0 && ih > 0) return iw * ih
  return 0
}
