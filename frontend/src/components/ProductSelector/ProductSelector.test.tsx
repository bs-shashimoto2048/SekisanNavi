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
  it('lists all product folders below the input as soon as it opens (指示: 既存の製番入力欄の下に、参照先フォルダ内の製番フォルダ名を一覧表示する)', async () => {
    vi.mocked(searchProducts).mockResolvedValue({
      matches: ['A1AA0379', 'A1GV2421', 'A1GV2422', 'B2XX0001'],
      truncated: false,
    })
    render(<ProductSelector currentProductNo="A1GV2421" onSelect={() => {}} onClose={() => {}} />)

    // 何も入力していない状態(マウント直後)でも、空文字列クエリで一覧取得を呼ぶ
    // (Backend側は「_」始まりを除く全件・絞り込みなしを返す)。
    await waitFor(() => expect(searchProducts).toHaveBeenCalledWith(''))
    expect(await screen.findByRole('button', { name: 'A1AA0379' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'B2XX0001' })).toBeInTheDocument()
  })

  it('shows candidates returned by the substring search (debounced), including matches not at the start of the name (指示: 入力文字に応じて候補を絞り込む)', async () => {
    vi.mocked(searchProducts).mockResolvedValue({
      matches: ['A1GV2421', 'A1GV2422'],
      truncated: false,
    })
    render(<ProductSelector currentProductNo="A1GV2421" onSelect={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(searchProducts).toHaveBeenCalledWith(''))
    vi.mocked(searchProducts).mockClear()

    fireEvent.change(screen.getByPlaceholderText('例: A1GV24'), { target: { value: 'GV24' } })

    await waitFor(() => expect(searchProducts).toHaveBeenCalledWith('GV24'))
    expect(await screen.findByRole('button', { name: 'A1GV2421' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A1GV2422' })).toBeInTheDocument()
  })

  it('shows "該当する製番がありません" when there are no matches (指示: 候補がない場合は「該当する製番がありません」と表示する)', async () => {
    vi.mocked(searchProducts).mockResolvedValue({ matches: [], truncated: false })
    render(<ProductSelector currentProductNo="A1GV2421" onSelect={() => {}} onClose={() => {}} />)

    expect(await screen.findByText('該当する製番がありません')).toBeInTheDocument()
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

  it('ignores a stale, slow-to-resolve response from an earlier query once a newer query has been typed (指示: 空クエリでの全件取得は実ファイルシステム走査のぶん遅くなりうるため、後から打った速い絞り込みクエリの結果を古いレスポンスで上書きしない)', async () => {
    let resolveInitial: (value: { matches: string[]; truncated: boolean }) => void
    const initialPending = new Promise<{ matches: string[]; truncated: boolean }>((resolve) => {
      resolveInitial = resolve
    })
    vi.mocked(searchProducts).mockImplementation((q: string) => {
      if (q === '') return initialPending
      if (q === 'GV24') return Promise.resolve({ matches: ['A1GV2421'], truncated: false })
      return Promise.resolve({ matches: [], truncated: false })
    })

    render(<ProductSelector currentProductNo="A1GV2421" onSelect={() => {}} onClose={() => {}} />)
    await waitFor(() => expect(searchProducts).toHaveBeenCalledWith(''))

    // 空クエリ(初回マウント時)の低速な全件取得がまだ解決していないうちに、
    // ユーザーが絞り込みクエリを入力して先にその結果が反映される状況を再現する。
    fireEvent.change(screen.getByPlaceholderText('例: A1GV24'), { target: { value: 'GV24' } })
    expect(await screen.findByRole('button', { name: 'A1GV2421' })).toBeInTheDocument()

    // その後に、現在の入力内容とはもう対応しない空クエリの結果が遅れて解決しても、
    // 画面には反映されない(絞り込み結果のままである)こと。
    resolveInitial!({ matches: ['A1AA0379', 'B2XX0001'], truncated: false })
    await Promise.resolve()
    await Promise.resolve()
    expect(screen.queryByRole('button', { name: 'A1AA0379' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'B2XX0001' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A1GV2421' })).toBeInTheDocument()
  })

  it('calls onClose when the backdrop or close button is clicked', () => {
    const onClose = vi.fn()
    render(<ProductSelector currentProductNo="A1GV2421" onSelect={() => {}} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
