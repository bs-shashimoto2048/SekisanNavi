import { render, screen, fireEvent, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CopperBusCodeSelector } from './CopperBusCodeSelector'
import { fetchCopperBusCodeOptions } from '../../api/client'
import type { EstimateMasterItem } from '../../types/domain'

// 実データの構造(品名=入力（主回路銅帯）/銅帯、型式・定格の組が常に1コードへ
// 一意に対応する)を模した小さなfixtureを使う(Issue #40 Phase 6-H)。
function makeItem(overrides: Partial<EstimateMasterItem>): EstimateMasterItem {
  return {
    id: 1,
    code: '44241',
    category: '入力（主回路銅帯）',
    model: '3×30   L=2.6m×3本',
    rating: '1Φ 10kVA　公共建築 (225A)',
    note: null,
    total_price_a: null,
    box_parts_price: null,
    painting_price: null,
    setup_a: null,
    sheet_metal_price: null,
    assembly_price: null,
    inspection_price: null,
    ...overrides,
  }
}

const ITEMS: EstimateMasterItem[] = [
  makeItem({ id: 1, code: '44241', model: '3×30   L=2.6m×3本', rating: '1Φ 10kVA　公共建築 (225A)' }),
  makeItem({ id: 2, code: '44242', model: '3×30   L=2.6m×3本', rating: '1Φ 20kVA　公共建築 (225A)' }),
  makeItem({ id: 3, code: '44244', model: '4×30   L=2.6m×3本', rating: '1Φ 50kVA　公共建築 (300A)' }),
  makeItem({
    id: 4,
    code: '44841',
    category: '銅帯',
    model: '3×30/1ｍ　(1相分）',
    rating: '307A/40℃ (配225A分175A)',
  }),
]

vi.mock('../../api/client', () => ({
  fetchCopperBusCodeOptions: vi.fn(() => Promise.resolve(ITEMS)),
}))

beforeEach(() => {
  vi.mocked(fetchCopperBusCodeOptions).mockClear()
  vi.mocked(fetchCopperBusCodeOptions).mockResolvedValue(ITEMS)
})

describe('CopperBusCodeSelector (盤情報、Issue #40 Phase 6-H / 追加修正: 面ごとの独立選択)', () => {
  it('shows the panel label (面番号) in the toggle button, and starts collapsed without fetching', () => {
    render(<CopperBusCodeSelector panelLabel="1" />)
    expect(screen.getByRole('button', { name: /面1 主回路銅帯コード選択/ })).toBeInTheDocument()
    expect(fetchCopperBusCodeOptions).not.toHaveBeenCalled()
  })

  it('fetches options and shows the 品名/型式/定格 selects when expanded', async () => {
    render(<CopperBusCodeSelector panelLabel="1" />)
    fireEvent.click(screen.getByRole('button', { name: /主回路銅帯コード選択/ }))

    expect(await screen.findByText('品名')).toBeInTheDocument()
    expect(fetchCopperBusCodeOptions).toHaveBeenCalledTimes(1)
    expect(screen.getByText('型式')).toBeInTheDocument()
    expect(screen.getByText('定格')).toBeInTheDocument()
  })

  it('narrows 型式 options to the selected 品名, and 定格 options to the selected 型式', async () => {
    render(<CopperBusCodeSelector panelLabel="1" />)
    fireEvent.click(screen.getByRole('button', { name: /主回路銅帯コード選択/ }))
    await screen.findByText('品名')

    const categorySelect = screen.getByRole('combobox', { name: '品名' }) as HTMLSelectElement
    expect(categorySelect.value).toBe('入力（主回路銅帯）')

    const modelSelect = screen.getByRole('combobox', { name: '型式' }) as HTMLSelectElement
    const modelOptions = within(modelSelect).getAllByRole('option').map((o) => o.textContent)
    // 「入力（主回路銅帯）」配下の型式のみ(「銅帯」側の型式は別品目のため含まれない)。
    expect(modelOptions).toEqual(['(選択してください)', '3×30   L=2.6m×3本', '4×30   L=2.6m×3本'])

    fireEvent.change(modelSelect, { target: { value: '3×30   L=2.6m×3本' } })

    const ratingSelect = screen.getByRole('combobox', { name: '定格' }) as HTMLSelectElement
    const ratingOptions = within(ratingSelect).getAllByRole('option').map((o) => o.textContent)
    expect(ratingOptions).toEqual(['(選択してください)', '1Φ 10kVA　公共建築 (225A)', '1Φ 20kVA　公共建築 (225A)'])
  })

  it('shows the matching code once 品名/型式/定格 are all selected', async () => {
    render(<CopperBusCodeSelector panelLabel="1" />)
    fireEvent.click(screen.getByRole('button', { name: /主回路銅帯コード選択/ }))
    await screen.findByText('品名')

    fireEvent.change(screen.getByRole('combobox', { name: '型式' }), {
      target: { value: '3×30   L=2.6m×3本' },
    })
    expect(screen.getByText('-')).toBeInTheDocument() // 定格未選択の間はコード未確定

    fireEvent.change(screen.getByRole('combobox', { name: '定格' }), {
      target: { value: '1Φ 20kVA　公共建築 (225A)' },
    })

    expect(screen.getByText('44242')).toBeInTheDocument()
  })

  it('resets 型式/定格 when 品名 changes, and resets 定格 when 型式 changes', async () => {
    render(<CopperBusCodeSelector panelLabel="1" />)
    fireEvent.click(screen.getByRole('button', { name: /主回路銅帯コード選択/ }))
    await screen.findByText('品名')

    fireEvent.change(screen.getByRole('combobox', { name: '型式' }), {
      target: { value: '3×30   L=2.6m×3本' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: '定格' }), {
      target: { value: '1Φ 10kVA　公共建築 (225A)' },
    })
    expect(screen.getByText('44241')).toBeInTheDocument()

    // 型式を変更すると定格の選択(=コード)はリセットされる。
    fireEvent.change(screen.getByRole('combobox', { name: '型式' }), {
      target: { value: '4×30   L=2.6m×3本' },
    })
    expect(screen.getByText('-')).toBeInTheDocument()

    // 品名を変更すると型式・定格ともリセットされる。
    fireEvent.change(screen.getByRole('combobox', { name: '定格' }), {
      target: { value: '1Φ 50kVA　公共建築 (300A)' },
    })
    expect(screen.getByText('44244')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: '品名' }), { target: { value: '銅帯' } })
    expect(screen.getByText('-')).toBeInTheDocument()
    const modelSelectAfter = screen.getByRole('combobox', { name: '型式' }) as HTMLSelectElement
    expect(modelSelectAfter.value).toBe('')
  })

  it('keeps each panel instance state independent: selecting a code on one panel does not affect another (面ごとに独立、追加修正の核心要件)', async () => {
    render(
      <>
        <CopperBusCodeSelector panelLabel="1" />
        <CopperBusCodeSelector panelLabel="2" />
      </>,
    )

    const toggles = screen.getAllByRole('button', { name: /主回路銅帯コード選択/ })
    expect(toggles).toHaveLength(2)
    fireEvent.click(toggles[0])
    fireEvent.click(toggles[1])
    await screen.findAllByText('品名')

    const modelSelects = screen.getAllByRole('combobox', { name: '型式' })
    const ratingSelects = screen.getAllByRole('combobox', { name: '定格' })
    expect(modelSelects).toHaveLength(2)

    // 面1 → 44241 を選択
    fireEvent.change(modelSelects[0], { target: { value: '3×30   L=2.6m×3本' } })
    fireEvent.change(ratingSelects[0], { target: { value: '1Φ 10kVA　公共建築 (225A)' } })

    // 面2 → 44244 を選択
    fireEvent.change(modelSelects[1], { target: { value: '4×30   L=2.6m×3本' } })
    fireEvent.change(ratingSelects[1], { target: { value: '1Φ 50kVA　公共建築 (300A)' } })

    const codes = screen.getAllByText(/^(44241|44244)$/).map((el) => el.textContent)
    expect(codes.sort()).toEqual(['44241', '44244'])

    // 面2 側だけ選び直しても、面1 側のコードは変化しない。
    fireEvent.change(modelSelects[1], { target: { value: '3×30   L=2.6m×3本' } })
    fireEvent.change(ratingSelects[1], { target: { value: '1Φ 20kVA　公共建築 (225A)' } })

    expect(screen.getByText('44241')).toBeInTheDocument() // 面1は変わらず維持
    expect(screen.getByText('44242')).toBeInTheDocument() // 面2が新しい選択結果
    expect(screen.queryByText('44244')).not.toBeInTheDocument()
  })
})

describe('CopperBusCodeSelector: 読み込み中・取得失敗・候補なしの表示', () => {
  it('shows a loading message while the options request is pending, then the selects', async () => {
    let resolve: (items: EstimateMasterItem[]) => void = () => {}
    vi.mocked(fetchCopperBusCodeOptions).mockReturnValue(
      new Promise<EstimateMasterItem[]>((r) => {
        resolve = r
      }),
    )
    render(<CopperBusCodeSelector panelLabel="1" />)
    fireEvent.click(screen.getByRole('button', { name: /主回路銅帯コード選択/ }))
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '品名' })).not.toBeInTheDocument()

    resolve(ITEMS)
    expect(await screen.findByRole('combobox', { name: '品名' })).toBeInTheDocument()
    expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument()
  })

  it('shows a fixed Japanese error message (never the exception text) when the request fails, and the toggle still works', async () => {
    vi.mocked(fetchCopperBusCodeOptions).mockRejectedValueOnce(new Error('boom: http://internal/host?token=abc'))
    render(<CopperBusCodeSelector panelLabel="1" />)
    const toggle = screen.getByRole('button', { name: /主回路銅帯コード選択/ })
    fireEvent.click(toggle)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('銅帯コード候補を取得できませんでした。閉じてもう一度開いてください。')
    expect(document.body.textContent).not.toContain('boom')
    expect(document.body.textContent).not.toContain('token')
    expect(screen.queryByRole('combobox', { name: '品名' })).not.toBeInTheDocument()

    // 閉じると本文が消え、再展開で再取得して回復できる(UIはロックされない)。
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(await screen.findByRole('combobox', { name: '品名' })).toBeInTheDocument()
    expect(fetchCopperBusCodeOptions).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an empty-state message (no selects, code not shown) when the API returns no options', async () => {
    vi.mocked(fetchCopperBusCodeOptions).mockResolvedValue([])
    render(<CopperBusCodeSelector panelLabel="1" />)
    fireEvent.click(screen.getByRole('button', { name: /主回路銅帯コード選択/ }))

    expect(await screen.findByText('銅帯コード候補がありません。')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '品名' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
