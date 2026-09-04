import { useState } from 'react'
import { ApiError, createEstimateConfirmation } from '../../api/client'
import type { EstimateConfirmation } from '../../types/domain'
import './EstimateConfirmationAction.css'

/**
 * 右ペイン②「積算集約」内の「積算確定」操作 (Issue #4 Phase B-3、最小UI)。
 *
 * **既存の`POST /api/products/{product_no}/estimate-confirmations`を呼ぶだけ**
 * (Phase B-2)。このコンポーネント自身はsnapshot内容を一切再計算・送信しない
 * (確定値の正本はBackend側で組み立てる既存仕様のまま。Issue #4最新コメントの
 * 方針)。積算集約の表示・対象セレクト・積算明細・BBox所属判定・Undo/Redoの
 * いずれにも影響しない、完全に独立した追加ボタンである。
 *
 * **製番単位であることを明示**: この操作は現在選択中の対象(総合計/個別盤/
 * 要確認)に関わらず常に製番全体を対象とするため、ボタンのラベル・確認
 * ダイアログの両方に`productNo`を明示し、「対象セレクトで選んでいる範囲だけが
 * 確定される」という誤解を避ける。
 *
 * **誤操作防止**: 押下直後に即APIを呼ばず、`window.confirm`による確認を
 * 挟む(専用モーダルは作らず、最小UIの原則に沿って標準ダイアログを使う)。
 * 送信中は再押下できないようにする(二重送信防止)。
 *
 * **0件確定**: APIは明細0件でも確定を許可する。UI側で独自に禁止せず、
 * 完了表示に常に`item_count`をそのまま表示することで、0件だった場合も
 * その事実が完了時に分かるようにする(確認ダイアログの時点では
 * 事前計算をせず、Backend側の実際の結果のみを正とする)。
 */

interface Props {
  /** 現在Viewerで開いている実製番。未選択(null)の間はボタン自体を出さない。 */
  productNo: string | null
}

type ConfirmationState =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'success'; confirmation: EstimateConfirmation }
  | { kind: 'error'; message: string }

function formatCurrency(amount: number): string {
  return `${amount.toLocaleString('ja-JP')}円`
}

/** 完了表示用の合計金額。積算集約(`sumAmounts`)と同じ考え方(単価未設定の
 * 明細は0円として黙って合算しない)を、確定snapshotのレスポンス
 * (`EstimateConfirmationItem[]`)に対して適用するだけの表示専用ロジック。 */
function summarizeAmount(confirmation: EstimateConfirmation): { total: number; unknownCount: number } {
  let total = 0
  let unknownCount = 0
  for (const item of confirmation.items) {
    if (item.amount == null) {
      unknownCount += 1
      continue
    }
    total += item.amount
  }
  return { total, unknownCount }
}

export function EstimateConfirmationAction({ productNo }: Props) {
  const [state, setState] = useState<ConfirmationState>({ kind: 'idle' })

  if (productNo == null) return null

  const confirming = state.kind === 'confirming'

  async function handleClick() {
    // productNoはこの時点でnullでないことをコンポーネント冒頭のガードで
    // 保証済みだが、TypeScriptのnarrowingをclosure内でも維持するため
    // ローカル変数へ束ねておく。
    const targetProductNo = productNo
    if (targetProductNo == null) return

    const confirmed = window.confirm(
      `製番 ${targetProductNo} の現在の積算結果を確定として保存します。\n` +
        '保存後に積算コードMasterの価格や図面データが変わっても、この確定内容自体は変化しません。\n\n' +
        'よろしいですか？',
    )
    if (!confirmed) return

    setState({ kind: 'confirming' })
    try {
      const confirmation = await createEstimateConfirmation(targetProductNo)
      setState({ kind: 'success', confirmation })
    } catch (e) {
      const message = e instanceof ApiError ? e.message : '積算確定に失敗しました。'
      setState({ kind: 'error', message })
    }
  }

  return (
    <div className="estimate-confirmation-action">
      <div className="estimate-confirmation-action__row">
        <span className="estimate-confirmation-action__label">製番 {productNo} の積算確定</span>
        <button
          type="button"
          className="estimate-confirmation-action__button"
          onClick={() => void handleClick()}
          disabled={confirming}
        >
          {confirming ? '確定中...' : '積算確定する'}
        </button>
      </div>

      {state.kind === 'success' && (
        <p className="estimate-confirmation-action__result estimate-confirmation-action__result--success">
          確定しました(確定ID {state.confirmation.id} / {state.confirmation.confirmed_at} / 積算コード{' '}
          {state.confirmation.item_count}件 / 合計 {formatCurrency(summarizeAmount(state.confirmation).total)}
          {summarizeAmount(state.confirmation).unknownCount > 0 &&
            ` ※単価未設定 ${summarizeAmount(state.confirmation).unknownCount}件を含まず`}
          )
        </p>
      )}

      {state.kind === 'error' && (
        <p className="estimate-confirmation-action__result estimate-confirmation-action__result--error" role="alert">
          積算確定に失敗しました: {state.message}
        </p>
      )}
    </div>
  )
}
