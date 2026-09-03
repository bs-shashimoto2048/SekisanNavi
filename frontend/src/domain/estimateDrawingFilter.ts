// 積算集約(②)の対象選択に応じて、左ペイン図面一覧(DrawingNavigator)へ渡す
// 表示対象ページ番号を導出する (積算対象連動の金額表示・図面一覧絞り込み 指示4章〜6章)。
//
// 図面タイトル文字列やページ番号の文字列一致では判定せず、既存の実識別子
// (banMenno/banNo, EstimateTarget, EstimateDetailItem.pageNo) の関係のみを使う
// (指示6章)。BBox所属判定ロジック(estimateAggregationReal.ts)自体には変更を
// 加えず、その出力(EstimateTarget/EstimateDetailItem)とApp.tsxが既に持っている
// panelsByPageNoだけから導出する。
import type { PanelPreview } from '../types/domain'
import type { EstimateDetailItem, EstimateTarget } from '../types/estimateAggregation'

/**
 * 選択中の積算対象に関連する図面ページ番号の集合を返す。
 *
 * - `target === null` (総合計): 絞り込みなし。呼び出し側は`null`を「フィルタしない」
 *   の意味として扱う (指示1章の「総合計」と同じ考え方)。
 * - `target.type === 'panel'` (個別盤): その物理盤(banMenno/banNo)が実際に存在する
 *   ページ全て (`panelsByPageNo`から導出)。同一の物理盤が複数の図面ページに
 *   またがって存在する現在の実データ構造をそのまま反映するため、「盤1つ=図面1枚」
 *   とは限らない (指示4章/6章)。
 * - `target.type === 'product' | 'tie'` (製品全体・要確認): どの盤BBoxとも交差
 *   しなかった(または複数盤に同点で交差した)Detectionの実際の所属ページ
 *   (`EstimateDetailItem.pageNo`、`drawingPageId`から解決済みの実識別子)を基準にする
 *   (指示5章)。該当する明細が1件も無い場合は空集合を返す (呼び出し側で
 *   「該当する図面はありません」等、専用の空表示に使う)。
 */
export function visiblePageNosForTarget(
  target: EstimateTarget | null,
  detailItems: EstimateDetailItem[],
  panelsByPageNo: Map<number, PanelPreview[]>,
): Set<number> | null {
  if (target == null) return null

  if (target.type === 'panel' && target.banMenno != null && target.banNo != null) {
    const pages = new Set<number>()
    for (const [pageNo, panels] of panelsByPageNo) {
      if (panels.some((p) => p.ban_menno === target.banMenno && p.ban_no === target.banNo)) {
        pages.add(pageNo)
      }
    }
    return pages
  }

  // product / tie: 対象の明細が実際に存在するページのみ。
  return new Set(detailItems.filter((d) => d.targetId === target.id).map((d) => d.pageNo))
}
