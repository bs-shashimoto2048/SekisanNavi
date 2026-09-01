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

/**
 * BBox右上角の正規化座標 (Phase 1.11 UI改修指示11章)。
 *
 * 引出線の矢印先端(アンカー)はこの点に固定する。BBoxをmove/resizeした場合、
 * この関数を呼び直すだけで新しいアンカー位置が得られる (= 自動追従)。
 * 正規化座標はDOM/画像と同じ左上原点のため、「右上」はx最大・y最小の角になる。
 */
export function topRightCorner(rect: NormalizedRect): { x: number; y: number } {
  return { x: rect.x + rect.w, y: rect.y }
}
