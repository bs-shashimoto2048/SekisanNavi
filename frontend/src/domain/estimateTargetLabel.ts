// EstimateTargetの説明的な表示ラベル ("面X / 盤Y" / "製番仕様" / "要確認")。
// 積算集約(②)の上部金額ラベル・積算明細強化ラウンドの所属変更通知など、複数箇所で
// 同じ表現を使うため一元化する (積算明細強化・Undo/Redo・要確認警告・編集追従
// 指示9章。表示文字列を複数箇所へハードコードして二重管理しない)。
//
// 積算明細(EstimateDetail.tsx)の「面/盤」列が使う短縮表示("1/1"/"全体"/"要確認")
// とは目的が異なる別関数として持つ(あちらは表の1セルに収める簡潔表示、こちらは
// 見出し・通知文で人が読む説明的表示)。
import type { EstimateTarget } from '../types/estimateAggregation'

export function formatTargetLabel(target: EstimateTarget | null): string {
  if (target == null) return '-'
  if (target.type === 'panel' && target.banMenno != null && target.banNo != null) {
    return `面${target.banMenno} / 盤${target.banNo}`
  }
  if (target.type === 'product') return '製番仕様'
  return '要確認' // tie
}

/** 対象セレクトの「総合計」を表す値。実対象(製番仕様/各盤/要確認)のidとは
 * 衝突しない空文字を使い、呼び出し側は`onSelectTarget`へnullを渡す(総合計は
 * 実データ上の分類バケットではなく「フィルタなし」というUI上の見方であるため、
 * `domain/estimateAggregationReal.ts`側には実体を持たせない)。
 *
 * [追加修正] 積算集約(`EstimateAggregation`)専用だった対象セレクトのoption
 * 構築ロジックを、積算明細(`EstimateDetail`)にも同じ「盤番号選択リスト」を
 * 追加するためここへ共通化した(2箇所で同じ対象id・ラベル表現を別々に
 * 実装すると、選択肢の見え方が食い違う恐れがあるため)。 */
export const ALL_OPTION_VALUE = ''

/** 対象セレクトの1オプション分の表示文字列。個別盤は「面番号 X / 盤番号 Y :
 * 盤名称」(次々work指示3章)、それ以外(製番仕様/要確認)は`target.name`を
 * そのまま使う。 */
export function targetOptionLabel(target: EstimateTarget): string {
  if (target.type === 'panel' && target.banMenno != null && target.banNo != null) {
    return `面番号 ${target.banMenno} / 盤番号 ${target.banNo} : ${target.name}`
  }
  return target.name
}
