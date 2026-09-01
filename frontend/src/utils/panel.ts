import type { PanelPreview } from '../types/domain'

/**
 * 中央Viewerで選択中の盤領域(product_df由来)を識別するキー (Phase 1.9, 要件19)。
 *
 * product_dfの生配列インデックスだけを識別子にはしない方針のため、
 * page_no/BAN_MENNO/BAN_NO/BAN_TYPEを組み合わせる (同一ページに同じBAN_NOの
 * 異なるview(正面図/背面図等)が存在しうるため、BAN_TYPEも含めて区別する)。
 * 末尾のindexは、万一これらが完全に一致する行が複数あった場合の保険的な
 * tie-breakerとして付与する。
 */
export function panelKey(panel: PanelPreview, index: number): string {
  return `${panel.page_no}:${panel.ban_menno}:${panel.ban_no}:${panel.ban_type}:${index}`
}

/**
 * 「同一盤」の判定キー (Phase 1.11 UI改修指示17章/18章)。
 *
 * PAGE + BAN_MENNO + BAN_NO のみを使い、BAN_TYPEは含めない。BAN_TYPEは
 * 正面図/背面図/左側面図等の「別矢視を区別する情報」であり、同一盤の別矢視
 * (=同じ盤を別の面から見た領域) をグループ化するための判定には含めない
 * (指示書18章)。1つの盤領域をhoverした時、この関数が返すキーが一致する
 * 全領域を連動して薄くハイライトする (`ProductPanelOverlay`参照)。
 *
 * `panelKey`(盤選択の一意識別用、BAN_TYPE+indexを含む)とは目的が異なる別関数
 * であり、混同しないこと。
 */
export function banGroupKey(panel: PanelPreview): string {
  return `${panel.page_no}:${panel.ban_menno}:${panel.ban_no}`
}
