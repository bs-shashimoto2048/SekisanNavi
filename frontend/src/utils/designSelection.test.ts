import { beforeEach, describe, expect, it } from 'vitest'
import type { DesignPage } from '../types/domain'
import { loadExcludedKeys, saveExcludedKeys, selectedItems } from './designSelection'

function item(key: string): DesignPage {
  return { key, page_label: key, drawing_name: `図${key}`, mode: 'preview', inference_page_no: null, ban_labels: [] }
}

describe('designSelection', () => {
  beforeEach(() => window.localStorage.clear())

  it('returns null when nothing has been confirmed yet for the product', () => {
    expect(loadExcludedKeys('A1')).toBeNull()
  })

  it('round-trips the excluded keys per product, keeping 01 and 1 distinct', () => {
    saveExcludedKeys('A1', new Set(['01', 'MB01']))
    saveExcludedKeys('A2', new Set(['1']))
    expect(loadExcludedKeys('A1')).toEqual(new Set(['01', 'MB01']))
    expect(loadExcludedKeys('A2')).toEqual(new Set(['1']))
    expect(loadExcludedKeys('A3')).toBeNull()
  })

  it('treats an empty exclusion as a confirmed "everything selected"', () => {
    saveExcludedKeys('A1', new Set())
    expect(loadExcludedKeys('A1')).toEqual(new Set())
  })

  it('ignores corrupted stored values instead of throwing', () => {
    for (const raw of ['not json', '[]', '{"excluded":"x"}', '{"excluded":[1]}', 'null', '"s"']) {
      window.localStorage.setItem('sekisan-navi:design-selection:v1:A1', raw)
      expect(loadExcludedKeys('A1')).toBeNull()
    }
  })

  it('does not throw when localStorage is unavailable', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('quota')
    }
    try {
      expect(() => saveExcludedKeys('A1', new Set(['x']))).not.toThrow()
    } finally {
      Storage.prototype.setItem = original
    }
  })

  it('keeps the given order and leaves out only the excluded keys', () => {
    const items = ['0', '01', '1', 'a1'].map(item)
    expect(selectedItems(items, new Set(['01'])).map((i) => i.key)).toEqual(['0', '1', 'a1'])
    expect(selectedItems(items, new Set()).map((i) => i.key)).toEqual(['0', '01', '1', 'a1'])
  })

  it('shows figures that are new in design.csv as selected (only excluded keys are remembered)', () => {
    saveExcludedKeys('A1', new Set(['01']))
    const later = ['01', '02', 'new'].map(item)
    expect(selectedItems(later, loadExcludedKeys('A1')!).map((i) => i.key)).toEqual(['02', 'new'])
  })
})
