import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { installMockResizeObserver } from './testUtils/mockResizeObserver'

afterEach(() => {
  cleanup()
})

// jsdomは`ResizeObserver`を実装していないため、全テスト共通でモックへ差し替える
// (DrawingCanvas.tsxのViewer自動Fit機能が使用する。実画面未達 追加修正指示35章)。
beforeEach(() => {
  installMockResizeObserver()
})
