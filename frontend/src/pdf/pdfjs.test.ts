import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  globalWorkerOptions: { workerSrc: '' as string },
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: mocks.globalWorkerOptions,
}))

import { PDFJS_WORKER_URL, pdfjsLib } from './pdfjs'

describe('PDF.js worker URL', () => {
  it('uses the same-origin public asset instead of a filesystem URL', () => {
    expect(PDFJS_WORKER_URL).toBe('/pdfjs/pdf.worker.min.mjs')
    expect(pdfjsLib.GlobalWorkerOptions.workerSrc).toBe(PDFJS_WORKER_URL)
    expect(PDFJS_WORKER_URL).not.toContain('/@fs/')
  })
})
