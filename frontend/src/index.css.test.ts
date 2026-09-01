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

  it('keeps the root font-size at 14px (高密度UIを維持する。19章)', () => {
    expect(getComputedStyle(document.documentElement).fontSize).toBe('14px')
  })
})
