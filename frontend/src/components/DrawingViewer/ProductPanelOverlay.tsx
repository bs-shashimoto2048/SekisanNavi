import { useEffect, useMemo, useState } from 'react'
import type { PanelPreview } from '../../types/domain'
import { banGroupKey, panelKey } from '../../utils/panel'

interface Props {
  panels: PanelPreview[]
  /** 現在選択中の盤を識別するキー (`utils/panel.ts::panelKey`)。Detection/BBoxの
   * 選択状態とは別概念として管理する (Phase 1.9 UI改修指示5章)。 */
  selectedPanelKey: string | null
  onSelectPanel: (key: string, panel: PanelPreview) => void
  /** 積算コードMasterで行が選択されている間 (Manual BBox追加モード) はtrue。
   * Phase 1.10 指示書4章/5章/7章: この間は盤詳細Tooltipを出さず (作業の主目的が
   * BBox作成に移るため)、かつ盤領域自体の操作(hover/click)を無効化して
   * Viewerドラッグを常にBBox作成として扱えるようにする。赤枠・ラベルの表示は
   * 維持し、盤の位置確認自体は妨げない (6章)。 */
  masterItemSelected?: boolean
}

interface HoverState {
  key: string
  panel: PanelPreview
  clientX: number
  clientY: number
}

// Tooltipのサイズ見積もり (概算)。実画面未達 修正指示6章「図面外へはみ出さない」対応の
// クランプ計算に使う。厳密な実測ではなく、内容(最大5行程度の短いテキスト)に対する
// 十分な余裕を見込んだ概算値。
const TOOLTIP_WIDTH_ESTIMATE = 220
const TOOLTIP_HEIGHT_ESTIMATE = 150
const TOOLTIP_OFFSET = 14

/** Tooltip用の詳細行を組み立てる。値が無い項目は表示しない (要件4)。
 * 実画面未達 修正指示5章の表示例の項目順・全角コロン表記に合わせる。 */
function buildTooltipLines(panel: PanelPreview): string[] {
  const lines = [`面番号：${panel.ban_menno}`, `盤番号：${panel.ban_no}`]
  if (panel.ban_meisyou) lines.push(`盤名称：${panel.ban_meisyou}`)
  if (panel.ban_type) lines.push(`種別：${panel.ban_type}`)
  lines.push(`PAGE：${panel.page_no}`)
  return lines
}

function clampTooltipPosition(clientX: number, clientY: number): { left: number; top: number } {
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800
  const maxLeft = Math.max(8, viewportWidth - TOOLTIP_WIDTH_ESTIMATE - 8)
  const maxTop = Math.max(8, viewportHeight - TOOLTIP_HEIGHT_ESTIMATE - 8)
  return {
    left: Math.min(clientX + TOOLTIP_OFFSET, maxLeft),
    top: Math.min(clientY + TOOLTIP_OFFSET, maxTop),
  }
}

/**
 * product_df.csv由来の盤領域Overlay (Phase 1.8、Phase 1.9でクリック選択対応、
 * 実画面未達 修正指示でhover Tooltip・イベント優先順位を修正)。
 *
 * 中央Drawing Viewer上に赤色半透明で重畳する。DetectionOverlayと同じ0.0〜1.0
 * 正規化座標系を共有しており、zoom/pan/fit/ペインリサイズが起きても位置関係が
 * 崩れない (architecture.md「Overlay座標系」)。1ページに複数行あれば全件描画する
 * (先頭1件へ削減しない。要件11/20)。
 *
 * 通常表示のラベルはBAN_MENNO/BAN_NOのみとし、BAN_MEISYOU/BAN_TYPE等の詳細は
 * hover時の独自Tooltip(このコンポーネント内でDOM描画するdiv)へ移した。
 * ブラウザ標準の`title`属性には依存しない (実画面未達 修正指示5章:
 * 「titleだけに依存しない」)。hoverとclickは独立したイベントハンドラのため、
 * Tooltip表示がクリックによる盤選択を妨げることはない (要件7)。
 *
 * `<button>`要素として実装しているため、DrawingCanvas側の既存ガード
 * (`(target as HTMLElement).closest('button')`によるPan/Manual BBox開始の抑止) が
 * そのまま適用され、盤領域クリックがPanやBBox作成と誤認識されない (要件9)。
 * BBox本体・リサイズハンドルとの優先順位は、実画面未達 修正指示15章/16章を受けて
 * `DrawingViewer.css`側で明示的なz-index/pointer-eventsにより保証している
 * (JSX描画順に暗黙で依存する実装は廃止した)。
 */
export function ProductPanelOverlay({
  panels,
  selectedPanelKey,
  onSelectPanel,
  masterItemSelected = false,
}: Props) {
  const [hover, setHover] = useState<HoverState | null>(null)

  // 盤にhover中のまま積算コードが選択された場合も、既に表示中のTooltipを
  // 即座に消す (マウスがその場から動かず`onMouseLeave`が発火しないケースへの対応。
  // Phase 1.10 指示書4章/5章)。
  useEffect(() => {
    if (masterItemSelected) setHover(null)
  }, [masterItemSelected])

  // 同一盤(PAGE+BAN_MENNO+BAN_NO)の別矢視を連動ハイライトする (Phase 1.11
  // UI改修指示17章/18章、追加修正1章〜3章で条件を修正)。個別の盤選択
  // (selectedPanelKey)とは別軸の、hover専用の一時的な強調表示。
  //
  // 追加修正1章: 「ページ内に複数種類の異なるBAN_MENNO/BAN_NOが存在する場合のみ」
  // 連動ハイライトを有効にする。1種類しか存在しないページ(例: P21のように
  // 同じ盤の別矢視だけが並ぶページ)では、そもそも「別の盤」という概念が無いため、
  // 連動ハイライトすると実質ページ全体が常に薄く塗りつぶされたのと同じになり
  // 意味を持たない。この場合は実際にhoverしている領域だけを塗りつぶす。
  const enableGroupedHover = useMemo(() => {
    const uniqueBanPairs = new Set(panels.map((p) => `${p.ban_menno}:${p.ban_no}`))
    return uniqueBanPairs.size > 1
  }, [panels])
  const hoveredGroupKey = hover && enableGroupedHover ? banGroupKey(hover.panel) : null

  return (
    <div className="product-panel-overlay">
      {panels.map((panel, i) => {
        const key = panelKey(panel, i)
        const isSelected = key === selectedPanelKey
        const isDimmed = selectedPanelKey != null && !isSelected
        // 実際にポインタが載っている領域自体は`:hover`疑似クラス(CSS)で強調されるため、
        // ここでは「同じ盤の“他の”別矢視」だけをプログラム的にハイライトする対象とする
        // (要件19: Tooltipは実際にhoverしている領域の情報のみを表示する。グループ内の
        // 他領域はTooltip自体は出さず、背景の強調のみ)。
        const isGroupHovered = hoveredGroupKey != null && banGroupKey(panel) === hoveredGroupKey && key !== hover?.key
        return (
          <button
            key={key}
            type="button"
            className={
              'product-panel-overlay__area' +
              (isSelected ? ' product-panel-overlay__area--selected' : '') +
              (isDimmed ? ' product-panel-overlay__area--dimmed' : '') +
              (masterItemSelected ? ' product-panel-overlay__area--noninteractive' : '') +
              (isGroupHovered ? ' product-panel-overlay__area--group-hover' : '')
            }
            style={{
              left: `${panel.normalized_rect.x * 100}%`,
              top: `${panel.normalized_rect.y * 100}%`,
              width: `${panel.normalized_rect.w * 100}%`,
              height: `${panel.normalized_rect.h * 100}%`,
            }}
            aria-label={buildTooltipLines(panel).join(' / ')}
            // 積算コード選択中はクリックによる盤選択も受け付けない (CSS側の
            // pointer-events:noneと合わせた二重の防御。要件7)。
            onClick={masterItemSelected ? undefined : () => onSelectPanel(key, panel)}
            onMouseEnter={(e) => {
              // 積算コード選択中は詳細Tooltipを出さない (Phase 1.10 指示書4章/5章:
              // 条件は「selectedMasterItemId == null AND panel hover」)。
              if (masterItemSelected) return
              setHover({ key, panel, clientX: e.clientX, clientY: e.clientY })
            }}
            onMouseMove={(e) => {
              if (masterItemSelected) return
              setHover((current) =>
                current && current.key === key
                  ? { ...current, clientX: e.clientX, clientY: e.clientY }
                  : current,
              )
            }}
            onMouseLeave={() => setHover((current) => (current?.key === key ? null : current))}
          >
            <span
              className={
                'product-panel-overlay__label' +
                (isSelected ? ' product-panel-overlay__label--selected' : '')
              }
            >
              {isSelected ? `[${panel.ban_menno}/${panel.ban_no}]` : `${panel.ban_menno}/${panel.ban_no}`}
            </span>
          </button>
        )
      })}
      {/* hover詳細Tooltip (実画面未達 修正指示5章/6章)。position:fixedのため
          ズーム/パン/ペインのoverflowに関係なく画面上のカーソル付近へ表示され、
          viewport端に対してクランプすることで図面外へはみ出さない。
          pointer-events:noneで、Tooltip自体がクリック/hoverを奪わないようにする。
          積算コード選択中は`masterItemSelected`によりhoverハンドラ自体がhover
          stateを更新しないため、既にhover中に選択が始まった場合もこの後の
          再描画でTooltipは出ない (`hover`は次のmouseEnter/Leaveまで残るが、
          選択開始時にApp側でbboxAddModeがtrueになった時点で次の操作からは
          抑止される)。 */}
      {hover && (
        <div
          className="product-panel-overlay__tooltip"
          role="tooltip"
          style={clampTooltipPosition(hover.clientX, hover.clientY)}
        >
          {buildTooltipLines(hover.panel).map((line) => (
            <div key={line} className="product-panel-overlay__tooltip-line">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
