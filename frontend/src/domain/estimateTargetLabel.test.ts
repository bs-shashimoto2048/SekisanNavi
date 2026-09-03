import { describe, expect, it } from 'vitest'
import { formatTargetLabel } from './estimateTargetLabel'
import type { EstimateTarget } from '../types/estimateAggregation'

describe('formatTargetLabel (積算明細強化・Undo/Redo・要確認警告・編集追従 指示9章)', () => {
  it('returns "-" for null (no target)', () => {
    expect(formatTargetLabel(null)).toBe('-')
  })

  it('formats a panel target as "面X / 盤Y"', () => {
    const target: EstimateTarget = { id: 'panel:1:1', type: 'panel', name: '高圧受電盤', banMenno: 1, banNo: 1 }
    expect(formatTargetLabel(target)).toBe('面1 / 盤1')
  })

  it('formats the product target as "製品全体"', () => {
    const target: EstimateTarget = { id: 'product', type: 'product', name: '製品全体', banMenno: null, banNo: null }
    expect(formatTargetLabel(target)).toBe('製品全体')
  })

  it('formats the tie target as "要確認"', () => {
    const target: EstimateTarget = {
      id: '__tie__',
      type: 'tie',
      name: '要確認（複数盤の交差面積が同値）',
      banMenno: null,
      banNo: null,
    }
    expect(formatTargetLabel(target)).toBe('要確認')
  })
})
