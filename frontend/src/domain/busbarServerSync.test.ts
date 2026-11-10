import { describe, expect, it } from 'vitest'
import { BUSBAR_DATA, EMPTY_SELECTION, statusOf, type BusbarSelection } from './busbarCodes'
import {
  describeBusbarSyncIssue,
  mergeServerBusbar,
  selectionFromCode,
  type ServerBusbarRow,
} from './busbarServerSync'
import type { BusbarRow } from './busbarSelections'

const code = '44815' // 標準仕様 / 3Φ / 200V級 / 100
const selected: BusbarSelection = { spec: '標準仕様', phase: '3Φ', voltage: '200V級', kva: '100' }
const srv = (face: number, rowId: string, c = code, factor = 1.0): ServerBusbarRow => ({
  ban_menno: face,
  row_id: rowId,
  code: c,
  factor,
})
const row = (id: string, selection: BusbarSelection = { ...selected }, factor = 1.0): BusbarRow => ({ id, selection, factor })
const partial = (id: string): BusbarRow => row(id, { ...EMPTY_SELECTION, spec: '標準仕様' })

describe('selectionFromCode', () => {
  it('maps every table code back to a selection that resolves to the same code (round trip)', () => {
    for (const record of BUSBAR_DATA) {
      const selection = selectionFromCode(record.code)
      expect(selection).not.toBeNull()
      const status = statusOf(selection!)
      expect(status.kind).toBe('unique')
      expect(status.kind === 'unique' && status.record.code).toBe(record.code)
    }
  })

  it('returns null for a code that is not in the table', () => {
    expect(selectionFromCode('99999')).toBeNull()
  })
})

describe('mergeServerBusbar', () => {
  it('restores the server rows (code and factor) when localStorage is empty', () => {
    const merged = mergeServerBusbar({}, [srv(1, 'row-1', code, 0.7), srv(2, 'row-a')])
    expect(merged.issues).toEqual([])
    expect(merged.rows['1']).toEqual([{ id: 'row-1', selection: selected, factor: 0.7 }])
    expect(merged.rows['2']).toEqual([{ id: 'row-a', selection: selected, factor: 1.0 }])
  })

  it('does not restore deleted (complete) local rows when the server returns an empty list, and reports them', () => {
    const merged = mergeServerBusbar({ '1': [row('row-1', selected, 0.5)], '2': [row('row-2')] }, [])
    expect(merged.rows).toEqual({})
    expect(merged.issues.map((i) => [i.kind, i.face, i.rowId])).toEqual([
      ['dropped', '1', 'row-1'],
      ['dropped', '2', 'row-2'],
    ])
    expect(describeBusbarSyncIssue(merged.issues[0])).toContain('サーバーに保存されていない')
  })

  it('keeps unfinished local input rows (never sent to the server) without silently losing them', () => {
    const merged = mergeServerBusbar({ '1': [partial('row-x')] }, [])
    expect(merged.rows['1']).toEqual([partial('row-x')])
    expect(merged.issues).toEqual([])
  })

  it('keeps an unfinished local row alongside the server rows of the same face, in local order, server-only rows after', () => {
    const merged = mergeServerBusbar({ '1': [partial('row-p'), row('row-1')] }, [srv(1, 'row-1'), srv(1, 'row-2', '44816')])
    expect(merged.rows['1'].map((r) => r.id)).toEqual(['row-p', 'row-1', 'row-2'])
    expect(merged.issues).toEqual([])
  })

  it('shows the server value and reports a conflict when a complete local row differs from the server (no silent overwrite)', () => {
    const merged = mergeServerBusbar({ '1': [row('row-1', selected, 0.5)] }, [srv(1, 'row-1', code, 1.4)])
    expect(merged.rows['1'][0].factor).toBe(1.4)
    expect(merged.issues).toEqual([
      { kind: 'conflict', face: '1', rowId: 'row-1', localCode: code, localFactor: 0.5, serverCode: code, serverFactor: 1.4 },
    ])
    expect(describeBusbarSyncIssue(merged.issues[0])).toContain('サーバーの値を表示')
  })

  it('reports no issue when the local row equals the server row', () => {
    const merged = mergeServerBusbar({ '1': [row('row-1', selected, 0.7)] }, [srv(1, 'row-1', code, 0.7)])
    expect(merged.issues).toEqual([])
    expect(merged.rows['1']).toHaveLength(1)
  })

  it('treats an unfinished local row with the same id as a server row as a conflict and shows the server row', () => {
    const merged = mergeServerBusbar({ '1': [partial('row-1')] }, [srv(1, 'row-1')])
    expect(merged.rows['1']).toEqual([{ id: 'row-1', selection: selected, factor: 1.0 }])
    expect(merged.issues).toMatchObject([{ kind: 'conflict', localCode: null }])
  })

  it('keeps server rows whose code is not in the table as preserved (not displayed, not lost on save) and reports them', () => {
    const merged = mergeServerBusbar({}, [srv(1, 'row-1'), srv(1, 'row-z', '99999', 0.8)])
    expect(merged.rows['1'].map((r) => r.id)).toEqual(['row-1'])
    expect(merged.preserved).toEqual({ '1': [srv(1, 'row-z', '99999', 0.8)] })
    expect(merged.issues).toEqual([{ kind: 'unmapped', face: '1', rowId: 'row-z', code: '99999' }])
  })

  it('keeps faces independent: only the faces present are changed', () => {
    const merged = mergeServerBusbar({ '1': [row('row-1')], '3': [partial('row-q')] }, [srv(2, 'row-2')])
    expect(Object.keys(merged.rows).sort()).toEqual(['2', '3'])
    expect(merged.rows['3']).toEqual([partial('row-q')])
    expect(merged.issues.map((i) => [i.kind, i.face])).toEqual([['dropped', '1']])
  })
})
