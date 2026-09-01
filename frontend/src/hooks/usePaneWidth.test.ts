import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { usePaneWidth } from './usePaneWidth'

const KEY = 'sekisan-navi:test-pane-width'

describe('usePaneWidth', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    window.localStorage.clear()
  })

  it('starts at the initial width when nothing is stored', () => {
    const { result } = renderHook(() => usePaneWidth(KEY, 220, 140, 0.3))
    expect(result.current[0]).toBe(220)
  })

  it('increases width when dragged in the positive direction, clamped to min', () => {
    const { result } = renderHook(() => usePaneWidth(KEY, 220, 140, 0.3))
    act(() => result.current[1](50))
    expect(result.current[0]).toBe(270)
  })

  it('does not shrink below the minimum width', () => {
    const { result } = renderHook(() => usePaneWidth(KEY, 220, 140, 0.3))
    act(() => result.current[1](-1000))
    expect(result.current[0]).toBe(140)
  })

  it('does not grow beyond min * window.innerWidth * maxVwRatio', () => {
    const { result } = renderHook(() => usePaneWidth(KEY, 220, 140, 0.3))
    act(() => result.current[1](100000))
    expect(result.current[0]).toBe(window.innerWidth * 0.3)
  })

  it('persists the width to localStorage under the given key', () => {
    const { result } = renderHook(() => usePaneWidth(KEY, 220, 140, 0.3))
    act(() => result.current[1](30))
    expect(window.localStorage.getItem(KEY)).toBe('250')
  })

  it('restores a previously saved valid width on next mount', () => {
    window.localStorage.setItem(KEY, '260')
    const { result } = renderHook(() => usePaneWidth(KEY, 220, 140, 0.3))
    expect(result.current[0]).toBe(260)
  })

  it('falls back to the initial width when the stored value is below the minimum', () => {
    window.localStorage.setItem(KEY, '10')
    const { result } = renderHook(() => usePaneWidth(KEY, 220, 140, 0.3))
    expect(result.current[0]).toBe(220)
  })

  it('falls back to the initial width when the stored value exceeds the max', () => {
    window.localStorage.setItem(KEY, String(window.innerWidth * 0.3 + 500))
    const { result } = renderHook(() => usePaneWidth(KEY, 220, 140, 0.3))
    expect(result.current[0]).toBe(220)
  })

  it('falls back to the initial width when the stored value is not a number', () => {
    window.localStorage.setItem(KEY, 'not-a-number')
    const { result } = renderHook(() => usePaneWidth(KEY, 220, 140, 0.3))
    expect(result.current[0]).toBe(220)
  })
})

describe('usePaneWidth with dimension="height" (Phase 1.11 UI改修指示24章〜26章: Master領域の高さリサイズに再利用)', () => {
  const HEIGHT_KEY = 'sekisan-navi:test-pane-height'

  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    window.localStorage.clear()
  })

  it('starts at the initial height when nothing is stored', () => {
    const { result } = renderHook(() => usePaneWidth(HEIGHT_KEY, 260, 120, 0.6, 'height'))
    expect(result.current[0]).toBe(260)
  })

  it('clamps against window.innerHeight (not innerWidth) when dimension is "height"', () => {
    const { result } = renderHook(() => usePaneWidth(HEIGHT_KEY, 260, 120, 0.6, 'height'))
    act(() => result.current[1](100000))
    expect(result.current[0]).toBe(window.innerHeight * 0.6)
    expect(result.current[0]).not.toBe(window.innerWidth * 0.6)
  })

  it('does not shrink below the minimum height', () => {
    const { result } = renderHook(() => usePaneWidth(HEIGHT_KEY, 260, 120, 0.6, 'height'))
    act(() => result.current[1](-1000))
    expect(result.current[0]).toBe(120)
  })

  it('persists and restores the height under its own storage key, independent of width panes', () => {
    const { result } = renderHook(() => usePaneWidth(HEIGHT_KEY, 260, 120, 0.6, 'height'))
    act(() => result.current[1](40))
    expect(window.localStorage.getItem(HEIGHT_KEY)).toBe('300')

    const { result: restored } = renderHook(() =>
      usePaneWidth(HEIGHT_KEY, 260, 120, 0.6, 'height'),
    )
    expect(restored.current[0]).toBe(300)
  })
})
