import { useLayoutEffect, useRef, useState } from 'react'
import type {
  AttributeSource,
  EstimatePanelInfo,
  MaterialRow,
  Panel,
  PanelPreview,
  SteelOutline,
} from '../../types/domain'
import { MaterialInfo } from './MaterialInfo'
import { SteelSection } from './SteelSection'
import { banGroupKey, panelKey } from '../../utils/panel'
import { useAutoFitGridColumns } from '../../hooks/useAutoFitGridColumns'
import { BoxTypeDetail } from './BoxTypeDetail'
import './PanelInfo.css'

/** 列数(面/盤・盤名称・高さ・幅・奥行・接続の6列、`COLUMN_HEADERS`と対応)。
 * [追加修正: 箱体型式解析] 「型式」列は、同じ値を箱体型式タブで詳細表示する
 * ようになったため、盤情報テーブルからは削除した(指示: 「既存の盤情報
 * テーブルから『型式』カラムを削除する。それ以外のカラム・データ・並び順は
 * 変えない」)。`useAutoFitGridColumns`へ渡す列数と、各セルの
 * `data-auto-col` indexが一致している必要がある。 */
const COLUMN_COUNT = 6

interface NaturalSize {
  width: number
  height: number
}

// 取得元の表示ラベル (要件12。旧PanelProperties.tsxから移設)。W/D/H等の項目名は
// ここにハードコードしない。
const SOURCE_LABEL: Record<AttributeSource, string> = {
  design_data: '設計データ',
  ai: 'AI検出',
  manual: '手動入力',
}

interface Props {
  /** 旧来のダミーDB由来Panel (Detectionのpanel_id経由)。product_df盤が現在の
   * ページに1件も無い場合のみ、後方互換のフォールバックとして表示する。 */
  panel: Panel | null
  /** 現在表示中ページのproduct_df盤一覧 (次work指示3章)。0件の場合もある。
   * 1ページに複数盤・同一盤の複数矢視(正面図/背面図等)が存在しうる
   * (`DrawingViewer`/`ProductPanelOverlay`へ渡すものと同じ配列)。 */
  panels: PanelPreview[]
  /** 製番全体のestcode_df.csv行 (ページに依存しない。Phase 1.14)。panelsの
   * 各行とban_menno/ban_noで突き合わせる。 */
  estimatePanels: EstimatePanelInfo[]
  /** 製番全体の材料一覧 (material.csv。ページに依存しない)。省略時は材料情報の欄自体を出さない
   * (既存の呼び出し・テストへの影響を避けるため)。空配列なら「材料情報なし」を表示する。 */
  materials?: MaterialRow[]
  /** 外形図の鋼材データ (折りたたみの「鋼材」欄。選択ページに依存しない)。省略時は欄自体を出さない。null=取得中。 */
  steel?: SteelOutline | null
  /** 中央Viewerで現在選択中の盤 (Phase 1.9)。 */
  selectedPanel: { key: string; panel: PanelPreview } | null
  /** カードクリックで中央Viewerと同じ盤選択状態にする (次work指示3章: 「盤情報を
   * クリックした際の現在の動作」= Viewerクリックと同じ`onSelectPanel`をそのまま
   * 再利用する。新しい選択ロジックは作らない)。 */
  onSelectPanel: (key: string, panel: PanelPreview) => void
  /** [2026-10 追加修正: 内容量に応じたウィンドウサイズ] 現在表示中の内容
   * (タブの開閉・盤情報一覧の行数等)を折り返し・省略無く表示するために
   * 必要な自然なサイズを、変化するたびに報告する(`App.tsx`経由で
   * `FloatingPanel`の`maxContentSize`へ渡り、リサイズ上限・自動フィットに
   * 使われる)。未指定の場合はこの機能自体を使わない(テスト等での簡略化用)。 */
  onNaturalSizeChange?: (size: NaturalSize) => void
}

// null/undefined/NaN/空文字はそのまま出さず"-"に統一する (指示書8章)。
// JSのNumber→String変換は2300.0のような値も自動的に"2300"へ整形するため、
// float表記由来の見た目上の".0"を個別に取り除く処理は不要 (指示書9章)。
function formatValue(value: string | number | null | undefined): string {
  if (value == null) return '-'
  if (typeof value === 'number' && Number.isNaN(value)) return '-'
  if (typeof value === 'string' && value.trim() === '') return '-'
  return String(value)
}

function isValidNumber(value: number | null | undefined): value is number {
  return value != null && !Number.isNaN(value)
}

// 高さ表示 (Issue #38 Phase 2 指示3章)。PanelPreview.ban_h1/ban_h2を「正面/背面」
// として扱うが、これはUI仕様上の前提であり、product_df.csv側のデータ定義として
// 確定した事実ではない (Phase 1調査で確認できたのは、矢視の種別に関わらず
// ban_h1が座標変換に使われる列であることのみ)。両方欠損している場合のみ
// EstimatePanelInfo.ban_hをfallbackとして使う。
//   - 正面あり/背面あり/同値      → "2300"
//   - 正面あり/背面あり/異値      → "2300 / 2000"
//   - 正面あり/背面なし          → "2300"
//   - 正面なし/背面あり          → "- / 2000" (正面値と誤認しないよう明示的に"-"を残す)
//   - 両方なし                   → ban_hがあればそれを表示、無ければ"-"
function formatHeight(banH1: number | null, banH2: number | null, fallbackBanH: number | null): string {
  const hasFront = isValidNumber(banH1)
  const hasBack = isValidNumber(banH2)
  if (hasFront && hasBack) {
    return banH1 === banH2 ? formatValue(banH1) : `${formatValue(banH1)} / ${formatValue(banH2)}`
  }
  if (hasFront) return formatValue(banH1)
  if (hasBack) return `- / ${formatValue(banH2)}`
  return formatValue(fallbackBanH)
}

// 幅/奥行 (Issue #38 Phase 2 指示4章): EstimatePanelInfo側を優先し、無ければ
// PanelPreview側をfallbackにする(盤情報1行化以前と優先順位が逆転している点に
// 注意。estcode_df.csv側の値を積算上の正とする方針)。
function formatWithFallback(primary: number | null, fallback: number | null): string {
  if (isValidNumber(primary)) return formatValue(primary)
  return formatValue(fallback)
}

interface PanelCard {
  /** Viewerの`ProductPanelOverlay`と同じ`panelKey`形式。カードクリック時に
   * そのまま`onSelectPanel`へ渡すことで、Viewer側のクリックと全く同じ選択状態
   * (ハイライト・非選択盤のdim表示等)を再現する。 */
  key: string
  panel: PanelPreview
  estimatePanel: EstimatePanelInfo | null
  isSelected: boolean
}

/** 1行=1盤のカラム型一覧(指示書6章)の7セル。列がズレないよう、値が無い項目も
 * spanごと省略せず必ず"-"を描画する(Issue #38 Phase 2 指示8章)。 */
interface PanelRowCells {
  menban: string
  name: string
  height: string
  width: string
  depth: string
  connect: string
}

function buildRowCells(card: PanelCard): PanelRowCells {
  const { panel, estimatePanel } = card
  return {
    menban: `${formatValue(panel.ban_menno)}/${formatValue(panel.ban_no)}`,
    name: formatValue(estimatePanel?.ban_meisyou ?? panel.ban_meisyou),
    height: formatHeight(panel.ban_h1, panel.ban_h2, estimatePanel?.ban_h ?? null),
    width: formatWithFallback(estimatePanel?.ban_w ?? null, panel.ban_w),
    depth: formatWithFallback(estimatePanel?.ban_d ?? null, panel.ban_d),
    connect: formatValue(estimatePanel?.ban_connect),
  }
}

/**
 * 現在ページのproduct_df盤一覧から、盤単位(ban_menno+ban_no)でカードを組み立てる
 * (次work指示3章)。
 *
 * 1つの盤には正面図/背面図等の複数の「矢視」が同じban_menno/ban_noで存在しうる
 * (`utils/panel.ts::banGroupKey`参照)。「盤1〜盤5をすべて確認できる」という
 * 要件は盤単位の一覧性を指しており、矢視ごとに重複したカードを出す必要はないため、
 * 同一盤の最初に現れた矢視を代表としてグループ化する。代表行のkey(`panelKey`、
 * 元の配列内indexを含む)をそのままカードのクリック対象として使うため、
 * カードをクリックするとViewer上でもその矢視の領域が選択状態になる。
 *
 * estcode_df.csv側の対応行(`estimatePanel`)が無い場合はnullのまま返し、
 * 呼び出し側で「該当する積算盤情報がありません」を表示する (指示書14章の考え方を
 * 複数盤対応後も踏襲)。
 */
function buildPanelCards(
  panels: PanelPreview[],
  estimatePanels: EstimatePanelInfo[],
  selectedPanel: { key: string; panel: PanelPreview } | null,
): PanelCard[] {
  const selectedGroupKey = selectedPanel ? banGroupKey(selectedPanel.panel) : null
  const seen = new Set<string>()
  const cards: PanelCard[] = []
  panels.forEach((p, index) => {
    const groupKey = banGroupKey(p)
    if (seen.has(groupKey)) return
    seen.add(groupKey)
    const estimatePanel =
      estimatePanels.find((e) => e.ban_menno === p.ban_menno && e.ban_no === p.ban_no) ?? null
    cards.push({
      key: panelKey(p, index),
      panel: p,
      estimatePanel,
      isSelected: selectedGroupKey === groupKey,
    })
  })
  return cards
}

/** 6列共通のヘッダーラベル(表示順そのまま。Issue #38 Phase 2 指示1章。
 * [追加修正: 箱体型式解析] 「型式」列は削除済み)。 */
const COLUMN_HEADERS: { key: keyof PanelRowCells; label: string }[] = [
  { key: 'menban', label: '面/盤' },
  { key: 'name', label: '盤名称' },
  { key: 'height', label: '高さ' },
  { key: 'width', label: '幅' },
  { key: 'depth', label: '奥行' },
  { key: 'connect', label: '接続' },
]

/**
 * 右ペイン上部の「盤情報」表示 (次work指示: 複数盤対応・コンパクト化。
 * 盤情報1行化・3領域リサイズ拡張・Redo時引出線回帰修正 指示1章/2章で
 * 原則1盤=1行のレイアウトへ変更した後、Issue #38 Phase 2で
 * 「面/盤|盤名称|型式|高さ|幅|奥行|接続」のカラム型一覧(CSS Grid)へ再設計。
 * [追加機能: 箱体型式解析] その後「型式」列を削除して6列とし、型式は上部の
 * 「箱体型式」タブで表示する)。
 *
 * Phase 1.14までは中央Viewerで選択中の盤1件のみを表示する前提だったが、
 * 「現在表示しているプレビュー内の盤・面をすべて確認できること」を優先し、
 * 現在ページのproduct_df盤全件を一覧として常時表示する形へ変更した。
 * 選択中の盤は行の強調表示(左アクセント+背景)で示す (指示書6章)。
 *
 * **列構成(Issue #38 Phase 2)**: 6列を常に描画し、値が無い項目もセルごと
 * 省略せず"-"を表示する(列がズレないようにするため。`buildRowCells`参照)。
 * 各`<button>`(1盤=1行)自身をCSS Gridコンテナにすることで、既存の
 * キーボード操作性・`aria-pressed`・クリック連動(`onSelectPanel`)を
 * 一切変更せずに列レイアウトへ移行できる(`<table><tr>`化すると行全体の
 * クリック可能性をJSで再実装する必要が生じるため採用しなかった。
 * Issue #38 Phase 1調査コメント参照)。
 *
 * 表示優先順位:
 *   1. 現在ページに1件以上product_df盤があれば、盤単位で一覧を表示する。
 *   2. product_df盤が1件も無く、旧来のダミーDB由来`panel`がある場合のみ、
 *      後方互換のため従来の属性テーブル表示にフォールバックする(今回変更しない)。
 *   3. どちらも無ければ「このページには盤情報がありません」。
 */
export function PanelInfo({
  panel,
  panels,
  estimatePanels,
  materials,
  steel,
  selectedPanel,
  onSelectPanel,
  onNaturalSizeChange,
}: Props) {
  const cards = buildPanelCards(panels, estimatePanels, selectedPanel)
  const heading = cards.length > 0 ? `盤情報　${cards.length}件` : '盤情報'

  // [追加機能: 箱体型式解析] 「箱体型式」タブに表示する型式は、中央Viewerで
  // 選択中の盤(`isSelected`、既存のハイライト対象と同じ)を優先し、未選択
  // (ページ読み込み直後等)の場合は一覧の先頭行をフォールバックとして使う
  // (盤情報テーブル自体が常に何らかの行を表示している以上、型式タブだけ
  // 空のまま放置しない)。
  const boxTypeCard = cards.find((c) => c.isSelected) ?? cards[0] ?? null
  const boxTypeModel = boxTypeCard?.estimatePanel?.model ?? null
  const boxTypeAnalysis = boxTypeCard?.estimatePanel?.box_type_analysis ?? null

  // 「箱体型式」タブの開閉state。既定は折りたたみ状態とし、盤情報テーブルの
  // 表示領域を圧迫しない。「鋼材」欄・「材料情報」欄は従来どおり`SteelSection`/
  // `MaterialInfo`(下部)が自身の開閉stateを持つため、ここでは扱わない。
  const [isBoxTypeExpanded, setIsBoxTypeExpanded] = useState(false)

  // [Issue #40 追加修正: 表カラム幅の共通自動調整] 各行(button)が独立した
  // grid containerのため、`grid-template-columns`に固定pxを個別チューニング
  // していた従来方式をやめ、見出し/全データ行を横断した内容の自然幅を
  // `useAutoFitGridColumns`(共通hook)で計測し、CSS変数(`--auto-col-N`、
  // `PanelInfo.css`参照)として反映する。`panels`/`estimatePanels`
  // (セル文字列の実際のデータソース)が変わった時のみ再計測する
  // (`selectedPanel`は選択ハイライトのみでセル内容を変えないため依存に含めない)。
  const gridRef = useRef<HTMLElement>(null)
  useAutoFitGridColumns(gridRef, COLUMN_COUNT, [panels, estimatePanels])

  // [2026-10 追加修正: 内容量に応じたウィンドウサイズ] 表示中の内容(箱体型式
  // タブの開閉・盤情報一覧の行数・箱体型式の解析結果・下部の材料情報/鋼材欄の
  // 開閉等)を折り返し・省略無しで表示するために必要な自然なサイズを実測し、
  // 変化した時だけ`onNaturalSizeChange`で報告する。
  //
  // 高さ: `.panel-info`(`gridRef`)自身に`height: 100%`を与えているCSSを
  // 一時的に`height: auto`で上書きし(インラインstyleはCSSクラスより優先される)、
  // 制約の無い状態での`scrollHeight`を読む。同期的に読み取って直後に元へ戻す
  // ため(`useLayoutEffect`、ペイント前)、画面のちらつきは発生しない。
  // `SteelSection`/`MaterialInfo`の開閉は各コンポーネント内部のstateで、
  // このコンポーネントの再描画を伴わないため、`MutationObserver`(DOMの子要素
  // 追加削除と`aria-expanded`属性の変化)でも再計測する。
  //
  // 幅: `.panel-info__row`(盤情報一覧の行)は`width: max-content`のため、
  // 現在のcontainer幅に関わらず常に自然な(折り返し無しの)幅を保持している。
  // その`scrollWidth`に`.panel-info`の左右paddingを足した値を自然な幅とする
  // (下限は`FloatingPanel`のkind別最小幅が担う)。
  const lastReportedSizeRef = useRef<NaturalSize | null>(null)
  useLayoutEffect(() => {
    if (!onNaturalSizeChange) return
    const el = gridRef.current
    if (!el) return

    function measure() {
      if (!el || !onNaturalSizeChange) return
      // `.panel-info`は`.floating-panel__body`(flex column)のflexアイテムであり、
      // 既定の`flex-shrink: 1`のため、`height: auto`で基準サイズを内容量に
      // 変えただけでは、親(`.floating-panel__body`、現在の`rect.height`、
      // まだ内容に自動フィットしていない古いサイズの可能性がある)に収まるよう
      // flexboxが圧縮してしまい、正しい自然な高さが測れない。`flex-shrink: 0`も
      // 併せて一時的に指定し、親サイズに関わらず内容どおりの高さを強制したうえで
      // `scrollHeight`を読む。
      const prevInlineHeight = el.style.height
      const prevInlineFlexShrink = el.style.flexShrink
      el.style.height = 'auto'
      el.style.flexShrink = '0'
      const naturalHeight = el.scrollHeight
      el.style.height = prevInlineHeight
      el.style.flexShrink = prevInlineFlexShrink

      // jsdom(単体テスト環境)は実レイアウトを行わないため`scrollHeight`は常に0に
      // なる(`useAutoFitGridColumns`と同じ既知の制約、`docs/coding-conventions.md`
      // 「テスト」節参照)。実際に高さ0の`.panel-info`(見出しだけでも必ず数十px
      // ある)は実ブラウザでは起こり得ないため、0の場合は「実レイアウト不可の
      // 環境」とみなして報告せず、`maxContentSize`を未設定のまま(=このkind向けの
      // 自動フィット機能が無効化された状態、既存の挙動)に保つ。これにより
      // `FloatingPanel`のレイアウト系テスト(Viewerサイズ変更時の追従等)が、
      // 意味の無い測定値に左右されず従来どおり検証できる。
      if (naturalHeight === 0) return

      const headerRow = el.querySelector<HTMLElement>('.panel-info__row--header')
      const style = window.getComputedStyle(el)
      const paddingX = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0')
      const naturalTableWidth = headerRow ? headerRow.scrollWidth + paddingX : 0
      const naturalWidth = naturalTableWidth

      const last = lastReportedSizeRef.current
      if (last && last.width === naturalWidth && last.height === naturalHeight) return
      const next = { width: naturalWidth, height: naturalHeight }
      lastReportedSizeRef.current = next
      onNaturalSizeChange(next)
    }

    measure()
    const observer = new MutationObserver(measure)
    observer.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded'],
    })
    return () => observer.disconnect()
    // cardsはpanels/estimatePanels/selectedPanelから毎回新しい配列として
    // 作られるため、依存には実際に高さ/幅へ影響する値のみを列挙する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, estimatePanels, materials, steel, isBoxTypeExpanded, boxTypeModel, boxTypeAnalysis, onNaturalSizeChange])

  return (
    <section className="panel-info" ref={gridRef}>
      {/* Issue #19 Phase 4追加修正: floating panel化に伴い折りたたみ機能を廃止した
          (表示/非表示はPanelVisibilityTogglesのみで行う)。この見出し領域は
          FloatingPanel側のドラッグハンドル判定(`h2`要素であること)を兼ねる。 */}
      <h2 className="panel-info__heading">{heading}</h2>

      {/* 盤情報テーブルより上に置く「箱体型式」の折り畳みタブ。「型式」列を削除
          した代わりに、このタブで同じ値をより詳しく(記号の意味・積算に使える
          情報)表示する。「鋼材」欄は盤情報テーブルの下の`SteelSection`
          (material.csv由来の実データ)が担うため、ここにはタブを置かない。 */}
      <div className="panel-info__tabs">
        <div className="panel-info__tab">
          <button
            type="button"
            className="panel-info__tab-toggle"
            aria-expanded={isBoxTypeExpanded}
            onClick={() => setIsBoxTypeExpanded((prev) => !prev)}
          >
            <span className="panel-info__tab-caret">{isBoxTypeExpanded ? '▾' : '▸'}</span>
            箱体型式
          </button>
          {isBoxTypeExpanded && <BoxTypeDetail model={boxTypeModel} analysis={boxTypeAnalysis} />}
        </div>
      </div>

      {cards.length === 0 && !panel && (
        <p className="panel-info__empty">このページには盤情報がありません</p>
      )}

      {cards.length > 0 && (
        <>
          <div className="panel-info__list-scroll">
            {/* [Issue #40 追加修正] 見出し行は`position: sticky`で縦スクロール時のみ
                見た目上固定する(他の表のthead thと同じ方式)。以前はスクロール
                領域の外に物理的に置いていたが、その方式だと横スクロールが
                必要になった場合にヘッダとデータ行の列がずれてしまうため、
                同じスクロール領域内に置いて横スクロールも同期させる。 */}
            <div className="panel-info__row panel-info__row--header" role="row">
              {COLUMN_HEADERS.map((col, index) => (
                <span
                  key={col.key}
                  className={`panel-info__cell panel-info__cell--header panel-info__cell--${col.key}`}
                  role="columnheader"
                  data-auto-col={index}
                >
                  {col.label}
                </span>
              ))}
            </div>
            <ul className="panel-info__list">
              {cards.map((card) => {
                const cells = buildRowCells(card)
                return (
                  <li key={card.key} role="row">
                    <button
                      type="button"
                      className={
                        'panel-info__row panel-info__data-row' +
                        (card.isSelected ? ' panel-info__row--selected' : '')
                      }
                      onClick={() => onSelectPanel(card.key, card.panel)}
                      aria-pressed={card.isSelected}
                    >
                      <span className="panel-info__cell panel-info__cell--menban" role="cell" data-auto-col={0}>
                        {cells.menban}
                      </span>
                      <span
                        className="panel-info__cell panel-info__cell--name"
                        role="cell"
                        title={cells.name}
                        data-auto-col={1}
                      >
                        {cells.name}
                      </span>
                      <span className="panel-info__cell panel-info__cell--height" role="cell" data-auto-col={2}>
                        {cells.height}
                      </span>
                      <span className="panel-info__cell panel-info__cell--width" role="cell" data-auto-col={3}>
                        {cells.width}
                      </span>
                      <span className="panel-info__cell panel-info__cell--depth" role="cell" data-auto-col={4}>
                        {cells.depth}
                      </span>
                      <span
                        className="panel-info__cell panel-info__cell--connect"
                        role="cell"
                        title={cells.connect}
                        data-auto-col={5}
                      >
                        {cells.connect}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}

      {cards.length === 0 && panel && (
        <>
          <div className="panel-info__title">
            {panel.panel_no} / {panel.name}
          </div>
          <table className="panel-info__table auto-fit-table">
            <tbody>
              {[...panel.attributes]
                .sort((a, b) => a.display_order - b.display_order)
                .map((attr) => (
                  <tr key={attr.id}>
                    <th>{attr.label}</th>
                    <td>
                      {attr.value}
                      {attr.unit ? ` ${attr.unit}` : ''}
                    </td>
                    <td className="panel-info__source">{SOURCE_LABEL[attr.source]}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}

      {materials !== undefined && <MaterialInfo materials={materials} />}
      <SteelSection steel={steel} panelModels={estimatePanels.map((e) => e.model)} />
    </section>
  )
}
