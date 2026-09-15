import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HelpPdfModal } from './HelpPdfModal'
import { ApiError, fetchHelpPdfStatus, helpPdfFileUrl } from '../../api/client'

// Issue #19 Phase 3: このcomponentはAPIクライアント越しに存在確認(status)のみを
// 呼び、PDFファイル自体はfetchせず<iframe src>へ渡すだけであることをmockで検証する。
vi.mock('../../api/client', () => ({
  fetchHelpPdfStatus: vi.fn(),
  helpPdfFileUrl: vi.fn(() => '/api/help/estimate-pdf/file'),
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

const mockFetchStatus = vi.mocked(fetchHelpPdfStatus)
const mockFileUrl = vi.mocked(helpPdfFileUrl)

beforeEach(() => {
  mockFetchStatus.mockReset()
  mockFileUrl.mockReset().mockReturnValue('/api/help/estimate-pdf/file')
})

describe('HelpPdfModal', () => {
  it('shows a loading message before the status check resolves', () => {
    mockFetchStatus.mockReturnValue(new Promise(() => {})) // 未解決のまま
    render(<HelpPdfModal onClose={() => {}} />)
    expect(screen.getByText('確認中...')).toBeInTheDocument()
  })

  it('renders an <iframe> pointing at the PDF file URL once the status says available=true', async () => {
    mockFetchStatus.mockResolvedValue({ available: true })
    render(<HelpPdfModal onClose={() => {}} />)

    const frame = await screen.findByTitle('積算資料PDF')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame.getAttribute('src')).toBe('/api/help/estimate-pdf/file')
    expect(mockFileUrl).toHaveBeenCalled()
  })

  it('shows a clear "not configured" message and no <iframe> when available=false (指示: 空白viewerではなく明確な案内)', async () => {
    mockFetchStatus.mockResolvedValue({ available: false })
    render(<HelpPdfModal onClose={() => {}} />)

    await waitFor(() => expect(screen.getByText(/積算資料が配置されていません/)).toBeInTheDocument())
    expect(screen.queryByTitle('積算資料PDF')).not.toBeInTheDocument()
  })

  it('shows a describeFetchError-formatted message when the status check itself fails', async () => {
    mockFetchStatus.mockRejectedValue(new ApiError(503, 'サーバーに接続できませんでした。'))
    render(<HelpPdfModal onClose={() => {}} />)

    await waitFor(() =>
      expect(screen.getByText(/積算資料の確認に失敗しました/)).toBeInTheDocument(),
    )
    expect(screen.queryByTitle('積算資料PDF')).not.toBeInTheDocument()
  })

  it('calls fetchHelpPdfStatus exactly once (lazy loading, no polling)', async () => {
    mockFetchStatus.mockResolvedValue({ available: true })
    render(<HelpPdfModal onClose={() => {}} />)

    await screen.findByTitle('積算資料PDF')
    expect(mockFetchStatus).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the × button is clicked', () => {
    mockFetchStatus.mockReturnValue(new Promise(() => {}))
    const onClose = vi.fn()
    render(<HelpPdfModal onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when the backdrop is clicked, but not when the panel itself is clicked (SystemSettingsと同じstopPropagationパターン)', () => {
    mockFetchStatus.mockReturnValue(new Promise(() => {}))
    const onClose = vi.fn()
    const { container } = render(<HelpPdfModal onClose={onClose} />)

    const backdrop = container.querySelector('.help-pdf-modal__backdrop') as HTMLElement
    const panel = container.querySelector('.help-pdf-modal') as HTMLElement

    fireEvent.click(panel)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('has a heading distinct from "積算コードMaster" (Help/参考資料であり、Masterを置き換えるものではないことの表示上の確認)', () => {
    mockFetchStatus.mockReturnValue(new Promise(() => {}))
    render(<HelpPdfModal onClose={() => {}} />)
    expect(screen.getByRole('heading', { name: '積算資料' })).toBeInTheDocument()
  })
})
