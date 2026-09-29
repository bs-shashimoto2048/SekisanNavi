import type { AttributeSource, EstimatePanelInfo, Panel, PanelPreview } from '../../types/domain'
import { banGroupKey, panelKey } from '../../utils/panel'
import './PanelInfo.css'

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
  /** 中央Viewerで現在選択中の盤 (Phase 1.9)。 */
  selectedPanel: { key: string; panel: PanelPreview } | null
  /** カードクリックで中央Viewerと同じ盤選択状態にする (次work指示3章: 「盤情報を
   * クリックした際の現在の動作」= Viewerクリックと同じ`onSelectPanel`をそのまま
   * 再利用する。新しい選択ロジックは作らない)。 */
  onSelectPanel: (key: string, panel: PanelPreview) => void
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
  model: string
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
    model: formatValue(estimatePanel?.model),
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

/** 7列共通のヘッダーラベル(表示順そのまま。Issue #38 Phase 2 指示1章)。 */
const COLUMN_HEADERS: { key: keyof PanelRowCells; label: string }[] = [
  { key: 'menban', label: '面/盤' },
  { key: 'name', label: '盤名称' },
  { key: 'model', label: '型式' },
  { key: 'height', label: '高さ' },
  { key: 'width', label: '幅' },
  { key: 'depth', label: '奥行' },
  { key: 'connect', label: '接続' },
]

/**
 * 右ペイン上部の「盤情報」表示 (次work指示: 複数盤対応・コンパクト化。
 * 盤情報1行化・3領域リサイズ拡張・Redo時引出線回帰修正 指示1章/2章で
 * 原則1盤=1行のレイアウトへ変更した後、Issue #38 Phase 2で
 * 「面/盤|盤名称|型式|高さ|幅|奥行|接続」のカラム型一覧(CSS Grid)へ再設計)。
 *
 * Phase 1.14までは中央Viewerで選択中の盤1件のみを表示する前提だったが、
 * 「現在表示しているプレビュー内の盤・面をすべて確認できること」を優先し、
 * 現在ページのproduct_df盤全件を一覧として常時表示する形へ変更した。
 * 選択中の盤は行の強調表示(左アクセント+背景)で示す (指示書6章)。
 *
 * **列構成(Issue #38 Phase 2)**: 7列を常に描画し、値が無い項目もセルごと
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
  selectedPanel,
  onSelectPanel,
}: Props) {
  const cards = buildPanelCards(panels, estimatePanels, selectedPanel)
  const heading = cards.length > 0 ? `盤情報　${cards.length}件` : '盤情報'

  return (
    <section className="panel-info">
      {/* Issue #19 Phase 4追加修正: floating panel化に伴い折りたたみ機能を廃止した
          (表示/非表示はPanelVisibilityTogglesのみで行う)。この見出し領域は
          FloatingPanel側のドラッグハンドル判定(`h2`要素であること)を兼ねる。 */}
      <h2 className="panel-info__heading">{heading}</h2>

      {cards.length === 0 && !panel && (
        <p className="panel-info__empty">このページには盤情報がありません</p>
      )}

      {cards.length > 0 && (
        <>
          {/* 見出し行はスクロール領域の外に置き、常に固定表示する (指示書1章/8章)。 */}
          <div className="panel-info__row panel-info__row--header" role="row">
            {COLUMN_HEADERS.map((col) => (
              <span
                key={col.key}
                className={`panel-info__cell panel-info__cell--header panel-info__cell--${col.key}`}
                role="columnheader"
              >
                {col.label}
              </span>
            ))}
          </div>
          <div className="panel-info__list-scroll">
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
                      <span className="panel-info__cell panel-info__cell--menban" role="cell">
                        {cells.menban}
                      </span>
                      <span
                        className="panel-info__cell panel-info__cell--name panel-info__cell--ellipsis"
                        role="cell"
                        title={cells.name}
                      >
                        {cells.name}
                      </span>
                      <span className="panel-info__cell panel-info__cell--model" role="cell">
                        {cells.model}
                      </span>
                      <span className="panel-info__cell panel-info__cell--height" role="cell">
                        {cells.height}
                      </span>
                      <span className="panel-info__cell panel-info__cell--width" role="cell">
                        {cells.width}
                      </span>
                      <span className="panel-info__cell panel-info__cell--depth" role="cell">
                        {cells.depth}
                      </span>
                      <span
                        className="panel-info__cell panel-info__cell--connect panel-info__cell--ellipsis"
                        role="cell"
                        title={cells.connect}
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
          <table className="panel-info__table">
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
    </section>
  )
}
