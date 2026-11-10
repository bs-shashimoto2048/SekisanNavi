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

function NaturalHeightHarness({ naturalHeight }: { naturalHeight: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<FloatingPanelRect | null>(null)
  const onRectChange = (
    update: FloatingPanelRect | ((previous: FloatingPanelRect | null) => FloatingPanelRect | null),
  ) => setRect((previous) => (typeof update === 'function' ? update(previous) : update))

  return (
    <div ref={containerRef} data-testid="viewer-wrap">
      <FloatingPanel
        visible
        kind="panelInfo"
        visibleKinds={['panelInfo']}
        containerRef={containerRef}
        initialTopOffset={99}
        rect={rect}
        onRectChange={onRectChange}
        maxContentSize={{ width: 720, height: naturalHeight }}
      >
        <h2>図面情報</h2>
      </FloatingPanel>
    </div>
  )
}

function NaturalDetailWidthHarness({ naturalWidth }: { naturalWidth: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<FloatingPanelRect | null>(null)
  const onRectChange = (
    update: FloatingPanelRect | ((previous: FloatingPanelRect | null) => FloatingPanelRect | null),
  ) => setRect((previous) => (typeof update === 'function' ? update(previous) : update))

  return (
    <div ref={containerRef} data-testid="viewer-wrap">
      <FloatingPanel
        visible
        kind="detail"
        visibleKinds={['detail']}
        containerRef={containerRef}
        rect={rect}
        onRectChange={onRectChange}
        maxContentWidth={naturalWidth}
      >
        <h2>積算明細</h2>
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
    const heading = panel.querySelector('h2') as HTMLElement
    fireEvent.pointerDown(heading, { pointerId: 2, clientX: 300, clientY: 60, button: 0 })
    fireEvent.pointerMove(heading, { pointerId: 2, clientX: 100, clientY: 60 })
    fireEvent.pointerUp(heading, { pointerId: 2, clientX: 100, clientY: 60 })
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

  it('keeps the initial top position while natural content height grows to the viewport limit', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      ...viewerBounds,
      bottom: 1000,
      height: 1000,
    } as DOMRect)

    const { rerender } = render(<NaturalHeightHarness naturalHeight={500} />)
    const panel = document.querySelector('.floating-panel--panelInfo') as HTMLElement
    expect(parseFloat(panel.style.top)).toBe(147)

    rerender(<NaturalHeightHarness naturalHeight={800} />)
    expect(parseFloat(panel.style.top)).toBe(147)

    rerender(<NaturalHeightHarness naturalHeight={1200} />)
    expect(parseFloat(panel.style.top)).toBe(147)
    expect(parseFloat(panel.style.height)).toBe(853)
  })

  it('expands the detail panel to its natural table width without changing height', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    )
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(viewerBounds)

    render(<NaturalDetailWidthHarness naturalWidth={1040} />)
    const panel = document.querySelector('.floating-panel--detail') as HTMLElement
    expect(parseFloat(panel.style.width)).toBe(1040)
    expect(parseFloat(panel.style.height)).toBe(304)
    expect(parseFloat(panel.style.left)).toBe(140)
  })
})
