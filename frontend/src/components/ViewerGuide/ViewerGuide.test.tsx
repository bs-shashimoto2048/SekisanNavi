import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ViewerGuide } from './ViewerGuide'

describe('ViewerGuide (Issue #31)', () => {
  it('renders the heading and main operation quick-reference rows', () => {
    render(<ViewerGuide />)

    expect(screen.getByRole('heading', { name: '操作ガイド', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '基本操作', level: 3 })).toBeInTheDocument()

    expect(screen.getByText('拡大・縮小')).toBeInTheDocument()
    expect(screen.getByText('マウスホイール')).toBeInTheDocument()
    expect(screen.getByText('図面移動')).toBeInTheDocument()
    expect(screen.getByText('ホイール押し込み + drag')).toBeInTheDocument()
    expect(screen.getByText('BBox追加')).toBeInTheDocument()
    expect(screen.getByText('部品台帳で部品選択 → 図面上を左drag')).toBeInTheDocument()
  })

  it('renders the screen-role quick reference for the other 4 floating panels', () => {
    render(<ViewerGuide />)

    expect(screen.getByRole('heading', { name: '画面を見る', level: 3 })).toBeInTheDocument()
    for (const [name, description] of [
      ['盤情報', '盤の寸法・型式'],
      ['積算集約', '数量・金額の集計'],
      ['積算明細', 'BBox単位の根拠'],
      ['部品台帳', 'BBoxへ割り当てる部品を選択'],
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
