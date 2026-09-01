/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Backendの接続先はここ1箇所に集約する (frontend/.env.local の VITE_BACKEND_URL)。
  // 開発サーバーは /api への呼び出しをこのURLへ同一オリジンでプロキシするため、
  // Backendのポートを変更してもFrontendコードやCORS設定を変更する必要はない
  // (Sekisan Navi Phase 1.5 実機確認不具合 修正指示 #9 対応)。
  const backendUrl = env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.ts'],
      // css:trueで実CSSをjsdomへ適用する (既定では.cssインポートはスタブ化され
      // getComputedStyleへ反映されない)。今回、盤領域内表示の追加指示への対応中に
      // 「line-height:0の継承によりテキストがクリップされ、DOM上には存在するのに
      // 画面には見えない」という不具合が全テストをすり抜けていたことが判明した
      // (jsdomはレイアウト計算はしないため clientWidth/getBoundingClientRect 等は
      // 引き続き0のままで既存のモック手法に影響しないが、CSSの値自体は
      // getComputedStyleで検証できるようになる)。
      css: true,
    },
  }
})
