import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ApiError, getEstimateConfirmation, listEstimateConfirmations } from '../../api/client'
import { applicableUnitLabel, judgmentMethodLabel } from '../../domain/drawingEvidencePresentation'
import type { EstimateConfirmationDetail, EstimateConfirmationItem, EstimateConfirmationSummary } from '../../types/domain'
import './EstimateConfirmationHistory.css'

/**
 * 右ペイン②「積算集約」内の「確定履歴」操作 (Issue #4 Phase B-4、最小UI。
 * Issue #36で表示文言を「確定履歴を見る」→「履歴」へ短縮、accessible name
 * (可視テキスト)は`履歴`のまま、hover時の補足は`title="確定履歴を見る"`で行う)。
 *
 * `EstimateConfirmationAction`(積算確定)の隣に置く独立したボタンで、
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

const MISSING_VALUE_PLACEHOLDER = '-'

/** [Issue #40 Phase 6-A指示A-5] 係数列の表示。Phase 6-A以前に確定された
 * 過去snapshot(`current_factor`がnull)は「-」のまま表示し、推測で1等を
 * 埋めない。`factor_overridden`が真の場合のみ「(手修正)」を添えて、
 * 自動結果から変更されたことが分かるようにする。 */
function formatConfirmedFactor(item: EstimateConfirmationItem): string {
  if (item.current_factor == null) return MISSING_VALUE_PLACEHOLDER
  return item.factor_overridden ? `${item.current_factor} (手修正)` : `${item.current_factor}`
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
      <button
        type="button"
        className="estimate-confirmation-history__trigger"
        onClick={handleOpen}
        title="確定履歴を見る"
      >
        履歴
      </button>
    )
  }

  // [追加修正: 積算コードMasterのfloating panel化・前面化ルール追加に伴う対応]
  // このmodalは`EstimateAggregation`(floating panel化されたcomponent)の中で
  // 開くため、通常のDOM上の位置のままだと`.floating-panel`(position:absolute +
  // 動的z-index)が作る新しいstacking contextの内側に閉じ込められてしまう。
  // その場合、このmodal自身のz-indexをどれだけ大きくしても、「他のfloating
  // panelの方が現在z-indexが高い」場合にそちらの後ろへ回り込んでしまう
  // (stacking contextの比較は祖先の`.floating-panel`単位で行われるため)。
  // `document.body`直下へportalすることでfloating panelのstacking context
  // から完全に抜け出させ、`.estimate-confirmation-history__backdrop`の
  // z-index(1000、EstimateConfirmationHistory.css)がfloating panel全体
  // (100番台)より確実に前面へ出るようにしている。
  return createPortal(
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
                    {/* [Issue #40 Phase 6-A指示A-5] 列構成を積算明細(EstimateDetail)
                        と揃えた(コード/内容/数量/適用単位/係数/金額/判定)。
                        Phase 6-A以前に確定された過去snapshotは新列(数量以外)が
                        全てnullのため、その場合は「-」のまま表示し壊れない
                        (値を推測で埋めない)。 */}
                    <table className="estimate-confirmation-history__table">
                      <thead>
                        <tr>
                          <th>コード</th>
                          <th>内容</th>
                          <th>数量</th>
                          <th>適用単位</th>
                          <th>係数</th>
                          <th>金額</th>
                          <th>判定</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailState.detail.items.map((item) => (
                          <tr key={item.id}>
                            <td>{item.code}</td>
                            <td>{formatContent(item)}</td>
                            <td>{item.quantity}</td>
                            <td>
                              {item.applicable_unit != null
                                ? applicableUnitLabel(item.applicable_unit)
                                : MISSING_VALUE_PLACEHOLDER}
                            </td>
                            <td>{formatConfirmedFactor(item)}</td>
                            <td>{item.amount != null ? formatCurrency(item.amount) : '不明'}</td>
                            <td>
                              {item.judgment_method != null
                                ? judgmentMethodLabel(item.judgment_method)
                                : MISSING_VALUE_PLACEHOLDER}
                            </td>
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
    </div>,
    document.body,
  )
}
