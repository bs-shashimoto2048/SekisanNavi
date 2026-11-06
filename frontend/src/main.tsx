import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary'
import './components/ErrorBoundary/ErrorBoundary.css'

// 未処理の描画例外で完全な白画面にならないよう、アプリ全体をError Boundaryで包む。
// 保存データ(localStorage等)は消さない。再読み込みで復帰を試せる。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary
      label="app"
      fallback={(error) => (
        <div className="error-fallback error-fallback--app" role="alert">
          <p className="error-fallback__title">画面の表示中にエラーが発生しました。</p>
          <p className="error-fallback__hint">
            ページを再読み込みしてください。保存済みの設定(銅帯選択など)は消えていません。
            繰り返す場合は、ブラウザーの開発者ツールのConsoleに出力されたエラーを管理者へ共有してください。
          </p>
          <p className="error-fallback__hint">詳細: {error.message}</p>
          <button type="button" onClick={() => window.location.reload()}>
            再読み込み
          </button>
        </div>
      )}
    >
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
