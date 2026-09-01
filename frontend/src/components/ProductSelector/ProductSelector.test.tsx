import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductSelector } from './ProductSelector'
import { ApiError, fetchProductInfo, searchProducts } from '../../api/client'

vi.mock('../../api/client', () => ({
  fetchProductInfo: vi.fn(),
  searchProducts: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

beforeEach(() => {
  vi.mocked(fetchProductInfo).mockReset()
  vi.mocked(searchProducts).mockReset()
  vi.mocked(searchProducts).mockResolvedValue({ matches: [], truncated: false })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ProductSelector (Phase 1.8: 製番検索・切替)', () => {
  it('does not search the backend for a query shorter than the minimum length', async () => {
    render(<ProductSelector currentProductNo="A1GV2421" onSelect={() => {}} onClose={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('例: A1GV24'), { target: { value: 'A' } })

    await new Promise((r) => setTimeout(r, 300))
    expect(searchProducts).not.toHaveBeenCalled()
  })

  it('shows candidates returned by the prefix search (debounced)', async () => {
    vi.mocked(searchProducts).mockResolvedValue({
      matches: ['A1GV2421', 'A1GV2422'],
      truncated: false,
    })
    render(<ProductSelector currentProductNo="A1GV2421" onSelect={() => {}} onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText('例: A1GV24'), { target: { value: 'A1GV24' } })

    await waitFor(() => expect(searchProducts).toHaveBeenCalledWith('A1GV24'))
    expect(await screen.findByRole('button', { name: 'A1GV2421' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A1GV2422' })).toBeInTheDocument()
  })

  it('shows a truncated notice when the backend reports more matches than shown', async () => {
    vi.mocked(searchProducts).mockResolvedValue({ matches: ['A1GV2421'], truncated: true })
    render(<ProductSelector currentProductNo="A1GV2421" onSelect={() => {}} onClose={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('例: A1GV24'), { target: { value: 'A1' } })

    expect(await screen.findByText(/絞り込んでください/)).toBeInTheDocument()
  })

  it('selects a product when a candidate is clicked, after confirming it exists', async () => {
    vi.mocked(searchProducts).mockResolvedValue({ matches: ['A1GV2422'], truncated: false })
    vi.mocked(fetchProductInfo).mockResolvedValue({
      product_no: 'A1GV2422',
      exists: true,
      ccv_resolved: false,
    })
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<ProductSelector currentProductNo="A1GV2421" onSelect={onSelect} onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('例: A1GV24'), { target: { value: 'A1GV24' } })

    const candidate = await screen.findByRole('button', { name: 'A1GV2422' })
    fireEvent.click(candidate)

    await waitFor(() => expect(fetchProductInfo).toHaveBeenCalledWith('A1GV2422'))
    expect(onSelect).toHaveBeenCalledWith('A1GV2422')
    expect(onClose).toHaveBeenCalled()
  })

  it('opens an exact product number directly via "開く" even if it is not in the candidate list (要件3)', async () => {
    vi.mocked(searchProducts).mockResolvedValue({ matches: [], truncated: false })
    vi.mocked(fetchProductInfo).mockResolvedValue({
      product_no: 'A1ZZ9999',
      exists: true,
      ccv_resolved: false,
    })
    const onSelect = vi.fn()
    render(<ProductSelector currentProductNo="A1GV2421" onSelect={onSelect} onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText('例: A1GV24'), { target: { value: 'A1ZZ9999' } })
    fireEvent.click(screen.getByRole('button', { name: '開く' }))

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('A1ZZ9999'))
  })

  it('shows an error message and does not select when the product does not exist', async () => {
    vi.mocked(fetchProductInfo).mockRejectedValue(new ApiError(404, '製番が見つかりません'))
    const onSelect = vi.fn()
    render(<ProductSelector currentProductNo="A1GV2421" onSelect={onSelect} onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText('例: A1GV24'), { target: { value: 'A1NOPE99' } })
    fireEvent.click(screen.getByRole('button', { name: '開く' }))

    expect(await screen.findByText('製番が見つかりません')).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('calls onClose when the backdrop or close button is clicked', () => {
    const onClose = vi.fn()
    render(<ProductSelector currentProductNo="A1GV2421" onSelect={() => {}} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
