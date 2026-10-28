import type { MaterialRow } from '../../types/domain'
import { classifyMaterialSpec, groupMaterials } from '../../domain/materialGroups'

interface Props {
  materials: MaterialRow[]
  showHeading?: boolean
}

/**
 * 製番の材料一覧 (material.csv。設計データの*.boxspec由来)。盤情報floating panelの下に表示する。
 *
 * ページ × 材料シンボル × 箱体型式ごとにまとめ、構成部名と材料仕様を並べる。
 * 材料仕様の`未記載`(.boxspecに記載なし)と`無し`(明示値)は見た目も文言も区別する。
 * データが無い(material.csvが無い・データ行が無い)場合は「材料情報なし」を表示する。
 * 値は加工せずそのまま表示する(記号・寸法・材質表記を変えない)。
 */
export function MaterialInfo({ materials, showHeading = true }: Props) {
  const groups = groupMaterials(materials)

  return (
    <section className="material-info" aria-label="材料情報">
      {showHeading && (
        <h3 className="material-info__heading">
          {groups.length > 0 ? `材料情報　${groups.length}件` : '材料情報'}
        </h3>
      )}
      {groups.length === 0 ? (
        <p className="material-info__empty">材料情報なし</p>
      ) : (
        <div className="material-info__scroll">
          {groups.map((group) => (
            <div key={group.key} className="material-info__group" data-testid="material-group">
              <div className="material-info__group-title">
                <span>ページ {group.page}</span>
                <span>{group.symbolName || '-'}</span>
                <span>型式 {group.cabtype || '-'}</span>
              </div>
              <table className="material-info__table">
                <tbody>
                  {group.rows.map((row) => {
                    const kind = classifyMaterialSpec(row.material_spec)
                    return (
                      <tr key={row.component_code}>
                        <th scope="row" title={row.component_code}>
                          {row.component_name || row.component_code}
                        </th>
                        <td
                          className={`material-info__spec material-info__spec--${kind}`}
                          data-spec-kind={kind}
                        >
                          {row.material_spec}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
