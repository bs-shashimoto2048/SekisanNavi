// 盤寸法(高さ・幅・奥行)の取得ルール。
//
// 寸法の優先順位(すべての表示経路で共通):
//   1. estcode_df.csv の BAN_H / BAN_W / BAN_D(正の値のみ。0 や欠損は「未設定」)
//   2. 未設定の項目だけ、product_df.csv の「ZUMEI に『外形図』を含み、BAN_TYPE が『正面図』」の行
//      (BAN_H1=正面高さ、BAN_H2=背面高さ、BAN_W=幅、BAN_D=奥行)。BAN_MENNO と BAN_NO が一致する盤にだけ使う。
//   3. どちらにも正の値が無ければ「-」(推測しない。別盤・別製番の値は流用しない)
// 高さだけは従来どおり product_df 側(正面/背面の2値)を先に使い、無いときに estcode_df の BAN_H を使う。
//
// 寸法は物理量なので、0 は有効な寸法ではなく未設定値として扱う
// (A1GE4568 の estcode_df.csv は BAN_H/W/D が全盤 0 で、同じ盤の外形図・正面図行には正の値がある)。
import type { PanelPreview, ProductDrawing } from '../types/domain'

type Dim = number | null | undefined

/** 有限な正の数だけを「設定済みの寸法」とみなす(0・負数・NaN・欠損は未設定)。 */
export function isSetDimension(value: Dim): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export const OUTLINE_DRAWING_KEYWORD = '外形図'
export const FRONT_VIEW_TYPE = '正面図'

/** 寸法の補完元に使える行か(ZUMEI に外形図を含み、BAN_TYPE が正面図)。 */
export function isOutlineFrontRow(drawingName: string | null | undefined, banType: string | null | undefined): boolean {
  return (drawingName ?? '').includes(OUTLINE_DRAWING_KEYWORD) && banType === FRONT_VIEW_TYPE
}

/**
 * 図面一覧から寸法の補完元行(外形図かつ正面図)だけを取り出す。
 * ページ番号の昇順(同順位は元の並び順)で並べ、採用行が決定的になるようにする。
 */
export function selectOutlineFrontPanels(drawings: ProductDrawing[]): PanelPreview[] {
  return drawings
    .map((drawing, index) => ({ drawing, index }))
    .filter(({ drawing }) => (drawing.drawing_name ?? '').includes(OUTLINE_DRAWING_KEYWORD))
    .sort((a, b) => a.drawing.page_no - b.drawing.page_no || a.index - b.index)
    .flatMap(({ drawing }) => drawing.panels.filter((panel) => isOutlineFrontRow(drawing.drawing_name, panel.ban_type)))
}

export interface PanelDimensions {
  /** 正面高さ(BAN_H1)。 */
  frontHeight: number | null
  /** 背面高さ(BAN_H2)。 */
  backHeight: number | null
  /** estcode_df の BAN_H(product_df に高さが無いときだけ使う)。 */
  fallbackHeight: number | null
  width: number | null
  depth: number | null
}

interface EstimateDims {
  ban_h: Dim
  ban_w: Dim
  ban_d: Dim
}

/** 同じ盤(ban_menno + ban_no)の補完元行を、項目ごとに最初の正の値で解決する。 */
export function resolvePanelDimensions(
  banMenno: number,
  banNo: number | null | undefined,
  estimate: EstimateDims | null | undefined,
  outlineFrontPanels: PanelPreview[],
): PanelDimensions {
  const sources =
    banNo == null ? [] : outlineFrontPanels.filter((p) => p.ban_menno === banMenno && p.ban_no === banNo)
  const firstSet = (pick: (p: PanelPreview) => Dim): number | null => {
    for (const source of sources) {
      const value = pick(source)
      if (isSetDimension(value)) return value
    }
    return null
  }
  return {
    frontHeight: firstSet((p) => p.ban_h1),
    backHeight: firstSet((p) => p.ban_h2),
    fallbackHeight: isSetDimension(estimate?.ban_h) ? estimate.ban_h : null,
    width: isSetDimension(estimate?.ban_w) ? estimate.ban_w : firstSet((p) => p.ban_w),
    depth: isSetDimension(estimate?.ban_d) ? estimate.ban_d : firstSet((p) => p.ban_d),
  }
}
