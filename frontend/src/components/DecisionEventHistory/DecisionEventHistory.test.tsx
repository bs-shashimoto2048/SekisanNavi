import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { DecisionEventHistory } from './DecisionEventHistory'
import { ApiError, listDecisionEvents } from '../../api/client'
import type { DecisionEvent } from '../../types/domain'

// Issue #4 Phase A-2: 読み出し専用の一覧APIを呼ぶだけの最小UI。
// このコンポーネント自身は値を編集・再計算しないことをAPIクライアントのmockで検証する。
vi.mock('../../api/client', () => ({
  listDecisionEvents: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

function makeEvent(overrides: Partial<DecisionEvent> = {}): DecisionEvent {
  return {
    id: 1,
    occurred_at: '2026-09-08 04:26:10',
    event_type: 'create',
    detection_id: 101,
    drawing_page_id: 1,
    page_no: 16,
    source_type: 'manual',
    master_item_id: 10,
    before_bbox_x: null,
    before_bbox_y: null,
    before_bbox_w: null,
    before_bbox_h: null,
    after_bbox_x: 0.1,
    after_bbox_y: 0.1,
    after_bbox_w: 0.05,
    after_bbox_h: 0.05,
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(listDecisionEvents).mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('DecisionEventHistory (Issue #4 Phase A-2: 操作履歴の最小UI)', () => {
  it('renders nothing when no product is open (productNo=null)', () => {
    const { container } = render(<DecisionEventHistory productNo={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows only the trigger button until opened, and does not call the API yet', () => {
    render(<DecisionEventHistory productNo="A1GV2421" />)
    expect(screen.getByRole('button', { name: '操作履歴を見る' })).toBeInTheDocument()
    expect(listDecisionEvents).not.toHaveBeenCalled()
  })

  it('shows a loading state while the request is in flight', async () => {
    let resolvePromise: (value: DecisionEvent[]) => void = () => {}
    vi.mocked(listDecisionEvents).mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve
      }),
    )
    render(<DecisionEventHistory productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '操作履歴を見る' }))
    expect(await screen.findByText('読み込み中...')).toBeInTheDocument()

    resolvePromise([])
    await waitFor(() => expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument())
  })

  it('shows an empty state when the product has no recorded events', async () => {
    vi.mocked(listDecisionEvents).mockResolvedValue([])
    render(<DecisionEventHistory productNo="A1OTHER99" />)

    fireEvent.click(screen.getByRole('button', { name: '操作履歴を見る' }))

    await waitFor(() => expect(listDecisionEvents).toHaveBeenCalledWith('A1OTHER99'))
    expect(await screen.findByText(/まだ操作履歴がありません/)).toBeInTheDocument()
  })

  it('shows an error message when the request fails', async () => {
    vi.mocked(listDecisionEvents).mockRejectedValue(new ApiError(503, 'データ参照ルートに接続できません。'))
    render(<DecisionEventHistory productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '操作履歴を見る' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('データ参照ルートに接続できません。')
  })

  it('shows a human-readable label for each event type', async () => {
    vi.mocked(listDecisionEvents).mockResolvedValue([
      makeEvent({ id: 1, event_type: 'create' }),
      makeEvent({
        id: 2,
        event_type: 'bbox_edit',
        before_bbox_x: 0.1,
        before_bbox_y: 0.1,
        before_bbox_w: 0.05,
        before_bbox_h: 0.05,
        after_bbox_x: 0.2,
        after_bbox_y: 0.2,
        after_bbox_w: 0.06,
        after_bbox_h: 0.06,
      }),
      makeEvent({
        id: 3,
        event_type: 'delete',
        before_bbox_x: 0.2,
        before_bbox_y: 0.2,
        before_bbox_w: 0.06,
        before_bbox_h: 0.06,
        after_bbox_x: null,
        after_bbox_y: null,
        after_bbox_w: null,
        after_bbox_h: null,
      }),
    ])
    render(<DecisionEventHistory productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '操作履歴を見る' }))

    expect(await screen.findByText('BBox追加')).toBeInTheDocument()
    expect(screen.getByText('BBox移動/サイズ変更')).toBeInTheDocument()
    expect(screen.getByText('BBox削除')).toBeInTheDocument()
  })

  it('shows Detection id / source type / page number for each event', async () => {
    vi.mocked(listDecisionEvents).mockResolvedValue([
      makeEvent({ detection_id: 42, source_type: 'ai', page_no: 3 }),
    ])
    render(<DecisionEventHistory productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '操作履歴を見る' }))

    const meta = await screen.findByText(/Detection #42/)
    expect(meta.textContent).toContain('AI検出')
    expect(meta.textContent).toContain('ページ3')
  })

  it('shows before/after BBox values for a bbox_edit event', async () => {
    vi.mocked(listDecisionEvents).mockResolvedValue([
      makeEvent({
        event_type: 'bbox_edit',
        before_bbox_x: 0.1,
        before_bbox_y: 0.1,
        before_bbox_w: 0.05,
        before_bbox_h: 0.05,
        after_bbox_x: 0.2,
        after_bbox_y: 0.25,
        after_bbox_w: 0.06,
        after_bbox_h: 0.07,
      }),
    ])
    render(<DecisionEventHistory productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '操作履歴を見る' }))

    const before = await screen.findByText(/変更前:/)
    expect(before.textContent).toContain('x=0.100')
    expect(before.textContent).toContain('y=0.100')
    const after = screen.getByText(/変更後:/)
    expect(after.textContent).toContain('x=0.200')
    expect(after.textContent).toContain('y=0.250')
  })

  it('only shows "変更後" (no 変更前) for a create event, since there is no before state', async () => {
    vi.mocked(listDecisionEvents).mockResolvedValue([makeEvent({ event_type: 'create' })])
    render(<DecisionEventHistory productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '操作履歴を見る' }))

    await screen.findByText(/変更後:/)
    expect(screen.queryByText(/変更前:/)).not.toBeInTheDocument()
  })

  it('only shows "変更前" (no 変更後) for a delete event, since there is no after state', async () => {
    vi.mocked(listDecisionEvents).mockResolvedValue([
      makeEvent({
        event_type: 'delete',
        before_bbox_x: 0.2,
        before_bbox_y: 0.2,
        before_bbox_w: 0.06,
        before_bbox_h: 0.06,
        after_bbox_x: null,
        after_bbox_y: null,
        after_bbox_w: null,
        after_bbox_h: null,
      }),
    ])
    render(<DecisionEventHistory productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '操作履歴を見る' }))

    await screen.findByText(/変更前:/)
    expect(screen.queryByText(/変更後:/)).not.toBeInTheDocument()
  })

  it('closes the modal when the backdrop is clicked', async () => {
    vi.mocked(listDecisionEvents).mockResolvedValue([])
    const { container } = render(<DecisionEventHistory productNo="A1GV2421" />)

    fireEvent.click(screen.getByRole('button', { name: '操作履歴を見る' }))
    await waitFor(() => expect(listDecisionEvents).toHaveBeenCalledTimes(1))

    const backdrop = container.querySelector('.decision-event-history__backdrop')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)

    expect(screen.getByRole('button', { name: '操作履歴を見る' })).toBeInTheDocument()
    expect(screen.queryByText(/まだ操作履歴がありません/)).not.toBeInTheDocument()
  })

  it('does not mix events from a previously viewed product when reopened for a different product', async () => {
    vi.mocked(listDecisionEvents).mockResolvedValueOnce([makeEvent({ id: 1, detection_id: 101 })])
    const { rerender } = render(<DecisionEventHistory productNo="A1GV2421" />)
    fireEvent.click(screen.getByRole('button', { name: '操作履歴を見る' }))
    await screen.findByText(/Detection #101/)

    // 閉じてから別製番へ切り替える(製番切替時に古い一覧を混在させないことの確認)
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    vi.mocked(listDecisionEvents).mockResolvedValueOnce([makeEvent({ id: 2, detection_id: 202 })])
    rerender(<DecisionEventHistory productNo="A1OTHER99" />)

    fireEvent.click(screen.getByRole('button', { name: '操作履歴を見る' }))
    await waitFor(() => expect(listDecisionEvents).toHaveBeenCalledWith('A1OTHER99'))
    expect(await screen.findByText(/Detection #202/)).toBeInTheDocument()
    expect(screen.queryByText(/Detection #101/)).not.toBeInTheDocument()
  })
})
