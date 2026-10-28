/// <reference types="vitest/config" />
import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig, loadEnv } from 'vite'

// [日本語PDF文字化け修正] pdfjs-distが同梱するCMap・標準フォント
// データ(`node_modules/pdfjs-dist/cmaps`, `.../standard_fonts`)を、外部CDNに
// 頼らず`public/pdfjs/`へコピーしてアプリと同一オリジンで配信する
// (`src/pdf/pdfjs.ts`のcMapUrl/standardFontDataUrlが参照する)。
// `public/pdfjs/`自体はnode_modules由来の生成物のため.gitignore対象とし、
// `vite`(dev/build共通で通るbuildStart)実行のたびに最新のインストール済み
// バージョンから作り直す(手動コピーして固定化しない)。
function copyPdfjsAssetsPlugin(): Plugin {
  return {
    name: 'copy-pdfjs-assets',
    buildStart() {
      const pairs: Array<[string, string]> = [
        ['node_modules/pdfjs-dist/cmaps', 'public/pdfjs/cmaps'],
        ['node_modules/pdfjs-dist/standard_fonts', 'public/pdfjs/standard_fonts'],
      ]
      for (const [src, dest] of pairs) {
        const srcPath = path.resolve(process.cwd(), src)
        const destPath = path.resolve(process.cwd(), dest)
        if (!fs.existsSync(srcPath)) continue
        fs.mkdirSync(destPath, { recursive: true })
        fs.cpSync(srcPath, destPath, { recursive: true })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Backendの接続先はここ1箇所に集約する (frontend/.env.local の VITE_BACKEND_URL)。
  // 開発サーバーは /api への呼び出しをこのURLへ同一オリジンでプロキシするため、
  // Backendのポートを変更してもFrontendコードやCORS設定を変更する必要はない
  // (Sekisan Navi Phase 1.5 実機確認不具合 修正指示 #9 対応)。
  const backendUrl = env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'

  return {
    plugins: [react(), copyPdfjsAssetsPlugin()],
    server: {
      // 社内LAN上の他端末からUI確認できるようにするための設定 (レビュー用途限定)。
      // 既定の`localhost`のみlisten (127.0.0.1/::1) だと開発PC自身からしか
      // 接続できないため、`true`にして全インターフェース (0.0.0.0 / ::) でlistenする。
      // `/api`プロキシはVite devサーバー自身(Node側)からBackendへ発行される
      // サーバー間通信であり、ブラウザから直接Backendへアクセスするわけではないため、
      // この変更だけで他端末からの/api呼び出しも同一オリジンでそのまま動作する
      // (BackendのCORS設定・bindアドレスの変更は不要)。
      host: true,
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
      // 全体実行時の負荷でテストが5秒(既定)を超える散発的な失敗を避けるため、余裕を持たせる。
      testTimeout: 15000,
    },
  }
})
