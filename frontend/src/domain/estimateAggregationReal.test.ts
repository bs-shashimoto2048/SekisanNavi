import { describe, expect, it } from 'vitest'
import {
  PRODUCT_TARGET_ID,
  TIE_TARGET_ID,
  assignDetectionToPanel,
  buildRealEstimateAggregation,
  panelTargetId,
  resolveAssignmentTargetId,
} from './estimateAggregationReal'
import type { Detection, EstimateMasterItem, EstimatePanelInfo, PanelPreview } from '../types/domain'

function makePanel(overrides: Partial<PanelPreview> = {}): PanelPreview {
  return {
    page_no: 16,
    ban_menno: 1,
    ban_no: 1,
    ban_meisyou: '高圧受電盤',
    ban_type: '正面図',
    ban_h1: 2300,
    ban_h2: null,
    ban_w: 900,
    ban_d: 2200,
    normalized_rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    ...overrides,
  }
}

function makeDetection(overrides: Partial<Detection> = {}): Detection {
  return {
    id: 1,
    drawing_page_id: 1,
    panel_id: null,
    class_name: '11001',
    bbox_x: 0.15,
    bbox_y: 0.15,
    bbox_w: 0.05,
    bbox_h: 0.05,
    confidence: null,
    status: 'reviewed',
    source_type: 'manual',
    master_item_id: 10,
    leader_label_x: null,
    leader_label_y: null,
    master_item_category: '箱・単独',
    master_item_model: 'OS2-816',
    master_item_code: '11001',
    ...overrides,
  }
}

function makeMasterItem(overrides: Partial<EstimateMasterItem> = {}): EstimateMasterItem {
  return {
    id: 10,
    code: '11001',
    category: '箱・単独',
    model: 'OS2-816',
    rating: '2.3*0.8*1.6',
    note: null,
    total_price_a: 315300,
    box_parts_price: 61600,
    painting_price: 89100,
    setup_a: 216,
    sheet_metal_price: 1096,
    assembly_price: 351,
    inspection_price: 15,
    ...overrides,
  }
}

function panelsByPageNo(entries: [number, PanelPreview[]][]): Map<number, PanelPreview[]> {
  return new Map(entries)
}

describe('assignDetectionToPanel (BBox交差による所属判定。ロジック自体は前回から変更なし)', () => {
  it('assigns to product when the bbox does not intersect any panel', () => {
    const panel = makePanel({ normalized_rect: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } })
    const bbox = { x: 0, y: 0, w: 0.1, h: 0.1 }
    expect(assignDetectionToPanel(bbox, [panel])).toEqual({ kind: 'product' })
  })

  it('assigns to the single overlapping panel', () => {
    const panel = makePanel({ normalized_rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } })
    const bbox = { x: 0.15, y: 0.15, w: 0.05, h: 0.05 }
    const result = assignDetectionToPanel(bbox, [panel])
    expect(result.kind).toBe('panel')
    if (result.kind === 'panel') expect(result.panel).toBe(panel)
  })

  it('does not treat a mere edge-touch as an intersection', () => {
    const panel = makePanel({ normalized_rect: { x: 0.2, y: 0, w: 0.2, h: 0.2 } })
    const bbox = { x: 0, y: 0, w: 0.2, h: 0.2 }
    expect(assignDetectionToPanel(bbox, [panel])).toEqual({ kind: 'product' })
  })

  it('picks the panel with the larger intersection area when two panels both overlap', () => {
    const small = makePanel({ ban_menno: 1, ban_no: 1, normalized_rect: { x: 0, y: 0, w: 0.1, h: 0.1 } })
    const large = makePanel({ ban_menno: 2, ban_no: 1, normalized_rect: { x: 0.05, y: 0, w: 0.3, h: 0.3 } })
    const bbox = { x: 0, y: 0, w: 0.3, h: 0.1 }
    const result = assignDetectionToPanel(bbox, [small, large])
    expect(result.kind).toBe('panel')
    if (result.kind === 'panel') expect(result.panel).toBe(large)
  })

  it('reports a tie when two DIFFERENT panels have exactly the same max intersection area', () => {
    const left = makePanel({ ban_menno: 1, ban_no: 1, normalized_rect: { x: 0, y: 0, w: 0.25, h: 0.25 } })
    const right = makePanel({ ban_menno: 2, ban_no: 1, normalized_rect: { x: 0.5, y: 0, w: 0.25, h: 0.25 } })
    const bbox = { x: 0.125, y: 0, w: 0.5, h: 0.25 }
    const result = assignDetectionToPanel(bbox, [left, right])
    expect(result.kind).toBe('tie')
    if (result.kind === 'tie') expect(result.candidates).toHaveLength(2)
  })

  it('does NOT report a tie when the equal-area winners are different views (矢視) of the SAME physical panel', () => {
    const front = makePanel({ ban_menno: 1, ban_no: 1, ban_type: '正面図', normalized_rect: { x: 0, y: 0, w: 0.2, h: 0.2 } })
    const back = makePanel({ ban_menno: 1, ban_no: 1, ban_type: '背面図', normalized_rect: { x: 0, y: 0, w: 0.2, h: 0.2 } })
    const bbox = { x: 0.05, y: 0.05, w: 0.05, h: 0.05 }
    const result = assignDetectionToPanel(bbox, [front, back])
    expect(result.kind).toBe('panel')
  })
})

describe('buildRealEstimateAggregation (積算集約・積算明細UI再構成: 製番全体・複数ページ対応)', () => {
  it('excludes detections without master_item_id from aggregation and detail entirely', () => {
    const notLinked = makeDetection({ id: 99, master_item_id: null })
    const result = buildRealEstimateAggregation({
      detections: [{ detection: notLinked, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([]),
      estimatePanels: [],
      masterItemById: new Map(),
    })
    expect(result.lineItems).toHaveLength(0)
    expect(result.detailItems).toHaveLength(0)
  })

  it('assigns a detection with no panel overlap to the product target', () => {
    const panel = makePanel({ normalized_rect: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } })
    const detection = makeDetection({ bbox_x: 0, bbox_y: 0, bbox_w: 0.05, bbox_h: 0.05 })
    const masterItemById = new Map([[10, makeMasterItem()]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [panel]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.lineItems[0].targetId).toBe(PRODUCT_TARGET_ID)
    expect(result.detailItems[0].targetId).toBe(PRODUCT_TARGET_ID)
    expect(result.targets.some((t) => t.id === PRODUCT_TARGET_ID && t.name === '製品全体')).toBe(true)
  })

  it('assigns a detection overlapping a panel to that panel target, carrying banMenno/banNo on the target (対象セレクトの実識別子)', () => {
    const panel = makePanel({ ban_menno: 5, ban_no: 5, ban_meisyou: 'No.2-1低圧動力盤' })
    const detection = makeDetection({ bbox_x: 0.15, bbox_y: 0.15, bbox_w: 0.05, bbox_h: 0.05 })
    const estimatePanels: EstimatePanelInfo[] = [
      { model: 'IS2', ban_menno: 5, ban_no: 5, ban_meisyou: 'No.2-1低圧動力盤', ban_h: 2300, ban_w: 1700, ban_d: 2200, ban_connect: '箱・左右(L)', sort_order: 1 },
    ]
    const masterItemById = new Map([[10, makeMasterItem()]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [panel]]]),
      estimatePanels,
      masterItemById,
    })
    const panelTarget = result.targets.find((t) => t.type === 'panel')
    expect(panelTarget?.name).toBe('No.2-1低圧動力盤')
    expect(panelTarget?.banMenno).toBe(5)
    expect(panelTarget?.banNo).toBe(5)
    expect(result.lineItems[0].targetId).toBe(panelTarget?.id)
  })

  it('merges the SAME physical panel across TWO DIFFERENT pages into a single target (次々work指示の核心: 複数図面にまたがる盤)', () => {
    const p16Panel = makePanel({ page_no: 16, ban_menno: 5, ban_no: 5, ban_meisyou: 'No.2-1低圧動力盤' })
    const p29Panel = makePanel({ page_no: 29, ban_menno: 5, ban_no: 5, ban_meisyou: 'No.2-1低圧動力盤', normalized_rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 } })
    const detOnP16 = makeDetection({ id: 1, bbox_x: 0.15, bbox_y: 0.15, bbox_w: 0.05, bbox_h: 0.05 })
    const detOnP29 = makeDetection({ id: 2, master_item_id: 11, bbox_x: 0.15, bbox_y: 0.15, bbox_w: 0.05, bbox_h: 0.05 })
    const masterItemById = new Map([[10, makeMasterItem({ id: 10 })], [11, makeMasterItem({ id: 11, code: '18203', model: '加算' })]])
    const result = buildRealEstimateAggregation({
      detections: [
        { detection: detOnP16, pageNo: 16 },
        { detection: detOnP29, pageNo: 29 },
      ],
      panelsByPageNo: panelsByPageNo([[16, [p16Panel]], [29, [p29Panel]]]),
      estimatePanels: [],
      masterItemById,
    })
    const panelTargets = result.targets.filter((t) => t.type === 'panel')
    expect(panelTargets).toHaveLength(1) // 同一盤へ1つに統合される
    expect(result.lineItems.filter((l) => l.targetId === panelTargets[0].id)).toHaveLength(2)
    // 積算明細側は数量集約せず、どちらのページ由来かを保持したまま2行のまま。
    const details = result.detailItems.filter((d) => d.targetId === panelTargets[0].id)
    expect(details).toHaveLength(2)
    expect(details.map((d) => d.pageNo).sort()).toEqual([16, 29])
  })

  it('merges two detections with the same masterItemId/target/source into one aggregated line with quantity=2', () => {
    const panel = makePanel()
    const d1 = makeDetection({ id: 1, bbox_x: 0.12, bbox_y: 0.12, bbox_w: 0.02, bbox_h: 0.02 })
    const d2 = makeDetection({ id: 2, bbox_x: 0.2, bbox_y: 0.2, bbox_w: 0.02, bbox_h: 0.02 })
    const masterItemById = new Map([[10, makeMasterItem({ total_price_a: 50000 })]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection: d1, pageNo: 16 }, { detection: d2, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [panel]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.lineItems).toHaveLength(1)
    const line = result.lineItems[0]
    expect(line.quantity).toBe(2)
    expect(line.amount).toBe(100000)
  })

  it('keeps the detail items UN-merged (1 Detection = 1 row) even when the aggregated line item merges them (積算集約=数量集約, 積算明細=根拠追跡)', () => {
    const panel = makePanel()
    const d1 = makeDetection({ id: 1, bbox_x: 0.12, bbox_y: 0.12, bbox_w: 0.02, bbox_h: 0.02 })
    const d2 = makeDetection({ id: 2, bbox_x: 0.2, bbox_y: 0.2, bbox_w: 0.02, bbox_h: 0.02 })
    const d3 = makeDetection({ id: 3, bbox_x: 0.25, bbox_y: 0.25, bbox_w: 0.02, bbox_h: 0.02 })
    const masterItemById = new Map([[10, makeMasterItem()]])
    const result = buildRealEstimateAggregation({
      detections: [
        { detection: d1, pageNo: 16 },
        { detection: d2, pageNo: 16 },
        { detection: d3, pageNo: 16 },
      ],
      panelsByPageNo: panelsByPageNo([[16, [panel]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.lineItems).toHaveLength(1)
    expect(result.lineItems[0].quantity).toBe(3)
    expect(result.detailItems).toHaveLength(3)
    expect(new Set(result.detailItems.map((d) => d.detectionId))).toEqual(new Set([1, 2, 3]))
  })

  it('does NOT merge detections with different masterItemId even within the same target', () => {
    const panel = makePanel()
    const d1 = makeDetection({ id: 1, master_item_id: 10 })
    const d2 = makeDetection({ id: 2, master_item_id: 11 })
    const masterItemById = new Map([
      [10, makeMasterItem({ id: 10, model: 'OS2-816', rating: '2.3*0.8*1.6' })],
      [11, makeMasterItem({ id: 11, model: 'OS2-916', rating: '2.3*0.9*1.6' })],
    ])
    const result = buildRealEstimateAggregation({
      detections: [{ detection: d1, pageNo: 16 }, { detection: d2, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [panel]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.lineItems).toHaveLength(2)
  })

  it('keeps AI-sourced and manually-added detections of the same masterItemId as separate aggregated lines', () => {
    const panel = makePanel()
    const d1 = makeDetection({ id: 1, source_type: 'ai' })
    const d2 = makeDetection({ id: 2, source_type: 'manual' })
    const masterItemById = new Map([[10, makeMasterItem()]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection: d1, pageNo: 16 }, { detection: d2, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [panel]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.lineItems).toHaveLength(2)
    expect(result.lineItems.map((l) => l.source).sort()).toEqual(['ai', 'manual'])
  })

  it('leaves amount as null (not 0) when the master item has no total_price_a', () => {
    const panel = makePanel()
    const detection = makeDetection()
    const masterItemById = new Map([[10, makeMasterItem({ total_price_a: null })]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [panel]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.lineItems[0].unitPrice).toBeNull()
    expect(result.lineItems[0].amount).toBeNull()
  })

  it('routes a tie-classified detection to the dedicated "tie" target', () => {
    const left = makePanel({ ban_menno: 1, ban_no: 1, normalized_rect: { x: 0, y: 0, w: 0.25, h: 0.25 } })
    const right = makePanel({ ban_menno: 2, ban_no: 1, normalized_rect: { x: 0.5, y: 0, w: 0.25, h: 0.25 } })
    const detection = makeDetection({ bbox_x: 0.125, bbox_y: 0, bbox_w: 0.5, bbox_h: 0.25 })
    const masterItemById = new Map([[10, makeMasterItem()]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [left, right]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.lineItems[0].targetId).toBe(TIE_TARGET_ID)
    expect(result.detailItems[0].targetId).toBe(TIE_TARGET_ID)
    expect(result.targets.some((t) => t.id === TIE_TARGET_ID)).toBe(true)
  })

  it('does not include the tie target when no detection is actually tied', () => {
    const panel = makePanel()
    const detection = makeDetection()
    const masterItemById = new Map([[10, makeMasterItem()]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [panel]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.targets.some((t) => t.id === TIE_TARGET_ID)).toBe(false)
  })

  it('always includes a target for every distinct physical panel across all pages, even with zero matching estimate codes', () => {
    const panelWithItem = makePanel({ ban_menno: 1, ban_no: 1 })
    const panelWithoutItem = makePanel({ ban_menno: 2, ban_no: 1, normalized_rect: { x: 0.6, y: 0.6, w: 0.1, h: 0.1 } })
    const detection = makeDetection({ bbox_x: 0.15, bbox_y: 0.15, bbox_w: 0.02, bbox_h: 0.02 })
    const masterItemById = new Map([[10, makeMasterItem()]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [panelWithItem, panelWithoutItem]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.targets.filter((t) => t.type === 'panel')).toHaveLength(2)
  })

  it('sorts panel targets by banMenno ascending', () => {
    const p5 = makePanel({ ban_menno: 5, ban_no: 5 })
    const p1 = makePanel({ ban_menno: 1, ban_no: 1, normalized_rect: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } })
    const result = buildRealEstimateAggregation({
      detections: [],
      panelsByPageNo: panelsByPageNo([[16, [p5, p1]]]),
      estimatePanels: [],
      masterItemById: new Map(),
    })
    const panelTargets = result.targets.filter((t) => t.type === 'panel')
    expect(panelTargets.map((t) => t.banMenno)).toEqual([1, 5])
  })

  it('carries drawingPageId/pageNo/status through to the detail item for Viewer navigation and honest status display', () => {
    const panel = makePanel()
    const detection = makeDetection({ drawing_page_id: 42, status: 'needs_review' })
    const masterItemById = new Map([[10, makeMasterItem()]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [panel]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.detailItems[0].drawingPageId).toBe(42)
    expect(result.detailItems[0].pageNo).toBe(16)
    expect(result.detailItems[0].status).toBe('needs_review')
  })

  it('derives itemName from the Master tab label via getCategoryPresentation, not the raw category value (明細遷移後のBBox残留・Hover色・品名列修正 指示3章)', () => {
    const panel = makePanel()
    // 実データのestimate_master_items.category内部値は半角中点(･)混在。
    // Master Picker(EstimateMasterPicker.tsx)のタブは`getCategoryPresentation`で
    // 全角統一した表示名("箱・単独")へ変換して見せているため、積算明細の品名も
    // 変換後の表示名と一致し、内部値そのものとは異なることを確認する。
    const detection = makeDetection({ master_item_category: '箱･単独' })
    const masterItemById = new Map([[10, makeMasterItem()]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [panel]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.detailItems[0].itemName).toBe('箱・単独')
    expect(result.detailItems[0].itemName).not.toBe(detection.master_item_category)
  })

  it('falls back to "-" (null) for itemName when the Detection has no master_item_category', () => {
    const panel = makePanel()
    const detection = makeDetection({ master_item_category: null })
    const masterItemById = new Map([[10, makeMasterItem()]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [panel]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.detailItems[0].itemName).toBeNull()
  })

  it('formats content as "model / rating", falling back to model only, then to code when both are missing', () => {
    const panel = makePanel()
    const both = makeDetection({ id: 1, master_item_id: 10, master_item_model: '換気扇' })
    const modelOnly = makeDetection({ id: 2, master_item_id: 11, master_item_model: '側面扉（無）' })
    const neither = makeDetection({ id: 3, master_item_id: 12, master_item_model: null, master_item_code: '99999' })
    const masterItemById = new Map([
      [10, makeMasterItem({ id: 10, rating: '上部取付' })],
      [11, makeMasterItem({ id: 11, rating: null })],
      [12, makeMasterItem({ id: 12, rating: null })],
    ])
    const result = buildRealEstimateAggregation({
      detections: [{ detection: both, pageNo: 16 }, { detection: modelOnly, pageNo: 16 }, { detection: neither, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [panel]]]),
      estimatePanels: [],
      masterItemById,
    })
    const byMaster = new Map(result.lineItems.map((l) => [l.masterItemId, l]))
    expect(byMaster.get(10)?.content).toBe('換気扇 / 上部取付')
    expect(byMaster.get(11)?.content).toBe('側面扉（無）')
    expect(byMaster.get(12)?.content).toBe('99999')
  })
})

describe('buildRealEstimateAggregation: totalLineItems (Sekisan Navi 追加修正指示: 積算集約の数量集約)', () => {
  it('merges the SAME masterItemId across THREE DIFFERENT panels into a single totalLineItems row with quantity=3 (指示2章/3章/17章の核心シナリオ)', () => {
    const p1 = makePanel({ ban_menno: 1, ban_no: 1, normalized_rect: { x: 0, y: 0, w: 0.2, h: 0.2 } })
    const p2 = makePanel({ ban_menno: 2, ban_no: 2, normalized_rect: { x: 0.3, y: 0, w: 0.2, h: 0.2 } })
    const p3 = makePanel({ ban_menno: 3, ban_no: 3, normalized_rect: { x: 0.6, y: 0, w: 0.2, h: 0.2 } })
    const d1 = makeDetection({ id: 1, bbox_x: 0.05, bbox_y: 0.05, bbox_w: 0.02, bbox_h: 0.02 })
    const d2 = makeDetection({ id: 2, bbox_x: 0.35, bbox_y: 0.05, bbox_w: 0.02, bbox_h: 0.02 })
    const d3 = makeDetection({ id: 3, bbox_x: 0.65, bbox_y: 0.05, bbox_w: 0.02, bbox_h: 0.02 })
    const masterItemById = new Map([[10, makeMasterItem({ total_price_a: 23100 })]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection: d1, pageNo: 16 }, { detection: d2, pageNo: 16 }, { detection: d3, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [p1, p2, p3]]]),
      estimatePanels: [],
      masterItemById,
    })
    // 対象別(lineItems)は3つの異なる盤へ分かれたまま(各quantity=1)。
    expect(result.lineItems).toHaveLength(3)
    expect(result.lineItems.every((l) => l.quantity === 1)).toBe(true)
    // 総合計用(totalLineItems)は対象を横断して1行にまとまる。
    expect(result.totalLineItems).toHaveLength(1)
    const total = result.totalLineItems[0]
    expect(total.quantity).toBe(3)
    expect(total.amount).toBe(23100 * 3)
    expect(total.targetId).toBeNull()
    expect(new Set(total.detectionIds)).toEqual(new Set([1, 2, 3]))
  })

  it('keeps different masterItemId as separate totalLineItems rows even across the same or different panels', () => {
    const panel = makePanel()
    const d1 = makeDetection({ id: 1, master_item_id: 10 })
    const d2 = makeDetection({ id: 2, master_item_id: 11 })
    const masterItemById = new Map([
      [10, makeMasterItem({ id: 10 })],
      [11, makeMasterItem({ id: 11, code: '18203', model: '加算' })],
    ])
    const result = buildRealEstimateAggregation({
      detections: [{ detection: d1, pageNo: 16 }, { detection: d2, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [panel]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.totalLineItems).toHaveLength(2)
  })

  it('does not merge two DIFFERENT masterItemId that happen to share the same displayed code (安全性: codeではなくmasterItemIdをキーにする)', () => {
    const panel = makePanel()
    const d1 = makeDetection({ id: 1, master_item_id: 10, master_item_code: '99999' })
    const d2 = makeDetection({ id: 2, master_item_id: 99, master_item_code: '99999' })
    const masterItemById = new Map([
      [10, makeMasterItem({ id: 10, code: '99999' })],
      [99, makeMasterItem({ id: 99, code: '99999', total_price_a: 1234 })],
    ])
    const result = buildRealEstimateAggregation({
      detections: [{ detection: d1, pageNo: 16 }, { detection: d2, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [panel]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.totalLineItems).toHaveLength(2)
    expect(new Set(result.totalLineItems.map((l) => l.masterItemId))).toEqual(new Set([10, 99]))
  })

  it('sums negative unit prices across merged detections without special-casing them (指示9章)', () => {
    const p1 = makePanel({ ban_menno: 1, ban_no: 1, normalized_rect: { x: 0, y: 0, w: 0.2, h: 0.2 } })
    const p2 = makePanel({ ban_menno: 2, ban_no: 2, normalized_rect: { x: 0.3, y: 0, w: 0.2, h: 0.2 } })
    const d1 = makeDetection({ id: 1, bbox_x: 0.05, bbox_y: 0.05, bbox_w: 0.02, bbox_h: 0.02 })
    const d2 = makeDetection({ id: 2, bbox_x: 0.35, bbox_y: 0.05, bbox_w: 0.02, bbox_h: 0.02 })
    const masterItemById = new Map([[10, makeMasterItem({ total_price_a: -9700 })]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection: d1, pageNo: 16 }, { detection: d2, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [p1, p2]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.totalLineItems[0].quantity).toBe(2)
    expect(result.totalLineItems[0].amount).toBe(-19400)
  })

  it('aggregates correctly within 製品全体 alone (no panel overlap at all)', () => {
    const panel = makePanel({ normalized_rect: { x: 0.8, y: 0.8, w: 0.1, h: 0.1 } }) // どのdetectionとも交差しない
    const d1 = makeDetection({ id: 1, bbox_x: 0.05, bbox_y: 0.05, bbox_w: 0.02, bbox_h: 0.02 })
    const d2 = makeDetection({ id: 2, bbox_x: 0.15, bbox_y: 0.05, bbox_w: 0.02, bbox_h: 0.02 })
    const masterItemById = new Map([[10, makeMasterItem({ total_price_a: 1000 })]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection: d1, pageNo: 16 }, { detection: d2, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [panel]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.lineItems).toHaveLength(1)
    expect(result.lineItems[0].targetId).toBe(PRODUCT_TARGET_ID)
    expect(result.lineItems[0].quantity).toBe(2)
    expect(result.totalLineItems).toHaveLength(1)
    expect(result.totalLineItems[0].quantity).toBe(2)
    expect(result.totalLineItems[0].amount).toBe(2000)
  })

  it('aggregates correctly within the tie target alone (要確認)', () => {
    const left = makePanel({ ban_menno: 1, ban_no: 1, normalized_rect: { x: 0, y: 0, w: 0.25, h: 0.25 } })
    const right = makePanel({ ban_menno: 2, ban_no: 1, normalized_rect: { x: 0.5, y: 0, w: 0.25, h: 0.25 } })
    const d1 = makeDetection({ id: 1, bbox_x: 0.125, bbox_y: 0, bbox_w: 0.5, bbox_h: 0.25 })
    const d2 = makeDetection({ id: 2, bbox_x: 0.125, bbox_y: 0, bbox_w: 0.5, bbox_h: 0.25 })
    const masterItemById = new Map([[10, makeMasterItem({ total_price_a: 500 })]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection: d1, pageNo: 16 }, { detection: d2, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [left, right]]]),
      estimatePanels: [],
      masterItemById,
    })
    expect(result.lineItems).toHaveLength(1)
    expect(result.lineItems[0].targetId).toBe(TIE_TARGET_ID)
    expect(result.lineItems[0].quantity).toBe(2)
    expect(result.totalLineItems[0].quantity).toBe(2)
    expect(result.totalLineItems[0].amount).toBe(1000)
  })

  it('never reduces the detail item count, regardless of how many rows get merged in lineItems/totalLineItems (積算明細は1 Detection = 1行のまま、指示12章)', () => {
    const p1 = makePanel({ ban_menno: 1, ban_no: 1, normalized_rect: { x: 0, y: 0, w: 0.2, h: 0.2 } })
    const p2 = makePanel({ ban_menno: 2, ban_no: 2, normalized_rect: { x: 0.3, y: 0, w: 0.2, h: 0.2 } })
    const p3 = makePanel({ ban_menno: 3, ban_no: 3, normalized_rect: { x: 0.6, y: 0, w: 0.2, h: 0.2 } })
    const d1 = makeDetection({ id: 1, bbox_x: 0.05, bbox_y: 0.05, bbox_w: 0.02, bbox_h: 0.02 })
    const d2 = makeDetection({ id: 2, bbox_x: 0.35, bbox_y: 0.05, bbox_w: 0.02, bbox_h: 0.02 })
    const d3 = makeDetection({ id: 3, bbox_x: 0.65, bbox_y: 0.05, bbox_w: 0.02, bbox_h: 0.02 })
    const masterItemById = new Map([[10, makeMasterItem()]])
    const result = buildRealEstimateAggregation({
      detections: [{ detection: d1, pageNo: 16 }, { detection: d2, pageNo: 16 }, { detection: d3, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [p1, p2, p3]]]),
      estimatePanels: [],
      masterItemById,
    })
    // lineItems=3行、totalLineItems=1行 と粒度が異なっていても、積算明細は必ず3件。
    expect(result.lineItems).toHaveLength(3)
    expect(result.totalLineItems).toHaveLength(1)
    expect(result.detailItems).toHaveLength(3)
    expect(new Set(result.detailItems.map((d) => d.detectionId))).toEqual(new Set([1, 2, 3]))
  })

  it('does not double-count: the sum of totalLineItems amounts equals the sum of detailItems-derived amounts (製番合計の整合、指示18章)', () => {
    const p1 = makePanel({ ban_menno: 1, ban_no: 1, normalized_rect: { x: 0, y: 0, w: 0.2, h: 0.2 } })
    const p2 = makePanel({ ban_menno: 2, ban_no: 2, normalized_rect: { x: 0.3, y: 0, w: 0.2, h: 0.2 } })
    const d1 = makeDetection({ id: 1, master_item_id: 10, bbox_x: 0.05, bbox_y: 0.05, bbox_w: 0.02, bbox_h: 0.02 })
    const d2 = makeDetection({ id: 2, master_item_id: 10, bbox_x: 0.35, bbox_y: 0.05, bbox_w: 0.02, bbox_h: 0.02 })
    const d3 = makeDetection({ id: 3, master_item_id: 11, bbox_x: 0.05, bbox_y: 0.15, bbox_w: 0.02, bbox_h: 0.02 })
    const masterItemById = new Map([
      [10, makeMasterItem({ id: 10, total_price_a: 23100 })],
      [11, makeMasterItem({ id: 11, code: '18330', total_price_a: -9700 })],
    ])
    const result = buildRealEstimateAggregation({
      detections: [{ detection: d1, pageNo: 16 }, { detection: d2, pageNo: 16 }, { detection: d3, pageNo: 16 }],
      panelsByPageNo: panelsByPageNo([[16, [p1, p2]]]),
      estimatePanels: [],
      masterItemById,
    })
    const totalFromTotalLineItems = result.totalLineItems.reduce((sum, l) => sum + (l.amount ?? 0), 0)
    // detailItemsは金額を持たないため、各行のmasterItemIdからunit priceを引いて独立に再計算する。
    const totalFromDetailItems = result.detailItems.reduce((sum, d) => {
      const unit = masterItemById.get(d.masterItemId)?.total_price_a ?? 0
      return sum + unit
    }, 0)
    expect(totalFromTotalLineItems).toBe(totalFromDetailItems)
    expect(totalFromTotalLineItems).toBe(23100 * 2 - 9700)
    // 対象別lineItemsの合計とも一致する(同じ実データを異なる粒度で集約しているだけ)。
    const totalFromLineItems = result.lineItems.reduce((sum, l) => sum + (l.amount ?? 0), 0)
    expect(totalFromLineItems).toBe(totalFromTotalLineItems)
  })
})

describe('resolveAssignmentTargetId (積算明細強化・Undo/Redo・要確認警告・編集追従 指示8章)', () => {
  it('resolves a "product" assignment to PRODUCT_TARGET_ID', () => {
    expect(resolveAssignmentTargetId({ kind: 'product' })).toBe(PRODUCT_TARGET_ID)
  })

  it('resolves a "panel" assignment to the same panelTargetId() the aggregation logic uses', () => {
    const panel = makePanel({ ban_menno: 2, ban_no: 2 })
    expect(resolveAssignmentTargetId({ kind: 'panel', panel, area: 0.01 })).toBe(panelTargetId(panel))
    expect(resolveAssignmentTargetId({ kind: 'panel', panel, area: 0.01 })).toBe('panel:2:2')
  })

  it('resolves a "tie" assignment to TIE_TARGET_ID', () => {
    const panel = makePanel()
    expect(resolveAssignmentTargetId({ kind: 'tie', candidates: [{ panel, area: 0.01 }] })).toBe(TIE_TARGET_ID)
  })
})
