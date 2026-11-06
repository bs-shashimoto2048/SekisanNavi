import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

let shouldThrow = true
function Bomb() {
  if (shouldThrow) throw new Error('boom')
  return <p>通常表示</p>
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = true
    window.localStorage.setItem('keep', 'me')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows the fallback instead of a blank screen, logs the error for developers, and never touches stored data', () => {
    render(
      <ErrorBoundary label="t" fallback={(e) => <p role="alert">失敗: {e.message}</p>}>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('失敗: boom')
    expect(console.error).toHaveBeenCalledWith('[ErrorBoundary:t]', expect.any(Error), expect.any(String))
    expect(window.localStorage.getItem('keep')).toBe('me')
  })

  it('recovers via reset and automatically when resetKeys change', () => {
    const view = render(
      <ErrorBoundary
        label="t"
        resetKeys={['a']}
        fallback={(_e, reset) => (
          <button type="button" onClick={reset}>
            再試行
          </button>
        )}
      >
        <Bomb />
      </ErrorBoundary>,
    )
    // 原因が残っている間は、再試行してもエラー表示に戻る(白画面にならない)。
    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument()

    // resetKeysが変わると、原因が解消していれば自動で通常表示に戻る。
    shouldThrow = false
    view.rerender(
      <ErrorBoundary label="t" resetKeys={['b']} fallback={() => <p>x</p>}>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByText('通常表示')).toBeInTheDocument()
  })
})
