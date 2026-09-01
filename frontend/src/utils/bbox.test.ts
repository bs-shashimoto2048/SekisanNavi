import { describe, expect, it } from 'vitest'
import { moveRect, resizeRect, topRightCorner } from './bbox'

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
