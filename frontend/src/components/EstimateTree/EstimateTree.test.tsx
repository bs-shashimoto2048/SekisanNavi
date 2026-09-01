import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EstimateTree } from './EstimateTree'
import type { DrawingPage, EstimateItem } from '../../types/domain'

const page: DrawingPage = {
  id: 13,
  drawing_file_id: 1,
  page_no: 13,
  drawing_type: '外形図',
  drawing_name: '外形図 P13',
  thumbnail_url: null,
  image_url: null,
  page_width: 1000,
  page_height: 1400,
  display_order: 0,
  source_type: 'product_file',
  product_no: 'A1TEST01',
  source_page_no: 13,
}

const items: EstimateItem[] = [
  {
    id: 1,
    code: '11001',
    category: '箱・単独',
    item_name: '箱',
    model: 'OS2-816',
    rating: null,
    quantity: 1,
    unit: '面',
    source_type: 'program',
    confidence: null,
    status: 'confirmed',
    references: [
      { id: 1, drawing_page_id: 13, detection_id: null, panel_id: null, reason: 'test' },
    ],
  },
]

describe('EstimateTree', () => {
  it('groups items by category and renders reference labels via pagesById', () => {
    render(
      <EstimateTree
        items={items}
        pagesById={new Map([[13, page]])}
        onNavigateReference={() => {}}
      />,
    )

    expect(screen.getByText('箱・単独')).toBeInTheDocument()
    expect(screen.getByText('外形図 P13')).toBeInTheDocument()
  })

  it('calls onNavigateReference with page and detection id when a reference is clicked', () => {
    const onNavigateReference = vi.fn()
    render(
      <EstimateTree
        items={items}
        pagesById={new Map([[13, page]])}
        onNavigateReference={onNavigateReference}
      />,
    )

    fireEvent.click(screen.getByText('外形図 P13'))

    expect(onNavigateReference).toHaveBeenCalledWith(13, null)
  })
})
