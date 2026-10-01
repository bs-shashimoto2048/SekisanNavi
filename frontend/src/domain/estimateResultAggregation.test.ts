import { describe, expect, it } from 'vitest'
import { buildEstimateResultAggregation, PRODUCT_TARGET_ID, TIE_TARGET_ID } from './estimateResultAggregation'
import type { EstimateMasterItem, EstimateResult } from '../types/domain'
import type { EstimateTarget } from '../types/estimateAggregation'

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
    evidence: [],
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

const baseTargets: EstimateTarget[] = [
  { id: PRODUCT_TARGET_ID, type: 'product', name: '製品全体', banMenno: null, banNo: null },
  { id: 'panel:1:1', type: 'panel', name: '高圧受電盤', banMenno: 1, banNo: 1 },
  { id: 'panel:2:2', type: 'panel', name: '低圧電灯盤', banMenno: 2, banNo: 2 },
]

describe('buildEstimateResultAggregation (Issue #40 Phase 5: 積算集約のEstimateResult化)', () => {
  it('sums quantity across multiple results sharing the same target+code, respecting evaluator-provided quantity (指示3章)', () => {
    // 「1台×3成立→数量3」: 評価器がPER_EVIDENCEで3件の独立した結果
    // (quantity=1ずつ)を生成済みという前提を、単純合算で正しく数量3にする。
    const results = [
      makeResult({ id: 1, result_key: 'k1', quantity: 1 }),
      makeResult({ id: 2, result_key: 'k2', quantity: 1 }),
      makeResult({ id: 3, result_key: 'k3', quantity: 1 }),
    ]
    const data = buildEstimateResultAggregation({ results, masterItemById, baseTargets })
    const line = data.lineItems.find((l) => l.targetId === 'panel:1:1' && l.code === '11001')
    expect(line?.quantity).toBe(3)
  })

  it('keeps quantity=1 for a single PER_CONDITION_GROUP-style result (指示3章「1製番→根拠複数でも数量1」)', () => {
    const results = [makeResult({ quantity: 1 })]
    const data = buildEstimateResultAggregation({ results, masterItemById, baseTargets })
    const line = data.lineItems.find((l) => l.targetId === 'panel:1:1' && l.code === '11001')
    expect(line?.quantity).toBe(1)
  })

  it('sums EstimateResult.price directly rather than recomputing unit_price*quantity (指示10章)', () => {
    const results = [
      makeResult({ id: 1, result_key: 'k1', price: 1000 }),
      makeResult({ id: 2, result_key: 'k2', price: 2000 }),
    ]
    const data = buildEstimateResultAggregation({ results, masterItemById, baseTargets })
    const line = data.lineItems.find((l) => l.targetId === 'panel:1:1' && l.code === '11001')
    expect(line?.amount).toBe(3000)
  })

  it('sets amount to null (not 0) when any contributing result has price=NULL (指示10章)', () => {
    const results = [
      makeResult({ id: 1, result_key: 'k1', price: 1000 }),
      makeResult({ id: 2, result_key: 'k2', price: null, unit_price: null }),
    ]
    const data = buildEstimateResultAggregation({ results, masterItemById, baseTargets })
    const line = data.lineItems.find((l) => l.targetId === 'panel:1:1' && l.code === '11001')
    expect(line?.amount).toBeNull()
  })

  it('groups a result with no panel target under the product target', () => {
    const results = [makeResult({ target_panel_ban_menno: null, target_panel_ban_no: null })]
    const data = buildEstimateResultAggregation({ results, masterItemById, baseTargets })
    const line = data.lineItems.find((l) => l.targetId === PRODUCT_TARGET_ID)
    expect(line).toBeDefined()
  })

  it('routes status=needs_review results into a dedicated 要確認(tie) bucket, not their nominal panel', () => {
    const results = [makeResult({ status: 'needs_review', target_panel_ban_menno: 1, target_panel_ban_no: 1 })]
    const data = buildEstimateResultAggregation({ results, masterItemById, baseTargets })
    expect(data.lineItems.find((l) => l.targetId === 'panel:1:1')).toBeUndefined()
    expect(data.lineItems.find((l) => l.targetId === TIE_TARGET_ID)).toBeDefined()
    expect(data.targets.some((t) => t.id === TIE_TARGET_ID && t.type === 'tie')).toBe(true)
  })

  it('does not add a 要確認(tie) target when there are no needs_review results', () => {
    const results = [makeResult({ status: 'auto' })]
    const data = buildEstimateResultAggregation({ results, masterItemById, baseTargets })
    expect(data.targets.some((t) => t.type === 'tie')).toBe(false)
  })

  it('still includes needs_review results in the grand total (totalLineItems), matching legacy tie behavior', () => {
    const results = [makeResult({ status: 'needs_review' })]
    const data = buildEstimateResultAggregation({ results, masterItemById, baseTargets })
    const total = data.totalLineItems.find((l) => l.code === '11001')
    expect(total?.amount).toBe(1000)
  })

  it('reuses baseTargets for the panel/product target list rather than deriving its own (dropdown completeness)', () => {
    // panel:2:2には現時点でEstimateResultが1件も無くても、baseTargetsに
    // 含まれていれば対象一覧には残り続ける(既存の「空でも対象として
    // 切り替えられる」体験を後退させない)。
    const data = buildEstimateResultAggregation({ results: [], masterItemById, baseTargets })
    expect(data.targets.map((t) => t.id)).toEqual([PRODUCT_TARGET_ID, 'panel:1:1', 'panel:2:2'])
  })

  it('does not fabricate unit_price/quantity into a line item when master item is unknown', () => {
    const results = [makeResult({ master_item_id: null, code: '99999' })]
    const data = buildEstimateResultAggregation({ results, masterItemById, baseTargets })
    const line = data.lineItems.find((l) => l.code === '99999')
    expect(line).toBeDefined()
    expect(line?.category).toBeNull()
  })
})
