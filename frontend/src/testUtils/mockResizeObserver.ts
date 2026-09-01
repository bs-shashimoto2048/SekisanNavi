// jsdomは`ResizeObserver`を実装していない (実際のレイアウト計測を行わないため)。
// DrawingCanvas.tsxのViewer自動Fit (実画面未達 追加修正指示18章〜35章) は
// ResizeObserverでViewer利用可能領域のサイズ変化を検知するため、単体テストから
// 「サイズが変化した」状況を手動で再現できるコントロール可能なモックを用意する。
//
// 実際のブラウザではResizeObserverが要素をobserve()した時点で一度、現在のサイズで
// コールバックが自動発火するが、このモックはテストコード側が明示的に`trigger()`を
// 呼んだ時のみ発火する (テストの意図を明確にするための単純化)。

interface MockResizeObserverEntry {
  target: Element
  contentRect: { width: number; height: number }
}

type ResizeObserverCallbackLike = (entries: MockResizeObserverEntry[]) => void

export class MockResizeObserver {
  static instances: MockResizeObserver[] = []

  private callback: ResizeObserverCallbackLike
  private observedElements: Element[] = []

  constructor(callback: ResizeObserverCallbackLike) {
    this.callback = callback
    MockResizeObserver.instances.push(this)
  }

  observe(element: Element) {
    this.observedElements.push(element)
  }

  unobserve(element: Element) {
    this.observedElements = this.observedElements.filter((el) => el !== element)
  }

  disconnect() {
    this.observedElements = []
  }

  /** テストから手動でresizeイベントを発火させる。 */
  trigger(element: Element, rect: { width: number; height: number }) {
    this.callback([{ target: element, contentRect: rect }])
  }

  /** 現在このインスタンスがobserve中の要素一覧 (デバッグ・アサーション用)。 */
  get observed(): readonly Element[] {
    return this.observedElements
  }
}

/** 直近(最後)に生成されたMockResizeObserverインスタンスを返す。
 * DrawingCanvas.tsxは`.drawing-canvas__viewport`を1つだけobserveするため、
 * 通常はテスト対象コンポーネントごとに1インスタンスで足りる。 */
export function getLatestMockResizeObserver(): MockResizeObserver {
  const instance = MockResizeObserver.instances[MockResizeObserver.instances.length - 1]
  if (!instance) throw new Error('MockResizeObserver instance not found. Did the component mount?')
  return instance
}

export function resetMockResizeObservers() {
  MockResizeObserver.instances = []
}

/** グローバルの`ResizeObserver`をこのモックへ差し替える (setupTests.tsから呼ぶ)。 */
export function installMockResizeObserver() {
  resetMockResizeObservers()
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = MockResizeObserver
}
