import { describe, expect, it } from 'vitest'
import {
  computeInitialLabelPosition,
  intersectionArea,
  moveRect,
  resizeRect,
  shiftLabelWithBBox,
  topRightCorner,
} from './bbox'

const ORIGINAL = { x: 0.2, y: 0.2, w: 0.2, h: 0.1 } // spans x:0.2-0.4, y:0.2-0.3

describe('resizeRect', () => {
  it('bottom-right handle keeps top-left fixed and moves the bottom-right corner', () => {
    const rect = resizeRect(ORIGINAL, 'bottom-right', 0.5, 0.4, 0.001)
    expect(rect.x).toBeCloseTo(0.2)
    expect(rect.y).toBeCloseTo(0.2)
    expect(rect.w).toBeCloseTo(0.3)
    expect(rect.h).toBeCloseTo(0.2)
  })

  it('top-left handle keeps bottom-right fixed and moves the top-left corner', () => {
    const rect = resizeRect(ORIGINAL, 'top-left', 0.1, 0.1, 0.001)
    expect(rect.x).toBeCloseTo(0.1)
    expect(rect.y).toBeCloseTo(0.1)
    // fixed corner = original bottom-right = (0.4, 0.3)
    expect(rect.x + rect.w).toBeCloseTo(0.4)
    expect(rect.y + rect.h).toBeCloseTo(0.3)
  })

  it('top-right handle keeps bottom-left fixed', () => {
    const rect = resizeRect(ORIGINAL, 'top-right', 0.5, 0.1, 0.001)
    // fixed corner = original bottom-left = (0.2, 0.3)
    expect(rect.x).toBeCloseTo(0.2)
    expect(rect.y + rect.h).toBeCloseTo(0.3)
    expect(rect.x + rect.w).toBeCloseTo(0.5)
    expect(rect.y).toBeCloseTo(0.1)
  })

  it('bottom-left handle keeps top-right fixed', () => {
    const rect = resizeRect(ORIGINAL, 'bottom-left', 0.1, 0.5, 0.001)
    // fixed corner = original top-right = (0.4, 0.2)
    expect(rect.x + rect.w).toBeCloseTo(0.4)
    expect(rect.y).toBeCloseTo(0.2)
    expect(rect.x).toBeCloseTo(0.1)
    expect(rect.y + rect.h).toBeCloseTo(0.5)
  })

  it('clamps the dragged point to the page bounds [0,1]', () => {
    const rect = resizeRect(ORIGINAL, 'bottom-right', 1.5, -0.5, 0.001)
    expect(rect.x + rect.w).toBeLessThanOrEqual(1)
    expect(rect.y).toBeGreaterThanOrEqual(0)
  })

  it('stops at the minimum size instead of flipping the handle role when dragged past the fixed corner', () => {
    // bottom-right handle dragged to the left of/above the fixed top-left corner
    const rect = resizeRect(ORIGINAL, 'bottom-right', 0.0, 0.0, 0.01)
    expect(rect.w).toBeCloseTo(0.01)
    expect(rect.h).toBeCloseTo(0.01)
    expect(rect.x).toBeCloseTo(0.2) // fixed corner untouched
    expect(rect.y).toBeCloseTo(0.2)
  })

  it('never produces a rect smaller than minSize', () => {
    const corners: Array<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'> = [
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ]
    for (const corner of corners) {
      const rect = resizeRect(ORIGINAL, corner, ORIGINAL.x, ORIGINAL.y, 0.005)
      expect(rect.w).toBeGreaterThanOrEqual(0.005 - 1e-9)
      expect(rect.h).toBeGreaterThanOrEqual(0.005 - 1e-9)
    }
  })
})

describe('moveRect (Phase 1.11 UI改修指示4章: BBox内部dragによる移動)', () => {
  it('keeps width/height unchanged while translating x/y', () => {
    const moved = moveRect(ORIGINAL, 0.1, -0.05)
    expect(moved.x).toBeCloseTo(0.3)
    expect(moved.y).toBeCloseTo(0.15)
    expect(moved.w).toBeCloseTo(ORIGINAL.w)
    expect(moved.h).toBeCloseTo(ORIGINAL.h)
  })

  it('clamps so the moved rect never leaves the [0,1] page range on the left/top', () => {
    const moved = moveRect(ORIGINAL, -10, -10)
    expect(moved.x).toBe(0)
    expect(moved.y).toBe(0)
    expect(moved.w).toBeCloseTo(ORIGINAL.w)
    expect(moved.h).toBeCloseTo(ORIGINAL.h)
  })

  it('clamps so the moved rect never leaves the [0,1] page range on the right/bottom', () => {
    const moved = moveRect(ORIGINAL, 10, 10)
    expect(moved.x).toBeCloseTo(1 - ORIGINAL.w)
    expect(moved.y).toBeCloseTo(1 - ORIGINAL.h)
    expect(moved.x + moved.w).toBeCloseTo(1)
    expect(moved.y + moved.h).toBeCloseTo(1)
  })

  it('a no-op delta (0,0) returns the same position', () => {
    const moved = moveRect(ORIGINAL, 0, 0)
    expect(moved).toEqual(ORIGINAL)
  })
})

describe('topRightCorner (Phase 1.11 UI改修指示11章: 引出線アンカー)', () => {
  it('computes the top-right corner (max x, min y) in normalized (top-left origin) coordinates', () => {
    expect(topRightCorner(ORIGINAL)).toEqual({ x: 0.4, y: 0.2 })
  })

  it('follows a moved rect (アンカーの自動追従)', () => {
    const moved = moveRect(ORIGINAL, 0.1, 0.1)
    expect(topRightCorner(moved)).toEqual({ x: moved.x + moved.w, y: moved.y })
  })

  it('follows a resized rect (アンカーの自動追従)', () => {
    const resized = resizeRect(ORIGINAL, 'bottom-right', 0.5, 0.4, 0.001)
    expect(topRightCorner(resized)).toEqual({ x: resized.x + resized.w, y: resized.y })
  })
})

describe('intersectionArea (積算集約: 根拠BBox×盤BBoxの所属判定指示)', () => {
  it('returns the overlap area when two rects partially overlap', () => {
    const a = { x: 0, y: 0, w: 0.5, h: 0.5 }
    const b = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
    // overlap: x 0.25-0.5 (0.25), y 0.25-0.5 (0.25)
    expect(intersectionArea(a, b)).toBeCloseTo(0.0625)
  })

  it('returns 0 when rects do not overlap at all', () => {
    const a = { x: 0, y: 0, w: 0.2, h: 0.2 }
    const b = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }
    expect(intersectionArea(a, b)).toBe(0)
  })

  it('returns 0 (not a positive area) when rects only touch along an edge (指示: 辺が触れているだけは所属としない)', () => {
    const a = { x: 0, y: 0, w: 0.2, h: 0.2 }
    const b = { x: 0.2, y: 0, w: 0.2, h: 0.2 } // 右辺同士がぴったり接する
    expect(intersectionArea(a, b)).toBe(0)
  })

  it('returns 0 when rects only touch at a single corner point', () => {
    const a = { x: 0, y: 0, w: 0.2, h: 0.2 }
    const b = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 } // 角(0.2,0.2)だけが接する
    expect(intersectionArea(a, b)).toBe(0)
  })

  it('returns the full area of the smaller rect when one rect fully contains the other', () => {
    const outer = { x: 0, y: 0, w: 1, h: 1 }
    const inner = { x: 0.4, y: 0.4, w: 0.1, h: 0.1 }
    expect(intersectionArea(outer, inner)).toBeCloseTo(0.01)
  })

  it('is symmetric (a,b) === (b,a)', () => {
    const a = { x: 0.1, y: 0.1, w: 0.3, h: 0.2 }
    const b = { x: 0.2, y: 0.15, w: 0.3, h: 0.3 }
    expect(intersectionArea(a, b)).toBeCloseTo(intersectionArea(b, a))
  })
})

describe('shiftLabelWithBBox (全体フォント拡大・BBox編集追従回帰修正 指示3章: ラベルがBBoxの移動に追従する)', () => {
  it('computes an initial position from the new anchor when the label has never been saved (currentLabel === null)', () => {
    const before = { x: 0.5, y: 0.5, w: 0.02, h: 0.02 }
    const after = { x: 0.3, y: 0.3, w: 0.02, h: 0.02 }
    const result = shiftLabelWithBBox(null, before, after)
    expect(result).toEqual(computeInitialLabelPosition(topRightCorner(after)))
  })

  it('shifts an already-saved label by exactly the anchor displacement, preserving the relative offset', () => {
    const before = { x: 0.5, y: 0.5, w: 0.02, h: 0.02 } // anchor = (0.52, 0.5)
    const after = { x: 0.3, y: 0.4, w: 0.02, h: 0.02 } // anchor = (0.32, 0.4) → delta (-0.2, -0.1)
    const savedLabel = { x: 0.6, y: 0.45 } // ユーザーが独自にドラッグして置いた位置
    const result = shiftLabelWithBBox(savedLabel, before, after)
    expect(result.x).toBeCloseTo(0.4) // 0.6 - 0.2
    expect(result.y).toBeCloseTo(0.35) // 0.45 - 0.1
  })

  it('is exactly reversible: shifting forward then shifting back by the inverse delta restores the original label (Undo整合性)', () => {
    const before = { x: 0.4, y: 0.4, w: 0.05, h: 0.05 }
    const after = { x: 0.1, y: 0.6, w: 0.08, h: 0.03 } // move + resize
    const savedLabel = { x: 0.5, y: 0.35 }
    const moved = shiftLabelWithBBox(savedLabel, before, after)
    const restored = shiftLabelWithBBox(moved, after, before) // Undo: before/afterを入れ替えて呼ぶだけ
    expect(restored.x).toBeCloseTo(savedLabel.x)
    expect(restored.y).toBeCloseTo(savedLabel.y)
  })

  it('does not move the label when the BBox itself did not change (before === after)', () => {
    const rect = { x: 0.3, y: 0.3, w: 0.05, h: 0.05 }
    const savedLabel = { x: 0.5, y: 0.2 }
    const result = shiftLabelWithBBox(savedLabel, rect, rect)
    expect(result).toEqual(savedLabel)
  })

  it('clamps the shifted label position to the 0..1 page range', () => {
    const before = { x: 0.5, y: 0.5, w: 0.02, h: 0.02 }
    const after = { x: -10, y: -10, w: 0.02, h: 0.02 } // 極端な移動 (呼び出し側は通常clamp済みのrectを渡す想定だが、念のため)
    const savedLabel = { x: 0.1, y: 0.1 }
    const result = shiftLabelWithBBox(savedLabel, before, after)
    expect(result.x).toBeGreaterThanOrEqual(0)
    expect(result.y).toBeGreaterThanOrEqual(0)
  })
})
