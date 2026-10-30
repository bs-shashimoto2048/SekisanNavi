// 主回路銅帯の選択状態(面ごとの複数行)と、その保存・再表示。
//
// - 面(`ban_menno`)ごとに、独立した選択行のリストを持つ。行は「＋」で同じ面に追加でき、個別に削除できる。
//   他の行・他の面の選択・削除には影響しない。
// - 初期状態は 1 行・4 項目すべて未選択(既定値・初期コードは選ばない)。
// - 保存先はブラウザーの localStorage(製番ごと)。サーバー・API・出力・DB・設定は変更しない。
//   読み込み時は、保存された値が対応表(busbarCodes)の絞り込みと矛盾する場合、その段以降を未選択に戻す。
import { BUSBAR_STEPS, EMPTY_SELECTION, optionsFor, type BusbarSelection } from './busbarCodes'

export interface BusbarRow {
  id: string
  selection: BusbarSelection
}

/** 面番号(文字列)→選択行のリスト。 */
export type BusbarRowsByFace = Record<string, BusbarRow[]>

export const BUSBAR_STORAGE_KEY = 'sekisan-navi:busbar-selections:v1'
/** 面の最初の(未選択の)行の固定 ID。保存前でも描画が安定するようにする。 */
export const FIRST_ROW_ID = 'row-1'

let rowCounter = 0

export function newRowId(): string {
  rowCounter += 1
  return `row-${Date.now().toString(36)}-${rowCounter}`
}

export function emptyRow(id: string = newRowId()): BusbarRow {
  return { id, selection: { ...EMPTY_SELECTION } }
}

/** その面の行(未保存なら、未選択の 1 行)。 */
export function rowsOf(byFace: BusbarRowsByFace, face: string): BusbarRow[] {
  const rows = byFace[face]
  return rows && rows.length > 0 ? rows : [emptyRow(FIRST_ROW_ID)]
}

export function setFaceRows(byFace: BusbarRowsByFace, face: string, rows: BusbarRow[]): BusbarRowsByFace {
  return { ...byFace, [face]: rows }
}

export function updateRow(rows: BusbarRow[], id: string, selection: BusbarSelection): BusbarRow[] {
  return rows.map((r) => (r.id === id ? { ...r, selection } : r))
}

export function addRow(rows: BusbarRow[]): BusbarRow[] {
  return [...rows, emptyRow()]
}

/** 個別削除。最後の 1 行は削除せず、未選択に戻す(面には常に 1 行以上ある)。 */
export function removeRow(rows: BusbarRow[], id: string): BusbarRow[] {
  if (rows.length <= 1) return rows.map((r) => (r.id === id ? { ...r, selection: { ...EMPTY_SELECTION } } : r))
  return rows.filter((r) => r.id !== id)
}

function sanitizeSelection(raw: unknown): BusbarSelection {
  const out: BusbarSelection = { ...EMPTY_SELECTION }
  if (typeof raw !== 'object' || raw === null) return out
  const source = raw as Record<string, unknown>
  for (let i = 0; i < BUSBAR_STEPS.length; i += 1) {
    const key = BUSBAR_STEPS[i].key
    const value = source[key]
    if (typeof value !== 'string' || !optionsFor(i, out).includes(value)) break   // 矛盾した値は、その段以降を未選択にする
    out[key] = value
  }
  return out
}

export function sanitizeRowsByFace(raw: unknown): BusbarRowsByFace {
  const result: BusbarRowsByFace = {}
  if (typeof raw !== 'object' || raw === null) return result
  for (const [face, rows] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue
    const clean: BusbarRow[] = []
    const seen = new Set<string>()
    for (const r of rows) {
      if (typeof r !== 'object' || r === null) continue
      const id = (r as { id?: unknown }).id
      if (typeof id !== 'string' || id === '' || seen.has(id)) continue
      seen.add(id)
      clean.push({ id, selection: sanitizeSelection((r as { selection?: unknown }).selection) })
    }
    if (clean.length > 0) result[face] = clean
  }
  return result
}

function readAll(): Record<string, unknown> {
  try {
    const text = window.localStorage.getItem(BUSBAR_STORAGE_KEY)
    const parsed = text ? JSON.parse(text) : {}
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** 製番の保存済み選択を読み込む(無い・壊れている場合は空)。 */
export function loadSelections(productNo: string | undefined): BusbarRowsByFace {
  if (!productNo) return {}
  return sanitizeRowsByFace(readAll()[productNo])
}

/** 製番の選択を保存する(localStorage が使えない環境では何もしない)。 */
export function saveSelections(productNo: string | undefined, byFace: BusbarRowsByFace): void {
  if (!productNo) return
  try {
    const all = readAll()
    all[productNo] = byFace
    window.localStorage.setItem(BUSBAR_STORAGE_KEY, JSON.stringify(all))
  } catch {
    // 保存できなくても、画面上の選択は有効(再表示で復元できないだけ)。
  }
}
