import { useEffect, useState } from 'react'
import type { DetectedPreviewItem } from '../../types/domain'

interface Props {
  items: DetectedPreviewItem[]
  /** 積算コードMasterで行が選択されている間 (Manual BBox追加モード) はtrue
   * (Phase 1.13指示書16章/17章)。`ProductPanelOverlay`と同じ考え方で、この間は
   * AI BBoxのhover Tooltipを止め、pointer-eventsも一時的にnoneにすることで
   * Manual BBoxのドラッグ作成をAI BBoxが妨げないようにする。 */
  masterItemSelected?: boolean
}

interface HoverState {
  id: number
  item: DetectedPreviewItem
  clientX: number
  clientY: number
}

// Tooltipのサイズ見積もり (概算)。ProductPanelOverlay.tsxと同じ考え方のクランプ計算に使う。
const TOOLTIP_WIDTH_ESTIMATE = 220
const TOOLTIP_HEIGHT_ESTIMATE = 120
const TOOLTIP_OFFSET = 14

/** Tooltip用の詳細行 (指示書9章: DEVICE/SCORE/PAGE/YOLO_INDEXを最低限表示)。
 * `id`はBackend側で`yolo_index`をそのまま渡している (`DetectedPreviewItemOut`参照)。 */
function buildTooltipLines(item: DetectedPreviewItem): string[] {
  return [
    `DEVICE: ${item.class_name}`,
    `SCORE: ${item.confidence.toFixed(2)}`, // 指示書10章: 実値を丸めて表示 (元データは変更しない)
    `PAGE: ${item.page_no}`,
    `YOLO_INDEX: ${item.id}`,
  ]
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
 * `detected_df.csv` (YOLO検出結果、実行済み推論の出力) 由来の検出BBoxプレビュー
 * (Phase 1.12で座標補正・表示を実装、Phase 1.13で表示優先度・視認性を整理)。
 *
 * **役割の整理 (指示書1章)**: 「AIが何をどこに検出したか」を確認するための情報であり、
 * 積算コード確定後の表示 (Manual BBox / Leader Line) とは役割を分ける。座標変換
 * ロジック(Phase 1.12)は一切変更しない。
 *
 * - 通常時: 背景透明・細い(1px)青系実線の枠のみ + `DEVICE`名だけの控えめなラベル
 *   (指示書2章〜6章。confidence(SCORE)は常時表示しない)。
 * - hover時のみ: 枠をやや太く + ごく薄い青背景 + DEVICE/SCORE/PAGE/YOLO_INDEXの
 *   詳細Tooltip (指示書8章/9章)。クリックしても既存Detectionの編集状態には
 *   入らない (指示書12章: 表示・確認専用)。
 * - Master Item選択中(Manual BBox追加モード)は、hover/Tooltipを止め、
 *   pointer-events自体をnoneにしてBBoxドラッグ作成を妨げない (指示書16章)。
 * - 複数件のBBoxを勝手に統合・NMS再処理しない。detected_df.csvの1行=1件として
 *   全件個別に保持・描画する (指示書11章)。
 *
 * Layer順序: `DrawingViewer.css`で盤領域(z-index 10)より上、引出線(15)・
 * Manual/AI BBox本体(20)より下に固定している (指示書8章/14章: 積算作業に入った
 * Manual/LeaderをAI BBoxより優先表示する)。
 */
export function DetectedPreviewOverlay({ items, masterItemSelected = false }: Props) {
  const [hover, setHover] = useState<HoverState | null>(null)

  // Master Item選択中は既に表示中のTooltipも即座に消す (マウスがその場から
  // 動かずonMouseLeaveが発火しないケースへの対応。ProductPanelOverlayと同じ考え方)。
  useEffect(() => {
    if (masterItemSelected) setHover(null)
  }, [masterItemSelected])

  // PAGE切替等でitems自体が入れ替わった時、古いhover stateを持ち越さない
  // (指示書21章: PAGE切替時にはAI hover state / Tooltipを解除する)。
  useEffect(() => {
    setHover(null)
  }, [items])

  return (
    <div className="detected-preview-overlay">
      {items.map((item) => {
        const rect = item.normalized_rect
        const isHovered = hover?.id === item.id
        return (
          <div
            key={item.id}
            className={
              'detected-preview-overlay__bbox' +
              (masterItemSelected ? ' detected-preview-overlay__bbox--noninteractive' : '')
            }
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
            }}
            onMouseEnter={(e) => {
              if (masterItemSelected) return // 二重の防御 (CSS側のpointer-events:noneと合わせて)
              setHover({ id: item.id, item, clientX: e.clientX, clientY: e.clientY })
            }}
            onMouseMove={(e) => {
              if (masterItemSelected) return
              setHover((current) =>
                current && current.id === item.id
                  ? { ...current, clientX: e.clientX, clientY: e.clientY }
                  : current,
              )
            }}
            onMouseLeave={() => setHover((current) => (current?.id === item.id ? null : current))}
          >
            {/* 指示書5章/6章: 通常表示はDEVICE名のみ。confidenceは常時表示しない
                (詳細はhover時のTooltipで確認する)。 */}
            <span
              className={
                'detected-preview-overlay__label' + (isHovered ? ' detected-preview-overlay__label--hovered' : '')
              }
            >
              {item.class_name}
            </span>
          </div>
        )
      })}
      {/* hover詳細Tooltip (指示書8章/9章)。ProductPanelOverlayと同じposition:fixed +
          viewport端クランプの実装。pointer-events:noneでTooltip自体がhoverを奪わない。 */}
      {hover && (
        <div
          className="detected-preview-overlay__tooltip"
          role="tooltip"
          style={clampTooltipPosition(hover.clientX, hover.clientY)}
        >
          {buildTooltipLines(hover.item).map((line) => (
            <div key={line} className="detected-preview-overlay__tooltip-line">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
