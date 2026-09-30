import type { Detection, EstimateMasterItem, EstimateResult } from '../../types/domain'
import { applicableUnitLabel, judgmentMethodLabel } from '../../domain/drawingEvidencePresentation'
import { EstimateResultFactorCell } from './EstimateResultFactorCell'
import './EstimateDetail.css'

/** 積算明細のタブ (Issue #40 Phase 5)。
 *
 * Phase 4までの「全て/AI/設計情報/マニュアル/ルール結果」という移行用の
 * 5タブ構成を廃止し、積算結果の正本であるEstimateResultを中心とした
 * タブへ置き換える(Phase 5指示4章)。AI/手動は「積算結果の種類」ではなく
 * 根拠情報の取得元であるため(指示1章)、タブの軸からは外し、行の根拠詳細
 * (`理由`ボタンのtitle)側で確認できるようにする。
 *
 * - `all`: 全EstimateResult(絞り込みなし)。
 * - `design_data`/`drawing_judgment`/`needs_confirmation`:
 *   `EstimateResult.judgment_method`のいずれかで絞り込む
 *   (`設計データ`/`図面判定`/`要確認`の3軸、指示1章)。
 * - `overridden`: `factor_overridden === true`の行のみ(「修正あり」、指示6章。
 *   将来`quantity_overridden`等の手修正フラグが増えた場合もここに合流させる
 *   想定)。
 */
export type DetailTabFilter = 'all' | 'design_data' | 'drawing_judgment' | 'needs_confirmation' | 'overridden'

const DETAIL_TABS: { value: DetailTabFilter; label: string }[] = [
  { value: 'all', label: '全て' },
  { value: 'design_data', label: '設計データ' },
  { value: 'drawing_judgment', label: '図面判定' },
  { value: 'needs_confirmation', label: '要確認' },
  { value: 'overridden', label: '修正あり' },
]

const MISSING_VALUE_PLACEHOLDER = '-'

/** `masterItemById`省略時の既定値。モジュールスコープの固定参照にすることで、
 * 呼び出し元が省略するたびに新しい空Mapが再生成されるのを避ける。 */
const EMPTY_MASTER_ITEM_MAP = new Map<number, EstimateMasterItem>()

function formatResultPrice(price: number | null): string {
  // 指示10章: 不明なpriceを0円にしない・未確定計算式を推測しない。NULLは「-」。
  if (price == null) return MISSING_VALUE_PLACEHOLDER
  return `¥${price.toLocaleString('ja-JP')}`
}

/** `masterItemById`と同様、省略時の既定値を固定参照にする。 */
const EMPTY_DETECTION_MAP = new Map<number, Detection>()

/** 根拠情報の表示 (Issue #40 Phase 5指示7章)。AI/手動は積算結果の種類では
 * なく根拠情報の取得元であるため、ここ(根拠詳細)でのみ表示する
 * (判定方法タブには出さない、指示1章)。設計データのみの根拠は、現時点で
 * APIが`design_data_ref`(盤キーのみ)しか返さないため、実際に判定へ使った
 * フィールド値までは表示できない(Phase 6以降での拡張余地として残す)。 */
function evidenceSummaryText(result: EstimateResult, detectionById: Map<number, Detection>): string {
  if (result.evidence.length === 0) return '根拠情報なし'
  return result.evidence
    .map((e) => {
      if (e.evidence_kind === 'design_data') {
        return '設計データ' + (e.design_data_ref ? ` (${e.design_data_ref})` : '')
      }
      if (e.detection_id != null) {
        const d = detectionById.get(e.detection_id)
        const source = d?.source_type === 'ai' ? 'AI' : '手動'
        const label = d?.master_item_code ?? d?.class_name ?? `BBox#${e.detection_id}`
        return `${label} (取得元: ${source})`
      }
      return '不明な根拠'
    })
    .join('\n')
}

interface Props {
  /** 選択中の対象(盤/製品全体/総合計)へ、呼び出し側(App.tsx)が既に
   * 絞り込み済みのEstimateResult一覧。積算結果の正本(Phase 5指示1章)。 */
  results: EstimateResult[]
  /** コード→品名解決用 (積算コードMaster、App.tsxの`masterItemById`をそのまま
   * 渡す)。EstimateResult自体は品名を持たず`master_item_id`のみ持つため。 */
  masterItemById?: Map<number, EstimateMasterItem>
  /** 根拠BBox(Detection)のAI/手動区別・表示名解決用 (Issue #40 Phase 5指示7章
   * 「根拠情報の表示」)。App.tsxの`allDetections`から作ったMapをそのまま渡す。 */
  detectionById?: Map<number, Detection>
  /** タブの選択状態。積算集約側の対象切替とは独立(タブ=判定方法の軸、
   * 対象切替=盤/製品全体の軸のため)。 */
  tabFilter: DetailTabFilter
  onTabFilterChange: (filter: DetailTabFilter) => void
  /** 係数の手修正 (Issue #40 7-3章)。API呼び出し・状態更新はApp.tsx側の責務。 */
  onOverrideResultFactor?: (result: EstimateResult, newFactor: number) => void
  /** 「初期値へ戻す」操作 (Issue #40 7-3章)。 */
  onResetResultFactor?: (result: EstimateResult) => void
  /** 行のHover/クリックで根拠BBoxをViewer上に強調する (Issue #40 Phase 3の
   * `handleFocusResultEvidence`をそのまま再利用する想定)。設計データのみの
   * 行(`evidence`にdetection_idが無い)では何も起きない(指示7章/8章)。 */
  onFocusResultEvidence?: (result: EstimateResult) => void
}

/**
 * 右ペイン③「積算明細」領域 (Issue #40 Phase 5: EstimateResultを正本とする
 * 積算結果の一覧・確認・係数修正を行う場所)。
 *
 * **表示列(指示5章)**: コード/内容/数量/適用単位/係数/金額/判定 の7列。
 * 判定理由・新旧経路の根拠区別(AI/手動)等の詳細情報は常時表示せず、
 * 「理由」ボタンのtitleへ逃がす(指示6章「常時長文表示は不要」)。
 *
 * **新旧同一コード衝突の可視化(指示13章)**: 新旧経路が同一コードを算出し、
 * 一意に統合できなかった行(`status === 'needs_review'`、
 * `app.services.estimate_result_pipeline`が付与)は、判定方法タブとしては
 * 通常通り分類されつつ(要確認とは別軸のため)、行に「要確認」バッジを
 * 追加表示して目視で気づけるようにする。
 *
 * **見出し・タブ・表ヘッダを固定し、データ行のみ内部スクロールする**
 * (既存の`EstimateAggregation`/旧`EstimateDetail`と同じ方針)。
 */
export function EstimateDetail({
  results,
  masterItemById = EMPTY_MASTER_ITEM_MAP,
  detectionById = EMPTY_DETECTION_MAP,
  tabFilter,
  onTabFilterChange,
  onOverrideResultFactor = () => {},
  onResetResultFactor = () => {},
  onFocusResultEvidence = () => {},
}: Props) {
  const counts: Record<DetailTabFilter, number> = {
    all: results.length,
    design_data: 0,
    drawing_judgment: 0,
    needs_confirmation: 0,
    overridden: 0,
  }
  for (const r of results) {
    counts[r.judgment_method] += 1
    if (r.factor_overridden) counts.overridden += 1
  }

  const visibleResults =
    tabFilter === 'all'
      ? results
      : tabFilter === 'overridden'
        ? results.filter((r) => r.factor_overridden)
        : results.filter((r) => r.judgment_method === tabFilter)

  return (
    <section className="estimate-detail">
      <div className="estimate-detail__fixed-top">
        {/* Issue #19 Phase 4追加修正: floating panel化に伴い折りたたみ機能を廃止した
            (表示/非表示はPanelVisibilityTogglesのみで行う)。この見出し領域は
            FloatingPanel側のドラッグハンドル判定(`h2`要素であること)を兼ねる。 */}
        <h2 className="estimate-detail__heading">積算明細</h2>

        <div className="estimate-detail__source-tabs" role="tablist" aria-label="判定">
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={tabFilter === tab.value}
              className={
                'estimate-detail__source-tab' +
                (tabFilter === tab.value ? ' estimate-detail__source-tab--active' : '')
              }
              onClick={() => onTabFilterChange(tab.value)}
            >
              {tab.label} {counts[tab.value]}
            </button>
          ))}
        </div>
      </div>

      <div className="estimate-detail__table-scroll">
        <table className="estimate-detail__table estimate-detail__table--rule-result">
          <thead>
            <tr>
              <th className="estimate-detail__col-rr-code">コード</th>
              <th className="estimate-detail__col-rr-name">内容</th>
              <th className="estimate-detail__col-rr-qty">数量</th>
              <th className="estimate-detail__col-rr-unit">適用単位</th>
              <th className="estimate-detail__col-rr-factor">係数</th>
              <th className="estimate-detail__col-rr-price">金額</th>
              <th className="estimate-detail__col-rr-method">判定</th>
            </tr>
          </thead>
          <tbody>
            {visibleResults.length === 0 && (
              <tr>
                <td className="estimate-detail__empty" colSpan={7}>
                  積算結果がありません
                </td>
              </tr>
            )}
            {visibleResults.map((result) => {
              const master = result.master_item_id != null ? (masterItemById.get(result.master_item_id) ?? null) : null
              const model = master?.model?.trim() || null
              const rating = master?.rating?.trim() || null
              const content = [model, rating].filter((v): v is string => !!v).join(' / ') || master?.category || null
              return (
                <tr
                  key={result.id}
                  className={
                    'estimate-detail__row' +
                    (result.status === 'needs_review' ? ' estimate-detail__row--needs-review' : '')
                  }
                  onMouseEnter={() => onFocusResultEvidence(result)}
                >
                  <td className="estimate-detail__col-rr-code">{result.code}</td>
                  <td className="estimate-detail__col-rr-name">{content ?? MISSING_VALUE_PLACEHOLDER}</td>
                  <td className="estimate-detail__col-rr-qty">{result.quantity}</td>
                  <td className="estimate-detail__col-rr-unit">
                    {result.applicable_unit != null
                      ? applicableUnitLabel(result.applicable_unit)
                      : MISSING_VALUE_PLACEHOLDER}
                  </td>
                  <td className="estimate-detail__col-rr-factor">
                    <EstimateResultFactorCell
                      result={result}
                      onOverride={(newFactor) => onOverrideResultFactor(result, newFactor)}
                      onReset={() => onResetResultFactor(result)}
                    />
                  </td>
                  <td className="estimate-detail__col-rr-price">{formatResultPrice(result.price)}</td>
                  <td className="estimate-detail__col-rr-method">
                    <span>{judgmentMethodLabel(result.judgment_method)}</span>
                    {result.status === 'needs_review' && (
                      <span className="estimate-detail__needs-review-badge" title="新旧経路の重複、または盤所属の判定が一意でないため要確認">
                        ⚠要確認
                      </span>
                    )}
                    {result.judgment_reason != null && (
                      <button
                        type="button"
                        className="estimate-detail__reason-button"
                        title={result.judgment_reason}
                        aria-label="判定理由"
                      >
                        理由
                      </button>
                    )}
                    <button
                      type="button"
                      className="estimate-detail__reason-button"
                      title={evidenceSummaryText(result, detectionById)}
                      aria-label="根拠"
                    >
                      根拠
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
