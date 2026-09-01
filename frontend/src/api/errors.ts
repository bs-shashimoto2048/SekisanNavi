import { ApiError } from './client'

/**
 * fetch失敗を、一般ユーザーにも意味が分かる日本語メッセージへ変換する。
 *
 * - Backendが返した detail (ApiError.message) は、Backend側で既に内部例外の
 *   スタックトレースやUNC内部情報を含まない安全な文言に変換済みなので、
 *   そのまま context と組み合わせて表示してよい (app/services/data_source.py参照)。
 * - fetch自体が失敗した場合 (ネットワーク断・CORS・接続拒否等) は、ブラウザが
 *   投げる "Failed to fetch" 等の生の文言をそのままユーザーへ見せず、
 *   「何を取得しようとして失敗したか」が伝わる文言に置き換える。
 */
export function describeFetchError(e: unknown, context: string): string {
  if (e instanceof ApiError) {
    return `${context}: ${e.message}`
  }
  return `${context}: サーバーに接続できませんでした。Backendが起動しているか、しばらくしてから再読み込みしてください。`
}
