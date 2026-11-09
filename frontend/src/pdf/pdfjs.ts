// PDF.js セットアップ (Phase 1.5)
//
// 採用理由・バージョン: docs/architecture.md「図面Viewerの技術選定」参照。
// pdfjs-dist は ESM only (build/pdf.mjs) のビルドを提供しており、
// Vite (ESM ネイティブ) との相性は良好であることを確認済み。
import * as pdfjsLib from 'pdfjs-dist'

// workerはVite設定のcopyPdfjsAssetsPluginが public/pdfjs へコピーし、
// same-originから配信する。node_modulesが別worktreeへのjunctionでも/@fsの403を避ける。
export const PDFJS_WORKER_URL = '/pdfjs/pdf.worker.min.mjs'
pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL

// [日本語PDF文字化け修正] 日本語を含むCJK圏PDFは、フォント自体は
// 埋め込まれていても、文字コード→字体(CID)の対応付けに事前定義された
// CMap(例: UniJIS-UCS2-H等)を使っていることが多く、pdf.jsはそれを解決する
// `cMapUrl`が無いと該当フォントの読み込み自体に失敗する(文字が欠ける・
// 豆腐表示になる原因。実際の日本語PDFで
// 「Ensure that the `cMapUrl` API parameter is provided」という読み込み失敗を
// 確認した)。`standardFontDataUrl`は非埋め込みの標準14書体を補うためのもの。
// 外部CDNには依存せず、`vite.config.ts`のプラグインが`node_modules/pdfjs-dist`
// 同梱の`cmaps`/`standard_fonts`を`public/pdfjs/`配下へコピーし、アプリと
// 同一オリジンで配信する。
export const PDF_DOCUMENT_RESOURCE_OPTIONS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
}

export { pdfjsLib }
