import { beforeEach, describe, expect, it } from 'vitest'
import {
  BUSBAR_STORAGE_KEY,
  FIRST_ROW_ID,
  addRow,
  emptyRow,
  loadSelections,
  removeRow,
  rowsOf,
  sanitizeRowsByFace,
  saveSelections,
  setFaceRows,
  updateRow,
} from './busbarSelections'
import { EMPTY_SELECTION } from './busbarCodes'

beforeEach(() => window.localStorage.clear())

describe('busbarSelections: 面ごとの行', () => {
  it('starts each face with no rows (no initial unselected row)', () => {
    expect(rowsOf({}, '1')).toEqual([])
    expect(rowsOf({ '2': [emptyRow('x')] }, '1')).toEqual([])
  })

  it('creates the first unselected row only when adding, then adds more to the same face', () => {
    const first = addRow(rowsOf({}, '1'))
    expect(first).toHaveLength(1)
    expect(first[0].selection).toEqual(EMPTY_SELECTION)
    expect(first[0].factor).toBe(1.0)
    expect(first[0].id).toBe(FIRST_ROW_ID)
    const rows = addRow(first)
    expect(rows).toHaveLength(2)
    expect(rows[1].selection).toEqual(EMPTY_SELECTION)
    expect(rows[1].id).not.toBe(rows[0].id)
  })

  it('removes one row individually without touching the others', () => {
    let rows = addRow(addRow(addRow(rowsOf({}, '1'))))
    rows = updateRow(rows, rows[0].id, { spec: '標準仕様', phase: null, voltage: null, kva: null })
    rows = updateRow(rows, rows[2].id, { spec: '公共建築', phase: null, voltage: null, kva: null })
    const removed = removeRow(rows, rows[1].id)
    expect(removed.map((r) => r.selection.spec)).toEqual(['標準仕様', '公共建築'])
  })

  it('deletes the only remaining row (the face goes back to no rows)', () => {
    let rows = addRow(rowsOf({}, '1'))
    rows = updateRow(rows, rows[0].id, { spec: '標準仕様', phase: '3Φ', voltage: null, kva: null })
    expect(removeRow(rows, rows[0].id)).toEqual([])
  })

  it('keeps faces independent', () => {
    let byFace = {}
    byFace = setFaceRows(byFace, '1', addRow(addRow(rowsOf(byFace, '1'))))
    const face2 = addRow(rowsOf(byFace, '2'))
    byFace = setFaceRows(byFace, '2', updateRow(face2, face2[0].id, { spec: '公共建築', phase: null, voltage: null, kva: null }))
    expect(rowsOf(byFace, '1')).toHaveLength(2)
    expect(rowsOf(byFace, '2')).toHaveLength(1)
    expect(rowsOf(byFace, '1').every((r) => r.selection.spec === null)).toBe(true)
    expect(rowsOf(byFace, '2')[0].selection.spec).toBe('公共建築')
    // 面2の最後の行を削除しても、面1の行は変わらない。
    byFace = setFaceRows(byFace, '2', removeRow(rowsOf(byFace, '2'), face2[0].id))
    expect(rowsOf(byFace, '2')).toEqual([])
    expect(rowsOf(byFace, '1')).toHaveLength(2)
  })

  it('does not restore a face whose rows were all deleted after save and reload', () => {
    saveSelections('A1TEST', { '1': [emptyRow('a')], '2': [emptyRow('b')] })
    saveSelections('A1TEST', { '1': removeRow(loadSelections('A1TEST')['1'], 'a'), '2': loadSelections('A1TEST')['2'] })
    const reloaded = loadSelections('A1TEST')
    expect(rowsOf(reloaded, '1')).toEqual([])
    expect(rowsOf(reloaded, '2').map((r) => r.id)).toEqual(['b'])
  })
})

describe('busbarSelections: 保存と再表示', () => {
  it('round-trips per product number', () => {
    const rows = [
      { id: 'a', factor: 0.7, selection: { spec: '標準仕様', phase: '3Φ', voltage: '200V級', kva: '100' } },
      { id: 'b', factor: 1.0, selection: { ...EMPTY_SELECTION } },
    ]
    saveSelections('A1TEST001', { '1': rows })
    expect(loadSelections('A1TEST001')).toEqual({ '1': rows })
    expect(loadSelections('A1TEST002')).toEqual({})
    // 別の製番の保存は互いに上書きしない。
    saveSelections('A1TEST002', { '2': [{ id: 'c', factor: 1.0, selection: { ...EMPTY_SELECTION } }] })
    expect(Object.keys(loadSelections('A1TEST001'))).toEqual(['1'])
    expect(Object.keys(loadSelections('A1TEST002'))).toEqual(['2'])
  })

  it('does nothing without a product number', () => {
    saveSelections(undefined, { '1': [emptyRow('x')] })
    expect(window.localStorage.getItem(BUSBAR_STORAGE_KEY)).toBeNull()
    expect(loadSelections(undefined)).toEqual({})
  })

  it('survives broken stored data', () => {
    window.localStorage.setItem(BUSBAR_STORAGE_KEY, '{not json')
    expect(loadSelections('A1TEST001')).toEqual({})
    window.localStorage.setItem(BUSBAR_STORAGE_KEY, JSON.stringify({ A1TEST001: 'oops' }))
    expect(loadSelections('A1TEST001')).toEqual({})
  })

  it('resets the contradictory stage and everything after it when restoring', () => {
    const cleaned = sanitizeRowsByFace({
      '1': [
        { id: 'r1', factor: 0.5, selection: { spec: '標準仕様', phase: '1Φ', voltage: '200V級', kva: '100' } }, // 1Φ に 200V級 は無い
        { id: 'r2', factor: 1.4, selection: { spec: '不明', phase: '3Φ', voltage: '200V級', kva: '100' } },
        { id: 'r1', factor: 0.6, selection: { ...EMPTY_SELECTION } }, // 重複 ID は捨てる
        { selection: {} }, // ID なしは捨てる
      ],
      '2': 'not-an-array',
    })
    expect(Object.keys(cleaned)).toEqual(['1'])
    expect(cleaned['1'].map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(cleaned['1'][0].selection).toEqual({ spec: '標準仕様', phase: '1Φ', voltage: null, kva: null })
    expect(cleaned['1'].map((r) => r.factor)).toEqual([0.5, 1.4])
    expect(cleaned['1'][1].selection).toEqual(EMPTY_SELECTION)
  })

  it('defaults missing or invalid saved factors to 1.0', () => {
    const cleaned = sanitizeRowsByFace({
      '1': [
        { id: 'missing', selection: { ...EMPTY_SELECTION } },
        { id: 'invalid', factor: 0.9, selection: { ...EMPTY_SELECTION } },
      ],
    })
    expect(cleaned['1'].map((row) => row.factor)).toEqual([1.0, 1.0])
  })
})
