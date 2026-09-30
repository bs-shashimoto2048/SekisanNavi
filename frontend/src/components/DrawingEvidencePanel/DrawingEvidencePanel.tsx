import { useEffect, useMemo, useState } from 'react'
import { fetchDrawingEvidenceTypes } from '../../api/client'
import type { DrawingEvidenceType, EstimateResult } from '../../types/domain'
import { judgmentScopeLabel, usageLabel } from '../../domain/drawingEvidencePresentation'
import './DrawingEvidencePanel.css'

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
 * 「図面情報」floating panel (Issue #40 Phase 3)。
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

  useEffect(() => {
    setLoading(true)
    fetchDrawingEvidenceTypes()
      .then((types) => {
        setAllTypes(types)
      })
      .finally(() => setLoading(false))
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
  const recentTypes = recentKeys.map((k) => byKey.get(k)).filter((t): t is DrawingEvidenceType => t != null)

  function handleSelect(key: string) {
    onSelectKey(key)
    setRecentKeys((prev) => {
      const next = pushRecentKey(prev, key)
      saveRecentKeys(next)
      return next
    })
  }

  const heading = allTypes.length > 0 ? `図面情報　${visibleTypes.length}件` : '図面情報'

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
          {visibleTypes.length === 0 && !loading && (
            <li>
              <p className="drawing-evidence-panel__empty">該当する図面情報がありません</p>
            </li>
          )}
        </ul>
      </div>

      {selectedType != null && (
        <div className="drawing-evidence-panel__selected">
          <div className="drawing-evidence-panel__selected-title">
            選択中: {selectedType.display_name}
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
