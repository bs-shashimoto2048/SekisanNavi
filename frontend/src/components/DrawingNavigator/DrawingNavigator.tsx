import { useState } from 'react'
import type { PanelPreview, ProductDrawing } from '../../types/domain'
import './DrawingNavigator.css'

interface Props {
  pages: ProductDrawing[]
  selectedPageNo: number | null
  onSelectPage: (pageNo: number) => void
  loading: boolean
  error: string | null
  /** 積算集約(②)の対象選択に連動した図面絞り込み (積算対象連動の金額表示・
   * 図面一覧絞り込み 指示4章〜6章)。`null`(または未指定)は絞り込みなし(総合計、
   * 全図面表示)を表す。指定時は`page_no`がこの集合に含まれるページのみ表示する。
   * `pages`自体(取得結果・loading/error状態)には触れず、表示するカードだけを
   * 絞り込む(実データ取得が0件の状態と、絞り込みの結果0件になった状態を区別する
   * ため。指示5章: 後者は不具合と誤認されない専用メッセージにする)。 */
  visiblePageNos?: Set<number> | null
}

const UNCLASSIFIED_GROUP = 'その他'

// 図面種別 (drawing_type) ごとにグループ化して表示する (要件27。既存のグループ分けを
// 維持)。グループ順序はページ配列に出現した順を採用する (暫定)。drawing_typeが
// 取得できなかったページ (product_df.csvに該当行が無い等) は「その他」へまとめる。
function groupByDrawingType(pages: ProductDrawing[]): [string, ProductDrawing[]][] {
  const order: string[] = []
  const groups = new Map<string, ProductDrawing[]>()
  for (const page of pages) {
    const type = page.drawing_type ?? UNCLASSIFIED_GROUP
    if (!groups.has(type)) {
      groups.set(type, [])
      order.push(type)
    }
    groups.get(type)!.push(page)
  }
  return order.map((type) => [type, groups.get(type)!])
}

// 同一ページに複数の盤情報がある場合、すべて確認できるようにする (要件11/12)。
// 赤色盤領域Overlayは左ペインには表示せず、中央Drawing Viewer側でのみ表示する
// (実画面未反映調査・修正指示 1章/7章/17章。ProductPanelOverlay参照)。
// ラベル表示は視認性のため重複する(BAN_MENNO, BAN_NO)組を1つにまとめる。
function uniqueBanPairs(panels: PanelPreview[]): string[] {
  const seen = new Set<string>()
  const pairs: string[] = []
  for (const p of panels) {
    const key = `${p.ban_menno}/${p.ban_no}`
    if (!seen.has(key)) {
      seen.add(key)
      pairs.push(key)
    }
  }
  return pairs
}

// 図面種別見出しの短い説明文 (Phase 1.11 UI改修指示20章)。サムネイル左上ラベルが
// 「ページ番号 / クロスリファレンス番号・盤番号」を表していることが、外形図等の
// 見出しからも分かるようにする。特定のdrawing_type文字列をハードコードするのではなく、
// そのグループに実際にBAN情報(product_df由来のpanels)を持つページが1件でもあるかで
// 判定する (外形図は実データ上BAN情報を持つが、基礎図等は持たない場合がある)。
// 長い説明文にはしない (指示書20章)。
function groupDescription(type: string, groupPages: ProductDrawing[]): string | null {
  if (type === UNCLASSIFIED_GROUP) return null
  const hasBanInfo = groupPages.some((p) => p.panels.length > 0)
  return hasBanInfo ? 'P：ページ / クロスリファレンス番号・盤番号' : 'P：ページ番号'
}

interface ThumbnailCardProps {
  page: ProductDrawing
  selected: boolean
  onClick: () => void
}

function ThumbnailCard({ page, selected, onClick }: ThumbnailCardProps) {
  const [imgFailed, setImgFailed] = useState(false)
  const banPairs = uniqueBanPairs(page.panels)

  return (
    <button
      type="button"
      className={
        'drawing-navigator__card' + (selected ? ' drawing-navigator__card--selected' : '')
      }
      onClick={onClick}
      title={page.drawing_type ? `${page.drawing_type} (P${page.page_no})` : `P${page.page_no}`}
    >
      <div className="drawing-navigator__thumb-wrap">
        {!imgFailed ? (
          <img
            className="drawing-navigator__thumb-img"
            src={page.thumbnail_url}
            alt={`P${page.page_no}`}
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className="drawing-navigator__thumb-fallback">
            画像なし
            <br />
            P{page.page_no}
          </div>
        )}
        {/* 盤領域(赤色)Overlayは左ペインには表示しない (実画面未反映調査・修正指示
            1章/7章)。PNGサムネイルとPAGE/BAN_MENNO/BAN_NOラベルのみを表示する。
            表示は簡潔にするため2行構成とし、BAN_MENNO/BAN_NOは"/"、複数盤は"・"で
            区切る (Phase 1.9 UI改修指示1章)。 */}
        <span className="drawing-navigator__thumb-label">
          <span className="drawing-navigator__thumb-label-line drawing-navigator__thumb-label-line--page">
            P{page.page_no}
          </span>
          {banPairs.length > 0 && (
            <span className="drawing-navigator__thumb-label-line drawing-navigator__thumb-label-line--ban">
              {/* Phase 1.11 UI改修指示21章: 区切りを中点「・」から読点「、」へ変更する。 */}
              {banPairs.join('、')}
            </span>
          )}
        </span>
      </div>
    </button>
  )
}

export function DrawingNavigator({
  pages,
  selectedPageNo,
  onSelectPage,
  loading,
  error,
  visiblePageNos = null,
}: Props) {
  // 絞り込みは表示するカードのみに適用し、loading/error/「ページが見つかりません」
  // の判定は絞り込み前のpages(実データ取得結果そのもの)で行う (指示5章/6章:
  // 実データが0件の状態と、絞り込み結果が0件の状態を混同しない)。
  const isFiltering = visiblePageNos != null
  const visiblePages = isFiltering ? pages.filter((p) => visiblePageNos!.has(p.page_no)) : pages
  const groups = groupByDrawingType(visiblePages)

  return (
    <nav className="drawing-navigator">
      <h2 className="drawing-navigator__heading">図面一覧</h2>
      {loading && <p className="drawing-navigator__status">読み込み中...</p>}
      {!loading && error && <p className="drawing-navigator__status drawing-navigator__status--error">{error}</p>}
      {!loading && !error && pages.length === 0 && (
        <p className="drawing-navigator__status">ページが見つかりません</p>
      )}
      {!loading && !error && pages.length > 0 && isFiltering && visiblePages.length === 0 && (
        <p className="drawing-navigator__status">該当する図面はありません</p>
      )}
      {!loading &&
        !error &&
        groups.map(([type, groupPages]) => (
          <section key={type} className="drawing-navigator__group">
            <h3 className="drawing-navigator__group-title">{type}</h3>
            {groupDescription(type, groupPages) && (
              <p className="drawing-navigator__group-description">
                {groupDescription(type, groupPages)}
              </p>
            )}
            <div className="drawing-navigator__cards">
              {groupPages.map((page) => (
                <ThumbnailCard
                  key={page.page_no}
                  page={page}
                  selected={page.page_no === selectedPageNo}
                  onClick={() => onSelectPage(page.page_no)}
                />
              ))}
            </div>
          </section>
        ))}
    </nav>
  )
}
