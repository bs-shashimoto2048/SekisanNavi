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
