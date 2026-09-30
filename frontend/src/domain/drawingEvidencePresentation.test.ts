import { describe, expect, it } from 'vitest'
import {
  applicableUnitLabel,
  judgmentScopeLabel,
  usageLabel,
  APPLICABLE_UNIT_LABELS,
  JUDGMENT_SCOPE_LABELS,
  USAGE_LABELS,
} from './drawingEvidencePresentation'
import type { ApplicableUnit, EvidenceUsage, JudgmentScope } from '../types/domain'

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

  it('specific label spot-checks matching Issue #40 UI examples', () => {
    expect(judgmentScopeLabel('panel')).toBe('盤全体')
    expect(judgmentScopeLabel('design_data')).toBe('設計データ')
    expect(usageLabel('both')).toBe('両方')
    expect(applicableUnitLabel('face')).toBe('1面')
  })
})
