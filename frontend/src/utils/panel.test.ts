import { describe, expect, it } from 'vitest'
import { banGroupKey, panelKey } from './panel'
import type { PanelPreview } from '../types/domain'

function makePanel(overrides: Partial<PanelPreview> = {}): PanelPreview {
  return {
    page_no: 16,
    ban_menno: 1,
    ban_no: 1,
    ban_meisyou: '高圧受電盤',
    ban_type: '正面図',
    ban_h1: null,
    ban_h2: null,
    ban_w: null,
    ban_d: null,
    normalized_rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
    ...overrides,
  }
}

describe('panelKey', () => {
  it('is stable for the same panel/index', () => {
    const panel = makePanel()
    expect(panelKey(panel, 0)).toBe(panelKey(makePanel(), 0))
  })

  it('differs when page_no differs', () => {
    expect(panelKey(makePanel({ page_no: 16 }), 0)).not.toBe(panelKey(makePanel({ page_no: 18 }), 0))
  })

  it('differs when ban_type differs (same page/menno/no, different view)', () => {
    expect(panelKey(makePanel({ ban_type: '正面図' }), 0)).not.toBe(
      panelKey(makePanel({ ban_type: '背面図' }), 0),
    )
  })

  it('differs when index differs (tie-breaker for otherwise-identical rows)', () => {
    expect(panelKey(makePanel(), 0)).not.toBe(panelKey(makePanel(), 1))
  })
})

describe('banGroupKey (Phase 1.11 UI改修指示17章/18章: 同一盤の別矢視グループ化)', () => {
  it('is the same for the same PAGE/BAN_MENNO/BAN_NO regardless of BAN_TYPE (別矢視)', () => {
    const front = makePanel({ ban_type: '正面図' })
    const back = makePanel({ ban_type: '背面図' })
    const side = makePanel({ ban_type: '左側面図' })
    expect(banGroupKey(front)).toBe(banGroupKey(back))
    expect(banGroupKey(back)).toBe(banGroupKey(side))
  })

  it('differs when BAN_NO differs (different panel, 指示書18章)', () => {
    expect(banGroupKey(makePanel({ ban_no: 5 }))).not.toBe(banGroupKey(makePanel({ ban_no: 4 })))
  })

  it('differs when BAN_MENNO differs', () => {
    expect(banGroupKey(makePanel({ ban_menno: 5 }))).not.toBe(
      banGroupKey(makePanel({ ban_menno: 4 })),
    )
  })

  it('differs when PAGE differs (別矢視の連動ハイライトは同一ページ内に限る前提)', () => {
    expect(banGroupKey(makePanel({ page_no: 16 }))).not.toBe(
      banGroupKey(makePanel({ page_no: 18 })),
    )
  })
})
