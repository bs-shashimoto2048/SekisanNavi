import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { PanelInfo } from './PanelInfo'
import type { PanelPreview } from '../../types/domain'

// 2026-11 白画面事案の回帰テスト。
// 計測値(内容に必要な高さ)が、現在のパネルサイズに依存して2つの値の間を往復する状況
// (実機では一覧の縦スクロールバーの出入りで 1152px ↔ 1133px)で、
// 「計測 → 親へ報告 → 親が再描画(表示用プレビューでは毎回新しい空配列が渡る)→ 再計測」が
// 同期更新として連鎖し続けると、React が「Maximum update depth exceeded」を投げて
// アプリ全体が白くなる。jsdom はレイアウトを計算しないため、scrollHeight を差し替えて再現する。

function makePanel(overrides: Partial<PanelPreview>): PanelPreview {
  return {
    page_no: 16,
    ban_menno: 1,
    ban_no: 1,
    ban_meisyou: '盤',
    ban_type: '正面図',
    ban_h1: 2100,
    ban_h2: null,
    ban_w: 1900,
    ban_d: 1200,
    normalized_rect: { x: 0, y: 0, w: 0.1, h: 0.1 },
    ...overrides,
  }
}

const fallbackPanels = [
  makePanel({ ban_menno: 1, ban_no: 1, ban_meisyou: 'パネルA' }),
  makePanel({ ban_menno: 2, ban_no: 2, ban_meisyou: 'パネルB' }),
]

// 表示用プレビュー(design=01 など)と同じ条件: 親が再描画されるたびに、新しい空配列を
// `panels` / `estimatePanels` として渡す(参照が毎回変わる)。
function Host({ onReport }: { onReport: (size: { width: number; height: number }) => void }) {
  const [, setSize] = useState<{ width: number; height: number } | null>(null)
  return (
    <PanelInfo
      panel={null}
      panels={[]}
      fallbackPanels={fallbackPanels}
      estimatePanels={[]}
      productNo="LOOPTEST"
      selectedPanel={null}
      onSelectPanel={() => {}}
      onNaturalSizeChange={(size) => {
        onReport(size)
        setSize(size) // 実アプリでは App の state。更新が親の再描画を起こす
      }}
    />
  )
}

describe('PanelInfo: 自然サイズの計測値が往復しても更新が連鎖し続けない(白画面の回帰)', () => {
  let originalScrollHeight: PropertyDescriptor | undefined
  let measureCount = 0
  let heights: number[] = [1152, 1133]
  let now = 1000

  beforeEach(() => {
    window.localStorage.clear()
    measureCount = 0
    heights = [1152, 1133]
    now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    // .panel-info の計測のたびに、2つの値を交互に返す(パネルサイズ依存の往復を模擬)。
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.classList.contains('panel-info')) return 0
        const value = heights[measureCount % heights.length]
        measureCount += 1
        return value
      },
    })
  })
  afterEach(() => {
    if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight
    vi.restoreAllMocks()
  })

  it('does not throw "Maximum update depth exceeded" and settles on the larger value when the measured height oscillates', () => {
    const reports: Array<{ width: number; height: number }> = []
    // 例外(白画面)にならずに描画でき、報告は有限回で収束する。
    expect(() => render(<Host onReport={(s) => reports.push(s)} />)).not.toThrow()
    expect(reports.length).toBeGreaterThan(0)
    // 往復は「200ms以内に8回以上の報告」で検出され、React の同期更新の上限(50回)より手前で止まる。
    expect(reports.length).toBeLessThanOrEqual(12)
    // 往復した2値のうち大きい側で確定する(以降、小さい側へ戻さない)。
    expect(Math.max(...reports.map((r) => r.height))).toBe(1152)
    expect(reports[reports.length - 1].height).toBe(1152)
    // 画面(寸法行・見出し)は維持される。
    expect(screen.getByRole('heading', { name: /図面情報/ })).toBeInTheDocument()
    expect(screen.getByText('パネルA').closest('button')).toBeVisible()
  })

  it('keeps the dimension rows and folds a face without throwing while the measured height oscillates', () => {
    render(<Host onReport={() => {}} />)
    expect(() => fireEvent.click(screen.getByRole('button', { name: '面1の銅帯設定を閉じる' }))).not.toThrow()
    const row = screen.getByText('パネルA').closest('button') as HTMLElement
    expect(row).toBeVisible()
    expect(within(row).getAllByRole('cell')).toHaveLength(6)
    expect(screen.queryByRole('region', { name: '面1 主回路銅帯' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '面2 主回路銅帯' })).toBeInTheDocument()
  })

  it('follows the final state after a rapid burst of toggles (e.g. 3 clicks within ~60ms) instead of treating it as an oscillation', () => {
    // 利用者が同じ開閉ボタンを素早く3回押す: 展開(1000) → 折りたたみ(700) → 展開(1000) → 折りたたみ(700)。
    // 報告の間隔は約30msで、直前の値へ戻る変化も含むが、報告回数は数回なので往復とはみなさない。
    // (旧実装は200ms以内に1回でも直前値へ戻ると往復とみなし、最終の折りたたみ状態の高さ(700)を
    //  報告せず、展開時の高さ(1000)が残った。)
    heights = [1000, 1000, 700, 700, 1000, 1000, 700, 700]
    const reports: Array<{ width: number; height: number }> = []
    const { rerender } = render(<Host onReport={(s) => reports.push(s)} />)
    for (const step of [2, 4, 6]) {
      now += 30
      measureCount = step
      act(() => rerender(<Host onReport={(s) => reports.push(s)} />))
    }
    expect(reports.map((r) => r.height)).toEqual([1000, 700, 1000, 700])
    expect(reports[reports.length - 1].height).toBe(700)
  })

  it('still reports a genuine size change back to an earlier value when it happens well after the previous report', () => {
    heights = [1000, 1000, 800, 800, 1000, 1000] // 往復ではなく、利用者の操作で 1000 → 800 → 1000 と変わる
    const reports: Array<{ width: number; height: number }> = []
    const { rerender } = render(<Host onReport={(s) => reports.push(s)} />)
    expect(reports.map((r) => r.height)).toEqual([1000])

    // 200ms以上あとの変化は往復とみなさず、そのまま報告する(折りたたみ・展開の通常動作)。
    now += 1000
    measureCount = 2
    act(() => rerender(<Host onReport={(s) => reports.push(s)} />))
    now += 1000
    measureCount = 4
    act(() => rerender(<Host onReport={(s) => reports.push(s)} />))
    expect(reports.map((r) => r.height)).toEqual([1000, 800, 1000])
  })
})
