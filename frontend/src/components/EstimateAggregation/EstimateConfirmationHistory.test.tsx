import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { EstimateConfirmationHistory } from './EstimateConfirmationHistory'
import { ApiError, getEstimateConfirmation, listEstimateConfirmations } from '../../api/client'
import type { EstimateConfirmationDetail, EstimateConfirmationSummary } from '../../types/domain'

// Issue #4 Phase B-4: 読み出し専用の一覧/詳細APIを呼ぶだけの最小UI。
// このコンポーネント自身は確定操作(POST)を一切呼ばず、現在のMaster/BBoxからの
// 再計算もしないことをAPIクライアントのmockで検証する。
vi.mock('../../api/client', () => ({
  listEstimateConfirmations: vi.fn(),
  getEstimateConfirmation: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

function makeSummary(overrides: Partial<EstimateConfirmationSummary> = {}): EstimateConfirmationSummary {
  return {
    id: 1,
    product_no: 'A1GV2421',
    confirmed_at: '2026-09-04 07:28:06',
    item_count: 15,
    total_amount: 322000,
    ...overrides,
  }
}

function makeDetail(overrides: Partial<EstimateConfirmationDetail> = {}): EstimateConfirmationDetail {
  return {
    id: 1,
    product_no: 'A1GV2421',
    confirmed_at: '2026-09-04 07:28:06',
    item_count: 1,
    total_amount: 322000,
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
  vi.mocked(listEstimateConfirmations).mockReset()
  vi.mocked(getEstimateConfirmation).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('EstimateConfirmationHistory (Issue #4 Phase B-4: 確定履歴の最小UI)', () => {
  it('renders nothing when no product is open (productNo=null)', () => {
    const { container } = render(<EstimateConfirmationHistory productNo={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows only the trigger button until opened, and does not call the API yet', () => {
    render(<EstimateConfirmationHistory productNo="A1GV2421" />)
    expect(screen.getByRole('button', { name: '確定履歴を見る' })).toBeInTheDocument()
    expect(listEstimateConfirmations).not.toHaveBeenCalled()
  })

  it('fetches and shows an empty state when the product has never been confirmed', async () => {
    vi.mocked(listEstimateConfirmations).mockResolvedValue([])
    render(<EstimateConfirmationHistory productNo="A1OTHER99" />)

    fireEvent.click(screen.getByRole('button', { name: '確定履歴を見る' }))

    await waitFor(() => expect(listEstimateConfirmations).toHaveBeenCalledWith('A1OTHER99'))
    expect(await screen.findByText(/まだ積算確定されていません/)).toBeInTheDocument()
  })

  it('shows the confirmation list with date / item count / total amount', async () => {
    vi.mocked(listEstimateConfirmations).mockResolvedValue([
      makeSummary({ id: 3, confirmed_at: '2026-09-05 10:00:00', item_count: 2, total_amount: 5000 }),
      makeSummary({ id: 2, confirmed_at: '2026-09-04 07:28:06', item_count: 15, total_amount: 322000 }),
    ])
    render(<EstimateConfirmationHistory productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '確定履歴を見る' }))

    await screen.findByText('2026-09-05 10:00:00')
    expect(screen.getByText('2026-09-04 07:28:06')).toBeInTheDocument()
    expect(screen.getByText('2件')).toBeInTheDocument()
    expect(screen.getByText('15件')).toBeInTheDocument()
    expect(screen.getByText('5,000円')).toBeInTheDocument()
    expect(screen.getByText('322,000円')).toBeInTheDocument()
  })

  it('fetches and shows the detail (including line items) when a confirmation is selected', async () => {
    vi.mocked(listEstimateConfirmations).mockResolvedValue([makeSummary()])
    vi.mocked(getEstimateConfirmation).mockResolvedValue(makeDetail())
    render(<EstimateConfirmationHistory productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '確定履歴を見る' }))
    await screen.findByText('2026-09-04 07:28:06')
    fireEvent.click(screen.getByText('2026-09-04 07:28:06'))

    await waitFor(() => expect(getEstimateConfirmation).toHaveBeenCalledWith('A1GV2421', 1))
    expect(await screen.findByText('11002')).toBeInTheDocument()
    // 「内容」列(型式/定格の結合)と「型式」列がどちらも同じ文字列になる
    // ケースのため、件数のみ確認する(値そのものは既にテーブル描画で確認済み)。
    expect(screen.getAllByText('OS2- 916').length).toBeGreaterThanOrEqual(1)
    // Backend側で算出済みの合計をそのまま表示するだけで、再計算はしない
    expect(screen.getByText(/合計 322,000円/)).toBeInTheDocument()
  })

  it('shows an unknown-price line item as "不明" rather than fabricating a value', async () => {
    vi.mocked(listEstimateConfirmations).mockResolvedValue([makeSummary()])
    vi.mocked(getEstimateConfirmation).mockResolvedValue(
      makeDetail({
        items: [
          {
            id: 2,
            detection_id: 102,
            drawing_page_id: 1,
            target_id: 'product',
            target_type: 'product',
            ban_menno: null,
            ban_no: null,
            panel_name: null,
            master_item_id: null,
            code: '18311',
            category: null,
            model: null,
            rating: null,
            source_type: 'ai',
            quantity: 1,
            unit_price: null,
            amount: null,
            status: 'reviewed',
            bbox_x: 0.2,
            bbox_y: 0.2,
            bbox_w: 0.05,
            bbox_h: 0.05,
            page_no: 16,
          },
        ],
      }),
    )
    render(<EstimateConfirmationHistory productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '確定履歴を見る' }))
    await screen.findByText('2026-09-04 07:28:06')
    fireEvent.click(screen.getByText('2026-09-04 07:28:06'))

    await screen.findAllByText('18311') // コード列・内容列(共にfallback)の両方に出る
    const unknownCells = screen.getAllByText('不明')
    expect(unknownCells.length).toBe(2) // 単価・金額のいずれも不明
  })

  it('allows navigating back from detail to the list', async () => {
    vi.mocked(listEstimateConfirmations).mockResolvedValue([makeSummary()])
    vi.mocked(getEstimateConfirmation).mockResolvedValue(makeDetail())
    render(<EstimateConfirmationHistory productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '確定履歴を見る' }))
    await screen.findByText('2026-09-04 07:28:06')
    fireEvent.click(screen.getByText('2026-09-04 07:28:06'))
    await screen.findByText('11002')

    fireEvent.click(screen.getByRole('button', { name: '← 一覧へ戻る' }))
    expect(screen.getByText('2026-09-04 07:28:06')).toBeInTheDocument()
    expect(screen.queryByText('11002')).not.toBeInTheDocument()
  })

  it('shows an error message when the list request fails', async () => {
    vi.mocked(listEstimateConfirmations).mockRejectedValue(new ApiError(503, 'データ参照ルートに接続できません。'))
    render(<EstimateConfirmationHistory productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '確定履歴を見る' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('データ参照ルートに接続できません。')
  })

  it('closes the modal when the backdrop is clicked, and re-fetches on reopen', async () => {
    vi.mocked(listEstimateConfirmations).mockResolvedValue([])
    render(<EstimateConfirmationHistory productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '確定履歴を見る' }))
    await waitFor(() => expect(listEstimateConfirmations).toHaveBeenCalledTimes(1))

    // [追加修正] modalはfloating panelのstacking contextに埋もれないよう
    // document.bodyへportalするようになったため、render()の`container`
    // (コンポーネント自身のDOM位置)ではなくdocument全体から探す。
    const backdrop = document.body.querySelector('.estimate-confirmation-history__backdrop')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)

    expect(screen.getByRole('button', { name: '確定履歴を見る' })).toBeInTheDocument()
    expect(screen.queryByText(/まだ積算確定されていません/)).not.toBeInTheDocument()
  })
})
