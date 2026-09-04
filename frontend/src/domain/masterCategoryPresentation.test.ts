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

  it('assigns every category a unique tabBg/tabFg too, with no duplicate tab presentation (UI視覚階層改善 追加修正指示 14章/28章)', () => {
    const tabBgs = MASTER_CATEGORY_PRESENTATION.map((p) => p.colors.tabBg)
    const tabFgs = MASTER_CATEGORY_PRESENTATION.map((p) => p.colors.tabFg)
    expect(new Set(tabBgs).size).toBe(13)
    expect(new Set(tabFgs).size).toBe(13)
  })

  it('assigns every category a unique tabActiveBg, each stronger than its own tabBg (UI視覚階層改善 追加修正第2ラウンド 6章/22章)', () => {
    const tabActiveBgs = MASTER_CATEGORY_PRESENTATION.map((p) => p.colors.tabActiveBg)
    expect(new Set(tabActiveBgs).size).toBe(13)
    for (const p of MASTER_CATEGORY_PRESENTATION) {
      expect(p.colors.tabActiveBg).not.toBe(p.colors.tabBg)
      expect(p.colors.tabActiveBg).toBeTruthy()
    }
  })

  it('uses white as tabActiveFg for every category (UI視覚階層改善 追加修正第4ラウンド 18章)', () => {
    for (const p of MASTER_CATEGORY_PRESENTATION) {
      expect(p.colors.tabActiveFg.toLowerCase()).toBe('#fff')
    }
  })

  it('darkens tabActiveBg enough for white text to stay readable (概ねWCAG AA 4.5:1以上, 追加修正第4ラウンド 6章/7章/8章)', () => {
    // WCAG 2.x の相対輝度・コントラスト比計算をそのまま実装し、白文字(#fff)との
    // コントラスト比を検証する。厳密な認証目的ではなく、「肉眼で明確に読める」
    // ことの客観的な下限チェックとして使う(指示8章)。
    function hexToRgb(hex: string) {
      const n = parseInt(hex.replace('#', ''), 16)
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
    }
    function relLum({ r, g, b }: { r: number; g: number; b: number }) {
      const f = (c: number) => {
        c /= 255
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    function contrastWithWhite(hex: string) {
      const L = relLum(hexToRgb(hex))
      return (1.0 + 0.05) / (L + 0.05)
    }

    for (const p of MASTER_CATEGORY_PRESENTATION) {
      const ratio = contrastWithWhite(p.colors.tabActiveBg)
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps bboxBorder/bboxFill/leaderColor/leaderTextColor untouched by the tab color strengthening (指示23章/24章: BBox/引出線色は変更しない)', () => {
    // 旧来のbboxBorder値(Manual BBox/引出線が参照する「純色」)がそのまま残っている
    // ことを確認する。これはタブ色強化の基準としても再利用した値そのもの。
    const byLabel = new Map(MASTER_CATEGORY_PRESENTATION.map((p) => [p.label, p]))
    expect(byLabel.get('箱・単独')!.colors.bboxBorder).toBe('#2a73bb')
    expect(byLabel.get('内部パネル')!.colors.bboxBorder).toBe('#2abb73')
    expect(byLabel.get('銅帯')!.colors.bboxBorder).toBe('#a6503f')
    expect(byLabel.get('箱・単独')!.colors.bboxFill).toBe('rgba(41, 127, 214, 0.14)')
    expect(byLabel.get('箱・単独')!.colors.leaderColor).toBe('#2a73bb')
    expect(byLabel.get('箱・単独')!.colors.leaderTextColor).toBe('#184c81')
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
