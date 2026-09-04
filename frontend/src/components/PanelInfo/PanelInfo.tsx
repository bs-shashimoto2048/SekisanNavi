import type { AttributeSource, EstimatePanelInfo, Panel, PanelPreview } from '../../types/domain'
import { banGroupKey, panelKey } from '../../utils/panel'
import { CollapsibleSectionHeading } from '../Layout/CollapsibleSectionHeading'
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
  /** Issue #6: 見出しクリックでの開閉状態。controlled(App.tsxが保持)にする理由は
   * 折りたたみ時に親側の高さ/flex配分(隣接領域への還元)を切り替える必要があり、
   * その判断がこのコンポーネント単体では完結しないため。積算対象・図面一覧
   * 連動・Undo/Redo等、他のロジックには一切接続しない独立したUI状態。 */
  collapsed?: boolean
  onToggleCollapsed?: () => void
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

// 盤寸法を「H 2300 : W 1700 : D 2200」の1行にまとめる (指示書5章)。
// 末尾に単位(mm)を付けると見た目上の違和感があるため表示しない
// (次work指示1章)。欠損項目は個別に"-"にする(指示書8章)。
function formatDimensions(h: number | null, w: number | null, d: number | null): string {
  return `H ${formatValue(h)} : W ${formatValue(w)} : D ${formatValue(d)}`
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

/**
 * 右ペイン上部の「盤情報」表示 (次work指示: 複数盤対応・コンパクト化。
 * 盤情報1行化・3領域リサイズ拡張・Redo時引出線回帰修正 指示1章/2章で
 * 原則1盤=1行のレイアウトへ変更)。
 *
 * Phase 1.14までは中央Viewerで選択中の盤1件のみを表示する前提だったが、
 * 「現在表示しているプレビュー内の盤・面をすべて確認できること」を優先し、
 * 現在ページのproduct_df盤全件をカード一覧として常時表示する形へ変更した。
 * 選択中の盤はカードの強調表示(左アクセント+背景)で示す (指示書6章)。
 *
 * 表示優先順位 (指示書5章、指示1章で継承):
 *   1. 面/盤番号(バッジ)
 *   2. 盤名称
 *   3. 型式
 *   4. 寸法
 *   5. 接続情報
 * すべてを1つのflex行(`panel-info__card-row`)の子要素として横並びにし、
 * `flex-wrap: wrap`のみで折り返しを制御する。flexboxは幅が足りない場合、
 * 末尾の要素から次の行へ送るため、JSでの幅測定や別途メディアクエリを書かなくても
 * 「通常幅は1行、狭幅時は優先度の低い項目(接続情報→寸法の順)から自然に2行目へ
 * 折り返る」という指示1章の要件をそのまま満たせる。
 *
 * 表示優先順位:
 *   1. 現在ページに1件以上product_df盤があれば、盤単位でカード一覧を表示する。
 *   2. product_df盤が1件も無く、旧来のダミーDB由来`panel`がある場合のみ、
 *      後方互換のため従来の属性テーブル表示にフォールバックする。
 *   3. どちらも無ければ「このページには盤情報がありません」。
 */
export function PanelInfo({
  panel,
  panels,
  estimatePanels,
  selectedPanel,
  onSelectPanel,
  collapsed = false,
  onToggleCollapsed = () => {},
}: Props) {
  const cards = buildPanelCards(panels, estimatePanels, selectedPanel)
  const heading = cards.length > 0 ? `盤情報　${cards.length}件` : '盤情報'

  return (
    <section className="panel-info">
      <CollapsibleSectionHeading
        title={heading}
        collapsed={collapsed}
        onToggle={onToggleCollapsed}
        headingClassName="panel-info__heading"
      />

      {/* Issue #6: 折りたたみ時は見出しだけを残し、本文(カード一覧・従来の属性
          テーブル・空状態メッセージ)はすべて非表示にする。 */}
      {!collapsed && cards.length === 0 && !panel && (
        <p className="panel-info__empty">このページには盤情報がありません</p>
      )}

      {!collapsed && cards.length > 0 && (
        <div className="panel-info__list-scroll">
          <ul className="panel-info__list">
            {cards.map((card) => (
              <li key={card.key}>
                <button
                  type="button"
                  className={
                    'panel-info__card' + (card.isSelected ? ' panel-info__card--selected' : '')
                  }
                  onClick={() => onSelectPanel(card.key, card.panel)}
                  aria-pressed={card.isSelected}
                >
                  <div className="panel-info__card-row">
                    <span className="panel-info__badge">
                      {formatValue(card.panel.ban_menno)}/{formatValue(card.panel.ban_no)}
                    </span>
                    <span className="panel-info__name">
                      {formatValue(card.estimatePanel?.ban_meisyou ?? card.panel.ban_meisyou)}
                    </span>
                    {card.estimatePanel ? (
                      <>
                        {card.estimatePanel.model != null && card.estimatePanel.model.trim() !== '' && (
                          <span className="panel-info__meta">{formatValue(card.estimatePanel.model)}</span>
                        )}
                        <span className="panel-info__meta">
                          {formatDimensions(
                            card.estimatePanel.ban_h,
                            card.estimatePanel.ban_w,
                            card.estimatePanel.ban_d,
                          )}
                        </span>
                        {card.estimatePanel.ban_connect != null &&
                          card.estimatePanel.ban_connect.trim() !== '' && (
                            <span className="panel-info__meta">{formatValue(card.estimatePanel.ban_connect)}</span>
                          )}
                      </>
                    ) : (
                      <span className="panel-info__meta panel-info__meta--muted">
                        該当する積算盤情報がありません
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!collapsed && cards.length === 0 && panel && (
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
