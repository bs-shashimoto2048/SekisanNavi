import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { FloatingPanel, type FloatingPanelRect } from './FloatingPanel'

const viewerBounds = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 1200,
  bottom: 800,
  width: 1200,
  height: 800,
  toJSON: () => ({}),
} as DOMRect

function Harness() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<FloatingPanelRect>({
    top: 40,
    left: 300,
    width: 590,
    height: 400,
  })
  const onRectChange = (
    update: FloatingPanelRect | ((previous: FloatingPanelRect | null) => FloatingPanelRect | null),
  ) => setRect((previous) => (typeof update === 'function' ? update(previous) ?? previous : update))

  return (
    <div ref={containerRef} data-testid="viewer-wrap">
      <FloatingPanel
        visible
        kind="panelInfo"
        visibleKinds={['panelInfo']}
        containerRef={containerRef}
        rect={rect}
        onRectChange={onRectChange}
        maxContentSize={{ width: 720, height: 500 }}
      >
        <h2>図面情報</h2>
      </FloatingPanel>
    </div>
  )
}

describe('FloatingPanel: 図面情報の右下リサイズ', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses only the bottom-right handle and clamps width to the natural content width', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(viewerBounds)

    render(<Harness />)
    const panel = document.querySelector('.floating-panel--panelInfo') as HTMLElement
    const handle = panel.querySelector('.floating-panel__resize-handle') as HTMLElement
    expect(handle).toBeInTheDocument()
    expect(panel.querySelector('.floating-panel__width-resize-handle')).toBeNull()

    const left = parseFloat(panel.style.left)
    const width = parseFloat(panel.style.width)
    const top = parseFloat(panel.style.top)
    const height = parseFloat(panel.style.height)
    const startX = left + width
    const startY = top + height

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: startX, clientY: startY, button: 0 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: startX + 1000, clientY: startY })
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: startX + 1000, clientY: startY })

    expect(parseFloat(panel.style.width)).toBe(720)
    expect(parseFloat(panel.style.left)).toBe(left)
  })
})
