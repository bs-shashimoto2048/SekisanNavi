import { useEffect, useMemo, useState } from 'react'
import { fetchDrawingEvidenceTypeCandidates, fetchDrawingEvidenceTypes } from '../../api/client'
import type { DrawingEvidenceType, DrawingEvidenceTypeCandidate, EstimateResult } from '../../types/domain'
import { judgmentScopeLabel, usageLabel } from '../../domain/drawingEvidencePresentation'
import './DrawingEvidencePanel.css'

/** 候補マニフェストの`status`→表示ラベル (Issue #40 追加修正)。この文言は
 * UI上の分類名であり、各候補の「確認待ち理由」そのもの(`blocker`、
 * マニフェストの値をそのまま表示する)とは別物。ここで業務的な確認理由を
 * 新たに作文しない。 */
const CANDIDATE_STATUS_LABEL: Record<DrawingEvidenceTypeCandidate['status'], string> = {
  ready: '投入準備完了(候補)',
  needs_business_confirmation: '業務確認待ち',
  blocked: '対応不可(ブロック)',
}

/** 最近使用した図面情報キーをlocalStorageへ保持する際のkey (Issue #40 Phase 3)。
 * 製番をまたいで共有してよい「作業者の直近の使い方の癖」程度の情報であり、
 * サーバー側で保持・同期する必要が無いため、per-viewerの利便性として
 * localStorageに留める(このViewerの他の永続化しない状態と同じ方針)。 */
const RECENT_KEYS_STORAGE_KEY = 'sekisanNavi.drawingEvidencePanel.recentKeys'
const MAX_RECENT_KEYS = 5

function loadRecentKeys(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEYS_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function saveRecentKeys(keys: string[]): void {
  try {
    window.localStorage.setItem(RECENT_KEYS_STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // 書き込み失敗(プライベートモード等)は無視する。「最近使用した」は
    // 利便性のための補助情報であり、必須機能ではない。
  }
}

function pushRecentKey(keys: string[], key: string): string[] {
  return [key, ...keys.filter((k) => k !== key)].slice(0, MAX_RECENT_KEYS)
}

interface Props {
  /** 現在選択中の図面情報key。nullは「未選択(BBox追加モードではない)」。 */
  selectedKey: string | null
  /** 同じ行の再クリックで選択解除、別の行のクリックで選択を切り替える
   * (`EstimateMasterPicker`の`onSelectItem`と同じトグル方式)。 */
  onSelectKey: (key: string) => void
  /** 領域の高さ(px)。省略時はCSS側の既定値を使う(他floating panelと同じ)。 */
  height?: number
  /** Viewer上で選択中の既存BBox(evidence_type_key付き)に関係する積算結果
   * (Issue #40 Phase 3: 根拠BBox→関係する積算結果表示)。新規BBox作成用の
   * `selectedKey`/`onSelectKey`とは独立した「表示のみ」の情報であり、
   * 選択の意味を混同しない。何も選択していない/関係する結果が無い場合は
   * 空配列または省略でよい。 */
  relatedResults?: EstimateResult[]
  /** 関係する積算結果の行をクリックした際に呼ばれる(Issue #40 Phase 3:
   * 積算結果→根拠BBox強調、の起点)。 */
  onFocusResult?: (result: EstimateResult) => void
}

/**
 * [追加修正: 図面情報パネルの表示内容] このcomponent自体の内容(図面情報タイプ選択・
 * BBox作成の入口)は変更していないが、表示先のfloating panelのラベルは
 * 「図面情報」から「図面情報追加」へ変更した(旧「図面情報」の位置には代わりに
 * 旧「盤情報」パネルの内容(`PanelInfo.tsx`)を表示する)。見出し文言のみ
 * `heading`で追従させ、BBox作成の挙動・取得するデータはいずれも変更していない。
 *
 * 「図面情報追加」floating panel (Issue #40 Phase 3)。
 *
 * 既存の「部品台帳」(`EstimateMasterPicker`、積算コードMasterをmaster_item_id
 * 経由で直接選ぶ)とは異なり、作業者はここで「図面上で見えている意味」
 * (VCT/CH/トランス等の図面情報)を選ぶ。選んだ図面情報はBBox作成時に
 * `evidence_type_key`としてDetectionへ付与され(`App.tsx::
 * handleCreateEvidenceBBox`)、積算コードそのものはルール評価器が導出する
 * (Issue #40 2-1章「BBox = 積算コード、を廃止する」)。
 *
 * 用途(積算対象/判定条件/両方)・判定範囲(位置/範囲/盤全体/図面全体/
 * 製番全体/設計データ)は、Backendの内部enum値をそのまま出さず、
 * `drawingEvidencePresentation.ts`で日本語ラベルへ変換して表示する
 * (Issue #40 Phase 3指示: 「作業者向けには英語enumを表示しない」)。
 */
export function DrawingEvidencePanel({
  selectedKey,
  onSelectKey,
  height,
  relatedResults = [],
  onFocusResult,
}: Props) {
  const [allTypes, setAllTypes] = useState<DrawingEvidenceType[]>([])
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [recentKeys, setRecentKeys] = useState<string[]>(() => loadRecentKeys())
  // [追加修正] 登録済み図面情報マスタが0件のときに表示する、候補マニフェスト
  // (本番seedではない)の読み取り専用一覧。`allTypes`とは完全に独立した
  // 取得(別API、別state)にすることで、登録済みマスタと候補を混同しない。
  const [candidates, setCandidates] = useState<DrawingEvidenceTypeCandidate[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetchDrawingEvidenceTypes()
      .then((types) => {
        setAllTypes(types)
      })
      .catch(() => {
        // [PR #47レビュー指摘対応] このcomponent自身の取得失敗時の表示
        // (`allTypes`を更新しない=既存の「該当する図面情報がありません」
        // 0件fallbackのまま)は変更していない。この`.catch`は、未処理の
        // promise rejectionとしてconsoleへ出てしまう(実ブラウザでは
        // "Uncaught (in promise)"になる)のを防ぐためだけに追加したもので、
        // 新しいエラー表示・挙動の変更は一切加えていない。
      })
      .finally(() => setLoading(false))
  }, [])

  // [追加修正] 候補マニフェストの取得は登録済み一覧の取得と独立して行う
  // (登録済みが0件かどうかが確定する前から並行して取得しておき、
  // 表示判断[`allTypes.length === 0`]の時点で既に手元にある状態にする)。
  // 取得失敗時も登録済み一覧の表示自体は壊さない(読み取り専用の付加情報)。
  useEffect(() => {
    setCandidatesLoading(true)
    fetchDrawingEvidenceTypeCandidates()
      .then(setCandidates)
      .catch(() => {})
      .finally(() => setCandidatesLoading(false))
  }, [])

  // 品名(category)一覧。`null`(未分類)は「すべて」タブとして扱う
  // (`EstimateMasterPicker`とは異なり、図面情報マスタのcategoryは
  // 任意項目であり空の可能性があるため。Issue #40 10-1章「category」)。
  const categories = useMemo(() => {
    const seen = new Set<string>()
    const cats: string[] = []
    for (const t of allTypes) {
      if (t.category != null && !seen.has(t.category)) {
        seen.add(t.category)
        cats.push(t.category)
      }
    }
    return cats
  }, [allTypes])

  const visibleTypes = useMemo(() => {
    const enabledOnly = allTypes.filter((t) => t.enabled)
    if (activeCategory == null) return enabledOnly
    return enabledOnly.filter((t) => t.category === activeCategory)
  }, [allTypes, activeCategory])

  const byKey = useMemo(() => new Map(allTypes.map((t) => [t.key, t])), [allTypes])
  const selectedType = selectedKey != null ? (byKey.get(selectedKey) ?? null) : null

  // [追加修正 指示3] 候補一覧を表示するかどうかは、選択可能な(enabledな)
  // 登録済みマスタが1件も無いかどうかで決める(fetchが返した生の件数
  // `allTypes.length`ではなく、無効化されたmasterしか無い場合も「実質0件」
  // として候補を見せる)。
  const hasAnyEnabledType = useMemo(() => allTypes.some((t) => t.enabled), [allTypes])

  // [追加修正 指示5] 登録済みマスタ(allTypes、無効化されたものも含む)と
  // 候補を混同しない。登録済みのkeyと重複する候補は候補一覧側へ重ねて
  // 出さない(無効化されたmasterのkeyと候補のkeyが一致する場合も対象)。
  const visibleCandidates = useMemo(
    () => candidates.filter((c) => !byKey.has(c.key)),
    [candidates, byKey],
  )
  const recentTypes = recentKeys.map((k) => byKey.get(k)).filter((t): t is DrawingEvidenceType => t != null)

  function handleSelect(key: string) {
    onSelectKey(key)
    setRecentKeys((prev) => {
      const next = pushRecentKey(prev, key)
      saveRecentKeys(next)
      return next
    })
  }

  // [追加修正: 図面情報パネルの表示内容] パネル自体のラベルを「図面情報追加」へ変更
  // (内容・取得ロジックは不変、上記component docコメント参照)。
  const heading = allTypes.length > 0 ? `図面情報追加　${visibleTypes.length}件` : '図面情報追加'

  return (
    <section className="drawing-evidence-panel" style={height != null ? { height } : undefined}>
      <h2 className="drawing-evidence-panel__heading">{heading}</h2>

      {relatedResults.length > 0 && (
        <div className="drawing-evidence-panel__related">
          <div className="drawing-evidence-panel__related-title">選択中BBoxの積算結果</div>
          <ul className="drawing-evidence-panel__related-list">
            {relatedResults.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="drawing-evidence-panel__related-item"
                  onClick={() => onFocusResult?.(r)}
                  title="関連する根拠BBoxを強調表示"
                >
                  {r.code}（数量 {r.quantity}）
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recentTypes.length > 0 && (
        <div className="drawing-evidence-panel__recent">
          <span className="drawing-evidence-panel__recent-label">最近使用</span>
          <div className="drawing-evidence-panel__recent-list">
            {recentTypes.map((t) => (
              <button
                key={t.key}
                type="button"
                className={
                  'drawing-evidence-panel__recent-chip' +
                  (t.key === selectedKey ? ' drawing-evidence-panel__recent-chip--selected' : '')
                }
                onClick={() => handleSelect(t.key)}
                title={t.description ?? undefined}
              >
                {t.display_name}
              </button>
            ))}
          </div>
        </div>
      )}

      {categories.length > 0 && (
        <label className="drawing-evidence-panel__category-label">
          カテゴリ
          <select
            className="drawing-evidence-panel__category-select"
            value={activeCategory ?? ''}
            onChange={(e) => setActiveCategory(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">すべて</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {loading && <span className="drawing-evidence-panel__loading">読み込み中...</span>}
        </label>
      )}

      <div className="drawing-evidence-panel__list-scroll">
        <ul className="drawing-evidence-panel__list">
          {visibleTypes.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                className={
                  'drawing-evidence-panel__row' +
                  (t.key === selectedKey ? ' drawing-evidence-panel__row--selected' : '')
                }
                onClick={() => handleSelect(t.key)}
                aria-pressed={t.key === selectedKey}
                title={t.description ?? undefined}
              >
                <span className="drawing-evidence-panel__row-name">{t.display_name}</span>
                <span className="drawing-evidence-panel__row-usage">{usageLabel(t.usage)}</span>
                <span className="drawing-evidence-panel__row-scope">
                  {judgmentScopeLabel(t.default_judgment_scope)}
                </span>
              </button>
            </li>
          ))}
          {/* [追加修正 指示3/4/6] 登録済み図面情報マスタが0件(`allTypes`、
              カテゴリ絞り込みの結果ではなく全体として0件)のときだけ、
              候補マニフェストを読み取り専用で表示する。候補は選択不可
              (onClick・BBox登録APIへの送信を一切持たない)。表示する
              status/確認待ち理由(`blocker`)はマニフェストの値そのままで、
              ここで新しい日本語理由を作文しない(指示6)。 */}
          {visibleTypes.length === 0 && !loading && hasAnyEnabledType && (
            <li>
              <p className="drawing-evidence-panel__empty">該当する図面情報がありません</p>
            </li>
          )}
          {!hasAnyEnabledType && !loading && (
            <li>
              {candidatesLoading ? (
                <p className="drawing-evidence-panel__loading">候補を読み込み中...</p>
              ) : visibleCandidates.length > 0 ? (
                <div className="drawing-evidence-panel__candidates">
                  <p className="drawing-evidence-panel__candidates-intro">
                    登録済みの図面情報マスタはまだありません。以下は本番投入前の
                    <strong>候補／確認待ち</strong>です(選択・BBox登録はできません)。
                  </p>
                  <ul className="drawing-evidence-panel__candidates-list">
                    {visibleCandidates.map((c) => (
                      <li key={c.key} className="drawing-evidence-panel__candidate-row">
                        <div className="drawing-evidence-panel__candidate-header">
                          <span className="drawing-evidence-panel__candidate-name">{c.display_name}</span>
                          <span
                            className={
                              'drawing-evidence-panel__candidate-status' +
                              ` drawing-evidence-panel__candidate-status--${c.status}`
                            }
                          >
                            候補・{CANDIDATE_STATUS_LABEL[c.status]}
                          </span>
                        </div>
                        {c.category != null && (
                          <div className="drawing-evidence-panel__candidate-category">
                            カテゴリ: {c.category}
                          </div>
                        )}
                        {c.blocker != null && (
                          <div className="drawing-evidence-panel__candidate-blocker">{c.blocker}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="drawing-evidence-panel__empty">
                  登録済みの図面情報も、確認中の候補もありません。
                </p>
              )}
            </li>
          )}
        </ul>
      </div>

      {selectedType != null && (
        <div className="drawing-evidence-panel__selected">
          {/* [Issue #40 Phase 6-C指示3章] 選択後に次の操作(図面上を囲んで追加)を
              明示し、新ワークフローの「図面情報を選ぶ→図面を囲む」という流れを
              迷わず続けられるようにする。 */}
          <div className="drawing-evidence-panel__selected-title">
            選択中: {selectedType.display_name} — 図面上を囲んで追加
          </div>
          <div className="drawing-evidence-panel__selected-meta">
            用途: {usageLabel(selectedType.usage)} ／ 判定範囲:{' '}
            {judgmentScopeLabel(selectedType.default_judgment_scope)}
          </div>
          {selectedType.description != null && selectedType.description.trim() !== '' && (
            <div className="drawing-evidence-panel__selected-description">{selectedType.description}</div>
          )}
        </div>
      )}
    </section>
  )
}
