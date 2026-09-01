import { describe, expect, it } from 'vitest'
import {
  buildSearchWithProductPage,
  parsePageNoFromSearch,
  parseProductNoFromSearch,
} from './urlState'

describe('parseProductNoFromSearch (Phase 1.11 UI改修指示22章)', () => {
  it('reads the product query param', () => {
    expect(parseProductNoFromSearch('?product=A1GV2421')).toBe('A1GV2421')
  })

  it('reads product alongside other params', () => {
    expect(parseProductNoFromSearch('?page=16&product=A1GV2421')).toBe('A1GV2421')
  })

  it('returns null when the param is missing (指示書23章: アプリを壊さない)', () => {
    expect(parseProductNoFromSearch('')).toBeNull()
    expect(parseProductNoFromSearch('?page=16')).toBeNull()
  })

  it('returns null for an empty/whitespace value', () => {
    expect(parseProductNoFromSearch('?product=')).toBeNull()
    expect(parseProductNoFromSearch('?product=%20')).toBeNull()
  })
})

describe('parsePageNoFromSearch (Phase 1.11 UI改修指示22章)', () => {
  it('reads a valid positive integer page number', () => {
    expect(parsePageNoFromSearch('?page=16')).toBe(16)
  })

  it('returns null when the param is missing', () => {
    expect(parsePageNoFromSearch('?product=A1GV2421')).toBeNull()
  })

  it('returns null for a non-numeric or invalid value (指示書23章: アプリを壊さない)', () => {
    expect(parsePageNoFromSearch('?page=abc')).toBeNull()
    expect(parsePageNoFromSearch('?page=-1')).toBeNull()
    expect(parsePageNoFromSearch('?page=0')).toBeNull()
    expect(parsePageNoFromSearch('?page=1.5')).toBeNull()
  })
})

describe('buildSearchWithProductPage (Phase 1.11 UI改修指示22章)', () => {
  it('builds a query string with product and page', () => {
    const search = buildSearchWithProductPage('', 'A1GV2421', 16)
    expect(parseProductNoFromSearch(`?${search}`)).toBe('A1GV2421')
    expect(parsePageNoFromSearch(`?${search}`)).toBe(16)
  })

  it('omits the page param when pageNo is null', () => {
    const search = buildSearchWithProductPage('', 'A1GV2421', null)
    expect(new URLSearchParams(search).has('page')).toBe(false)
  })

  it('preserves unrelated existing query params', () => {
    const search = buildSearchWithProductPage('?foo=bar', 'A1GV2421', 16)
    const params = new URLSearchParams(search)
    expect(params.get('foo')).toBe('bar')
    expect(params.get('product')).toBe('A1GV2421')
  })

  it('overwrites an existing product/page value rather than duplicating it', () => {
    const search = buildSearchWithProductPage('?product=OLD&page=1', 'A1GV2421', 16)
    const params = new URLSearchParams(search)
    expect(params.getAll('product')).toEqual(['A1GV2421'])
    expect(params.getAll('page')).toEqual(['16'])
  })
})
