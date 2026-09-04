import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { EstimateConfirmationAction } from './EstimateConfirmationAction'
import { ApiError, createEstimateConfirmation } from '../../api/client'
import type { EstimateConfirmation } from '../../types/domain'

// Issue #4 Phase B-3: 既存のPOST /api/products/{product_no}/estimate-confirmations
// を呼ぶだけの最小UI。ここではこのコンポーネント自身が「呼ぶだけ」で、値の
// 再計算・送信を一切行っていないことをAPIクライアントのmockで検証する。
vi.mock('../../api/client', () => ({
  createEstimateConfirmation: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

function makeConfirmation(overrides: Partial<EstimateConfirmation> = {}): EstimateConfirmation {
  return {
    id: 1,
    product_no: 'A1GV2421',
    confirmed_at: '2026-09-04 07:28:06',
    item_count: 15,
    items: [
      {
        id: 1,
        detection_id: 101,
        drawing_page_id: 1,
        target_id: 'panel:5:5',
        target_type: 'panel',
        ban_menno: 5,
        ban_no: 5,
        panel_name: 'No.2-1低圧動力盤',
        master_item_id: 10,
        code: '11002',
        category: '箱･単独',
        model: 'OS2- 916',
        rating: null,
        source_type: 'manual',
        quantity: 1,
        unit_price: 322000,
        amount: 322000,
        status: 'reviewed',
        bbox_x: 0.1,
        bbox_y: 0.1,
        bbox_w: 0.05,
        bbox_h: 0.05,
        page_no: 16,
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(createEstimateConfirmation).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('EstimateConfirmationAction (Issue #4 Phase B-3: 積算確定の最小UI)', () => {
  it('renders nothing when no product is open (productNo=null)', () => {
    const { container } = render(<EstimateConfirmationAction productNo={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the product number in the label so the product-wide scope of the action is explicit', () => {
    render(<EstimateConfirmationAction productNo="A1GV2421" />)
    expect(screen.getByText('製番 A1GV2421 の積算確定')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '積算確定する' })).toBeInTheDocument()
  })

  it('does not call the API when the user cancels the confirmation dialog', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<EstimateConfirmationAction productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '積算確定する' }))

    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('製番 A1GV2421'))
    expect(createEstimateConfirmation).not.toHaveBeenCalled()
  })

  it('calls the existing confirmation API (and only that) after the user confirms', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(createEstimateConfirmation).mockResolvedValue(makeConfirmation())
    render(<EstimateConfirmationAction productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '積算確定する' }))

    await waitFor(() => expect(createEstimateConfirmation).toHaveBeenCalledTimes(1))
    expect(createEstimateConfirmation).toHaveBeenCalledWith('A1GV2421')
  })

  it('disables the button while the request is in flight, to prevent double submission', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let resolvePromise: (value: EstimateConfirmation) => void = () => {}
    vi.mocked(createEstimateConfirmation).mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve
      }),
    )
    render(<EstimateConfirmationAction productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '積算確定する' }))

    const button = await screen.findByRole('button', { name: '確定中...' })
    expect(button).toBeDisabled()
    // 送信中に再クリックしても2回目のAPI呼び出しは発生しない
    fireEvent.click(button)
    expect(createEstimateConfirmation).toHaveBeenCalledTimes(1)

    resolvePromise(makeConfirmation())
    await waitFor(() => expect(screen.getByRole('button', { name: '積算確定する' })).not.toBeDisabled())
  })

  it('shows confirmation id / confirmed_at / item_count / total amount on success', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(createEstimateConfirmation).mockResolvedValue(
      makeConfirmation({ id: 7, confirmed_at: '2026-09-04 07:28:06', item_count: 15 }),
    )
    render(<EstimateConfirmationAction productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '積算確定する' }))

    await screen.findByText(/確定しました/)
    const result = screen.getByText(/確定しました/)
    expect(result.textContent).toContain('確定ID 7')
    expect(result.textContent).toContain('2026-09-04 07:28:06')
    expect(result.textContent).toContain('積算コード 15件')
    expect(result.textContent).toContain('322,000円')
  })

  it('makes a 0-item confirmation visible in the completion message (0件確定を隠さない)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(createEstimateConfirmation).mockResolvedValue(
      makeConfirmation({ id: 2, item_count: 0, items: [] }),
    )
    render(<EstimateConfirmationAction productNo="A1OTHER99" />)

    fireEvent.click(screen.getByRole('button', { name: '積算確定する' }))

    const result = await screen.findByText(/確定しました/)
    expect(result.textContent).toContain('積算コード 0件')
    expect(result.textContent).toContain('0円')
  })

  it('shows an error message and does not claim success when the API call fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(createEstimateConfirmation).mockRejectedValue(new ApiError(503, 'データ参照ルートに接続できません。'))
    render(<EstimateConfirmationAction productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '積算確定する' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('積算確定に失敗しました')
    expect(alert.textContent).toContain('データ参照ルートに接続できません。')
    expect(screen.queryByText(/^確定しました/)).not.toBeInTheDocument()
    // 失敗後は再試行できるようボタンが有効へ戻ること
    expect(screen.getByRole('button', { name: '積算確定する' })).not.toBeDisabled()
  })
})
