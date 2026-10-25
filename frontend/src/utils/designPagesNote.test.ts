import { describe, expect, it } from 'vitest'
import { designPagesFallbackNote } from './designPagesNote'

describe('designPagesFallbackNote', () => {
  it('is null before loading and when the design.csv list is usable', () => {
    expect(designPagesFallbackNote(null)).toBeNull()
    const item = { key: '1', page_label: '1', drawing_name: 'a', mode: 'preview' as const, inference_page_no: null, ban_labels: [] }
    expect(designPagesFallbackNote({ status: 'ok', items: [item], skipped_rows: 0 })).toBeNull()
  })

  it.each([
    ['missing', 'design.csv がないため、従来の図面一覧を表示しています'],
    ['invalid', 'design.csv を読み込めないため、従来の図面一覧を表示しています'],
    ['empty', 'design.csv に表示できる図面がないため、従来の図面一覧を表示しています'],
  ] as const)('uses a fixed message for %s', (status, message) => {
    expect(designPagesFallbackNote({ status, items: [], skipped_rows: 0 })).toBe(message)
  })

  it('treats status ok with no rows like empty', () => {
    expect(designPagesFallbackNote({ status: 'ok', items: [], skipped_rows: 3 })).toBe(
      'design.csv に表示できる図面がないため、従来の図面一覧を表示しています',
    )
  })
})