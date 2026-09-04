// index.cssは通常main.tsx経由でのみ読み込まれ、他のコンポーネントテストは
// 個々のコンポーネントを直接renderするためこのグローバルスタイルを経由しない。
// Phase 1.10 UI改修指示16章/17章の「UI全体のfont-family変更」を実際にCSSカスケードで
// 検証するテストのためだけに、ここで明示的にimportする。
import './index.css'
import { describe, expect, it } from 'vitest'

describe('index.css (Phase 1.10 UI改修指示16章/17章: UI全体のfont-family)', () => {
  it(':root(documentElement) uses a Windows日本語UI向けのsystem font stackを優先する', () => {
    const fontFamily = getComputedStyle(document.documentElement).fontFamily
    // Webフォントの新規配信は行わず(17章)、OS/ブラウザ既存フォントのみのstackとする。
    expect(fontFamily).toContain('Yu Gothic UI')
    expect(fontFamily).toContain('Meiryo UI')
    expect(fontFamily).toContain('Segoe UI')
    // 優先順位: Yu Gothic UI が先頭であること (日本語UI向け字面で可読性を優先)。
    expect(fontFamily.split(',')[0]).toContain('Yu Gothic UI')
  })

  it('raises the root font-size to 15px (全体フォント拡大・BBox編集追従回帰修正 指示1章: remベースの全CSSを一括で底上げする土台)', () => {
    expect(getComputedStyle(document.documentElement).fontSize).toBe('15px')
  })
})

describe('index.css: Status palette token (UI視覚階層改善 第5ラウンド〜最終微調整ラウンド)', () => {
  function token(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  }

  it('maps confirmed(success) to a green, distinct from Structure cobalt and Category colors', () => {
    expect(token('--status-success')).toBe('#15803d')
  })

  it('maps needs_review/pending(warning) to an amber family, not blue (Structureとの衝突を避ける)', () => {
    // UI配色 最終微調整ラウンド 指示1章〜3章: 「確認待ち」は濃色+白文字(旧
    // --status-warning-strong-bg)から淡色chip(--status-warning-chip-*)へ
    // 差し替えた。--status-warning-accent(要確認)は引き続き#b45309のまま
    // (指示5章: 確認待ちと要確認は同じamber系統だが強度を変えてよい)。
    expect(token('--status-warning-chip-bg')).toBe('#fef3c7')
    expect(token('--status-warning-chip-border')).toBe('#f59e0b')
    expect(token('--status-warning-accent')).toBe('#b45309')
    expect(token('--status-warning-text')).toBe('#92400e')
  })

  it('maps excluded(error) to a single red, not two different reds (旧#991b1b/#b91c1cの統合)', () => {
    expect(token('--status-error')).toBe('#b91c1c')
  })

  it('maps analyzing/not_analyzed(neutral/disabled) to gray, not blue (Structureのコバルトと衝突しない)', () => {
    const neutral = token('--status-neutral')
    const neutralSoft = token('--status-neutral-soft')
    expect(neutral).toBe('#4b5563')
    expect(neutralSoft).toBe('#6b7280')
    expect(neutral).not.toMatch(/^#1|^#2/) // 青系(#1d4ed8, #2563eb等)の頭文字ではないことの簡易確認
  })

  it('keeps the light warning chip background/text pair readable (概ねWCAG AA 4.5:1以上, 淡色chip+濃色文字)', () => {
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
    function contrast(hexA: string, hexB: string) {
      const [l1, l2] = [relLum(hexToRgb(hexA)), relLum(hexToRgb(hexB))].sort((a, b) => b - a)
      return (l1 + 0.05) / (l2 + 0.05)
    }
    const ratio = contrast(token('--status-warning-chip-bg'), token('--status-warning-text'))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})

describe('index.css: セル境界token (表セル境界の統一・ヘッダ左寄せ/数値セル右寄せ)', () => {
  function token(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  }

  it('defines --border-cell as a lighter tone than the region/table-outer borders (罫線階層: 大領域 > header境界 > セル境界)', () => {
    expect(token('--border-cell')).toBe('#edf1f5')
    // #edf1f5は#cbd5e1(--border-region/--border-table-outer)より明度が高い
    // (=より薄い)ことを簡易確認する。
    const cell = parseInt(token('--border-cell').replace('#', ''), 16)
    const tableOuter = parseInt(token('--border-table-outer').replace('#', ''), 16)
    expect(cell).toBeGreaterThan(tableOuter)
  })
})
