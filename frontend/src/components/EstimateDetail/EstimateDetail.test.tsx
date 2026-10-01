import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EstimateDetail } from './EstimateDetail'
import type { Detection, EstimateMasterItem, EstimateResult } from '../../types/domain'

function makeResult(overrides: Partial<EstimateResult> = {}): EstimateResult {
  return {
    id: 1,
    product_no: 'A1GV2421',
    result_key: '11001:panel:1:1',
    master_item_id: 10,
    code: '11001',
    quantity: 1,
    initial_quantity: 1,
    current_quantity: 1,
    quantity_overridden: false,
    quantity_override_reason: null,
    applicable_unit: 'face',
    initial_factor: 1.0,
    current_factor: 1.0,
    factor_overridden: false,
    factor_override_reason: null,
    factor_updated_at: null,
    factor_updated_by: null,
    judgment_method: 'drawing_judgment',
    judgment_scope: 'panel',
    target_panel_ban_menno: 1,
    target_panel_ban_no: 1,
    target_drawing_page_id: 16,
    judgment_reason: null,
    source_rule_id: 5,
    unit_price: 1000,
    unit_labor: null,
    price: 1000,
    labor: null,
    status: 'auto',
    allowed_factors: null,
    evidence: [{ id: 1, evidence_kind: 'detection', detection_id: 42, design_data_ref: null }],
    ...overrides,
  }
}

const masterItemById = new Map<number, EstimateMasterItem>([
  [
    10,
    {
      id: 10,
      code: '11001',
      category: '箱',
      model: 'IS2',
      rating: '2300*900*2200',
      note: null,
      total_price_a: 1000,
      box_parts_price: null,
      painting_price: null,
      setup_a: null,
      sheet_metal_price: null,
      assembly_price: null,
      inspection_price: null,
    },
  ],
])

const detectionById = new Map<number, Detection>([
  [
    42,
    {
      id: 42,
      drawing_page_id: 1,
      panel_id: null,
      class_name: 'side_door',
      bbox_x: 0.1,
      bbox_y: 0.1,
      bbox_w: 0.05,
      bbox_h: 0.05,
      confidence: null,
      status: 'reviewed',
      source_type: 'manual',
      master_item_id: null,
      leader_label_x: null,
      leader_label_y: null,
      master_item_category: null,
      master_item_model: null,
      master_item_code: null,
      evidence_type_key: 'side_door',
    },
  ],
])

function renderDetail(props: Partial<Parameters<typeof EstimateDetail>[0]> = {}) {
  return render(
    <EstimateDetail
      results={[]}
      masterItemById={masterItemById}
      detectionById={detectionById}
      tabFilter="all"
      onTabFilterChange={() => {}}
      {...props}
    />,
  )
}

describe('EstimateDetail (Issue #40 Phase 5: EstimateResultを正本とする積算明細)', () => {
  it('shows the 5 new tabs (全て/設計データ/図面判定/要確認/修正あり), not the old AI/manual tabs', () => {
    renderDetail({ results: [makeResult()] })
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent?.replace(/\s?\d+$/, ''))
    expect(tabs).toEqual(['全て', '設計データ', '図面判定', '要確認', '修正あり'])
    expect(screen.queryByRole('tab', { name: /^AI/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /マニュアル/ })).not.toBeInTheDocument()
  })

  it('shows コード/内容/数量/適用単位/係数/金額/判定 as the 7 columns', () => {
    renderDetail({ results: [makeResult()] })
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['コード', '内容', '数量', '適用単位', '係数', '金額', '判定'])
  })

  it('"全て" tab includes every EstimateResult regardless of judgment_method', () => {
    const results = [
      makeResult({ id: 1, code: 'A', judgment_method: 'design_data' }),
      makeResult({ id: 2, code: 'B', judgment_method: 'drawing_judgment' }),
      makeResult({ id: 3, code: 'C', judgment_method: 'needs_confirmation' }),
    ]
    renderDetail({ results, tabFilter: 'all' })
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^全て/ }).textContent).toContain('3')
  })

  it('"設計データ" tab filters to judgment_method === design_data only', () => {
    const results = [
      makeResult({ id: 1, code: 'A', judgment_method: 'design_data' }),
      makeResult({ id: 2, code: 'B', judgment_method: 'drawing_judgment' }),
    ]
    renderDetail({ results, tabFilter: 'design_data' })
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.queryByText('B')).not.toBeInTheDocument()
  })

  it('"図面判定" tab filters to judgment_method === drawing_judgment only', () => {
    const results = [
      makeResult({ id: 1, code: 'A', judgment_method: 'design_data' }),
      makeResult({ id: 2, code: 'B', judgment_method: 'drawing_judgment' }),
    ]
    renderDetail({ results, tabFilter: 'drawing_judgment' })
    expect(screen.queryByText('A')).not.toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('"要確認" tab still shows judgment_method === needs_confirmation rows (and hides ordinary rows)', () => {
    const results = [
      makeResult({ id: 1, code: 'A', judgment_method: 'drawing_judgment' }),
      makeResult({ id: 2, code: 'B', judgment_method: 'needs_confirmation' }),
    ]
    renderDetail({ results, tabFilter: 'needs_confirmation' })
    expect(screen.queryByText('A')).not.toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^要確認/ }).textContent).toContain('1')
  })

  it('"要確認" tab also shows status === needs_review rows whose judgment_method is drawing_judgment (新旧同一コード衝突)', () => {
    const results = [
      makeResult({ id: 1, code: 'A', judgment_method: 'drawing_judgment', status: 'auto' }),
      makeResult({ id: 2, code: 'B', judgment_method: 'drawing_judgment', status: 'needs_review' }),
      makeResult({ id: 3, code: 'C', judgment_method: 'needs_confirmation', status: 'auto' }),
    ]
    renderDetail({ results, tabFilter: 'needs_confirmation' })
    expect(screen.queryByText('A')).not.toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
    // タブ件数も表示条件と同じ(2件)
    expect(screen.getByRole('tab', { name: /^要確認/ }).textContent).toContain('2')
  })

  it('counts a row that is both needs_review and needs_confirmation only once in the "要確認" tab', () => {
    const results = [makeResult({ id: 1, code: 'A', judgment_method: 'needs_confirmation', status: 'needs_review' })]
    renderDetail({ results, tabFilter: 'needs_confirmation' })
    expect(screen.getByRole('tab', { name: /^要確認/ }).textContent).toMatch(/要確認\s*1$/)
  })

  it('keeps needs_review rows in their own judgment_method tab too, without affecting other tab counts', () => {
    const results = [
      makeResult({ id: 1, code: 'A', judgment_method: 'drawing_judgment', status: 'needs_review' }),
      makeResult({ id: 2, code: 'B', judgment_method: 'design_data', status: 'auto' }),
    ]
    renderDetail({ results, tabFilter: 'drawing_judgment' })
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.queryByText('B')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^全て/ }).textContent).toContain('2')
    expect(screen.getByRole('tab', { name: /^設計データ/ }).textContent).toContain('1')
    expect(screen.getByRole('tab', { name: /^図面判定/ }).textContent).toContain('1')
    expect(screen.getByRole('tab', { name: /^要確認/ }).textContent).toContain('1')
  })

  it('"修正あり" tab filters to factor_overridden === true regardless of judgment_method', () => {
    const results = [
      makeResult({ id: 1, code: 'A', judgment_method: 'design_data', factor_overridden: false }),
      makeResult({ id: 2, code: 'B', judgment_method: 'drawing_judgment', factor_overridden: true }),
    ]
    renderDetail({ results, tabFilter: 'overridden' })
    expect(screen.queryByText('A')).not.toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^修正あり/ }).textContent).toContain('1')
  })

  it('"修正あり" tab also includes quantity_overridden === true rows (Issue #40 Phase 6後半指示7章)', () => {
    const results = [
      makeResult({ id: 1, code: 'A', factor_overridden: false, quantity_overridden: false }),
      makeResult({ id: 2, code: 'B', factor_overridden: false, quantity_overridden: true }),
      makeResult({ id: 3, code: 'C', factor_overridden: true, quantity_overridden: true }),
    ]
    renderDetail({ results, tabFilter: 'overridden' })
    expect(screen.queryByText('A')).not.toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
    // 両方修正されている行(C)も1行としてのみ数える。
    expect(screen.getByRole('tab', { name: /^修正あり/ }).textContent).toContain('2')
  })

  it('calls onOverrideResultQuantity/onResetResultQuantity from the embedded quantity cell', () => {
    const onOverrideResultQuantity = vi.fn()
    const onResetResultQuantity = vi.fn()
    const result = makeResult({ current_quantity: 3, quantity_overridden: true })
    renderDetail({ results: [result], onOverrideResultQuantity, onResetResultQuantity })

    const input = screen.getByLabelText('数量') as HTMLInputElement
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)
    fireEvent.change(screen.getByLabelText('数量変更の理由'), { target: { value: '現地確認' } })
    fireEvent.click(screen.getByRole('button', { name: '適用' }))
    expect(onOverrideResultQuantity).toHaveBeenCalledWith(result, 5, '現地確認')

    const quantityCell = input.closest('.estimate-result-quantity-cell') as HTMLElement
    fireEvent.click(within(quantityCell).getByRole('button', { name: '初期値へ戻す' }))
    expect(onResetResultQuantity).toHaveBeenCalledWith(result)
  })

  it('calls onTabFilterChange (not internal state) when a tab is clicked', () => {
    const onTabFilterChange = vi.fn()
    renderDetail({ results: [makeResult()], onTabFilterChange })
    fireEvent.click(screen.getByRole('tab', { name: /^設計データ/ }))
    expect(onTabFilterChange).toHaveBeenCalledWith('design_data')
  })

  it('shows judgment_method in Japanese, never the raw enum value', () => {
    renderDetail({ results: [makeResult({ judgment_method: 'drawing_judgment' })] })
    expect(screen.getByText('図面判定')).toBeInTheDocument()
    expect(screen.queryByText('drawing_judgment')).not.toBeInTheDocument()
  })

  it('shows applicable_unit in Japanese, or "-" when null', () => {
    const { rerender } = renderDetail({ results: [makeResult({ applicable_unit: 'face' })] })
    expect(screen.getByText('1面')).toBeInTheDocument()

    rerender(
      <EstimateDetail
        results={[makeResult({ id: 2, applicable_unit: null })]}
        masterItemById={masterItemById}
        tabFilter="all"
        onTabFilterChange={() => {}}
      />,
    )
    expect(document.querySelector('tbody .estimate-detail__col-rr-unit')?.textContent).toBe('-')
  })

  it('shows price formatted with a currency prefix, and "-" (never 0円) when null', () => {
    const { rerender } = renderDetail({ results: [makeResult({ price: 1000 })] })
    expect(screen.getByText('¥1,000')).toBeInTheDocument()

    rerender(
      <EstimateDetail
        results={[makeResult({ id: 2, price: null })]}
        masterItemById={masterItemById}
        tabFilter="all"
        onTabFilterChange={() => {}}
      />,
    )
    expect(document.querySelector('tbody .estimate-detail__col-rr-price')?.textContent).toBe('-')
    expect(screen.queryByText('0円')).not.toBeInTheDocument()
  })

  it('resolves 内容 from the master item (model/rating), falling back to code', () => {
    renderDetail({ results: [makeResult({ master_item_id: 10 })] })
    expect(screen.getByText('IS2 / 2300*900*2200')).toBeInTheDocument()
  })

  it('shows a 理由 button (with judgment_reason as its title) only when present', () => {
    const { rerender } = renderDetail({ results: [makeResult({ judgment_reason: 'VCT + CH / 同一盤' })] })
    expect(screen.getByRole('button', { name: '判定理由' }).title).toBe('VCT + CH / 同一盤')

    rerender(
      <EstimateDetail
        results={[makeResult({ id: 2, judgment_reason: null })]}
        masterItemById={masterItemById}
        tabFilter="all"
        onTabFilterChange={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: '判定理由' })).not.toBeInTheDocument()
  })

  it('shows a 根拠 button summarizing evidence provenance (AI/手動) from detectionById', () => {
    renderDetail({ results: [makeResult()] })
    const button = screen.getByRole('button', { name: '根拠' })
    expect(button.title).toContain('取得元: 手動')
  })

  it('[Issue #40 Phase 6-B] shows design_data evidence as a Japanese condition line, not raw field names/JSON', () => {
    renderDetail({
      results: [
        makeResult({
          evidence: [
            {
              id: 1,
              evidence_kind: 'design_data',
              detection_id: null,
              design_data_ref: JSON.stringify({
                panel: '1:1',
                conditions: [
                  { field: 'ban_w', operator: '>=', expected_value: 900, actual_value: 1200 },
                  { field: 'ban_d', operator: '==', expected_value: 2200, actual_value: 2200 },
                ],
              }),
            },
          ],
        }),
      ],
    })
    const button = screen.getByRole('button', { name: '根拠' })
    expect(button.title).toContain('幅: 1200 ≥ 900')
    expect(button.title).toContain('奥行: 2200 = 2200')
    // 内部field名(ban_w/ban_d)をそのまま表示しない。
    expect(button.title).not.toContain('ban_w')
    expect(button.title).not.toContain('ban_d')
  })

  it('[Issue #40 Phase 6-B] falls back to a plain "設計データ" label for pre-Phase-6-B design_data_ref values ({"panel": "..."} only)', () => {
    renderDetail({
      results: [
        makeResult({
          evidence: [
            { id: 1, evidence_kind: 'design_data', detection_id: null, design_data_ref: '{"panel": "1:1"}' },
          ],
        }),
      ],
    })
    const button = screen.getByRole('button', { name: '根拠' })
    expect(button.title).toContain('設計データ')
  })

  it('shows a needs-review badge only when status === needs_review', () => {
    const { rerender } = renderDetail({ results: [makeResult({ status: 'needs_review' })] })
    expect(screen.getByText('⚠要確認')).toBeInTheDocument()

    rerender(
      <EstimateDetail
        results={[makeResult({ id: 2, status: 'auto' })]}
        masterItemById={masterItemById}
        tabFilter="all"
        onTabFilterChange={() => {}}
      />,
    )
    expect(screen.queryByText('⚠要確認')).not.toBeInTheDocument()
  })

  it('calls onFocusResultEvidence on row hover (Phase 3 BBox highlight reuse)', () => {
    const onFocusResultEvidence = vi.fn()
    const result = makeResult()
    renderDetail({ results: [result], onFocusResultEvidence })
    const row = screen.getByText('11001').closest('tr') as HTMLElement
    fireEvent.mouseEnter(row)
    expect(onFocusResultEvidence).toHaveBeenCalledWith(result)
  })

  it('calls onOverrideResultFactor/onResetResultFactor from the embedded factor cell', () => {
    const onOverrideResultFactor = vi.fn()
    const onResetResultFactor = vi.fn()
    const result = makeResult({ current_factor: 0.7, allowed_factors: [0.5, 0.7, 1.0], factor_overridden: true })
    renderDetail({ results: [result], onOverrideResultFactor, onResetResultFactor })
    fireEvent.change(screen.getByLabelText('係数'), { target: { value: '0.5' } })
    expect(onOverrideResultFactor).toHaveBeenCalledWith(result, 0.5)
    const factorCell = screen.getByLabelText('係数').closest('.estimate-result-factor-cell') as HTMLElement
    fireEvent.click(within(factorCell).getByRole('button', { name: '初期値へ戻す' }))
    expect(onResetResultFactor).toHaveBeenCalledWith(result)
  })

  it('shows "積算結果がありません" when there are no results', () => {
    renderDetail({ results: [] })
    expect(screen.getByText('積算結果がありません')).toBeInTheDocument()
  })
})
