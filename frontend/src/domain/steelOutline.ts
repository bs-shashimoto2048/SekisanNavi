import type { SteelItem } from '../types/domain'

/** 箱体型式と CABTYPE の比較用の正規化: 全角→半角(NFKC)・前後の空白除去・大文字化。 */
export function normalizeModel(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').trim().toUpperCase()
}

export type CabtypeMatch =
  | { kind: 'match'; model: string }
  | { kind: 'mismatch'; models: string[] }
  | { kind: 'unknown-no-cabtype' }
  | { kind: 'unknown-no-model' }

/** CABTYPE と箱体型式の照合。正規化後の完全一致だけを「一致」とする(前方一致・部分一致・似た型式は一致にしない)。 */
export function matchCabtype(cabtype: string, panelModels: Array<string | null | undefined>): CabtypeMatch {
  const cab = normalizeModel(cabtype)
  if (cab === '') return { kind: 'unknown-no-cabtype' }
  const models = panelModels.filter((m): m is string => normalizeModel(m) !== '').map((m) => m.trim())
  if (models.length === 0) return { kind: 'unknown-no-model' }
  const hit = models.find((m) => normalizeModel(m) === cab)
  if (hit !== undefined) return { kind: 'match', model: hit }
  return { kind: 'mismatch', models: Array.from(new Set(models)) }
}

export interface SteelGroup {
  symbolName: string
  cabtype: string
  items: SteelItem[]
}

/** 同じ(記号名, CABTYPE)の行を1グループにまとめる(CSVの出力順を保つ。離れて現れる同じ組も統合しない)。 */
export function groupSteelItems(items: SteelItem[]): SteelGroup[] {
  const groups: SteelGroup[] = []
  for (const item of items) {
    const last = groups[groups.length - 1]
    if (last && last.symbolName === item.symbol_name && last.cabtype === item.cabtype) {
      last.items.push(item)
    } else {
      groups.push({ symbolName: item.symbol_name, cabtype: item.cabtype, items: [item] })
    }
  }
  return groups
}
