import type { MaterialRow } from '../types/domain'

/** material.csv の `MATERIAL_SPEC` の特別な値。`未記載`=.boxspecに記載が無い、`無し`=明示値。
 * 意味が違うため、表示でも区別する(値そのものは加工せず、判定にだけ使う)。 */
export const MATERIAL_NOT_DESCRIBED = '未記載'
export const MATERIAL_NOTHING = '無し'

export interface MaterialGroup {
  /** ページ・材料シンボル・箱体型式・出所ファイルで一意なキー。 */
  key: string
  page: string
  symbolName: string
  /** 箱体型式(CABTYPE)。空のことがある。 */
  cabtype: string
  sourceFile: string
  rows: MaterialRow[]
}

/** CSV順(ページ順・シンボル順・構成部順)を保ったまま、ページ × 材料シンボル × 箱体型式でまとめる。 */
export function groupMaterials(materials: MaterialRow[]): MaterialGroup[] {
  const groups = new Map<string, MaterialGroup>()
  for (const row of materials) {
    const key = JSON.stringify([row.page, row.symbol_name, row.cabtype, row.source_file])
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        page: row.page,
        symbolName: row.symbol_name,
        cabtype: row.cabtype,
        sourceFile: row.source_file,
        rows: [],
      }
      groups.set(key, group)
    }
    group.rows.push(row)
  }
  return [...groups.values()]
}

export type MaterialSpecKind = 'not_described' | 'nothing' | 'value'

export function classifyMaterialSpec(spec: string): MaterialSpecKind {
  if (spec === MATERIAL_NOT_DESCRIBED) return 'not_described'
  if (spec === MATERIAL_NOTHING) return 'nothing'
  return 'value'
}
