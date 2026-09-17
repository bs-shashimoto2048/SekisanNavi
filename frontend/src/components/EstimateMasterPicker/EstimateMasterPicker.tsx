import { useEffect, useMemo, useState } from 'react'
import { fetchMasterItems } from '../../api/client'
import type { EstimateMasterItem } from '../../types/domain'
import { getCategoryPresentation, toCssVars } from '../../domain/masterCategoryPresentation'
import './EstimateMasterPicker.css'

// [追加修正: 部品台帳への再設計] 表示列を コード/型式/定格 の3列のみへ限定した
// (指示3章: その他の価格・工数・検査等の列はこのfloating panelでは表示しない。
// 元データ・`EstimateMasterItem`型・`fetchMasterItems`が返す全項目・
// `onSelectItem`で渡すitemId経由のMaster item全体参照はいずれも変更していない。
// あくまで表示上の列を絞るだけで、Backend/domain側は一切変更しない)。
// 数値列(総合価格A等)が無くなったため、numeric区分自体も不要になった。
const COLUMNS: { key: keyof EstimateMasterItem; label: string; className: string }[] = [
  { key: 'code', label: 'コード', className: 'master-picker__col-code' },
  { key: 'model', label: '型式', className: 'master-picker__col-model' },
  { key: 'rating', label: '定格', className: 'master-picker__col-rating' },
]

function formatCell(value: EstimateMasterItem[keyof EstimateMasterItem]): string {
  if (value === null || value === undefined) return ''
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

  // [追加修正: カテゴリ色の変化を簡素化] 以前はtable header全体の背景/文字色を
  // 選択中カテゴリごとに大きく切り替えていたが(旧「選択中タブ→header→data」の
  // 視覚階層)、部品台帳では品名を切り替えるたびにpanel全体やtable headerの色が
  // 大きく変わる表現がくどく見えるため廃止した(table headerは他3panelと同じ
  // 固定の配色に統一。下記CSS参照)。カテゴリの配色情報自体
  // (`getCategoryPresentation`/`toCssVars`)は、下記の品名select自身への
  // ごく控えめな左accent(`--cat-tab-border`のみ)としてのみ限定的に利用する。
  const selectAccentStyle = useMemo(() => {
    if (activeCategory == null) return undefined
    return toCssVars(getCategoryPresentation(activeCategory).colors)
  }, [activeCategory])

  // [追加修正: 検索欄廃止] カテゴリ切替時のみMasterを再取得する(旧: 検索文字列も
  // 依存に含めデバウンスしていたが、テキスト入力自体が無くなったため不要になった)。
  useEffect(() => {
    if (activeCategory == null) return
    setLoading(true)
    fetchMasterItems({ category: activeCategory })
      .then(setItems)
      .finally(() => setLoading(false))
  }, [activeCategory])

  // [追加修正: UI名称変更] ユーザー向け表示名を「積算コードMaster」から
  // 「部品台帳」へ変更した(内部のcomponent名・class名・domain名は変更して
  // いない。指示1章: 大規模リファクタリングは行わない)。
  // [追加修正: 他floating panelとのフォーマット統一] 盤情報(PanelInfo)の
  // 見出しが`盤情報　{件数}件`のように件数を見出しテキスト自体へ埋め込む
  // 形式のため、部品台帳もこれに揃える(旧: 見出しと件数を別要素に分けた
  // 濃色ツールバー行だったものを廃止)。
  const heading = activeCategory != null ? `部品台帳　${items.length}件` : '部品台帳'

  return (
    <section className="master-picker" style={height != null ? { height } : undefined}>
      <h2 className="master-picker__heading">{heading}</h2>

      {/* [追加修正: 検索欄を廃止し品名選択リストへ変更、追加修正でさらに
          コンパクト化] 横一列のタブ表示は横幅を浪費し、floating panel化
          (幅を絞りたい)と相性が悪いため、単一の<select>による品名切替へ
          置き換えた。品名の定義・並び順・表示ラベル
          (`masterCategoryPresentation.ts`)・`activeCategory` state・切替時の
          再取得ロジックはタブ時代のものをそのまま再利用しており、見た目だけを
          変更している。selectの横幅はpanel幅いっぱいまで広げず(下記CSS)、
          長い品名はselect内で省略表示する。ラベル文言は「カテゴリ」から
          「品名」へ変更した(指示1章)。
          [追加修正: 品名ラベルとselectを横並びに] `<label>`自体は
          `品名`テキスト→`<select>`→(読み込み中はloading表示)の順でDOM構造は
          変えていない。並び方向(縦積み→横並び)はCSS側(`master-picker__
          category-label`のflex-direction)のみで切り替えている。 */}
      <label className="master-picker__category-label">
        品名
        <select
          className="master-picker__category-select"
          value={activeCategory ?? ''}
          style={selectAccentStyle}
          onChange={(e) => setActiveCategory(e.target.value)}
        >
          {categoryTabs.map((c) => (
            <option key={c} value={c}>
              {getCategoryPresentation(c).label}
            </option>
          ))}
        </select>
        {loading && <span className="master-picker__loading">読み込み中...</span>}
      </label>

      <div className="master-picker__table-wrap">
        <table className="master-picker__table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key} className={col.className}>
                  {col.label}
                </th>
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
                  <td key={col.key} className={col.className}>
                    {formatCell(item[col.key])}
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
