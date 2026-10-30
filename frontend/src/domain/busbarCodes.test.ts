import { describe, expect, it } from 'vitest'
import {
  BUSBAR_DATA,
  BUSBAR_RAW,
  EMPTY_SELECTION,
  VOLTAGE_NONE,
  VOLTAGE_NONE_LABEL,
  detailsOf,
  displayValue,
  optionsFor,
  selectStep,
  statusOf,
  type BusbarSelection,
} from './busbarCodes'

const full = (spec: string, phase: string, voltage: string, kva: string): BusbarSelection => ({ spec, phase, voltage, kva })

describe('busbarCodes: 対応表(ユーザー提示のデータをそのまま使う)', () => {
  it('has 66 records: 公共建築 44241-44273 and 標準仕様 44801-44833', () => {
    expect(BUSBAR_DATA).toHaveLength(66)
    const codes = BUSBAR_DATA.map((r) => Number(r.code))
    expect(codes.slice(0, 33)).toEqual(Array.from({ length: 33 }, (_, i) => 44241 + i))
    expect(codes.slice(33)).toEqual(Array.from({ length: 33 }, (_, i) => 44801 + i))
    expect(new Set(BUSBAR_DATA.slice(0, 33).map((r) => r.spec))).toEqual(new Set(['公共建築']))
    expect(new Set(BUSBAR_DATA.slice(33).map((r) => r.spec))).toEqual(new Set(['標準仕様']))
    expect(new Set(BUSBAR_DATA.map((r) => r.code)).size).toBe(66)
  })

  it('parses representative records exactly as given', () => {
    const by = (code: string) => BUSBAR_DATA.find((r) => r.code === code)
    expect(by('44241')).toEqual({ code: '44241', spec: '公共建築', phase: '1Φ', voltage: '—', kva: 10, size: '3×30', length: '2.6', amp: '225' })
    expect(by('44263')).toEqual({ code: '44263', spec: '公共建築', phase: '3Φ', voltage: '200V級', kva: 2000, size: '10×200T', length: '5.5', amp: '5240' })
    expect(by('44273')).toEqual({ code: '44273', spec: '公共建築', phase: '3Φ', voltage: '400V級', kva: 2000, size: '8×150W', length: '5.6', amp: '3020' })
    expect(by('44815')).toEqual({ code: '44815', spec: '標準仕様', phase: '3Φ', voltage: '200V級', kva: 100, size: '3×30', length: '3.9', amp: '307' })
    expect(by('44833')).toEqual({ code: '44833', spec: '標準仕様', phase: '3Φ', voltage: '400V級', kva: 2000, size: '10×100W', length: '5.6', amp: '2901' })
  })

  it('keeps the raw table lines in the 8-field format', () => {
    for (const line of BUSBAR_RAW.trim().split('\n')) expect(line.trim().split('|')).toHaveLength(8)
  })

  it.each(BUSBAR_DATA.map((r) => [r.code, r] as const))(
    'a unique selection (spec/phase/voltage/kva) yields code %s',
    (code, r) => {
      const selection = full(r.spec, r.phase, r.voltage, String(r.kva))
      const status = statusOf(selection)
      expect(status.kind).toBe('unique')
      if (status.kind === 'unique') expect(status.record.code).toBe(code)
    },
  )

  it('every record is reachable through the cascading options (each stage offers the chosen value)', () => {
    for (const r of BUSBAR_DATA) {
      const keys = ['spec', 'phase', 'voltage', 'kva'] as const
      let selection: BusbarSelection = { ...EMPTY_SELECTION }
      keys.forEach((key, i) => {
        const value = key === 'kva' ? String(r.kva) : String(r[key])
        expect(optionsFor(i, selection)).toContain(value)
        selection = selectStep(selection, i, value)
      })
      const status = statusOf(selection)
      expect(status.kind === 'unique' && status.record.code).toBe(r.code)
    }
  })
})

describe('busbarCodes: 段階的な絞り込み', () => {
  it('offers nothing but 仕様 initially (later stages are empty while the earlier stage is unselected)', () => {
    expect(optionsFor(0, EMPTY_SELECTION)).toEqual(['公共建築', '標準仕様'])
    expect(optionsFor(1, EMPTY_SELECTION)).toEqual([])
    expect(optionsFor(2, EMPTY_SELECTION)).toEqual([])
    expect(optionsFor(3, EMPTY_SELECTION)).toEqual([])
  })

  it('narrows 相数 → 電圧区分 → 容量 by the earlier choices', () => {
    let s = selectStep(EMPTY_SELECTION, 0, '公共建築')
    expect(optionsFor(1, s)).toEqual(['1Φ', '3Φ'])
    s = selectStep(s, 1, '1Φ')
    expect(optionsFor(2, s)).toEqual([VOLTAGE_NONE])
    s = selectStep(s, 2, VOLTAGE_NONE)
    expect(optionsFor(3, s)).toEqual(['10', '20', '30', '50', '75', '100', '150', '200', '300', '500'])

    s = selectStep(selectStep(s, 1, '3Φ'), 1, '3Φ')
    expect(optionsFor(2, s).sort()).toEqual(['200V級', '400V級'])
    s = selectStep(s, 2, '400V級')
    expect(optionsFor(3, s)).toEqual(['75', '100', '150', '200', '300', '500', '750', '1000', '1500', '2000'])
    s = selectStep(selectStep(EMPTY_SELECTION, 0, '標準仕様'), 1, '3Φ')
    s = selectStep(s, 2, '200V級')
    expect(optionsFor(3, s)).toEqual(['20', '30', '50', '75', '100', '150', '200', '300', '500', '750', '1000', '1500', '2000'])
  })

  it('displays the 1Φ voltage "—" as 区分なし（1Φ） (value itself stays "—")', () => {
    expect(displayValue('voltage', VOLTAGE_NONE)).toBe(VOLTAGE_NONE_LABEL)
    expect(VOLTAGE_NONE_LABEL).toBe('区分なし（1Φ）')
    expect(displayValue('voltage', '200V級')).toBe('200V級')
    expect(displayValue('spec', '標準仕様')).toBe('標準仕様')
  })

  it('resets all later stages when an earlier stage changes (and keeps earlier stages)', () => {
    const s = full('標準仕様', '3Φ', '200V級', '100')
    expect(selectStep(s, 0, '公共建築')).toEqual({ spec: '公共建築', phase: null, voltage: null, kva: null })
    expect(selectStep(s, 1, '1Φ')).toEqual({ spec: '標準仕様', phase: '1Φ', voltage: null, kva: null })
    expect(selectStep(s, 2, '400V級')).toEqual({ spec: '標準仕様', phase: '3Φ', voltage: '400V級', kva: null })
    expect(selectStep(s, 3, '200')).toEqual({ spec: '標準仕様', phase: '3Φ', voltage: '200V級', kva: '200' })
    expect(selectStep(s, 0, '')).toEqual(EMPTY_SELECTION)
  })
})

describe('busbarCodes: 一致なし・複数一致・未完了', () => {
  it('is incomplete (no code) until all four items are selected', () => {
    expect(statusOf(EMPTY_SELECTION).kind).toBe('incomplete')
    expect(statusOf({ ...EMPTY_SELECTION, spec: '標準仕様', phase: '3Φ' }).kind).toBe('incomplete')
    expect(statusOf({ spec: '標準仕様', phase: '3Φ', voltage: '200V級', kva: null }).kind).toBe('incomplete')
  })

  it('reports "none" (code not adopted) when no record matches', () => {
    expect(statusOf(full('標準仕様', '1Φ', '200V級', '100')).kind).toBe('none')
    expect(statusOf(full('公共建築', '3Φ', '200V級', '12345')).kind).toBe('none')
  })

  it('reports "multiple" (code not adopted) when several records match the same conditions', () => {
    // 現行の対応表では 4 条件が重複するレコードは無いため、一致が複数になる条件は表の複製で再現する。
    const dup = BUSBAR_DATA.find((r) => r.code === '44815')!
    BUSBAR_DATA.push({ ...dup, code: '99999' })
    try {
      const status = statusOf(full('標準仕様', '3Φ', '200V級', '100'))
      expect(status).toEqual({ kind: 'multiple', count: 2 })
    } finally {
      BUSBAR_DATA.pop()
    }
    expect(statusOf(full('標準仕様', '3Φ', '200V級', '100')).kind).toBe('unique')
  })

  it('provides the display details (品名/型式/定格/コード) for a unique record', () => {
    const r = BUSBAR_DATA.find((x) => x.code === '44241')!
    expect(detailsOf(r)).toEqual([
      ['コード', '44241'],
      ['品名', '入力（主回路銅帯）'],
      ['型式', '3×30 L=2.6m×3本'],
      ['定格', '1Φ 10kVA 公共建築 (225A)'],
    ])
    const r3 = BUSBAR_DATA.find((x) => x.code === '44815')!
    expect(detailsOf(r3)[3]).toEqual(['定格', '3Φ 100kVA 200V級 標準仕様 (307A)'])
  })
})
