// PDF.js セットアップ (Phase 1.5)
//
// 採用理由・バージョン: docs/architecture.md「図面Viewerの技術選定」参照。
// pdfjs-dist は ESM only (build/pdf.mjs) のビルドを提供しており、
// Vite (ESM ネイティブ) との相性は良好であることを確認済み。
import * as pdfjsLib from 'pdfjs-dist'

// Viteの `new URL(..., import.meta.url)` パターンでワーカーを解決する。
// (pdfjs-dist公式ドキュメント記載のバンドラー向け標準的な設定方法)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

export { pdfjsLib }
