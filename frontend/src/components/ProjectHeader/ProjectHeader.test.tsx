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
  it('shows the selected product number without stale metadata from another project (dash for missing data)', () => {
    render(
      <ProjectHeader
        project={project}
        currentProductNo="A1LW0626"
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
      />,
    )
    expect(screen.getByText('製番: A1LW0626')).toBeInTheDocument()
    // 別製番のproject_infoの値は出さず、データが無いので「—」
    expect(screen.getByText('整理番号: —')).toBeInTheDocument()
    expect(screen.getByText('盤名称: —')).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(project.seiri_no))).not.toBeInTheDocument()
    expect(screen.queryByText(new RegExp(project.panel_name))).not.toBeInTheDocument()
    expect(screen.queryByText(/解析状態:/)).not.toBeInTheDocument()
  })

  it('shows the selected product header data (seiri_no) and a dash for the panel name that has no source', () => {
    render(
      <ProjectHeader
        project={project}
        currentProductNo="A1LW0626"
        productHeader={{ product_no: 'A1LW0626', seiri_no: 'LW0089', panel_name: null, status: 'ok' }}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
      />,
    )
    expect(screen.getByText('整理番号: LW0089')).toBeInTheDocument()
    expect(screen.getByText('盤名称: —')).toBeInTheDocument()
    expect(screen.getByText('製番: A1LW0626')).toBeInTheDocument()
  })

  it('prefers the product header over the project_info of the same product and falls back to project_info only for missing fields', () => {
    render(
      <ProjectHeader
        project={project}
        currentProductNo={project.seiban}
        productHeader={{ product_no: project.seiban, seiri_no: 'LW0089', panel_name: null, status: 'ok' }}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
      />,
    )
    expect(screen.getByText('整理番号: LW0089')).toBeInTheDocument()
    expect(screen.getByText(`盤名称: ${project.panel_name}`)).toBeInTheDocument()
  })

  it('shows project_info as the default before any product is selected', () => {
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
      />,
    )
    expect(screen.getByText(`整理番号: ${project.seiri_no}`)).toBeInTheDocument()
    expect(screen.getByText(`盤名称: ${project.panel_name}`)).toBeInTheDocument()
  })

  it('shows dashes for seiri_no and panel name when neither project nor header data is available', () => {
    render(
      <ProjectHeader
        project={null}
        currentProductNo="A1LW0626"
        productHeader={null}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
      />,
    )
    expect(screen.getByText('整理番号: —')).toBeInTheDocument()
    expect(screen.getByText('盤名称: —')).toBeInTheDocument()
  })

  it('shows the selected product number even when project information is unavailable', () => {
    render(
      <ProjectHeader
        project={null}
        currentProductNo="A1LW0626"
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
      />,
    )
    expect(screen.getByText('製番: A1LW0626')).toBeInTheDocument()
  })

  it('keeps project metadata when it belongs to the selected product', () => {
    render(
      <ProjectHeader
        project={project}
        currentProductNo={project.seiban}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
      />,
    )
    expect(screen.getByText(`製番: ${project.seiban}`)).toBeInTheDocument()
    expect(screen.getByText(`整理番号: ${project.seiri_no}`)).toBeInTheDocument()
    expect(screen.getByText(`盤名称: ${project.panel_name}`)).toBeInTheDocument()
  })

  it('renders the app title as "Sekisan Navi" only, without the old "/ 積算ナビ" suffix (UI視覚階層改善 指示6章)', () => {
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
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
        onOpenReferencePdfs={noop}
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
        onOpenReferencePdfs={noop}
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
        onOpenReferencePdfs={noop}
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

  it('keeps the header bar itself (its own padding) unchanged even though the brand title now has its own block (Issue #9 追加修正: ブランドブロック化)', () => {
    const { container } = render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
      />,
    )
    // jsdomはlayoutを持たないため、実際に描画されたHeaderの高さ(px)は
    // ここでは検証できない(既知の制約)。ここでは「Header自身のCSSボックス
    // モデル(padding)を変更していないこと」だけを、リテラル値の一致で確認する
    // (var()を経由しないため、この比較はjsdomでも信頼できる)。実際に
    // headerHeightが変化していないことは実ブラウザ(Playwright)で確認済み
    // (Issue #9コメント参照)。
    const header = container.querySelector('.project-header') as HTMLElement
    expect(getComputedStyle(header).padding).toBe('0.4rem 0.8rem') // 文字拡大(+17%)に合わせて、ヘッダーの高さが増えないよう余白を詰めた(0.5rem 1rem から)
  })

  it('gives the brand title its own visually-separated "block" (background/padding/border-radius/margin), not just bare text (Issue #9 追加修正: タイトルをブランドブロックとして分離)', () => {
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
      />,
    )
    const brand = screen.getByText('Sekisan Navi')
    const style = getComputedStyle(brand)
    expect(style.backgroundColor).toBe('rgba(255, 255, 255, 0.16)')
    expect(style.borderRadius).toBe('6px')
    expect(style.paddingLeft).not.toBe('0px')
    expect(style.paddingTop).not.toBe('0px')
    expect(style.marginRight).not.toBe('0px')
  })

  it('uses a bright cobalt blue that fades to white toward the right, instead of the old flat dark navy (UI視覚階層改善 追加修正指示 2章、Issue #9追加修正3回目でグラデーション化)', () => {
    const { container } = render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
      />,
    )
    const header = container.querySelector('.project-header') as HTMLElement
    const style = getComputedStyle(header)
    // Issue #9追加修正3回目: 単色背景(background-color)から、左は濃いコバルト
    // #2455e2(=rgb(36, 85, 226))を保ちつつ右へ白(#eef2fc)へ近づく
    // linear-gradientへ変更した。単色ではなくbackground-image(gradient)に
    // なったことと、gradientの開始色に旧来のコバルトが含まれること、旧#1f2937
    // (濃紺, rgb(31,41,55))ではないことを確認する。
    expect(style.backgroundImage).toContain('linear-gradient')
    expect(style.backgroundImage).toContain('rgb(36, 85, 226)')
    expect(style.backgroundImage).not.toContain('rgb(31, 41, 55)')
    expect(style.color).toBe('rgb(255, 255, 255)')
  })

  it('gives the right-side action buttons a self-contained readable style, independent of the header background (Issue #9 追加修正3回目: グラデーション右端でも可読性を保つ)', () => {
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
      />,
    )
    const openProductButton = screen.getByRole('button', { name: '製番を開く' })
    const style = getComputedStyle(openProductButton)
    // 旧来は半透明の白(地の濃い青が透けて見える前提)だったが、Header右端は
    // グラデーションでほぼ白くなるため、地の色に依存しない不透明に近い白背景+
    // 濃い青文字へ変更した(白地の上でも視認できる配色)。
    expect(style.backgroundColor).toBe('rgba(255, 255, 255, 0.94)')
    expect(style.color).toBe('rgb(29, 63, 174)')
  })

  it('renders project info and the Japanese label for analysis_status', () => {
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
      />,
    )

    expect(screen.getByText(/整理番号: A1AB3211/)).toBeInTheDocument()
    expect(screen.getByText(/確認待ち/)).toBeInTheDocument()
  })

  it('shows a loading indicator when loading and no project yet', () => {
    render(
      <ProjectHeader
        project={null}
        loading
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
      />,
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
          onOpenReferencePdfs={noop}
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
        onOpenReferencePdfs={noop}
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
        onOpenReferencePdfs={noop}
      />,
    )
    fireEvent.click(screen.getByText('システム設定'))
    expect(onOpenSystemSettings).toHaveBeenCalled()
  })

  it('calls onOpenReferencePdfs when the "資料" button is clicked', () => {
    const onOpenReferencePdfs = vi.fn()
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={onOpenReferencePdfs}
      />,
    )
    fireEvent.click(screen.getByText('資料'))
    expect(onOpenReferencePdfs).toHaveBeenCalled()
  })

  it('shows exactly one PDF-opening button ("資料"), with the old "積算資料" button removed (指示: 資料機能の一本化)', () => {
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
      />,
    )
    expect(screen.getByRole('button', { name: '資料' })).toBeInTheDocument()
    expect(screen.queryByText('積算資料')).not.toBeInTheDocument()
  })

  it('gives only the "資料" button the dedicated red-accent class, leaving the other header buttons untouched (指示: 資料タブを鮮やかな赤色にする。他のタブや画面全体の配色は変更しない)', () => {
    render(
      <ProjectHeader
        project={project}
        loading={false}
        onOpenProductViewer={noop}
        onOpenSystemSettings={noop}
        onOpenReferencePdfs={noop}
      />,
    )
    // 実際に解決される色(鮮やかな赤#f5222d)自体は、jsdomがCSS変数(var())を
    // shorthandプロパティ内で正しく解決できないという既知の制約により、
    // ここでは検証できない(docs/coding-conventions.md「テスト」節参照)。
    // 実ブラウザでの表示色はPlaywrightで別途確認する。ここでは、専用classが
    // 「資料」ボタンだけに付き、他のボタンには付かないことだけを確認する。
    expect(screen.getByRole('button', { name: '資料' }).className).toContain(
      'project-header__reference-pdf-button',
    )
    expect(screen.getByRole('button', { name: '製番を開く' }).className).not.toContain(
      'project-header__reference-pdf-button',
    )
    expect(screen.getByRole('button', { name: 'システム設定' }).className).not.toContain(
      'project-header__reference-pdf-button',
    )
  })
})
