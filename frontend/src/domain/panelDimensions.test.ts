import { describe, expect, it } from 'vitest'
import {
  isOutlineFrontRow,
  isSetDimension,
  resolvePanelDimensions,
  selectOutlineFrontPanels,
} from './panelDimensions'
import type { PanelPreview, ProductDrawing } from '../types/domain'

function panel(overrides: Partial<PanelPreview>): PanelPreview {
  return {
    page_no: 8,
    ban_menno: 1,
    ban_no: 1,
    ban_meisyou: '高圧受電盤',
    ban_type: '正面図',
    ban_h1: 2365,
    ban_h2: 2275,
    ban_w: 900,
    ban_d: 2000,
    normalized_rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
    ...overrides,
  }
}

function drawing(page_no: number, drawing_name: string | null, panels: PanelPreview[]): ProductDrawing {
  return { page_no, thumbnail_url: '', drawing_type: null, drawing_name, panels }
}

const zeroEstimate = { ban_h: 0, ban_w: 0, ban_d: 0 }

describe('isSetDimension: 0・負数・欠損は未設定', () => {
  it('accepts only finite positive numbers', () => {
    expect(isSetDimension(900)).toBe(true)
    expect(isSetDimension(0)).toBe(false)
    expect(isSetDimension(-1)).toBe(false)
    expect(isSetDimension(Number.NaN)).toBe(false)
    expect(isSetDimension(null)).toBe(false)
    expect(isSetDimension(undefined)).toBe(false)
  })
})

describe('selectOutlineFrontPanels: 補完元は「ZUMEIに外形図を含み、BAN_TYPEが正面図」の行だけ', () => {
  const drawings = [
    drawing(11, '内部機器配置図(1-1)', [panel({ page_no: 11 })]), // 外形図ではない → 対象外
    drawing(9, '外形図(2)', [panel({ page_no: 9, ban_type: '背面図' })]), // 正面図ではない → 対象外
    drawing(8, '外形図(1)', [
      panel({ page_no: 8, ban_type: '左側面図' }), // 正面図ではない → 対象外
      panel({ page_no: 8, ban_type: '正面図', ban_w: 1000 }),
    ]),
    drawing(10, null, [panel({ page_no: 10 })]), // 図面名なし → 対象外
  ]

  it('keeps only front-view rows of drawings whose name contains 外形図', () => {
    const rows = selectOutlineFrontPanels(drawings)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ page_no: 8, ban_type: '正面図', ban_w: 1000 })
  })

  it('orders candidates by page number so the adopted row is deterministic regardless of input order', () => {
    const rows = selectOutlineFrontPanels([
      drawing(20, '外形図(B)', [panel({ page_no: 20, ban_w: 2 })]),
      drawing(8, '外形図(A)', [panel({ page_no: 8, ban_w: 1 })]),
    ])
    expect(rows.map((r) => r.page_no)).toEqual([8, 20])
  })

  it('isOutlineFrontRow checks both conditions', () => {
    expect(isOutlineFrontRow('外形図(1)', '正面図')).toBe(true)
    expect(isOutlineFrontRow('内部機器配置図', '正面図')).toBe(false)
    expect(isOutlineFrontRow('外形図(1)', '背面図')).toBe(false)
    expect(isOutlineFrontRow(null, '正面図')).toBe(false)
  })
})

describe('resolvePanelDimensions', () => {
  const source = [panel({})]

  it('uses the 外形図・正面図 row when estcode_df dimensions are missing (null)', () => {
    const d = resolvePanelDimensions(1, 1, { ban_h: null, ban_w: null, ban_d: null }, source)
    expect(d).toMatchObject({ frontHeight: 2365, backHeight: 2275, width: 900, depth: 2000, fallbackHeight: null })
  })

  it('treats estcode_df 0 as unset (confirmed on A1GE4568) and uses the product_df row', () => {
    const d = resolvePanelDimensions(1, 1, zeroEstimate, source)
    expect(d).toMatchObject({ frontHeight: 2365, backHeight: 2275, width: 900, depth: 2000, fallbackHeight: null })
  })

  it('keeps a positive estcode_df width/depth over the product_df row', () => {
    const d = resolvePanelDimensions(1, 1, { ban_h: 0, ban_w: 1700, ban_d: 2200 }, source)
    expect(d.width).toBe(1700)
    expect(d.depth).toBe(2200)
  })

  it('resolves height, width and depth independently when only some are missing', () => {
    // estcode は幅だけ設定済み。product_df の外形図・正面図は奥行と背面高さだけ正の値。
    const partial = [panel({ ban_h1: null, ban_h2: 2275, ban_w: 0, ban_d: 2000 })]
    const d = resolvePanelDimensions(1, 1, { ban_h: 0, ban_w: 1700, ban_d: 0 }, partial)
    expect(d).toMatchObject({ frontHeight: null, backHeight: 2275, width: 1700, depth: 2000 })
  })

  it('fills each item from the first row (by page order) that has a positive value for it', () => {
    const rows = [
      panel({ page_no: 8, ban_w: 0, ban_d: 1800 }),
      panel({ page_no: 20, ban_w: 950, ban_d: 2500 }),
    ]
    const d = resolvePanelDimensions(1, 1, null, rows)
    expect(d.width).toBe(950) // 先頭行は0なので次の行の正の値
    expect(d.depth).toBe(1800) // 先頭行の正の値を採用(後続行で上書きしない)
  })

  it('uses estcode_df BAN_H as the height only when product_df has no height', () => {
    const none = [panel({ ban_h1: null, ban_h2: null })]
    expect(resolvePanelDimensions(1, 1, { ban_h: 2450, ban_w: 0, ban_d: 0 }, none).fallbackHeight).toBe(2450)
    expect(resolvePanelDimensions(1, 1, { ban_h: 0, ban_w: 0, ban_d: 0 }, none).fallbackHeight).toBeNull()
  })

  it('returns nothing (no guessing) when there is no matching 外形図・正面図 row, and never uses another panel', () => {
    const other = [panel({ ban_menno: 2, ban_no: 2, ban_w: 1100 })]
    const d = resolvePanelDimensions(1, 1, zeroEstimate, other)
    expect(d).toEqual({ frontHeight: null, backHeight: null, fallbackHeight: null, width: null, depth: null })
    expect(resolvePanelDimensions(1, 1, zeroEstimate, [])).toMatchObject({ width: null, depth: null })
  })

  it('matches by both ban_menno and ban_no, and never matches a panel without ban_no', () => {
    const rows = [panel({ ban_menno: 1, ban_no: 2, ban_w: 1234 })] // 面は同じだが盤番号が違う
    expect(resolvePanelDimensions(1, 1, null, rows).width).toBeNull()
    expect(resolvePanelDimensions(1, null, null, rows).width).toBeNull()
    expect(resolvePanelDimensions(1, 2, null, rows).width).toBe(1234)
  })
})
