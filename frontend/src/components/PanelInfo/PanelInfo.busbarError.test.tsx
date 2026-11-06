import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PanelInfo } from './PanelInfo'
import type { PanelPreview } from '../../types/domain'

// 銅帯欄(BusbarSelector)の描画で例外が起きても、画面全体が白くならず、
// 図面情報・寸法行・他の面が残ることを確認する(Error Boundaryの回帰テスト)。
const control = vi.hoisted(() => ({ failFace: null as string | null }))

vi.mock('../BusbarSelector/BusbarSelector', () => ({
  BusbarSelector: ({ faceLabel }: { faceLabel: string }) => {
    if (control.failFace === faceLabel) throw new Error(`銅帯欄の描画に失敗(面${faceLabel})`)
    return <section aria-label={`面${faceLabel} 主回路銅帯`}>面{faceLabel}の銅帯欄</section>
  },
}))

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

function renderPanelInfo() {
  return render(
    <PanelInfo
      panel={null}
      panels={[
        makePanel({ ban_menno: 1, ban_no: 1, ban_meisyou: 'パネルA' }),
        makePanel({ ban_menno: 2, ban_no: 2, ban_meisyou: 'パネルB' }),
      ]}
      estimatePanels={[]}
      productNo="TESTBUSBAR"
      selectedPanel={null}
      onSelectPanel={() => {}}
    />,
  )
}

describe('PanelInfo: 銅帯欄の描画例外(Error Boundary)', () => {
  beforeEach(() => {
    control.failFace = null
    window.localStorage.clear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the heading, every dimension row and the other faces when one face busbar section throws, and shows a recovery message', () => {
    control.failFace = '1'
    renderPanelInfo()

    // 画面は残り、寸法行は両方表示されたまま。
    expect(screen.getByRole('heading', { name: /図面情報/ })).toBeInTheDocument()
    for (const name of ['パネルA', 'パネルB']) {
      const row = screen.getByText(name).closest('button') as HTMLElement
      expect(row).toBeVisible()
      expect(within(row).getAllByRole('cell')).toHaveLength(6)
    }
    // 例外が起きた面1だけが、エラー表示(再試行ボタン付き)に置き換わる。他の面は正常。
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('面1の銅帯欄を表示できません')
    expect(alert).toHaveTextContent('保存済みの銅帯設定は消していません')
    expect(within(alert).getByRole('button', { name: '再試行' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '面2 主回路銅帯' })).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    // 例外の詳細は開発者向けログに残る。
    expect(console.error).toHaveBeenCalledWith(
      '[ErrorBoundary:busbar-face-1]',
      expect.objectContaining({ message: '銅帯欄の描画に失敗(面1)' }),
      expect.any(String),
    )
  })

  it('does not touch saved busbar data, still folds other faces, and recovers on retry once the cause is gone', () => {
    const saved = JSON.stringify({ TESTBUSBAR: { '1': [{ id: 'row-1', selection: { spec: null, phase: null, voltage: null, kva: null } }] } })
    window.localStorage.setItem('sekisan-navi:busbar-selections:v1', saved)
    control.failFace = '1'
    renderPanelInfo()

    // 面2の折りたたみは、面1がエラー表示でも独立して動く(寸法行は残る)。
    fireEvent.click(screen.getByRole('button', { name: '面2の銅帯設定を閉じる' }))
    expect(screen.queryByRole('region', { name: '面2 主回路銅帯' })).not.toBeInTheDocument()
    expect(screen.getByText('パネルA').closest('button')).toBeVisible()
    expect(screen.getByText('パネルB').closest('button')).toBeVisible()
    // 保存データは変更・削除されていない。
    expect(window.localStorage.getItem('sekisan-navi:busbar-selections:v1')).toBe(saved)

    // 原因が解消した後に「再試行」を押すと、面1の銅帯欄が戻る。
    control.failFace = null
    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '面1 主回路銅帯' })).toBeInTheDocument()
  })
})
