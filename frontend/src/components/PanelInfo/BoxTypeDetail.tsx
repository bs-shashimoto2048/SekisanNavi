import type { BoxTypeAnalysis, BoxTypeSpecConflict } from '../../types/domain'
import './BoxTypeDetail.css'

interface Props {
  /** 現在表示対象の盤のestcode_df.csv由来の型式(生文字列)。解析対象が無い
   * (estcode_df.csv側に対応行が無い等)場合はnull。 */
  model: string | null
  /** `model`をBackendで解析した結果。`model`がnullならnull。 */
  analysis: BoxTypeAnalysis | null
}

const STATUS_LABEL: Record<BoxTypeAnalysis['status'], string> = {
  parsed: '解析済み',
  partial: '一部未解析',
  ambiguous: '複数候補(曖昧)',
  conflict: '仕様競合(要確認)',
  unknown: '第1記号を特定できません',
}

const GROUP_LABEL: Record<string, string> = {
  primary: '第1記号',
  aux1: '補助記号1',
  aux2: '補助記号2',
  aux3: '補助記号3',
}

const PROCESSING_TARGET_LABEL: Record<BoxTypeAnalysis['processing_target'], string> = {
  complete_box: '箱体全体',
  partial_fabrication: '部分製作品',
  other_vendor_product: '他社製品',
  unknown: '対象範囲不明',
}

function conflictFor(conflicts: BoxTypeSpecConflict[], fieldName: string): BoxTypeSpecConflict | undefined {
  return conflicts.find((c) => c.field === fieldName)
}

interface InfoRow {
  label: string
  value: string
  attention?: boolean
}

/** 「積算に使用できる情報」の表の行を組み立てる(指示5章)。根拠の無い値は
 * 表示せず(行ごと省略)、競合・不明な項目のみ「要確認」として明示する。 */
function buildInfoRows(analysis: BoxTypeAnalysis): InfoRow[] {
  const rows: InfoRow[] = []
  const hasFinishConflict = conflictFor(analysis.conflicts, 'finish') != null

  rows.push({ label: '箱体分類', value: analysis.box_category ?? '要確認', attention: analysis.box_category == null })
  if (analysis.product_category != null) {
    rows.push({ label: '製品区分', value: analysis.product_category })
  }
  if (analysis.structure != null) {
    rows.push({ label: '箱体構造', value: analysis.structure })
  }
  rows.push({
    label: '設置環境',
    value: analysis.environment ?? '要確認(資料に明記なし)',
    attention: analysis.environment == null,
  })
  if (analysis.usage != null) {
    rows.push({ label: '使用区分', value: analysis.usage })
  }

  const materialConflict = conflictFor(analysis.conflicts, 'material')
  if (materialConflict != null) {
    rows.push({ label: '材質', value: '要確認(競合)', attention: true })
  } else if (analysis.material != null) {
    rows.push({ label: '材質', value: analysis.material })
  }

  if (hasFinishConflict || conflictFor(analysis.conflicts, 'body_coating') != null) {
    rows.push({ label: '塗装(本体)', value: '要確認(競合)', attention: true })
  } else if (analysis.coating != null) {
    rows.push({ label: '塗装(本体)', value: analysis.coating })
  }

  if (hasFinishConflict || conflictFor(analysis.conflicts, 'body_surface') != null) {
    rows.push({ label: '金属表面処理(本体)', value: '要確認(競合)', attention: true })
  } else if (analysis.surface_treatment != null) {
    rows.push({ label: '金属表面処理(本体)', value: analysis.surface_treatment })
  }

  const baseConflict =
    conflictFor(analysis.conflicts, 'base_surface') != null || conflictFor(analysis.conflicts, 'base_coating') != null
  if (baseConflict) {
    rows.push({ label: 'ベース表面処理', value: '要確認(競合)', attention: true })
  } else if (analysis.base_finish != null) {
    rows.push({ label: 'ベース表面処理', value: analysis.base_finish })
  }

  const certConflict = conflictFor(analysis.conflicts, 'certification')
  if (certConflict != null) {
    rows.push({ label: '認定区分', value: '要確認(競合)', attention: true })
  } else if (analysis.certification != null) {
    rows.push({ label: '認定区分', value: analysis.certification })
  }

  if (analysis.ip55) {
    rows.push({ label: '防塵防噴流仕様(IP55)', value: '該当' })
  }

  rows.push({ label: '処理対象', value: PROCESSING_TARGET_LABEL[analysis.processing_target] })

  if (analysis.custom_estimate_conditions.length > 0) {
    rows.push({ label: '独自積算条件', value: analysis.custom_estimate_conditions.join(' / ') })
  }
  if (analysis.other_notes.length > 0) {
    rows.push({ label: 'その他特殊仕様', value: analysis.other_notes.join(' / ') })
  }

  return rows
}

export function BoxTypeDetail({ model, analysis }: Props) {
  if (model == null) {
    return <p className="box-type-detail__empty">このページには箱体型式の情報がありません</p>
  }

  return (
    <div className="box-type-detail">
      <div className="box-type-detail__header">
        <span className="box-type-detail__label">箱体型式：</span>
        <span className="box-type-detail__symbol">{model}</span>
        {analysis != null && (
          <span className={`box-type-detail__status box-type-detail__status--${analysis.status}`}>
            {STATUS_LABEL[analysis.status]}
          </span>
        )}
      </div>

      {analysis == null && <p className="box-type-detail__empty">この型式は解析できませんでした</p>}

      {analysis != null && (
        <>
          <ul className="box-type-detail__symbol-list">
            {analysis.primary != null && (
              <li>
                <span className="box-type-detail__symbol-group">{GROUP_LABEL.primary}</span>
                <span className="box-type-detail__symbol-code">{analysis.primary.code}</span>
                <span className="box-type-detail__symbol-meaning">{analysis.primary.meaning}</span>
              </li>
            )}
            {analysis.aux_matches.map((m, index) => (
              <li key={`${m.group}-${m.code}-${index}`}>
                <span className="box-type-detail__symbol-group">{GROUP_LABEL[m.group] ?? m.group}</span>
                <span className="box-type-detail__symbol-code">{m.code}</span>
                <span className="box-type-detail__symbol-meaning">{m.meaning}</span>
              </li>
            ))}
          </ul>

          {(analysis.unparsed.length > 0 || analysis.warnings.length > 0) && (
            <ul className="box-type-detail__warnings">
              {analysis.unparsed.length > 0 && (
                <li>未解析の文字列: {analysis.unparsed.join(', ')}(要確認)</li>
              )}
              {analysis.warnings.map((w, index) => (
                <li key={index}>{w}</li>
              ))}
            </ul>
          )}

          {analysis.notes.length > 0 && (
            <ul className="box-type-detail__notes">
              {analysis.notes.map((n, index) => (
                <li key={index}>{n}</li>
              ))}
            </ul>
          )}

          <div className="box-type-detail__table-caption">積算に使用できる情報</div>
          <div className="box-type-detail__table-scroll">
            <table className="box-type-detail__table">
              <thead>
                <tr>
                  <th>積算分類</th>
                  <th>情報</th>
                </tr>
              </thead>
              <tbody>
                {buildInfoRows(analysis).map((row) => (
                  <tr key={row.label} className={row.attention ? 'box-type-detail__row--attention' : undefined}>
                    <th>{row.label}</th>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {analysis.alternatives.length > 0 && (
            <p className="box-type-detail__alternatives-note">
              他に{analysis.alternatives.length}件の同等な解析候補があります(要確認)。
            </p>
          )}
        </>
      )}
    </div>
  )
}
