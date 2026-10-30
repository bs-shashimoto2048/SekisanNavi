// 主回路銅帯(入力)コードの対応表と、4段階の絞り込み(仕様 → 相数 → 電圧区分 → 容量[kVA])。
//
// 対応表は、ユーザー提示の Obsidian DataviewJS コードの `raw` を**そのまま**使う(唯一の対応表)。
// コード・仕様・数値を、この画面側で推測・補完・加工しない。表示用の文言の置き換えは、電圧区分「—」(1Φ)を
// 「区分なし（1Φ）」と表示することだけ(値自体は「—」のまま扱う)。
//
// データ書式: コード|仕様|相数|電圧区分|容量(kVA)|銅帯サイズ|長さ(m)|定格電流(A)
export const BUSBAR_RAW = `44241|公共建築|1Φ|—|10|3×30|2.6|225
44242|公共建築|1Φ|—|20|3×30|2.6|225
44243|公共建築|1Φ|—|30|3×30|2.6|225
44244|公共建築|1Φ|—|50|4×30|2.6|300
44245|公共建築|1Φ|—|75|4×40|3.9|400
44246|公共建築|1Φ|—|100|6×40|3.9|480
44247|公共建築|1Φ|—|150|6×60|4.8|720
44248|公共建築|1Φ|—|200|6×100|4.8|1020
44249|公共建築|1Φ|—|300|10×100|5.1|1500
44250|公共建築|1Φ|—|500|10×100W|5.3|2450
44251|公共建築|3Φ|200V級|20|3×30|2.6|225
44252|公共建築|3Φ|200V級|30|3×30|2.6|225
44253|公共建築|3Φ|200V級|50|3×30|2.6|225
44254|公共建築|3Φ|200V級|75|3×30|2.6|225
44255|公共建築|3Φ|200V級|100|4×30|3.9|300
44256|公共建築|3Φ|200V級|150|6×40|4.3|480
44257|公共建築|3Φ|200V級|200|6×50|5.4|600
44258|公共建築|3Φ|200V級|300|6×100|5.5|1020
44259|公共建築|3Φ|200V級|500|10×100|5.8|1500
44260|公共建築|3Φ|200V級|750|8×100W|5.0|2260
44261|公共建築|3Φ|200V級|1000|8×150W|5.3|3020
44262|公共建築|3Φ|200V級|1500|10×200W|5.5|4390
44263|公共建築|3Φ|200V級|2000|10×200T|5.5|5240
44264|公共建築|3Φ|400V級|75|3×30|2.6|225
44265|公共建築|3Φ|400V級|100|3×30|4.0|225
44266|公共建築|3Φ|400V級|150|3×30|4.2|225
44267|公共建築|3Φ|400V級|200|4×30|5.4|300
44268|公共建築|3Φ|400V級|300|6×40|5.5|480
44269|公共建築|3Φ|400V級|500|6×60|5.8|720
44270|公共建築|3Φ|400V級|750|8×100|5.8|1200
44271|公共建築|3Φ|400V級|1000|10×100|6.2|1500
44272|公共建築|3Φ|400V級|1500|8×100W|5.6|2260
44273|公共建築|3Φ|400V級|2000|8×150W|5.6|3020
44801|標準仕様|1Φ|—|10|3×30|2.6|307
44802|標準仕様|1Φ|—|20|3×30|2.6|307
44803|標準仕様|1Φ|—|30|3×30|2.6|307
44804|標準仕様|1Φ|—|50|3×30|2.6|307
44805|標準仕様|1Φ|—|75|4×30|3.9|379
44806|標準仕様|1Φ|—|100|6×40|3.9|651
44807|標準仕様|1Φ|—|150|6×50|4.8|805
44808|標準仕様|1Φ|—|200|6×75|4.8|1113
44809|標準仕様|1Φ|—|300|8×100|5.1|1658
44810|標準仕様|1Φ|—|500|6×100W|5.3|2392
44811|標準仕様|3Φ|200V級|20|3×30|2.6|307
44812|標準仕様|3Φ|200V級|30|3×30|2.6|307
44813|標準仕様|3Φ|200V級|50|3×30|2.6|307
44814|標準仕様|3Φ|200V級|75|3×30|2.6|307
44815|標準仕様|3Φ|200V級|100|3×30|3.9|307
44816|標準仕様|3Φ|200V級|150|4×40|4.3|498
44817|標準仕様|3Φ|200V級|200|6×40|5.4|651
44818|標準仕様|3Φ|200V級|300|6×60|5.5|911
44819|標準仕様|3Φ|200V級|500|6×100|5.8|1420
44820|標準仕様|3Φ|200V級|750|6×100W|5.0|2392
44821|標準仕様|3Φ|200V級|1000|10×100W|5.3|2901
44822|標準仕様|3Φ|200V級|1500|10×200W|5.5|5199
44823|標準仕様|3Φ|200V級|2000|10×200T|5.5|6206
44824|標準仕様|3Φ|400V級|75|3×30|2.6|307
44825|標準仕様|3Φ|400V級|100|3×30|4.0|307
44826|標準仕様|3Φ|400V級|150|3×30|4.2|307
44827|標準仕様|3Φ|400V級|200|3×30|5.4|307
44828|標準仕様|3Φ|400V級|300|4×40|5.5|498
44829|標準仕様|3Φ|400V級|500|6×50|5.8|805
44830|標準仕様|3Φ|400V級|750|6×75|5.8|1113
44831|標準仕様|3Φ|400V級|1000|6×100|6.2|1420
44832|標準仕様|3Φ|400V級|1500|8×150|5.6|2285
44833|標準仕様|3Φ|400V級|2000|10×100W|5.6|2901`

export interface BusbarRecord {
  code: string
  spec: string
  phase: string
  voltage: string
  kva: number
  size: string
  length: string
  amp: string
}

/** 電圧区分の「なし」(1Φ)を表す、対応表上の値。 */
export const VOLTAGE_NONE = '—'
/** 画面上の表示名(値そのものは `VOLTAGE_NONE` のまま扱う)。 */
export const VOLTAGE_NONE_LABEL = '区分なし（1Φ）'

export const BUSBAR_DATA: BusbarRecord[] = BUSBAR_RAW.trim()
  .split('\n')
  .map((line) => {
    const [code, spec, phase, voltage, kva, size, length, amp] = line.trim().split('|')
    return { code, spec, phase, voltage, kva: Number(kva), size, length, amp }
  })

export type BusbarStepKey = 'spec' | 'phase' | 'voltage' | 'kva'

/** 選択の4段階(この順に、前段の選択で後段の候補を絞り込む)。 */
export const BUSBAR_STEPS: ReadonlyArray<{ key: BusbarStepKey; label: string }> = [
  { key: 'spec', label: '仕様' },
  { key: 'phase', label: '相数' },
  { key: 'voltage', label: '電圧区分' },
  { key: 'kva', label: '容量（kVA）' },
]

/** 4段階の選択(null = 未選択)。値は対応表の文字列(`kva` も文字列)。 */
export type BusbarSelection = Record<BusbarStepKey, string | null>

export const EMPTY_SELECTION: BusbarSelection = { spec: null, phase: null, voltage: null, kva: null }

const sortValues = (key: BusbarStepKey, values: string[]): string[] =>
  values.sort((a, b) => (key === 'kva' ? Number(a) - Number(b) : a.localeCompare(b, 'ja')))

/** 値の表示名。電圧区分「—」は「区分なし（1Φ）」と表示する。 */
export function displayValue(key: BusbarStepKey, value: string): string {
  return key === 'voltage' && value === VOLTAGE_NONE ? VOLTAGE_NONE_LABEL : value
}

/**
 * 段 `index` の候補。前段(0..index-1)がすべて選択済みのときだけ、その選択に一致するレコードから候補を作る
 * (前段が未選択なら空 = 選べない)。
 */
export function optionsFor(index: number, selection: BusbarSelection): string[] {
  for (let i = 0; i < index; i += 1) {
    if (selection[BUSBAR_STEPS[i].key] === null) return []
  }
  const rows = BUSBAR_DATA.filter((r) =>
    BUSBAR_STEPS.slice(0, index).every(({ key }) => String(r[key]) === selection[key]),
  )
  const key = BUSBAR_STEPS[index].key
  return sortValues(key, [...new Set(rows.map((r) => String(r[key])))])
}

/** 段 `index` を `value` に変えた選択。**それより後段はすべて未選択に戻す**。 */
export function selectStep(selection: BusbarSelection, index: number, value: string | null): BusbarSelection {
  const next: BusbarSelection = { ...selection }
  BUSBAR_STEPS.forEach(({ key }, i) => {
    if (i === index) next[key] = value === '' ? null : value
    else if (i > index) next[key] = null
  })
  return next
}

export type BusbarStatus =
  | { kind: 'incomplete' }
  | { kind: 'none' }
  | { kind: 'multiple'; count: number }
  | { kind: 'unique'; record: BusbarRecord }

/** 4項目がそろったとき、一致するレコードが 1 件のときだけ `unique`(コードを採用する)。0 件・複数件は採用しない。 */
export function statusOf(selection: BusbarSelection): BusbarStatus {
  if (BUSBAR_STEPS.some(({ key }) => selection[key] === null)) return { kind: 'incomplete' }
  const matched = BUSBAR_DATA.filter((r) => BUSBAR_STEPS.every(({ key }) => String(r[key]) === selection[key]))
  if (matched.length === 0) return { kind: 'none' }
  if (matched.length > 1) return { kind: 'multiple', count: matched.length }
  return { kind: 'unique', record: matched[0] }
}

/** 一意に決まったレコードの表示項目(選定結果の 1 行表示の順: コード｜品名｜型式｜定格)。 */
export function detailsOf(r: BusbarRecord): Array<[string, string]> {
  const voltage = r.voltage === VOLTAGE_NONE ? '' : ` ${r.voltage}`
  return [
    ['コード', r.code],
    ['品名', '入力（主回路銅帯）'],
    ['型式', `${r.size} L=${r.length}m×3本`],
    ['定格', `${r.phase} ${r.kva}kVA${voltage} ${r.spec} (${r.amp}A)`],
  ]
}
