import { describe, expect, it } from 'vitest'
import { describeFetchError } from './errors'
import { ApiError } from './client'

describe('describeFetchError', () => {
  it('combines the context with the backend-provided (already user-safe) detail message', () => {
    const message = describeFetchError(new ApiError(503, 'データ参照ルートへのアクセスに失敗しました。'), '製番データの取得に失敗しました')
    expect(message).toBe('製番データの取得に失敗しました: データ参照ルートへのアクセスに失敗しました。')
  })

  it('replaces raw network-level errors (e.g. the browser "Failed to fetch" message) with a friendly message', () => {
    const message = describeFetchError(new TypeError('Failed to fetch'), '図面データを取得できませんでした')
    expect(message).toContain('図面データを取得できませんでした')
    expect(message).not.toContain('Failed to fetch')
  })

  it('does not leak raw error text for unknown thrown values', () => {
    const message = describeFetchError('some raw internal string', '積算結果の取得に失敗しました')
    expect(message).not.toContain('some raw internal string')
  })
})
