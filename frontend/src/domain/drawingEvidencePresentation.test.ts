import { describe, expect, it } from 'vitest'
import {
  applicableUnitLabel,
  designDataFieldLabel,
  designDataOperatorLabel,
  formatDesignDataAnyOfGroups,
  formatDesignDataCondition,
  judgmentMethodLabel,
  judgmentScopeLabel,
  parseDesignDataRef,
  usageLabel,
  APPLICABLE_UNIT_LABELS,
  JUDGMENT_METHOD_LABELS,
  JUDGMENT_SCOPE_LABELS,
  USAGE_LABELS,
} from './drawingEvidencePresentation'
import type { ApplicableUnit, EvidenceUsage, JudgmentMethod, JudgmentScope } from '../types/domain'

describe('drawingEvidencePresentation (Issue #40 Phase 3: 作業者向けには英語enumを表示しない)', () => {
  it('translates every EvidenceUsage value to a Japanese label', () => {
    const usages: EvidenceUsage[] = ['estimate_target', 'condition', 'both']
    for (const u of usages) {
      const label = usageLabel(u)
      expect(label).toBe(USAGE_LABELS[u])
      expect(label).not.toBe(u) // 英語enum値そのものを出さない
    }
  })

  it('translates every JudgmentScope value to a Japanese label', () => {
    const scopes: JudgmentScope[] = ['position', 'range', 'panel', 'drawing', 'product', 'design_data']
    for (const s of scopes) {
      const label = judgmentScopeLabel(s)
      expect(label).toBe(JUDGMENT_SCOPE_LABELS[s])
      expect(label).not.toBe(s)
    }
  })

  it('translates every ApplicableUnit value to a Japanese label', () => {
    const units: ApplicableUnit[] = ['face', 'unit', 'product', 'location', 'sheet', 'actual_quantity', 'other']
    for (const u of units) {
      const label = applicableUnitLabel(u)
      expect(label).toBe(APPLICABLE_UNIT_LABELS[u])
      expect(label).not.toBe(u)
    }
  })

  it('translates every JudgmentMethod value to a Japanese label', () => {
    const methods: JudgmentMethod[] = ['design_data', 'drawing_judgment', 'needs_confirmation']
    for (const m of methods) {
      const label = judgmentMethodLabel(m)
      expect(label).toBe(JUDGMENT_METHOD_LABELS[m])
      expect(label).not.toBe(m)
    }
  })

  it('specific label spot-checks matching Issue #40 UI examples', () => {
    expect(judgmentScopeLabel('panel')).toBe('盤全体')
    expect(judgmentScopeLabel('design_data')).toBe('設計データ')
    expect(usageLabel('both')).toBe('両方')
    expect(applicableUnitLabel('face')).toBe('1面')
    expect(judgmentMethodLabel('design_data')).toBe('設計データ')
    expect(judgmentMethodLabel('drawing_judgment')).toBe('図面判定')
    expect(judgmentMethodLabel('needs_confirmation')).toBe('要確認')
  })
})

describe('design_data_ref presentation (Issue #40 Phase 6-B: 内部field名をそのまま表示しない)', () => {
  it('translates every DesignDataContext field name used in judgment conditions to Japanese', () => {
    const fields: [string, string][] = [
      ['ban_menno', '面'],
      ['ban_no', '盤'],
      ['ban_meisyou', '盤名称'],
      ['model', '型式'],
      ['ban_h1', '正面高さ'],
      ['ban_h2', '背面高さ'],
      ['ban_w', '幅'],
      ['ban_d', '奥行'],
      ['ban_connect', '接続'],
    ]
    for (const [field, label] of fields) {
      expect(designDataFieldLabel(field)).toBe(label)
    }
  })

  it('falls back to the raw field name for an unknown field, rather than guessing a label', () => {
    expect(designDataFieldLabel('unknown_field')).toBe('unknown_field')
  })

  it('translates every supported operator to a natural symbol', () => {
    expect(designDataOperatorLabel('==')).toBe('=')
    expect(designDataOperatorLabel('!=')).toBe('≠')
    expect(designDataOperatorLabel('>=')).toBe('≥')
    expect(designDataOperatorLabel('<=')).toBe('≤')
    expect(designDataOperatorLabel('>')).toBe('>')
    expect(designDataOperatorLabel('<')).toBe('<')
  })

  it('parses a Phase 6-B design_data_ref with conditions', () => {
    const ref = parseDesignDataRef(
      JSON.stringify({
        panel: '1:1',
        conditions: [{ field: 'ban_w', operator: '>=', expected_value: 900, actual_value: 1200 }],
      }),
    )
    expect(ref).toEqual({
      panel: '1:1',
      conditions: [{ field: 'ban_w', operator: '>=', expected_value: 900, actual_value: 1200 }],
    })
  })

  it('parses a pre-Phase-6-B design_data_ref ({"panel": "..."} only) as an empty conditions list, not an error', () => {
    const ref = parseDesignDataRef('{"panel": "1:1"}')
    expect(ref).toEqual({ panel: '1:1', conditions: [] })
  })

  it('returns null for invalid/unparseable JSON, rather than throwing or fabricating a value', () => {
    expect(parseDesignDataRef('not json')).toBeNull()
    expect(parseDesignDataRef(null)).toBeNull()
    expect(parseDesignDataRef(undefined)).toBeNull()
  })

  it('formats a condition as "field: actual operator expected", matching the Issue #40 Phase 6-B UI example', () => {
    expect(
      formatDesignDataCondition({ field: 'ban_w', operator: '>=', expected_value: 900, actual_value: 1200 }),
    ).toBe('幅: 1200 ≥ 900')
    expect(
      formatDesignDataCondition({ field: 'ban_d', operator: '==', expected_value: 2200, actual_value: 2200 }),
    ).toBe('奥行: 2200 = 2200')
  })

  it('shows "不明" for actual_value rather than fabricating a number when it is null', () => {
    expect(
      formatDesignDataCondition({ field: 'ban_w', operator: '>=', expected_value: 900, actual_value: null }),
    ).toBe('幅: 不明 ≥ 900')
  })

  it('[Issue #40 Phase 6-E] formats starts_with as a natural Japanese sentence, not a symbol', () => {
    expect(
      formatDesignDataCondition({ field: 'model', operator: 'starts_with', expected_value: 'IS', actual_value: 'IS2' }),
    ).toBe('型式: IS2 が "IS" で始まる')
  })

  it('[Issue #40 Phase 6-E] formats in with the candidate list, not a symbol', () => {
    expect(
      formatDesignDataCondition({
        field: 'model',
        operator: 'in',
        expected_value: ['IS1', 'IS2', 'OS1'],
        actual_value: 'IS2',
      }),
    ).toBe('型式: IS2 が [IS1, IS2, OS1] のいずれか')
  })
})

describe('design_data_ref OR (any_of) presentation (Issue #40 Phase 6-F指示B)', () => {
  it('parses a design_data_ref with any_of groups', () => {
    const ref = parseDesignDataRef(
      JSON.stringify({
        panel: '1:1',
        conditions: [],
        any_of: [
          {
            matched: true,
            conditions: [{ field: 'model', operator: 'starts_with', expected_value: 'IS', actual_value: 'IS2' }],
          },
          {
            matched: false,
            conditions: [{ field: 'model', operator: 'starts_with', expected_value: 'OS', actual_value: 'IS2' }],
          },
        ],
      }),
    )
    expect(ref?.any_of).toHaveLength(2)
    expect(ref?.any_of?.[0].matched).toBe(true)
    expect(ref?.any_of?.[1].matched).toBe(false)
  })

  it('omits any_of (undefined) for a design_data_ref without OR conditions (Phase 6-E以前との後方互換)', () => {
    const ref = parseDesignDataRef(JSON.stringify({ panel: '1:1', conditions: [] }))
    expect(ref?.any_of).toBeUndefined()
  })

  it('still parses a pre-Phase-6-B design_data_ref ({"panel": "..."} only) without any_of', () => {
    const ref = parseDesignDataRef('{"panel": "1:1"}')
    expect(ref).toEqual({ panel: '1:1', conditions: [] })
    expect(ref?.any_of).toBeUndefined()
  })

  it('formats any_of groups with a matched/unmatched marker per group', () => {
    const lines = formatDesignDataAnyOfGroups([
      {
        matched: true,
        conditions: [{ field: 'model', operator: 'starts_with', expected_value: 'IS', actual_value: 'IS2' }],
      },
      {
        matched: false,
        conditions: [{ field: 'model', operator: 'starts_with', expected_value: 'OS', actual_value: 'IS2' }],
      },
    ])
    expect(lines).toEqual(['○ 型式: IS2 が "IS" で始まる', '× 型式: IS2 が "OS" で始まる'])
  })

  it('joins multiple AND conditions within one OR group with "かつ"', () => {
    const lines = formatDesignDataAnyOfGroups([
      {
        matched: true,
        conditions: [
          { field: 'model', operator: 'starts_with', expected_value: 'IS', actual_value: 'IS2' },
          { field: 'ban_w', operator: '>=', expected_value: 900, actual_value: 1200 },
        ],
      },
    ])
    expect(lines).toEqual(['○ 型式: IS2 が "IS" で始まる かつ 幅: 1200 ≥ 900'])
  })
})
