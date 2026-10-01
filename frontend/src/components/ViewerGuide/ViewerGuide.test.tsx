import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ViewerGuide } from './ViewerGuide'

describe('ViewerGuide (Issue #31, Issue #40 Phase 6-Cで新ワークフローへ更新)', () => {
  it('renders the new 6-step workflow before the operation quick-reference', () => {
    render(<ViewerGuide />)

    expect(screen.getByRole('heading', { name: '操作ガイド', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '基本の流れ', level: 3 })).toBeInTheDocument()

    for (const step of [
      '図面情報を選ぶ',
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
    expect(screen.getByText('図面情報で項目選択 → 図面上を左drag')).toBeInTheDocument()
  })

  it('renders the screen-role quick reference, listing 図面情報 first and noting 部品台帳 is auxiliary', () => {
    render(<ViewerGuide />)

    expect(screen.getByRole('heading', { name: '画面を見る', level: 3 })).toBeInTheDocument()
    for (const [name, description] of [
      ['図面情報', '図面上で見えている根拠'],
      ['盤情報', '盤の寸法・型式'],
      ['積算集約', '数量・金額の集計'],
      ['積算明細', 'BBox単位の根拠'],
      ['部品台帳', '補助'],
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument()
      expect(screen.getByText(new RegExp(description))).toBeInTheDocument()
    }
  })

  it('points to the user guide for full details, without embedding its full content', () => {
    render(<ViewerGuide />)
    expect(screen.getByText('詳しい操作方法はユーザーガイドを参照')).toBeInTheDocument()
  })
})
