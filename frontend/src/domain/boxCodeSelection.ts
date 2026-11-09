// 箱コード自動選定の行(積算明細)に関する表示用ヘルパー。
//
// 選定そのもの(接続情報→カテゴリ、型式・定格・寸法の照合)はBackend
// (`backend/app/domain/box_code_selection.py`、`box_code_candidates.py`)が行い、
// 結果は `estimate_results` の行(result_key が `box:面番号:盤番号`)として返る。
// ここでは、その行を判別し、手修正で選べる候補(部品台帳の箱3カテゴリ)を作るだけ。
import type { EstimateMasterItem, EstimateResult } from '../types/domain'

export const BOX_CATEGORIES = ['箱･単独', '箱･左右', '箱･中'] as const

export const BOX_RESULT_KEY_PREFIX = 'box:'

export type BoxSelectionState = 'auto' | 'manual' | 'needs_review'

export function isBoxResult(result: EstimateResult): boolean {
  return result.result_key.startsWith(BOX_RESULT_KEY_PREFIX)
}

/** 箱コード行の選定状態。手修正 > 要確認(コード未確定・重複の可能性) > 自動選定。 */
export function boxSelectionState(result: EstimateResult): BoxSelectionState {
  if (result.code_overridden) return 'manual'
  if (result.status === 'needs_review' || result.master_item_id == null) return 'needs_review'
  return 'auto'
}

export const BOX_SELECTION_STATE_LABEL: Record<BoxSelectionState, string> = {
  auto: '自動選定',
  manual: '手修正',
  needs_review: '要確認',
}

/** 対象盤の表示名(面番号/盤番号)。 */
export function boxPanelLabel(result: EstimateResult): string {
  return `面${result.target_panel_ban_menno ?? '-'}/盤${result.target_panel_ban_no ?? '-'}`
}

export interface BoxCodeOptionGroup {
  category: string
  items: EstimateMasterItem[]
}

/**
 * 手修正で選べるコード。その盤の品名カテゴリが確定していればそのカテゴリだけ、
 * 接続情報が不明で決められない場合は箱3カテゴリすべて(カテゴリごとにまとめる)。
 */
export function boxCodeOptionGroups(
  result: EstimateResult,
  masterItems: Iterable<EstimateMasterItem>,
): BoxCodeOptionGroup[] {
  const categories = result.box_category != null ? [result.box_category] : [...BOX_CATEGORIES]
  const all = [...masterItems]
  return categories
    .map((category) => ({
      category,
      items: all.filter((item) => item.category === category).sort((a, b) => a.code.localeCompare(b.code)),
    }))
    .filter((group) => group.items.length > 0)
}

export function boxItemLabel(item: EstimateMasterItem): string {
  const spec = [item.model?.trim(), item.rating?.trim()].filter((v): v is string => !!v).join(' / ')
  return spec ? `${item.code} ${spec}` : item.code
}
