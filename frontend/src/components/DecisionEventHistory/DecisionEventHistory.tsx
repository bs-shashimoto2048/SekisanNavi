import { useState } from 'react'
import { ApiError, listDecisionEvents } from '../../api/client'
import type { DecisionEvent, DecisionEventType } from '../../types/domain'
import './DecisionEventHistory.css'

/**
 * 編集ツールバー(Undo/Redoボタンの隣)の「操作履歴を見る」操作
 * (Issue #4 Phase A-2、最小UI)。
 *
 * 読み出し専用の`GET /api/products/{product_no}/decision-events`のみを呼ぶ。
 * このコンポーネント自身は値を再計算・編集せず、保存済みの判断履歴
 * (BBox追加/削除/移動・サイズ変更の事実)をそのまま時系列(古い順)で
 * 一覧表示するだけである(Undo/Redoの取り消し操作自体はこのUIから行えない。
 * 既存のUndo/Redoボタン・キーボードショートカットのまま)。
 *
 * **配置**: 積算集約パネル内には置かず、App全体の編集ツールバー
 * (Undo/Redoボタンの隣)に置く。decision_eventsはDetection(BBox)の編集
 * そのものの履歴であり、積算金額の確定履歴(`EstimateConfirmationHistory`、
 * 積算集約パネル内に配置)とは性質が異なるため、既存の「積算画面」の
 * 作業導線(対象セレクト・明細表・確定操作)を邪魔しない位置とする。
 *
 * **表示文言**: `event_type`はそのままでは非技術者に意味が伝わらないため、
 * 日本語ラベルへ変換する(`create`→「BBox追加」等)。move/resizeは保存時に
 * 区別していない(`bbox_edit`に統合)ため、「BBox移動/サイズ変更」とだけ表示し、
 * 保存データから確実に判定できない細分化は行わない。
 */

interface Props {
  /** 現在Viewerで開いている実製番。未選択(null)の間はボタン自体を出さない。 */
  productNo: string | null
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'loaded'; events: DecisionEvent[] }
  | { kind: 'error'; message: string }

const EVENT_TYPE_LABELS: Record<DecisionEventType, string> = {
  create: 'BBox追加',
  delete: 'BBox削除',
  bbox_edit: 'BBox移動/サイズ変更',
}

const SOURCE_TYPE_LABELS: Record<DecisionEvent['source_type'], string> = {
  ai: 'AI検出',
  manual: '手動',
}

/** BBox座標(0.0〜1.0の正規化値)を小数第3位までの読みやすい文字列にする。
 * 4値のいずれかがnull(create時のbefore、delete時のafter)ならnullを返す。 */
function formatBBox(x: number | null, y: number | null, w: number | null, h: number | null): string | null {
  if (x == null || y == null || w == null || h == null) return null
  const f = (v: number) => v.toFixed(3)
  return `位置(x=${f(x)}, y=${f(y)}) / サイズ(幅${f(w)}×高さ${f(h)})`
}

function EventRow({ event }: { event: DecisionEvent }) {
  const before = formatBBox(event.before_bbox_x, event.before_bbox_y, event.before_bbox_w, event.before_bbox_h)
  const after = formatBBox(event.after_bbox_x, event.after_bbox_y, event.after_bbox_w, event.after_bbox_h)

  return (
    <li className="decision-event-history__item">
      <div className="decision-event-history__item-header">
        <span className="decision-event-history__date">{event.occurred_at}</span>
        <span className={`decision-event-history__type decision-event-history__type--${event.event_type}`}>
          {EVENT_TYPE_LABELS[event.event_type]}
        </span>
      </div>
      <div className="decision-event-history__item-meta">
        Detection #{event.detection_id} / {SOURCE_TYPE_LABELS[event.source_type]}
        {event.page_no != null && ` / ページ${event.page_no}`}
      </div>
      {(before || after) && (
        <div className="decision-event-history__bbox">
          {before && <div className="decision-event-history__bbox-line">変更前: {before}</div>}
          {after && <div className="decision-event-history__bbox-line">変更後: {after}</div>}
        </div>
      )}
    </li>
  )
}

export function DecisionEventHistory({ productNo }: Props) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })

  if (productNo == null) return null
  const currentProductNo = productNo

  function handleOpen() {
    setOpen(true)
    setState({ kind: 'loading' })
    listDecisionEvents(currentProductNo)
      .then((events) => setState({ kind: 'loaded', events }))
      .catch((e) =>
        setState({
          kind: 'error',
          message: e instanceof ApiError ? e.message : '操作履歴の取得に失敗しました。',
        }),
      )
  }

  function handleClose() {
    setOpen(false)
  }

  if (!open) {
    return (
      <button type="button" className="decision-event-history__trigger" onClick={handleOpen}>
        操作履歴を見る
      </button>
    )
  }

  return (
    <div className="decision-event-history__backdrop" onClick={handleClose}>
      <div className="decision-event-history" onClick={(e) => e.stopPropagation()}>
        <div className="decision-event-history__header">
          <h2>操作履歴(製番 {currentProductNo})</h2>
          <button type="button" onClick={handleClose} aria-label="閉じる">
            ×
          </button>
        </div>

        {state.kind === 'loading' && <p className="decision-event-history__status">読み込み中...</p>}
        {state.kind === 'error' && (
          <p className="decision-event-history__error" role="alert">
            {state.message}
          </p>
        )}
        {state.kind === 'loaded' && state.events.length === 0 && (
          <p className="decision-event-history__empty">
            製番 {currentProductNo} にはまだ操作履歴がありません。
          </p>
        )}
        {state.kind === 'loaded' && state.events.length > 0 && (
          <ul className="decision-event-history__list">
            {state.events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
