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

// jsdomは`Element.scrollIntoView`も実装していないため、no-opスタブを用意する
// (積算明細強化・Undo/Redo・要確認警告・編集追従 指示13章: 編集した明細行への
// 自動スクロールが呼び出すだけで、実際のスクロール量自体はjsdomでは検証できない
// ため、呼び出されたことだけを確認できれば十分)。
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
