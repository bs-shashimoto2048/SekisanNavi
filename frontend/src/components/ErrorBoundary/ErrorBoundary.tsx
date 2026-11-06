import { Component, type ErrorInfo, type ReactNode } from 'react'

// 描画中の未処理例外で画面全体が真っ白になるのを防ぐ Error Boundary。
//
// - 例外の詳細は開発者向けに console.error へ残す(`label`で発生箇所を示す)。
// - localStorage 等の保存データには一切触れない(自動削除・初期化はしない)。
// - `resetKeys` の値が変わると自動的に通常表示を再試行する(図面・製番の切替で復帰できる)。
// - `fallback` には例外と、手動で再試行する `reset` を渡す。

interface Props {
  /** 発生箇所のラベル(ログ用)。 */
  label: string
  fallback: (error: Error, reset: () => void) => ReactNode
  /** この値が変わると、エラー状態を解除して再描画を試みる。 */
  resetKeys?: ReadonlyArray<unknown>
  children: ReactNode
}

interface State {
  error: Error | null
}

function sameKeys(a: ReadonlyArray<unknown> = [], b: ReadonlyArray<unknown> = []): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info.componentStack)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && !sameKeys(prev.resetKeys, this.props.resetKeys)) {
      this.setState({ error: null })
    }
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) return this.props.fallback(this.state.error, this.reset)
    return this.props.children
  }
}
