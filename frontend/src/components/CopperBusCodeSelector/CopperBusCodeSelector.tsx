import { useEffect, useMemo, useState } from 'react'
import { fetchCopperBusCodeOptions } from '../../api/client'
import type { EstimateMasterItem } from '../../types/domain'
import './CopperBusCodeSelector.css'

// 主回路銅帯コード選択UI (盤情報、Issue #40 Phase 6-H / 追加修正)。
//
// 品名(「入力（主回路銅帯）」/「銅帯」、別品目のため区別し、絞り込み時に
// 混同しない)→型式→定格の順に候補を絞り込み、最後に対応する積算コードを
// 表示するだけの読み取り専用UI。`GET /api/master-items/copper-bus-code-options`
// から候補を取得する。
//
// **面(ban_menno)ごとに独立、盤(ban_no)には紐づかない**: 銅帯コードは
// 1面につき1つ選択するという実際の運用に合わせ、盤情報(`PanelInfo`)は
// 同じ面番号の盤(`ban_no`違い)が複数あっても、その面につきこのcomponentを
// 1インスタンスしかマウントしない(面番号ごとの代表行にのみ配置する。
// `PanelInfo.buildCopperSelectorAnchorKeys`参照)。このcomponent自身は
// 複数盤の集約ロジックを持たず、呼び出し側が面番号単位でマウント数を
// 制御することで、Reactの通常のcomponent-local state分離により
// 「1面につき1つ」「他の面の選択・変更で上書きされない」の両方を
// 保証する(面ごとのmapを自前で管理する必要はない)。
//
// **重要**: このcomponentはBBox追加対象の選択(`EstimateMasterPicker`の
// `onSelectItem`/`selectedItemId`)にも、積算確定にも一切連動しない。
// 自分自身のローカルstateのみで品名/型式/定格/コードの表示を完結させる。

function uniqueInOrder(values: (string | null)[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const v of values) {
    if (v === null) continue
    if (!seen.has(v)) {
      seen.add(v)
      result.push(v)
    }
  }
  return result
}

interface Props {
  /** この選択欄が対応する面番号(`ban_menno`)の表示ラベル(例: "1")。
   * 銅帯コードは1面につき1つであり盤番号(`ban_no`)には紐づかないため、
   * 盤番号は含めない(Issue #40 Phase 6-H 追加修正)。画面上の実際の面番号と
   * ひも付いていることを明示するため、トグルボタンの文言へそのまま使う。
   * 呼び出し側(`PanelInfo`)は、同じ面番号の盤が複数あってもこのcomponentを
   * 1インスタンスしかマウントしない(=選択状態も自然に面番号単位になる)。 */
  panelLabel: string
}

export function CopperBusCodeSelector({ panelLabel }: Props) {
  const [items, setItems] = useState<EstimateMasterItem[]>([])
  const [loading, setLoading] = useState(false)
  // 取得失敗時は固定の日本語文言のみを表示する(例外メッセージ・URL・内部情報は
  // 画面に出さない)。折りたたみ→再展開で再取得できる。
  const [loadFailed, setLoadFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [category, setCategory] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const [rating, setRating] = useState<string | null>(null)

  // 展開時に初回のみ候補を取得する(常時表示にせず、盤情報の主要な表示の
  // 邪魔にならないようにする)。
  useEffect(() => {
    if (!expanded || items.length > 0) return
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    fetchCopperBusCodeOptions()
      .then((options) => {
        if (cancelled) return
        setItems(options)
        const categories = uniqueInOrder(options.map((o) => o.category))
        setCategory((current) => current ?? categories[0] ?? null)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [expanded, items.length])

  const categories = useMemo(() => uniqueInOrder(items.map((i) => i.category)), [items])

  const modelsForCategory = useMemo(
    () => uniqueInOrder(items.filter((i) => i.category === category).map((i) => i.model)),
    [items, category],
  )

  const ratingsForCategoryModel = useMemo(
    () =>
      uniqueInOrder(
        items.filter((i) => i.category === category && i.model === model).map((i) => i.rating),
      ),
    [items, category, model],
  )

  const matchedItem = useMemo(
    () => items.find((i) => i.category === category && i.model === model && i.rating === rating) ?? null,
    [items, category, model, rating],
  )

  function handleCategoryChange(next: string) {
    setCategory(next)
    setModel(null)
    setRating(null)
  }

  function handleModelChange(next: string) {
    setModel(next || null)
    setRating(null)
  }

  function handleRatingChange(next: string) {
    setRating(next || null)
  }

  return (
    <div className="copper-bus-code-selector">
      <button
        type="button"
        className="copper-bus-code-selector__toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        面{panelLabel} 主回路銅帯コード選択 {expanded ? '▲' : '▼'}
      </button>

      {expanded && (
        <div className="copper-bus-code-selector__body">
          {loading && <span className="copper-bus-code-selector__loading">読み込み中...</span>}

          {!loading && loadFailed && (
            <span className="copper-bus-code-selector__message" role="alert">
              銅帯コード候補を取得できませんでした。閉じてもう一度開いてください。
            </span>
          )}

          {!loading && !loadFailed && items.length === 0 && (
            <span className="copper-bus-code-selector__message">銅帯コード候補がありません。</span>
          )}

          {!loading && !loadFailed && items.length > 0 && (
            <>
              <label className="copper-bus-code-selector__field">
                品名
                <select
                  value={category ?? ''}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  disabled={categories.length === 0}
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <label className="copper-bus-code-selector__field">
                型式
                <select
                  value={model ?? ''}
                  onChange={(e) => handleModelChange(e.target.value)}
                  disabled={modelsForCategory.length === 0}
                >
                  <option value="">(選択してください)</option>
                  {modelsForCategory.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>

              <label className="copper-bus-code-selector__field">
                定格
                <select
                  value={rating ?? ''}
                  onChange={(e) => handleRatingChange(e.target.value)}
                  disabled={ratingsForCategoryModel.length === 0}
                >
                  <option value="">(選択してください)</option>
                  {ratingsForCategoryModel.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>

              <div className="copper-bus-code-selector__result">
                コード:{' '}
                <span className="copper-bus-code-selector__code">
                  {matchedItem ? matchedItem.code : '-'}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
