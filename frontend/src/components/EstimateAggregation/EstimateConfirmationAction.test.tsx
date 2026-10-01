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
        current_factor: 1.0,
        factor_overridden: false,
        judgment_method: 'drawing_judgment',
        applicable_unit: null,
        judgment_reason: null,
        source_rule_id: null,
        result_status: 'auto',
        initial_quantity: 1,
        current_quantity: 1,
        quantity_overridden: false,
        quantity_override_reason: null,
        quantity_updated_at: null,
        quantity_updated_by: null,
        evidence: [],
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
    expect(screen.getByText('製番 A1GV2421')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '確定' })).toBeInTheDocument()
  })

  it('does not call the API when the user cancels the confirmation dialog', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<EstimateConfirmationAction productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '確定' }))

    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('製番 A1GV2421'))
    expect(createEstimateConfirmation).not.toHaveBeenCalled()
  })

  it('calls the existing confirmation API (and only that) after the user confirms', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(createEstimateConfirmation).mockResolvedValue(makeConfirmation())
    render(<EstimateConfirmationAction productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '確定' }))

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

    fireEvent.click(screen.getByRole('button', { name: '確定' }))

    const button = await screen.findByRole('button', { name: '確定中...' })
    expect(button).toBeDisabled()
    // 送信中に再クリックしても2回目のAPI呼び出しは発生しない
    fireEvent.click(button)
    expect(createEstimateConfirmation).toHaveBeenCalledTimes(1)

    resolvePromise(makeConfirmation())
    await waitFor(() => expect(screen.getByRole('button', { name: '確定' })).not.toBeDisabled())
  })

  it('shows confirmation id / confirmed_at / item_count / total amount on success', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(createEstimateConfirmation).mockResolvedValue(
      makeConfirmation({ id: 7, confirmed_at: '2026-09-04 07:28:06', item_count: 15 }),
    )
    render(<EstimateConfirmationAction productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '確定' }))

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

    fireEvent.click(screen.getByRole('button', { name: '確定' }))

    const result = await screen.findByText(/確定しました/)
    expect(result.textContent).toContain('積算コード 0件')
    expect(result.textContent).toContain('0円')
  })

  it('shows an error message and does not claim success when the API call fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(createEstimateConfirmation).mockRejectedValue(new ApiError(503, 'データ参照ルートに接続できません。'))
    render(<EstimateConfirmationAction productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '確定' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('積算確定に失敗しました')
    expect(alert.textContent).toContain('データ参照ルートに接続できません。')
    expect(screen.queryByText(/^確定しました/)).not.toBeInTheDocument()
    // 失敗後は再試行できるようボタンが有効へ戻ること
    expect(screen.getByRole('button', { name: '確定' })).not.toBeDisabled()
  })

  it('[Issue #36] uses a short visible label ("確定") with a title attribute for the fuller description, without changing the accessible name', () => {
    render(<EstimateConfirmationAction productNo="A1GV2421" />)
    const button = screen.getByRole('button', { name: '確定' })
    expect(button).toHaveAttribute('title', '積算確定する')
    // accessible nameは可視テキスト(「確定」)のままで、title属性には
    // 上書きされない(titleは可視テキストが無い場合のみaccessible nameの
    // 情報源として使われる。可視テキストが優先されるため、既存の
    // `getByRole('button', { name: '確定' })`ベースのテストは壊れない)。
    expect(button).toHaveAccessibleName('確定')
  })

  it('[Issue #36] no longer wraps the label/button in the old bordered box (border/background廃止、compact rowへ直接溶け込む)', () => {
    const { container } = render(<EstimateConfirmationAction productNo="A1GV2421" />)
    expect(container.querySelector('.estimate-confirmation-action')).not.toBeInTheDocument()
  })

  describe('Issue #40 Phase 6-A指示A-1: needs_review行が残っている間は確定できない', () => {
    it('disables the button and shows guidance when needsReviewCount > 0, without calling the API', () => {
      render(<EstimateConfirmationAction productNo="A1GV2421" needsReviewCount={2} />)
      const button = screen.getByRole('button', { name: '確定' })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('title', '要確認の積算結果が残っているため確定できません')
      expect(screen.getByRole('alert').textContent).toContain('要確認の積算結果が2件残っているため確定できません')

      fireEvent.click(button)
      expect(createEstimateConfirmation).not.toHaveBeenCalled()
    })

    it('shows a link to navigate to the 要確認 tab when onNavigateToNeedsReview is provided', () => {
      const onNavigateToNeedsReview = vi.fn()
      render(
        <EstimateConfirmationAction
          productNo="A1GV2421"
          needsReviewCount={1}
          onNavigateToNeedsReview={onNavigateToNeedsReview}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: '要確認タブで確認する' }))
      expect(onNavigateToNeedsReview).toHaveBeenCalledTimes(1)
    })

    it('enables the button normally when needsReviewCount is 0 (default)', () => {
      render(<EstimateConfirmationAction productNo="A1GV2421" />)
      expect(screen.getByRole('button', { name: '確定' })).not.toBeDisabled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
