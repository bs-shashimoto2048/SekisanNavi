import { useEffect, useMemo, useState } from 'react'
import { fetchMasterItems } from '../../api/client'
import type { EstimateMasterItem } from '../../types/domain'
import { getCategoryPresentation, toCssVars } from '../../domain/masterCategoryPresentation'
import './EstimateMasterPicker.css'

// 表示列の定義 (要件: コード/型式/定格/総合価格A/箱・部品価格/塗装価格/設A/板金/組立/検査の
// この順序)。Excelの列構成をそのままFrontendへ固定しない (要件14) ため、
// 列を増減・変更したい場合はこの配列のみを変更すればよい。
const COLUMNS: { key: keyof EstimateMasterItem; label: string; numeric?: boolean }[] = [
  { key: 'code', label: 'コード' },
  { key: 'model', label: '型式' },
  { key: 'rating', label: '定格' },
  { key: 'total_price_a', label: '総合価格A', numeric: true },
  { key: 'box_parts_price', label: '箱・部品価格', numeric: true },
  { key: 'painting_price', label: '塗装価格', numeric: true },
  { key: 'setup_a', label: '設A', numeric: true },
  { key: 'sheet_metal_price', label: '板金', numeric: true },
  { key: 'assembly_price', label: '組立', numeric: true },
  { key: 'inspection_price', label: '検査', numeric: true },
]

// 表示用の3桁区切りフォーマット。元データ(数値)そのものは変更しない、表示のみの整形。
function formatCell(value: EstimateMasterItem[keyof EstimateMasterItem], numeric?: boolean): string {
  if (value === null || value === undefined) return ''
  if (numeric && typeof value === 'number') return value.toLocaleString('ja-JP')
  return String(value)
}

// Masterデータに実在する品名からタブを生成する (要件2/3)。品名一覧そのものを
// Frontendへハードコードしない。タブの並び順は「Backendが返す順序をそのまま使う」
// ことで実現しており (Backend側で `app/domain/master_categories.ALLOWED_CATEGORIES`
// の業務指定順にORDER BYしている)、Frontend側に同じ並び順リストを二重管理しない
// (Master仕様変更の追加指示3章)。使用対象13品名以外の行・品名が空欄(NULL)の行は
// Master Importer側で取り込み自体を行わないため (追加指示2章)、ここでは受け取った
// データをそのまま出現順で重複除去するだけでよい (「未分類」タブは廃止した)。
function extractCategoryTabs(items: EstimateMasterItem[]): string[] {
  const seen = new Set<string>()
  const tabs: string[] = []
  for (const item of items) {
    if (item.category === null) continue // 想定上は発生しない (Importer側で除外済み)
    if (!seen.has(item.category)) {
      seen.add(item.category)
      tabs.push(item.category)
    }
  }
  return tabs
}

interface Props {
  selectedItemId: number | null
  onSelectItem: (itemId: number) => void
  /** 領域の高さ(px)。省略時はCSS側の既定値(260px)を使う (Phase 1.11 指示書24章〜26章:
   * 中央ViewerとMasterの境界のResize Handleでユーザーが変更できるようにする)。 */
  height?: number
}

export function EstimateMasterPicker({ selectedItemId, onSelectItem, height }: Props) {
  const [allItems, setAllItems] = useState<EstimateMasterItem[]>([])
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<EstimateMasterItem[]>([])
  const [loading, setLoading] = useState(false)

  // 初回: 品名タブ生成用に全件を取得する。
  useEffect(() => {
    fetchMasterItems({}).then((all) => {
      setAllItems(all)
      const tabs = extractCategoryTabs(all)
      if (tabs.length > 0) {
        setActiveCategory((current) => current ?? tabs[0])
      }
    })
  }, [])

  const categoryTabs = useMemo(() => extractCategoryTabs(allItems), [allItems])

  // UI視覚階層改善 追加修正第3ラウンド 1章/2章/11章/12章: 選択中タブと同じ
  // category presentation(`--cat-tab-bg`/`--cat-tab-fg`/`--cat-tab-border`)を
  // table headerへも注入し、「active tab → header → data」の視覚階層をつなげる。
  // 新しいpresentation値(tabHeaderBg等)は追加せず、既存のtab用の値をそのまま
  // 再利用する(指示3章のheaderBg≒tabBg方針。tabBgは既にtabActiveBgより淡いため
  // 「header <  active tab」の濃淡関係が自然に保たれる)。activeCategoryがまだ
  // 無い場合(初回読み込み前)はスタイル自体を注入せず、CSS側の既定値
  // (#f9fafb等)へ委ねる。
  const activeHeaderStyle = useMemo(() => {
    if (activeCategory == null) return undefined
    return toCssVars(getCategoryPresentation(activeCategory).colors)
  }, [activeCategory])

  // タブ切替・検索文字列変更時に、選択中の品名 + 検索語でMasterを再取得する。
  useEffect(() => {
    if (activeCategory == null) return
    const timer = setTimeout(() => {
      setLoading(true)
      const q = query.trim()
      fetchMasterItems({ category: activeCategory, q: q || undefined })
        .then(setItems)
        .finally(() => setLoading(false))
    }, 200)
    return () => clearTimeout(timer)
  }, [activeCategory, query])

  return (
    <section className="master-picker" style={height != null ? { height } : undefined}>
      <div className="master-picker__toolbar">
        <h2 className="master-picker__heading">積算コードMaster</h2>
        <input
          className="master-picker__search"
          type="text"
          placeholder="コード・型式で検索 (現在のタブ内)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {loading && <span className="master-picker__loading">検索中...</span>}
        <span className="master-picker__count">{items.length}件</span>
      </div>

      <div className="master-picker__tabs" role="tablist">
        {categoryTabs.map((c) => {
          // 内部値(半角カナ・半角中点混在)はDB/APIの値のまま保持し、UI表示名・配色の
          // 変換は`masterCategoryPresentation.ts`へ一元化している (Phase 1.10 指示書9章)。
          // Phase 1.11: 13カテゴリすべて固有色になったため、CSS側に色ごとの
          // モディファイアクラスを増やすのではなく、CSSカスタムプロパティを
          // styleへ注入する方式にした (HEX/RGB値をCSSへ重複記述しない。指示書30章)。
          const presentation = getCategoryPresentation(c)
          return (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={c === activeCategory}
              className={
                'master-picker__tab' + (c === activeCategory ? ' master-picker__tab--active' : '')
              }
              style={toCssVars(presentation.colors)}
              onClick={() => setActiveCategory(c)}
            >
              {presentation.label}
            </button>
          )
        })}
      </div>

      <div className="master-picker__table-wrap">
        <table className="master-picker__table">
          <thead style={activeHeaderStyle}>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.id}
                className={
                  'master-picker__row' +
                  (item.id === selectedItemId ? ' master-picker__row--selected' : '')
                }
                onClick={() => onSelectItem(item.id)}
                title="クリックしてManual BBox追加対象として選択/解除"
              >
                {COLUMNS.map((col) => (
                  <td key={col.key} className={col.numeric ? 'master-picker__cell--numeric' : ''}>
                    {formatCell(item[col.key], col.numeric)}
                  </td>
                ))}
              </tr>
            ))}
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={COLUMNS.length} className="master-picker__empty">
                  該当する積算コードがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
