import { useState } from 'react'
import { ApiError, getEstimateConfirmation, listEstimateConfirmations } from '../../api/client'
import type { EstimateConfirmationDetail, EstimateConfirmationItem, EstimateConfirmationSummary } from '../../types/domain'
import './EstimateConfirmationHistory.css'

/**
 * 右ペイン②「積算集約」内の「確定履歴を見る」操作 (Issue #4 Phase B-4、最小UI)。
 *
 * `EstimateConfirmationAction`(積算確定する)の隣に置く独立したボタンで、
 * 過去に確定したsnapshotを製番単位で一覧・詳細参照できるようにする。
 * このコンポーネント自身は確定操作(POST)を一切呼ばず、読み出し専用の
 * `GET /api/products/{product_no}/estimate-confirmations`(一覧)/
 * `GET /api/products/{product_no}/estimate-confirmations/{id}`(詳細)のみを使う
 * (Issue #4最新コメントの方針。confirmation自体はappend-onlyのため、
 * このUIから編集・削除する手段は用意しない)。
 *
 * **表示項目はBackendが返すsnapshotの値のみ**を使う。現在のEstimate
 * Master/BBox/CSVから補完・再計算はしない(保存されていない情報を
 * 現在値で埋めない、という既存の実データ方針をそのまま踏襲する)。
 */

interface Props {
  /** 現在Viewerで開いている実製番。未選択(null)の間はボタン自体を出さない。 */
  productNo: string | null
}

type ListState =
  | { kind: 'loading' }
  | { kind: 'loaded'; confirmations: EstimateConfirmationSummary[] }
  | { kind: 'error'; message: string }

type DetailState =
  | { kind: 'loading' }
  | { kind: 'loaded'; detail: EstimateConfirmationDetail }
  | { kind: 'error'; message: string }

function formatCurrency(amount: number): string {
  return `${amount.toLocaleString('ja-JP')}円`
}

/** 積算集約(EstimateAggregation)の「内容」列と同じ考え方(型式/定格を
 * ' / 'で結合し、いずれも無ければコードへfallbackする)の表示専用フォーマット。
 * BBox所属判定等のドメインロジックではなく、単なる文字列整形のためここに
 * 閉じて持つ(既存の`estimateAggregationReal.ts::buildContent`は非公開関数)。 */
function formatContent(item: EstimateConfirmationItem): string {
  const parts = [item.model, item.rating].filter((v): v is string => !!v && v.trim() !== '')
  return parts.length > 0 ? parts.join(' / ') : item.code
}

export function EstimateConfirmationHistory({ productNo }: Props) {
  const [open, setOpen] = useState(false)
  const [listState, setListState] = useState<ListState>({ kind: 'loading' })
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detailState, setDetailState] = useState<DetailState | null>(null)

  if (productNo == null) return null
  const currentProductNo = productNo

  function loadList() {
    setListState({ kind: 'loading' })
    listEstimateConfirmations(currentProductNo)
      .then((confirmations) => setListState({ kind: 'loaded', confirmations }))
      .catch((e) =>
        setListState({
          kind: 'error',
          message: e instanceof ApiError ? e.message : '確定履歴の取得に失敗しました。',
        }),
      )
  }

  function handleOpen() {
    setOpen(true)
    setSelectedId(null)
    setDetailState(null)
    loadList()
  }

  function handleClose() {
    setOpen(false)
  }

  function handleSelect(confirmationId: number) {
    setSelectedId(confirmationId)
    setDetailState({ kind: 'loading' })
    getEstimateConfirmation(currentProductNo, confirmationId)
      .then((detail) => setDetailState({ kind: 'loaded', detail }))
      .catch((e) =>
        setDetailState({
          kind: 'error',
          message: e instanceof ApiError ? e.message : '確定内容の取得に失敗しました。',
        }),
      )
  }

  function handleBackToList() {
    setSelectedId(null)
    setDetailState(null)
  }

  if (!open) {
    return (
      <button type="button" className="estimate-confirmation-history__trigger" onClick={handleOpen}>
        確定履歴を見る
      </button>
    )
  }

  return (
    <div className="estimate-confirmation-history__backdrop" onClick={handleClose}>
      <div className="estimate-confirmation-history" onClick={(e) => e.stopPropagation()}>
        <div className="estimate-confirmation-history__header">
          <h2>確定履歴(製番 {currentProductNo})</h2>
          <button type="button" onClick={handleClose} aria-label="閉じる">
            ×
          </button>
        </div>

        {selectedId == null ? (
          <>
            {listState.kind === 'loading' && (
              <p className="estimate-confirmation-history__status">読み込み中...</p>
            )}
            {listState.kind === 'error' && (
              <p className="estimate-confirmation-history__error" role="alert">
                {listState.message}
              </p>
            )}
            {listState.kind === 'loaded' && listState.confirmations.length === 0 && (
              <p className="estimate-confirmation-history__empty">
                製番 {currentProductNo} はまだ積算確定されていません。
              </p>
            )}
            {listState.kind === 'loaded' && listState.confirmations.length > 0 && (
              <ul className="estimate-confirmation-history__list">
                {listState.confirmations.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="estimate-confirmation-history__list-item"
                      onClick={() => handleSelect(c.id)}
                    >
                      <span className="estimate-confirmation-history__list-date">{c.confirmed_at}</span>
                      <span className="estimate-confirmation-history__list-count">{c.item_count}件</span>
                      <span className="estimate-confirmation-history__list-amount">
                        {formatCurrency(c.total_amount)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className="estimate-confirmation-history__back"
              onClick={handleBackToList}
            >
              ← 一覧へ戻る
            </button>

            {detailState?.kind === 'loading' && (
              <p className="estimate-confirmation-history__status">読み込み中...</p>
            )}
            {detailState?.kind === 'error' && (
              <p className="estimate-confirmation-history__error" role="alert">
                {detailState.message}
              </p>
            )}
            {detailState?.kind === 'loaded' && (
              <div className="estimate-confirmation-history__detail">
                <p className="estimate-confirmation-history__detail-summary">
                  確定日時 {detailState.detail.confirmed_at} / 件数 {detailState.detail.item_count}件 / 合計{' '}
                  {formatCurrency(detailState.detail.total_amount)}
                </p>
                {detailState.detail.items.length === 0 ? (
                  <p className="estimate-confirmation-history__empty">
                    この確定には積算コードの明細がありません。
                  </p>
                ) : (
                  <div className="estimate-confirmation-history__table-wrap">
                    <table className="estimate-confirmation-history__table">
                      <thead>
                        <tr>
                          <th>コード</th>
                          <th>内容</th>
                          <th>型式</th>
                          <th>定格</th>
                          <th>単価(暫定)</th>
                          <th>数量</th>
                          <th>金額</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailState.detail.items.map((item) => (
                          <tr key={item.id}>
                            <td>{item.code}</td>
                            <td>{formatContent(item)}</td>
                            <td>{item.model ?? '-'}</td>
                            <td>{item.rating ?? '-'}</td>
                            <td>{item.unit_price != null ? formatCurrency(item.unit_price) : '不明'}</td>
                            <td>{item.quantity}</td>
                            <td>{item.amount != null ? formatCurrency(item.amount) : '不明'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
