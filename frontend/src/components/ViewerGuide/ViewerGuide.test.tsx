import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ViewerGuide } from './ViewerGuide'

describe('ViewerGuide (Issue #31, Issue #40 Phase 6-Cで新ワークフローへ更新)', () => {
  it('renders the new 6-step workflow before the operation quick-reference', () => {
    render(<ViewerGuide />)

    expect(screen.getByRole('heading', { name: '操作ガイド', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '基本の流れ', level: 3 })).toBeInTheDocument()

    for (const step of [
      '図面情報追加で項目を選ぶ',
      '図面を囲む',
      '積算結果を確認',
      '必要なら数量/係数を修正',
      '要確認を解消',
      '確定',
    ]) {
      expect(screen.getByText(step)).toBeInTheDocument()
    }
  })

  it('renders the main operation quick-reference rows, with BBox追加 pointing to 図面情報 (not 部品台帳)', () => {
    render(<ViewerGuide />)

    expect(screen.getByRole('heading', { name: '基本操作', level: 3 })).toBeInTheDocument()

    expect(screen.getByText('拡大・縮小')).toBeInTheDocument()
    expect(screen.getByText('マウスホイール')).toBeInTheDocument()
    expect(screen.getByText('図面移動')).toBeInTheDocument()
    expect(screen.getByText('ホイール押し込み + drag')).toBeInTheDocument()
    expect(screen.getByText('BBox追加')).toBeInTheDocument()
    expect(screen.getByText('図面情報追加で項目選択 → 図面上を左drag')).toBeInTheDocument()
  })

  it('renders the screen-role quick reference using the current header button names (図面情報/図面情報追加/積算集約/積算明細/部品台帳), in header order', () => {
    const { container } = render(<ViewerGuide />)

    expect(screen.getByRole('heading', { name: '画面を見る', level: 3 })).toBeInTheDocument()
    const items = Array.from(container.querySelectorAll('.viewer-guide__screen-list li'))
    expect(items.map((li) => li.querySelector('strong')?.textContent)).toEqual([
      '図面情報',
      '図面情報追加',
      '積算集約',
      '積算明細',
      '部品台帳',
    ])
    const descriptionByName = new Map(
      items.map((li) => [li.querySelector('strong')?.textContent, li.textContent ?? '']),
    )
    expect(descriptionByName.get('図面情報')).toContain('盤の寸法・型式')
    expect(descriptionByName.get('図面情報追加')).toContain('図面上で見えている根拠')
    expect(descriptionByName.get('積算集約')).toContain('数量・金額の集計')
    expect(descriptionByName.get('積算明細')).toContain('BBox単位の根拠')
    expect(descriptionByName.get('部品台帳')).toContain('補助')
  })

  it('no longer shows the former panel name 盤情報 anywhere (旧ボタン名。図面情報へ改名済み)', () => {
    const { container } = render(<ViewerGuide />)
    expect(container.textContent).not.toContain('盤情報')
  })

  it('points to the user guide for full details, without embedding its full content', () => {
    render(<ViewerGuide />)
    expect(screen.getByText('詳しい操作方法はユーザーガイドを参照')).toBeInTheDocument()
  })
})
