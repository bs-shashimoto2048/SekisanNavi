// jsdomは`IntersectionObserver`を実装していない。ReferencePdfViewer(資料PDF表示)の
// ページ遅延描画(表示領域付近のページだけ実際にcanvas描画する)を検証するため、
// mockResizeObserver.tsと同じ考え方(テストコード側が明示的にtrigger()を呼んだ時
// のみ発火する)のコントロール可能なモックを用意する。

interface MockIntersectionObserverEntry {
  target: Element
  isIntersecting: boolean
}

type IntersectionObserverCallbackLike = (entries: MockIntersectionObserverEntry[]) => void

export class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []

  private callback: IntersectionObserverCallbackLike
  private observedElements: Element[] = []

  constructor(callback: IntersectionObserverCallbackLike) {
    this.callback = callback
    MockIntersectionObserver.instances.push(this)
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

  /** テストから手動で交差状態の変化を発火させる。 */
  trigger(element: Element, isIntersecting: boolean) {
    this.callback([{ target: element, isIntersecting }])
  }

  get observed(): readonly Element[] {
    return this.observedElements
  }
}

/** 直近(最後)に生成されたMockIntersectionObserverインスタンスを返す。 */
export function getLatestMockIntersectionObserver(): MockIntersectionObserver {
  const instance = MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1]
  if (!instance) throw new Error('MockIntersectionObserver instance not found. Did the component mount?')
  return instance
}

export function resetMockIntersectionObservers() {
  MockIntersectionObserver.instances = []
}

/** グローバルの`IntersectionObserver`をこのモックへ差し替える (setupTests.tsから呼ぶ)。 */
export function installMockIntersectionObserver() {
  resetMockIntersectionObservers()
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = MockIntersectionObserver
}
