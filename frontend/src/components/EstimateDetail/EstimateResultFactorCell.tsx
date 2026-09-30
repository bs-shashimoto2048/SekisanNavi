import { useEffect, useState } from 'react'
import type { EstimateResult } from '../../types/domain'
import './EstimateResultFactorCell.css'

interface Props {
  result: EstimateResult
  /** 係数の手修正 (Issue #40 7-3章)。`allowed_factors`がある場合は必ずその
   * 候補値のいずれかが渡される(`<select>`のoptionが候補そのものであるため、
   * ブラウザ操作では候補外を選べない)。無い場合は自由入力値。 */
  onOverride: (newFactor: number) => void
  /** 「初期値へ戻す」操作(Issue #40 7-3章、必須操作)。 */
  onReset: () => void
}

/**
 * 積算明細「ルール結果」行の係数セル (Issue #40 Phase 4)。
 *
 * - `factor_overridden === false`: 初期値をそのまま適用中 → 緑字 (指示4章)。
 * - `factor_overridden === true`: 手動修正値を適用中 → 赤字。hover/titleで
 *   「現在: X / 初期: Y / 手動修正」を確認できるようにし、通常表示は
 *   情報過多にしない(指示5章)。
 * - `allowed_factors`が設定されている場合は`<select>`(候補外はブラウザ操作では
 *   選択不可)、未設定の場合は自由入力の`<input type="number">`(指示4章)。
 * - 「初期値へ戻す」ボタンは常に表示するが、既に初期値のままの場合は
 *   無意味なAPI呼び出しを避けるため無効化する。
 */
export function EstimateResultFactorCell({ result, onOverride, onReset }: Props) {
  const [freeInputValue, setFreeInputValue] = useState(String(result.current_factor))

  // reset-factor・再評価等、外部要因でcurrent_factorが変わった場合に自由入力欄も
  // 追従させる(手動入力の途中でこの値が変わることは通常無いため、単純に
  // 上書きしてよい)。
  useEffect(() => {
    setFreeInputValue(String(result.current_factor))
  }, [result.current_factor])

  const valueTitle = result.factor_overridden
    ? `現在: ${result.current_factor}\n初期: ${result.initial_factor}\n手動修正`
    : `初期値のまま (${result.initial_factor})`

  // PR #43レビュー指摘対応: `Number('')`はJavaScript仕様上`0`になるため、
  // 空欄のままblurすると意図せず係数0が保存されてしまっていた
  // (allowed_factors=NULL時は自由入力のためBackend側も拒否しない)。
  // 空欄・数値として不正な値は、保存せず現在の`result.current_factor`の
  // 表示へ戻す。明示的に"0"を入力した場合はそのまま有効な手修正値として
  // 許可する(0自体を禁止する業務根拠は無いため)。
  function commitFreeInput() {
    const trimmed = freeInputValue.trim()
    const parsed = Number(trimmed)
    if (trimmed === '' || !Number.isFinite(parsed)) {
      setFreeInputValue(String(result.current_factor))
      return
    }
    if (parsed !== result.current_factor) {
      onOverride(parsed)
    }
  }

  return (
    <div className="estimate-result-factor-cell">
      <span
        className={
          'estimate-result-factor-cell__value' +
          (result.factor_overridden
            ? ' estimate-result-factor-cell__value--overridden'
            : ' estimate-result-factor-cell__value--initial')
        }
        title={valueTitle}
      >
        {result.current_factor}
      </span>

      {result.allowed_factors != null ? (
        <select
          className="estimate-result-factor-cell__select"
          aria-label="係数"
          value={result.current_factor}
          onChange={(e) => onOverride(Number(e.target.value))}
        >
          {result.allowed_factors.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="estimate-result-factor-cell__input"
          aria-label="係数"
          type="number"
          step="any"
          value={freeInputValue}
          onChange={(e) => setFreeInputValue(e.target.value)}
          onBlur={commitFreeInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            }
          }}
        />
      )}

      <button
        type="button"
        className="estimate-result-factor-cell__reset"
        title="初期値へ戻す"
        aria-label="初期値へ戻す"
        disabled={!result.factor_overridden}
        onClick={onReset}
      >
        ↺
      </button>
    </div>
  )
}
