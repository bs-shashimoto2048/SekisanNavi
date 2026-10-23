import type { DesignPages } from '../types/domain'

/** design.csv基準の一覧を使えない(取得前を除く)とき、従来の図面一覧へ切り替えていることを示す固定文言
 * (例外文言・パスは含めない)。使える(okで1件以上)場合や、取得前(null)はnull。 */
export function designPagesFallbackNote(designPages: DesignPages | null): string | null {
  if (designPages == null) return null
  if (designPages.status === 'ok' && designPages.items.length > 0) return null
  const reason =
    designPages.status === 'missing'
      ? 'design.csv がないため'
      : designPages.status === 'invalid'
        ? 'design.csv を読み込めないため'
        : 'design.csv に表示できる図面がないため'
  return `${reason}、従来の図面一覧を表示しています`
}
