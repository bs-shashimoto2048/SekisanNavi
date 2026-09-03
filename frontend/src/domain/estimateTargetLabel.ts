// EstimateTargetの説明的な表示ラベル ("面X / 盤Y" / "製品全体" / "要確認")。
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
  if (target.type === 'product') return '製品全体'
  return '要確認' // tie
}
