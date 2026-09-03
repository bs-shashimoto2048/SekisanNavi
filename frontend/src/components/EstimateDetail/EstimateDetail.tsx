import { useEffect, useMemo, useRef, useState } from 'react'
import type { DetectionStatus } from '../../types/domain'
import type { EstimateDetailItem, EstimateSource, EstimateTarget } from '../../types/estimateAggregation'
import './EstimateDetail.css'

/** 積算明細の情報源フィルタ。「全て」と、実データでは常に0件になる「設計情報」
 * を含むため、実データのみを表す`EstimateSource`とは別のUI専用の型として定義する。
 * App.tsx側が所属変更追従(指示12章)で強制的に切り替えられるよう、外部へ公開する。 */
export type DetailSourceFilter = 'all' | EstimateSource | 'design_data'

const SOURCE_TABS: { value: DetailSourceFilter; label: string }[] = [
  { value: 'all', label: '全て' },
  { value: 'ai', label: 'AI' },
  { value: 'design_data', label: '設計情報' },
  { value: 'manual', label: 'マニュアル' },
]

const MISSING_VALUE_PLACEHOLDER = '-'

/**
 * Detection.statusを○/△/×の3記号へ変換する (盤フォーカス・積算明細再設計 指示2章)。
 * 実データの4値を「新設せず」3記号へまとめる際の対応関係:
 *   - `reviewed` (Manual BBox追加時の既定値。「配置した時点で確認済み」の扱い。
 *     docs/data-model.md参照) → ○ (確定)
 *   - `needs_review` (要確認フラグ) → △ (要確認、そのまま)
 *   - `pending` (未確認・レビュー未実施) → △ (要確認と同じ「未確定」グループへ。
 *     `pending`専用の4つ目の記号は新設しない)
 *   - `excluded` (除外・無効) → × (不備)
 */
const STATUS_SYMBOL: Record<DetectionStatus, string> = {
  reviewed: '○',
  needs_review: '△',
  pending: '△',
  excluded: '×',
}

/** 状態のソート順位 (積算明細強化・Undo/Redo・要確認警告・編集追従 指示3章:
 * ×→△→○の順)。needs_review/pendingは表示記号(△)が同じであるため同順位とする。 */
const STATUS_SORT_RANK: Record<DetectionStatus, number> = {
  excluded: 0,
  needs_review: 1,
  pending: 1,
  reviewed: 2,
}

type SortColumn = 'panel' | 'itemName' | 'code' | 'model' | 'rating' | 'page' | 'status' | 'editOrder'
type SortDirection = 'asc' | 'desc'

const COLUMN_DEFS: { column: SortColumn; label: string; className: string }[] = [
  { column: 'panel', label: '面/盤', className: 'estimate-detail__col-panel' },
  { column: 'itemName', label: '品名', className: 'estimate-detail__col-name' },
  { column: 'code', label: 'コード', className: 'estimate-detail__col-code' },
  { column: 'model', label: '型式', className: 'estimate-detail__col-model' },
  { column: 'rating', label: '定格', className: 'estimate-detail__col-rating' },
  { column: 'page', label: '図面', className: 'estimate-detail__col-page' },
  { column: 'status', label: '状態', className: 'estimate-detail__col-status' },
  { column: 'editOrder', label: '編集順', className: 'estimate-detail__col-edit-order' },
]

/** 積算明細「面/盤」列用のコンパクト表示 (指示1章)。表示文字列から所属を
 * 逆算せず、既存のEstimateTarget(BBox所属判定の結果そのもの)を引くだけにする。 */
function formatTargetCompact(target: EstimateTarget | null): string {
  if (target == null) return MISSING_VALUE_PLACEHOLDER
  if (target.type === 'panel' && target.banMenno != null && target.banNo != null) {
    return `${target.banMenno}/${target.banNo}`
  }
  if (target.type === 'product') return '全体'
  return '要確認' // tie
}

/** 編集日時を「20260903 10:44:03」形式へ整形する (指示1章)。 */
function formatEditDateTime(editedAt: number): string {
  const d = new Date(editedAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const naturalCollator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })

function compareItems(
  column: SortColumn,
  a: EstimateDetailItem,
  b: EstimateDetailItem,
  targetById: Map<string, EstimateTarget>,
): number {
  switch (column) {
    case 'panel': {
      const ta = targetById.get(a.targetId) ?? null
      const tb = targetById.get(b.targetId) ?? null
      const banMennoA = ta?.banMenno ?? Number.POSITIVE_INFINITY
      const banMennoB = tb?.banMenno ?? Number.POSITIVE_INFINITY
      if (banMennoA !== banMennoB) return banMennoA - banMennoB
      const banNoA = ta?.banNo ?? Number.POSITIVE_INFINITY
      const banNoB = tb?.banNo ?? Number.POSITIVE_INFINITY
      return banNoA - banNoB
    }
    case 'itemName':
      return (a.itemName ?? '').localeCompare(b.itemName ?? '', 'ja')
    case 'code': {
      const numA = Number(a.code)
      const numB = Number(b.code)
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB
      return a.code.localeCompare(b.code, 'ja')
    }
    case 'model':
      return naturalCollator.compare(a.model ?? '', b.model ?? '')
    case 'rating':
      return naturalCollator.compare(a.rating ?? '', b.rating ?? '')
    case 'page':
      return a.pageNo - b.pageNo
    case 'status':
      return STATUS_SORT_RANK[a.status] - STATUS_SORT_RANK[b.status]
    case 'editOrder':
      return a.editSequence - b.editSequence
    default:
      return 0
  }
}

interface Props {
  detailItems: EstimateDetailItem[]
  /** BBox所属判定の結果そのもの (EstimateTarget一覧)。「面/盤」列の表示・ソートで
   * `targetId`から実識別子(banMenno/banNo/type)を引くために使う (指示1章:
   * 表示文字列から所属を逆算せず、既存のEstimateTarget/BBox所属結果を再利用する)。 */
  targets: EstimateTarget[]
  /** 積算集約(②)と共有する対象選択状態。nullは「総合計」(フィルタなし)。 */
  selectedTargetId: string | null
  /** 現在Viewerが表示中のページ番号。一致する行は背景色で強調する (指示4章)。 */
  currentPageNo: number | null
  /** 図面セルクリックでViewerを該当図面へ移動する (既存EstimateTreeと同じ
   * `onNavigateReference`をそのまま再利用する)。 */
  onNavigateReference: (drawingPageId: number, detectionId: number | null) => void
  /** 行(または根拠セル)hoverで一時的にViewer上のBBoxを強調する。nullでhover解除。 */
  onHoverDetail: (detectionId: number | null) => void
  /** 情報源タブの選択状態。所属変更追従(指示12章)でApp.tsx側から強制的に
   * 切り替えられるようにcontrolledにしている (旧: このコンポーネント内部のstate)。 */
  sourceFilter: DetailSourceFilter
  onSourceFilterChange: (filter: DetailSourceFilter) => void
  /** 編集直後、一時的に強調・自動スクロールする対象のDetection id (指示5章/13章)。
   * nullの間は何もしない。強調の解除(タイマー)はApp.tsx側が行う。 */
  editFollowDetectionId?: number | null
}

/**
 * 右ペイン③「積算明細」領域 (この積算情報が、どの対象・情報源・図面・位置を
 * 根拠として付けられたものかを確認する場所)。
 *
 * **積算集約との重要な違い**: 積算集約(②)は同一積算コードを数量としてまとめるが、
 * ここでは原則まとめない。1 Detection(情報付け) = 1行を維持し、同じコードが
 * 複数の図面/BBoxに付加されている場合もそれぞれ追跡できるようにする。
 *
 * **表示は面/盤・品名・コード・型式・定格・図面・状態・編集順の8列**
 * (積算明細強化・Undo/Redo・要確認警告・編集追従 指示1章)。「面/盤」は
 * `EstimateTarget`(BBox所属判定の結果そのもの)から導出し、表示文字列からの
 * 逆算は行わない。「編集順」は`EstimateDetailItem.editSequence`
 * (App.tsxが管理するFrontendセッション内カウンタ。Backendに永続的な更新日時が
 * 無いため「更新日時」とは呼ばない)を使う。
 *
 * **全列ソート可能** (指示3章)。ヘッダクリックで昇順/降順を切り替え、現在の
 * ソート列に▲/▼を表示する。初期状態は編集順の降順。ソート状態はこの
 * コンポーネント内部のuseStateで保持し、親の再描画(データ更新)では
 * リセットされない (指示14章: 編集追従が発生してもユーザーのソート条件を維持)。
 *
 * **行の強調優先順位** (指示4章/5章): 編集直後 > Hover > 現在ページ > 通常。
 * 編集直後・現在ページはJS側で排他的に1つのクラスを付け、Hoverは既存の
 * CSS `:hover`疑似クラスにまかせる (詳細度により自然にHover > 現在ページになる。
 * 編集直後はCSS側で`:hover`より詳細度を上げて常に最優先になるようにしている)。
 *
 * **見出し・タブ・表ヘッダ・凡例を固定し、データ行のみ内部スクロールする**
 * (盤フォーカス・積算明細再設計 指示5章)。`<thead>`に`position:sticky`を使い、
 * 凡例(`__legend`)はスクロール領域の外に置くことで常に見える状態を保つ。
 *
 * **Hoverとクリックの役割分離**: 行のHoverは根拠位置を一時的に確認するだけの
 * 操作(Viewerページの自動遷移はしない)。図面セルのクリックだけがViewerの
 * ページ遷移を行う (既存EstimateTreeの根拠図面ジャンプ機構を再利用)。
 */
export function EstimateDetail({
  detailItems,
  targets,
  selectedTargetId,
  currentPageNo,
  onNavigateReference,
  onHoverDetail,
  sourceFilter,
  onSourceFilterChange,
  editFollowDetectionId = null,
}: Props) {
  // ソート列/方向は「ユーザーが選んだ表示上の好み」であり、データ(App.tsx側の状態)
  // とは無関係のため、このコンポーネント自身のuseStateとして持つ (指示14章: 編集
  // 追従で勝手にリセットされてはいけない。親の再描画(データ更新)では値は保持される)。
  // 初期値は編集順の降順 (指示3章)。
  const [sortColumn, setSortColumn] = useState<SortColumn>('editOrder')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const tableScrollRef = useRef<HTMLDivElement>(null)

  const targetById = useMemo(() => new Map(targets.map((t) => [t.id, t])), [targets])

  // 積算集約(②)で選択中の対象へ完全連動させる。「総合計」(null)の場合は
  // フィルタしない。
  const itemsForTarget = useMemo(
    () => (selectedTargetId == null ? detailItems : detailItems.filter((d) => d.targetId === selectedTargetId)),
    [detailItems, selectedTargetId],
  )

  const counts = useMemo(() => {
    const c: Record<DetailSourceFilter, number> = { all: itemsForTarget.length, ai: 0, design_data: 0, manual: 0 }
    for (const item of itemsForTarget) c[item.source] += 1
    return c
  }, [itemsForTarget])

  const visibleItems = useMemo(() => {
    if (sourceFilter === 'all') return itemsForTarget
    // 'design_data'は実データに対応するsource_typeが存在しないため、常に0件になる
    // (実データから判定できない情報源を仮に割り当てない方針)。
    if (sourceFilter === 'design_data') return []
    return itemsForTarget.filter((item) => item.source === sourceFilter)
  }, [itemsForTarget, sourceFilter])

  const sortedItems = useMemo(() => {
    const copy = [...visibleItems]
    copy.sort((a, b) => {
      const cmp = compareItems(sortColumn, a, b, targetById)
      return sortDirection === 'asc' ? cmp : -cmp
    })
    return copy
  }, [visibleItems, sortColumn, sortDirection, targetById])

  // 編集直後の対象行まで自動スクロールする (指示13章)。ソート順は変更しないため、
  // 現在のsortedItemsの中から該当行のDOMを探すだけでよい。
  useEffect(() => {
    if (editFollowDetectionId == null) return
    const row = tableScrollRef.current?.querySelector(
      `[data-detection-id="${editFollowDetectionId}"]`,
    )
    row?.scrollIntoView({ block: 'nearest' })
  }, [editFollowDetectionId])

  function handleHeaderClick(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  return (
    <section className="estimate-detail">
      <div className="estimate-detail__fixed-top">
        <h2 className="estimate-detail__heading">積算明細</h2>

        <div className="estimate-detail__source-tabs" role="tablist" aria-label="情報源">
          {SOURCE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={sourceFilter === tab.value}
              className={
                'estimate-detail__source-tab' +
                (sourceFilter === tab.value ? ' estimate-detail__source-tab--active' : '')
              }
              onClick={() => onSourceFilterChange(tab.value)}
            >
              {tab.label} {counts[tab.value]}
            </button>
          ))}
        </div>
      </div>

      <div className="estimate-detail__table-scroll" ref={tableScrollRef}>
        <table className="estimate-detail__table">
          <thead>
            <tr>
              {COLUMN_DEFS.map(({ column, label, className }) => {
                const isActive = sortColumn === column
                return (
                  <th key={column} className={className}>
                    <button
                      type="button"
                      className="estimate-detail__sort-button"
                      onClick={() => handleHeaderClick(column)}
                      aria-label={`${label}でソート`}
                    >
                      {label}
                      {isActive && (
                        <span className="estimate-detail__sort-indicator">
                          {sortDirection === 'asc' ? '▲' : '▼'}
                        </span>
                      )}
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sortedItems.length === 0 && (
              <tr>
                <td className="estimate-detail__empty" colSpan={COLUMN_DEFS.length}>
                  明細がありません
                </td>
              </tr>
            )}
            {sortedItems.map((item) => {
              const isCurrentPage = item.pageNo === currentPageNo
              const isEditFollow = item.detectionId === editFollowDetectionId
              const rowStateClass = isEditFollow
                ? ' estimate-detail__row--edit-follow'
                : isCurrentPage
                  ? ' estimate-detail__row--current-page'
                  : ''
              return (
                <tr
                  key={item.id}
                  data-detection-id={item.detectionId}
                  className={'estimate-detail__row' + rowStateClass}
                  onMouseEnter={() => onHoverDetail(item.detectionId)}
                  onMouseLeave={() => onHoverDetail(null)}
                >
                  <td className="estimate-detail__col-panel">
                    {formatTargetCompact(targetById.get(item.targetId) ?? null)}
                  </td>
                  <td className="estimate-detail__col-name">{item.itemName ?? MISSING_VALUE_PLACEHOLDER}</td>
                  <td className="estimate-detail__col-code">{item.code}</td>
                  <td className="estimate-detail__col-model">{item.model ?? MISSING_VALUE_PLACEHOLDER}</td>
                  <td className="estimate-detail__col-rating">{item.rating ?? MISSING_VALUE_PLACEHOLDER}</td>
                  <td className="estimate-detail__col-page">
                    <button
                      type="button"
                      className={
                        'estimate-detail__page-link' +
                        (isCurrentPage ? ' estimate-detail__page-link--current' : '')
                      }
                      title={isCurrentPage ? '現在表示中の図面です (行のHoverでBBoxを確認できます)' : 'この図面へ移動'}
                      onClick={() => onNavigateReference(item.drawingPageId, item.detectionId)}
                    >
                      P{item.pageNo}
                    </button>
                  </td>
                  <td className="estimate-detail__col-status">
                    <span
                      className={`estimate-detail__status estimate-detail__status--${item.status}`}
                      title={item.status}
                    >
                      {STATUS_SYMBOL[item.status]}
                    </span>
                  </td>
                  <td className="estimate-detail__col-edit-order">
                    {item.editedAt != null ? (
                      <>
                        <span className="estimate-detail__edit-order-full">
                          {formatEditDateTime(item.editedAt)}
                        </span>
                        <span className="estimate-detail__edit-order-short">{item.editSequence}</span>
                      </>
                    ) : (
                      MISSING_VALUE_PLACEHOLDER
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="estimate-detail__legend">○ 確定　△ 要確認　× 不備</p>
    </section>
  )
}
