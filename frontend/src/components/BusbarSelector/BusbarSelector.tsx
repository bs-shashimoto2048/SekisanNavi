import {
  BUSBAR_STEPS,
  detailsOf,
  displayValue,
  optionsFor,
  selectStep,
  statusOf,
  type BusbarSelection,
} from '../../domain/busbarCodes'
import { addRow, BUSBAR_FACTOR_OPTIONS, removeRow, updateRow, updateRowFactor, type BusbarRow } from '../../domain/busbarSelections'
import './BusbarSelector.css'

// 主回路銅帯(入力)コード選定UI (盤情報の盤一覧の下)。
//
// 4段階(仕様 → 相数 → 電圧区分 → 容量[kVA])で絞り込み、4項目がそろって対応するコードが 1 件に決まるときだけ、
// コードと仕様を表示する(0 件・複数件はコードを採用せず、状態を表示する)。対応表は `domain/busbarCodes`
// (ユーザー提示の DataviewJS のデータ)だけ。＋で追加した入力行は 4 項目すべて未選択(既定値・初期コードなし)。
//
// 面(`ban_menno`)ごとに 1 つ配置し、「＋」で同じ面に選択行を追加、個別に削除できる。この component は
// 行のリストを props で受け取る制御コンポーネントで、状態の保持・保存は呼び出し側(PanelInfo)が面ごとに行う。

interface Props {
  /** 面の表示ラベル(例: "1")。 */
  faceLabel: string
  rows: BusbarRow[]
  onChange: (rows: BusbarRow[]) => void
  /** サーバー保存済みの選択を取得中。追加・編集・削除を無効にし、読み込み中と分かる表示を出す
   * (取得結果との競合で、入力や保存済みの選択を失わないため)。 */
  loading?: boolean
}

function statusText(selection: BusbarSelection): string | null {
  const status = statusOf(selection)
  if (status.kind === 'incomplete') return '左から順に 4 項目を選択してください。'
  if (status.kind === 'none') return '一致するコードがありません(コードは採用されません)。'
  if (status.kind === 'multiple') return `一致するコードが一意に決まりません(該当 ${status.count} 件。コードは採用されません)。`
  return null
}

export function BusbarSelector({ faceLabel, rows, onChange, loading = false }: Props) {
  return (
    <div className="busbar-selector">
      <div className="busbar-selector__header">
        <span className="busbar-selector__title">面{faceLabel} 主回路銅帯(入力)コード選定</span>
        <button
          type="button"
          className="busbar-selector__add"
          onClick={() => onChange(addRow(rows))}
          disabled={loading}
          aria-label={`面${faceLabel}に銅帯の選択行を追加`}
          title="選択行を追加"
        >
          ＋
        </button>
      </div>

      {loading && (
        <p className="busbar-selector__loading" role="status">
          サーバーの保存内容を読み込み中です…(完了するまで追加・編集・削除はできません)
        </p>
      )}

      <div role="region" aria-label={`面${faceLabel} 主回路銅帯`} aria-busy={loading}>
        {rows.map((row, rowIndex) => {
        const status = statusOf(row.selection)
        const message = statusText(row.selection)
        const rowLabel = `面${faceLabel} 銅帯${rowIndex + 1}`
        const selectedCode = status.kind === 'unique' ? status.record.code : null
        return (
          <div className="busbar-selector__row" key={row.id} role="group" aria-label={rowLabel}>
            <div className="busbar-selector__row-head">
              <span className="busbar-selector__row-title">銅帯 {rowIndex + 1}</span>
              <button
                type="button"
                className="busbar-selector__remove"
                onClick={() => onChange(removeRow(rows, row.id))}
                disabled={loading}
                aria-label={`${rowLabel}を削除`}
                title="この行を削除"
              >
                ✕
              </button>
            </div>
            <div className="busbar-selector__fields">
              {BUSBAR_STEPS.map(({ key, label }, i) => {
                const options = optionsFor(i, row.selection)
                const value = row.selection[key]
                return (
                  <label className="busbar-selector__field" key={key} style={{ gridColumn: i + 2 }}>
                    <span className="busbar-selector__label">
                      {i + 1}. {label}
                    </span>
                    <select
                      value={value ?? ''}
                      disabled={loading || options.length === 0}
                      aria-label={`${rowLabel} ${label}`}
                      onChange={(e) => onChange(updateRow(rows, row.id, selectStep(row.selection, i, e.target.value)))}
                    >
                      <option value="">選択</option>
                      {options.map((o) => (
                        <option key={o} value={o}>
                          {displayValue(key, o)}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              })}
            </div>
            <div className="busbar-selector__code-cell" aria-live="polite" data-status={status.kind}>
              <span className="busbar-selector__label">選定コード</span>
              {selectedCode ? (
                <strong className="busbar-selector__code-value">{selectedCode}</strong>
              ) : (
                <span className="busbar-selector__code-placeholder" title={message ?? undefined}>
                  {status.kind === 'none' ? '該当なし' : status.kind === 'multiple' ? '複数一致' : '—'}
                </span>
              )}
            </div>
            <label className="busbar-selector__factor">
              <span className="busbar-selector__label">係数</span>
              <select
                value={row.factor}
                disabled={loading}
                aria-label={`${rowLabel} 係数`}
                onChange={(e) => onChange(updateRowFactor(rows, row.id, Number(e.target.value)))}
              >
                {BUSBAR_FACTOR_OPTIONS.map((factor) => (
                  <option key={factor} value={factor}>{factor.toFixed(1)}</option>
                ))}
              </select>
            </label>
            {status.kind === 'unique' && (
              <div className="busbar-selector__result" data-status={status.kind}>
                <dl className="busbar-selector__summary" aria-label="選定結果">
                  {detailsOf(status.record).map(([name, text], k) => (
                    <div className="busbar-selector__item" key={name}>
                      {k > 0 && (
                        <span className="busbar-selector__sep" aria-hidden="true">
                          ｜
                        </span>
                      )}
                      <dt className="busbar-selector__item-name">{name}</dt>
                      <dd className={k === 0 ? 'busbar-selector__code' : 'busbar-selector__value'} title={`${name}: ${text}`}>
                        {text}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        )
        })}
      </div>
    </div>
  )
}
