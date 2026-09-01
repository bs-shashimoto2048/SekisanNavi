// ブラウザURLのquery文字列(`?product=...&page=...`)による表示状態の復元
// (Phase 1.11 UI改修指示22章/23章)。
//
// リロード時に選択中製番・PAGEが消える問題への対応として、localStorageではなく
// URL queryを優先して使う(指示書22章: 「URLで状態を表現できるなら優先して検討する」)。
// 純粋関数として切り出すことで、jsdom越しのwindow.location操作に依存せず
// 単体テストできるようにしている。

const PRODUCT_PARAM = 'product'
const PAGE_PARAM = 'page'

/** URL queryから製番を読み取る。無ければ(または空文字なら)nullを返す。
 * 実在確認はしない (呼び出し側がAPI応答を見て安全にfallbackする。指示書23章)。 */
export function parseProductNoFromSearch(search: string): string | null {
  const params = new URLSearchParams(search)
  const value = params.get(PRODUCT_PARAM)
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** URL queryからPAGE番号を読み取る。無い/不正な値の場合はnullを返す
 * (アプリを壊さない。指示書23章)。 */
export function parsePageNoFromSearch(search: string): number | null {
  const params = new URLSearchParams(search)
  const value = params.get(PAGE_PARAM)
  if (value == null) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * 現在のURLのquery文字列を、指定した製番・PAGEを反映した新しいquery文字列へ
 * 差し替える。他のquery paramは保持する。pageがnullの場合はpage paramを削除する
 * (例: ページ一覧取得前の一時的な状態)。
 */
export function buildSearchWithProductPage(
  currentSearch: string,
  productNo: string,
  pageNo: number | null,
): string {
  const params = new URLSearchParams(currentSearch)
  params.set(PRODUCT_PARAM, productNo)
  if (pageNo != null) {
    params.set(PAGE_PARAM, String(pageNo))
  } else {
    params.delete(PAGE_PARAM)
  }
  return params.toString()
}
