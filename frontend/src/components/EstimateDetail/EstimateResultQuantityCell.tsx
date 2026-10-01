import { useEffect, useState } from 'react'
import type { EstimateResult } from '../../types/domain'
import './EstimateResultQuantityCell.css'

interface Props {
  result: EstimateResult
  /** 数量の手修正 (Issue #40 Phase 6後半)。`reason`は必須(指示4章)。 */
  onOverride: (newQuantity: number, reason: string) => void
  /** 「初期値へ戻す」操作(係数と同じく必須操作)。 */
  onReset: () => void
}

/**
 * 積算明細「ルール結果」行の数量セル (Issue #40 Phase 6後半)。
 *
 * - `quantity_overridden === false`: 自動算定値をそのまま適用中 → 緑字
 *   (係数セルと同じ配色思想、指示1章)。
 * - `quantity_overridden === true`: 手動修正値を適用中 → 赤字。hover/titleで
 *   「初期数量/現在数量/修正理由」を確認できるようにする(指示6章)。
 * - 数量変更時は理由入力を必須とする(指示4章、初回実装)。入力欄をblurした
 *   時点で値が変化していれば、同じセル内に理由入力(インライン、指示4章
 *   「選択肢B」)を展開し、理由確定まではAPIを呼ばない。
 * - 「初期値へ戻す」ボタンは常に表示するが、既に初期値のままの場合は無効化する。
 */
export function EstimateResultQuantityCell({ result, onOverride, onReset }: Props) {
  const [freeInputValue, setFreeInputValue] = useState(String(result.current_quantity))
  const [pendingQuantity, setPendingQuantity] = useState<number | null>(null)
  const [reasonInput, setReasonInput] = useState('')

  // reset-quantity・再評価等、外部要因でcurrent_quantityが変わった場合に
  // 自由入力欄・理由入力中の状態も追従させる。
  useEffect(() => {
    setFreeInputValue(String(result.current_quantity))
    setPendingQuantity(null)
    setReasonInput('')
  }, [result.current_quantity])

  const valueTitle = result.quantity_overridden
    ? `現在: ${result.current_quantity}\n初期: ${result.initial_quantity}\n理由: ${
        result.quantity_override_reason ?? ''
      }\n手動修正`
    : `初期値のまま (${result.initial_quantity})`

  // 空欄・NaN/Infinity・負数は保存せず、現在の`result.current_quantity`の表示へ
  // 戻す(指示3章)。明示的な"0"はそのまま有効な手修正値として許可する。
  function commitFreeInput() {
    const trimmed = freeInputValue.trim()
    const parsed = Number(trimmed)
    if (trimmed === '' || !Number.isFinite(parsed) || parsed < 0) {
      setFreeInputValue(String(result.current_quantity))
      return
    }
    if (parsed === result.current_quantity) {
      return
    }
    setPendingQuantity(parsed)
    setReasonInput('')
  }

  function confirmReason() {
    if (pendingQuantity == null) {
      return
    }
    const reason = reasonInput.trim()
    if (reason === '') {
      return
    }
    onOverride(pendingQuantity, reason)
    setPendingQuantity(null)
    setReasonInput('')
  }

  function cancelPending() {
    setPendingQuantity(null)
    setReasonInput('')
    setFreeInputValue(String(result.current_quantity))
  }

  return (
    <div className="estimate-result-quantity-cell">
      <div className="estimate-result-quantity-cell__row">
        <span
          className={
            'estimate-result-quantity-cell__value' +
            (result.quantity_overridden
              ? ' estimate-result-quantity-cell__value--overridden'
              : ' estimate-result-quantity-cell__value--initial')
          }
          title={valueTitle}
        >
          {result.current_quantity}
        </span>

        <input
          className="estimate-result-quantity-cell__input"
          aria-label="数量"
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

        <button
          type="button"
          className="estimate-result-quantity-cell__reset"
          title="初期値へ戻す"
          aria-label="初期値へ戻す"
          disabled={!result.quantity_overridden}
          onClick={onReset}
        >
          ↺
        </button>
      </div>

      {pendingQuantity != null && (
        <div className="estimate-result-quantity-cell__reason-prompt">
          <input
            className="estimate-result-quantity-cell__reason-input"
            aria-label="数量変更の理由"
            placeholder="変更理由(必須)"
            value={reasonInput}
            onChange={(e) => setReasonInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                confirmReason()
              } else if (e.key === 'Escape') {
                cancelPending()
              }
            }}
            autoFocus
          />
          <button
            type="button"
            className="estimate-result-quantity-cell__reason-apply"
            aria-label="適用"
            disabled={reasonInput.trim() === ''}
            onClick={confirmReason}
          >
            適用
          </button>
          <button
            type="button"
            className="estimate-result-quantity-cell__reason-cancel"
            aria-label="キャンセル"
            onClick={cancelPending}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
