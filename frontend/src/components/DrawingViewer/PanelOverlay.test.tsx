import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PanelOverlay } from './PanelOverlay'
import type { PanelArea } from '../../types/domain'

describe('PanelOverlay', () => {
  it('renders multiple independent areas for the same panel/page (e.g. 背面/正面/右側面)', () => {
    const areas: PanelArea[] = [
      { id: 1, panel_id: 1, drawing_page_id: 1, area_x: 0.23, area_y: 0.5, area_w: 0.06, area_h: 0.2, label: '背面図' },
      { id: 2, panel_id: 1, drawing_page_id: 1, area_x: 0.63, area_y: 0.11, area_w: 0.06, area_h: 0.22, label: '正面図' },
      { id: 3, panel_id: 1, drawing_page_id: 1, area_x: 0.76, area_y: 0.11, area_w: 0.16, area_h: 0.22, label: '右側面図' },
    ]
    render(<PanelOverlay areas={areas} />)

    expect(screen.getByText('背面図')).toBeInTheDocument()
    expect(screen.getByText('正面図')).toBeInTheDocument()
    expect(screen.getByText('右側面図')).toBeInTheDocument()
  })

  it('converts normalized area coordinates to percentage-based CSS position', () => {
    const areas: PanelArea[] = [
      { id: 1, panel_id: 1, drawing_page_id: 1, area_x: 0.23, area_y: 0.5, area_w: 0.06, area_h: 0.2, label: '背面図' },
    ]
    render(<PanelOverlay areas={areas} />)
    const area = screen.getByText('背面図').parentElement as HTMLElement
    expect(area.style.left).toBe('23%')
    expect(area.style.top).toBe('50%')
    expect(area.style.width).toBe('6%')
    expect(area.style.height).toBe('20%')
  })

  it('renders nothing when there are no areas', () => {
    const { container } = render(<PanelOverlay areas={[]} />)
    expect(container.querySelectorAll('.panel-overlay__area')).toHaveLength(0)
  })
})
