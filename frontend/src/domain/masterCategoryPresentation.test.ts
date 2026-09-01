import { describe, expect, it } from 'vitest'
import {
  MASTER_CATEGORY_PRESENTATION,
  getCategoryPresentation,
  toCssVars,
} from './masterCategoryPresentation'

// 半角カタカナ・半角中点の判定 (Phase 1.10 UI改修指示8章: 全角表記へ統一する)。
// U+FF61〜U+FF9F は半角カナ+半角句読点のブロック。
const HALF_WIDTH_KANA_RANGE = /[｡-ﾟ]/

describe('MASTER_CATEGORY_PRESENTATION (Phase 1.10/1.11)', () => {
  it('has exactly 13 entries, matching the backend ALLOWED_CATEGORIES count', () => {
    expect(MASTER_CATEGORY_PRESENTATION).toHaveLength(13)
  })

  it('keeps the business-specified display order (0-indexed, matching the tab order)', () => {
    expect(MASTER_CATEGORY_PRESENTATION.map((p) => p.order)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ])
    expect(MASTER_CATEGORY_PRESENTATION.map((p) => p.label)).toEqual([
      '箱・単独',
      '箱・左右',
      '箱・中',
      '内部パネル',
      '底板',
      '盤間の仕切・遮蔽',
      '附属品加算価格',
      '箱体価格倍率',
      'パネル',
      'OPA用アングル枠',
      '金網',
      '入力（主回路銅帯）',
      '銅帯',
    ])
  })

  it('every display label is fully full-width (no half-width kana/punctuation remains, 指示書8章)', () => {
    for (const p of MASTER_CATEGORY_PRESENTATION) {
      expect(p.label).not.toMatch(HALF_WIDTH_KANA_RANGE)
    }
  })

  it('keeps the internal value untouched (may still contain half-width forms) as a distinct field from label (指示書9章)', () => {
    const byLabel = new Map(MASTER_CATEGORY_PRESENTATION.map((p) => [p.label, p]))
    expect(byLabel.get('内部パネル')!.internal).toBe('内部ﾊﾟﾈﾙ')
    expect(byLabel.get('パネル')!.internal).toBe('ﾊﾟﾈﾙ')
    expect(byLabel.get('OPA用アングル枠')!.internal).toBe('OPA用ｱﾝｸﾞﾙ枠')
    expect(byLabel.get('箱・単独')!.internal).toBe('箱･単独')
  })

  it('assigns every one of the 13 categories a unique color, with no two categories sharing a tabBorder/bboxBorder (Phase 1.11 指示書1章)', () => {
    const tabBorders = MASTER_CATEGORY_PRESENTATION.map((p) => p.colors.tabBorder)
    const bboxBorders = MASTER_CATEGORY_PRESENTATION.map((p) => p.colors.bboxBorder)
    expect(new Set(tabBorders).size).toBe(13)
    expect(new Set(bboxBorders).size).toBe(13)
  })

  it('provides all color roles needed by tab / BBox / leader line, without any role left as an empty value', () => {
    for (const p of MASTER_CATEGORY_PRESENTATION) {
      expect(p.colors.tabBg).toBeTruthy()
      expect(p.colors.tabBorder).toBeTruthy()
      expect(p.colors.tabFg).toBeTruthy()
      expect(p.colors.bboxBorder).toBeTruthy()
      expect(p.colors.bboxFill).toBeTruthy()
      expect(p.colors.leaderColor).toBeTruthy()
      expect(p.colors.leaderTextColor).toBeTruthy()
    }
  })

  it('uses a low-alpha rgba for bboxFill so the underlying drawing stays readable', () => {
    for (const p of MASTER_CATEGORY_PRESENTATION) {
      const alpha = Number(p.colors.bboxFill.match(/[\d.]+\)$/)?.[0].replace(')', ''))
      expect(alpha).toBeGreaterThan(0)
      expect(alpha).toBeLessThanOrEqual(0.2)
    }
  })
})

describe('getCategoryPresentation', () => {
  it('resolves the exact internal value to its presentation', () => {
    const p = getCategoryPresentation('内部ﾊﾟﾈﾙ')
    expect(p.label).toBe('内部パネル')
  })

  it('falls back gracefully for an unknown category, without crashing (回帰確認)', () => {
    const p = getCategoryPresentation('想定外の品名')
    expect(p.label).toBe('想定外の品名')
    expect(p.colors.tabBg).toBeTruthy()
  })

  it('falls back gracefully for null/undefined (AI Detectionにはmaster_item_categoryが無い。Phase 1.11)', () => {
    expect(getCategoryPresentation(null).colors.bboxBorder).toBeTruthy()
    expect(getCategoryPresentation(undefined).colors.bboxBorder).toBeTruthy()
  })
})

describe('toCssVars', () => {
  it('maps every color role to a CSS custom property (Phase 1.11 指示書30章: HEX/RGB値をCSSへ重複記述しない)', () => {
    const p = getCategoryPresentation('箱･単独')
    const vars = toCssVars(p.colors)
    expect(vars['--cat-tab-bg']).toBe(p.colors.tabBg)
    expect(vars['--cat-tab-border']).toBe(p.colors.tabBorder)
    expect(vars['--cat-tab-fg']).toBe(p.colors.tabFg)
    expect(vars['--cat-bbox-border']).toBe(p.colors.bboxBorder)
    expect(vars['--cat-bbox-fill']).toBe(p.colors.bboxFill)
    expect(vars['--cat-leader-color']).toBe(p.colors.leaderColor)
    expect(vars['--cat-leader-text']).toBe(p.colors.leaderTextColor)
  })
})
