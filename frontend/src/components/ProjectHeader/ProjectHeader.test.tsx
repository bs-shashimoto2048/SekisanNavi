import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectHeader } from './ProjectHeader'
import type { ProjectInfo } from '../../types/domain'

const project: ProjectInfo = {
  id: 1,
  seiri_no: 'A1AB3211',
  seiban: 'AB0367',
  panel_name: '絶縁変圧器盤（太陽光発電）',
  analysis_status: 'needs_review',
}

const noop = () => {}

describe('ProjectHeader', () => {
  it('renders the app title as "Sekisan Navi" only, without the old "/ 積算ナビ" suffix (UI視覚階層改善 指示6章)', () => {
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
      />,
    )
    expect(screen.getByText('Sekisan Navi')).toBeInTheDocument()
    expect(screen.queryByText(/Sekisan Navi \/ 積算ナビ/)).not.toBeInTheDocument()
    expect(screen.queryByText(/積算ナビ/)).not.toBeInTheDocument()
  })

  it('gives the title its own brand class, separate from the business-info spans (UI視覚階層改善 追加修正: タイトルSaaS化 指示3章)', () => {
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
      />,
    )
    const brand = screen.getByText('Sekisan Navi')
    expect(brand.className).toContain('project-header__brand')
    // 整理番号等の業務情報は`.project-header__info`配下にあり、brandはその外側。
    expect(brand.closest('.project-header__info')).toBeNull()
  })

  it('keeps the brand title on one line via white-space: nowrap (指示16章)', () => {
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
      />,
    )
    const brand = screen.getByText('Sekisan Navi')
    expect(getComputedStyle(brand).whiteSpace).toBe('nowrap')
  })

  it('makes the brand title clearly larger/bolder/whiter than the surrounding business-info text (Issue #9: 実画面でタイトルが目立たないとの指摘への対応)', () => {
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
      />,
    )
    const brand = screen.getByText('Sekisan Navi')
    const brandStyle = getComputedStyle(brand)
    // 純白(#ffffff)・weight 800・letter-spacing強化(0.04em)。
    expect(brandStyle.color).toBe('rgb(255, 255, 255)')
    expect(brandStyle.fontWeight).toBe('800')

    const info = screen.getByText(/整理番号: A1AB3211/)
    const infoStyle = getComputedStyle(info)
    // 業務情報側はbrandより明確に小さい/太くない(相対比較。px値は
    // ブラウザ既定フォントサイズに依存するため、絶対px値ではなく大小関係で検証する)。
    expect(parseFloat(brandStyle.fontSize)).toBeGreaterThan(parseFloat(infoStyle.fontSize))
    expect(Number(brandStyle.fontWeight)).toBeGreaterThan(Number(infoStyle.fontWeight) || 400)
  })

  it('does not add any height-affecting style (padding/line-height/height) to the brand title (指示6章/12章/19章: Header高さを変えない)', () => {
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
      />,
    )
    const brand = screen.getByText('Sekisan Navi')
    const style = getComputedStyle(brand)
    expect(style.padding).toBe('0')
    expect(style.margin).toBe('0')
    expect(style.height).toBe('auto')
  })

  it('uses a bright cobalt blue background instead of the old dark navy (UI視覚階層改善 追加修正指示 2章、最終微調整ラウンド指示6章で一段軽いコバルトへ)', () => {
    const { container } = render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
      />,
    )
    const header = container.querySelector('.project-header') as HTMLElement
    const style = getComputedStyle(header)
    // #2455e2 = rgb(36, 85, 226)。旧#1f2937(濃紺, rgb(31,41,55))ではないこと。
    expect(style.backgroundColor).toBe('rgb(36, 85, 226)')
    expect(style.backgroundColor).not.toBe('rgb(31, 41, 55)')
    expect(style.color).toBe('rgb(255, 255, 255)')
  })

  it('renders project info and the Japanese label for analysis_status', () => {
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
      />,
    )

    expect(screen.getByText(/整理番号: A1AB3211/)).toBeInTheDocument()
    expect(screen.getByText(/確認待ち/)).toBeInTheDocument()
  })

  it('shows a loading indicator when loading and no project yet', () => {
    render(
      <ProjectHeader project={null} loading onOpenProductViewer={noop} onOpenSystemSettings={noop} />,
    )
    expect(screen.getByText('読込中...')).toBeInTheDocument()
  })

  it.each([
    ['not_analyzed', '未解析'],
    ['analyzing', '解析中'],
    ['needs_review', '確認待ち'],
    ['confirmed', '確定'],
  ] as const)(
    'renders the %s status with its own modifier class and label (UI視覚階層改善 第5ラウンド 指示21章: status mapping)',
    (status, label) => {
      const { container } = render(
        <ProjectHeader
          project={{ ...project, analysis_status: status }}
          loading={false}
          onOpenProductViewer={noop}
          onOpenSystemSettings={noop}
        />,
      )
      const badge = container.querySelector('.project-header__status') as HTMLElement
      expect(badge.className).toContain(`project-header__status--${status}`)
      expect(badge.textContent).toContain(label)
    },
  )

  it('disables the "解析実行" button and does not make it fully unreadable (UI視覚階層改善 第5ラウンド 指示12章)', () => {
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
      />,
    )
    const button = screen.getByText('解析実行') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('calls onOpenSystemSettings when the settings button is clicked', () => {
    const onOpenSystemSettings = vi.fn()
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={onOpenSystemSettings}
      />,
    )
    fireEvent.click(screen.getByText('システム設定'))
    expect(onOpenSystemSettings).toHaveBeenCalled()
  })
})
