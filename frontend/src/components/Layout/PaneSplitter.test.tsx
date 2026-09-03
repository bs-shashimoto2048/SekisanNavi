import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PaneSplitter } from './PaneSplitter'

describe('PaneSplitter', () => {
  it('reports incremental drag deltas while dragging, and stops after mouseup', () => {
    const onDrag = vi.fn()
    render(<PaneSplitter onDrag={onDrag} ariaLabel="テスト境界" />)
    const handle = screen.getByRole('separator', { name: 'テスト境界' })

    fireEvent.mouseDown(handle, { clientX: 100, button: 0 })
    fireEvent.mouseMove(window, { clientX: 130 })
    expect(onDrag).toHaveBeenCalledWith(30)

    fireEvent.mouseMove(window, { clientX: 150 })
    // 直前位置(130)からの差分のみを通知する (合計ではなく増分)
    expect(onDrag).toHaveBeenCalledWith(20)

    fireEvent.mouseUp(window, { clientX: 150 })
    fireEvent.mouseMove(window, { clientX: 200 })
    expect(onDrag).toHaveBeenCalledTimes(2) // mouseup後は追加で呼ばれない
  })

  it('does not call onDrag for a mousedown without any movement', () => {
    const onDrag = vi.fn()
    render(<PaneSplitter onDrag={onDrag} ariaLabel="テスト境界" />)
    const handle = screen.getByRole('separator', { name: 'テスト境界' })

    fireEvent.mouseDown(handle, { clientX: 100, button: 0 })
    fireEvent.mouseUp(window, { clientX: 100 })

    expect(onDrag).not.toHaveBeenCalled()
  })

  it('sets a col-resize cursor and disables text selection on the body while dragging', () => {
    const onDrag = vi.fn()
    render(<PaneSplitter onDrag={onDrag} ariaLabel="テスト境界" />)
    const handle = screen.getByRole('separator', { name: 'テスト境界' })

    fireEvent.mouseDown(handle, { clientX: 100, button: 0 })
    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')

    fireEvent.mouseUp(window, { clientX: 100 })
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('ignores non-primary mouse buttons', () => {
    const onDrag = vi.fn()
    render(<PaneSplitter onDrag={onDrag} ariaLabel="テスト境界" />)
    const handle = screen.getByRole('separator', { name: 'テスト境界' })

    fireEvent.mouseDown(handle, { clientX: 100, button: 2 }) // 右クリック
    fireEvent.mouseMove(window, { clientX: 150 })

    expect(onDrag).not.toHaveBeenCalled()
  })
})

describe('PaneSplitter: 視覚階層改善 (grip・hover/drag状態・既存a11y仕様の維持)', () => {
  it('renders a grip element for the visual handle, without changing the accessible name/role', () => {
    render(<PaneSplitter onDrag={() => {}} ariaLabel="テスト境界" />)
    const handle = screen.getByRole('separator', { name: 'テスト境界' })
    // gripは装飾のみ(aria-hidden)であり、role/aria-labelはハンドル自身が持つ
    // 既存仕様のまま変わらないことを確認する。
    const grip = handle.querySelector('.pane-splitter__grip')
    expect(grip).not.toBeNull()
    expect(grip?.getAttribute('aria-hidden')).toBe('true')
    expect(handle.getAttribute('aria-label')).toBe('テスト境界')
  })

  it('does not carry the --dragging modifier class before any interaction', () => {
    render(<PaneSplitter onDrag={() => {}} ariaLabel="テスト境界" />)
    const handle = screen.getByRole('separator', { name: 'テスト境界' })
    expect(handle.className).not.toContain('pane-splitter--dragging')
  })

  it('adds a --dragging modifier class while dragging, and removes it on mouseup', () => {
    render(<PaneSplitter onDrag={() => {}} ariaLabel="テスト境界" />)
    const handle = screen.getByRole('separator', { name: 'テスト境界' })

    fireEvent.mouseDown(handle, { clientX: 100, button: 0 })
    expect(handle.className).toContain('pane-splitter--dragging')

    fireEvent.mouseUp(window, { clientX: 100 })
    expect(handle.className).not.toContain('pane-splitter--dragging')
  })

  it('does not add the --dragging modifier class for a non-primary mouse button', () => {
    render(<PaneSplitter onDrag={() => {}} ariaLabel="テスト境界" />)
    const handle = screen.getByRole('separator', { name: 'テスト境界' })

    fireEvent.mouseDown(handle, { clientX: 100, button: 2 })
    expect(handle.className).not.toContain('pane-splitter--dragging')
  })
})

describe('PaneSplitter with axis="y" (Phase 1.11 UI改修指示24章: Master領域の高さ変更)', () => {
  it('tracks vertical movement (clientY) instead of horizontal when axis="y"', () => {
    const onDrag = vi.fn()
    render(<PaneSplitter onDrag={onDrag} ariaLabel="Master高さ境界" axis="y" />)
    const handle = screen.getByRole('separator', { name: 'Master高さ境界' })

    fireEvent.mouseDown(handle, { clientY: 200, button: 0 })
    fireEvent.mouseMove(window, { clientY: 230 })
    expect(onDrag).toHaveBeenCalledWith(30)

    // 水平方向の移動は無視される。
    fireEvent.mouseMove(window, { clientX: 999, clientY: 230 })
    expect(onDrag).toHaveBeenCalledTimes(1)
  })

  it('reports the horizontal orientation via aria-orientation', () => {
    render(<PaneSplitter onDrag={() => {}} ariaLabel="Master高さ境界" axis="y" />)
    const handle = screen.getByRole('separator', { name: 'Master高さ境界' })
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('sets a row-resize cursor while dragging vertically', () => {
    render(<PaneSplitter onDrag={() => {}} ariaLabel="Master高さ境界" axis="y" />)
    const handle = screen.getByRole('separator', { name: 'Master高さ境界' })

    fireEvent.mouseDown(handle, { clientY: 200, button: 0 })
    expect(document.body.style.cursor).toBe('row-resize')

    fireEvent.mouseUp(window, { clientY: 200 })
    expect(document.body.style.cursor).toBe('')
  })
})
