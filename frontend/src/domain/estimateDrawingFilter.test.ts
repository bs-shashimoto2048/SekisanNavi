import { describe, expect, it } from 'vitest'
import { visiblePageNosForTarget } from './estimateDrawingFilter'
import type { PanelPreview } from '../types/domain'
import type { EstimateDetailItem, EstimateTarget } from '../types/estimateAggregation'

function makePanel(overrides: Partial<PanelPreview> = {}): PanelPreview {
  return {
    page_no: 16,
    ban_menno: 1,
    ban_no: 1,
    ban_meisyou: '高圧受電盤',
    ban_type: '正面図',
    ban_h1: null,
    ban_h2: null,
    ban_w: null,
    ban_d: null,
    normalized_rect: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
    ...overrides,
  }
}

function makeDetailItem(overrides: Partial<EstimateDetailItem> = {}): EstimateDetailItem {
  return {
    id: '1',
    detectionId: 1,
    drawingPageId: 1,
    pageNo: 16,
    targetId: 'product',
    source: 'manual',
    masterItemId: 10,
    code: '18311',
    itemName: '附属品加算価格',
    model: null,
    rating: null,
    status: 'reviewed',
    editedAt: null,
    editSequence: 0,
    ...overrides,
  }
}

const productTarget: EstimateTarget = { id: 'product', type: 'product', name: '製品全体', banMenno: null, banNo: null }
const panelTarget: EstimateTarget = {
  id: 'panel:5:5',
  type: 'panel',
  name: 'No.2-1低圧動力盤',
  banMenno: 5,
  banNo: 5,
}
const tieTarget: EstimateTarget = {
  id: '__tie__',
  type: 'tie',
  name: '要確認（複数盤の交差面積が同値）',
  banMenno: null,
  banNo: null,
}

describe('visiblePageNosForTarget (積算対象連動の金額表示・図面一覧絞り込み 指示4章〜6章)', () => {
  it('returns null (no filtering) for 総合計 (target === null)', () => {
    expect(visiblePageNosForTarget(null, [], new Map())).toBeNull()
  })

  it('returns every page where the physical panel (banMenno/banNo) actually appears, even across multiple pages (盤1つ=図面1枚とは限らない、指示4章)', () => {
    const panelsByPageNo = new Map<number, PanelPreview[]>([
      [16, [makePanel({ page_no: 16, ban_menno: 5, ban_no: 5 })]],
      [29, [makePanel({ page_no: 29, ban_menno: 5, ban_no: 5 })]],
      [18, [makePanel({ page_no: 18, ban_menno: 1, ban_no: 1 })]], // 別の盤
    ])
    const result = visiblePageNosForTarget(panelTarget, [], panelsByPageNo)
    expect(result).toEqual(new Set([16, 29]))
  })

  it('does not match a page whose panel has the same ban_no but a different ban_menno (物理盤の識別はbanMenno+banNoの組で行う)', () => {
    const panelsByPageNo = new Map<number, PanelPreview[]>([
      [16, [makePanel({ page_no: 16, ban_menno: 5, ban_no: 5 })]],
      [20, [makePanel({ page_no: 20, ban_menno: 9, ban_no: 5 })]], // ban_noだけ一致
    ])
    const result = visiblePageNosForTarget(panelTarget, [], panelsByPageNo)
    expect(result).toEqual(new Set([16]))
  })

  it('for 製品全体/要確認, uses the pageNo of the detail items belonging to that target (Detectionの実所属ページ、指示5章)', () => {
    const detailItems = [
      makeDetailItem({ id: 'a', targetId: 'product', pageNo: 16 }),
      makeDetailItem({ id: 'b', targetId: 'product', pageNo: 29 }),
      makeDetailItem({ id: 'c', targetId: 'panel:1:1', pageNo: 18 }), // 別対象
    ]
    const result = visiblePageNosForTarget(productTarget, detailItems, new Map())
    expect(result).toEqual(new Set([16, 29]))
  })

  it('returns an empty set (not null) when 製品全体 has zero matching detail items (指示5章: 空表示は許容するが絞り込みなしとは区別する)', () => {
    const result = visiblePageNosForTarget(productTarget, [], new Map())
    expect(result).toEqual(new Set())
    expect(result).not.toBeNull()
  })

  it('applies the same detailItems-based rule to the tie (要確認) target', () => {
    const detailItems = [makeDetailItem({ id: 'a', targetId: '__tie__', pageNo: 21 })]
    const result = visiblePageNosForTarget(tieTarget, detailItems, new Map())
    expect(result).toEqual(new Set([21]))
  })
})
