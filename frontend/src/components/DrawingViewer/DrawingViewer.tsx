import { useEffect, useState } from 'react'
import type { Detection, PanelPreview } from '../../types/domain'
import type { NormalizedRect } from '../../utils/bbox'
import { DrawingCanvas } from './DrawingCanvas'
import { DetectionOverlay } from './DetectionOverlay'
import type { PreviewBBox } from './DetectionOverlay'
import { LeaderLineOverlay } from './LeaderLineOverlay'
import { ProductPanelOverlay } from './ProductPanelOverlay'
import './DrawingViewer.css'

interface Props {
  /** 表示対象の製番・ページ番号 (Phase 1.8)。左ペインが参照する実データと同じ
   * 製番配下のページを直接参照するため、DB上のダミーDrawingPageには依存しない。 */
  productNo: string | null
  pageNo: number | null
  /** 表示する画像のURL (Phase 1.8重要仕様訂正)。左ペインのサムネイルと**同一の
   * {page}.png**を使う (`ProductDrawing.thumbnail_url` をそのまま渡す)。
   * product_df由来の盤領域Overlayはこの画像の実ピクセル寸法を正規化の基準にしているため、
   * 左右で異なる画像ソース(PDF等)を使うと位置がずれる可能性がある (指示書1章/3章)。 */
  pageImageUrl: string | null
  /** 見出しに表示するラベル (図面種別 + ページ番号等)。 */
  pageLabel: string
  /** 選択中ページのproduct_df由来盤領域 (Phase 1.8)。中央Viewerにのみ表示し、
   * 左ペインのサムネイルには表示しない (実画面未反映調査・修正指示 7章/17章)。
   * ダミーDB由来のPanelOverlay(旧`panelAreas`)と二重に表示しないよう、
   * こちらの表示に一本化している (指示書11章)。 */
  panels: PanelPreview[]
  /** 現在選択中の盤 (product_df由来) を識別するキー。Detection/BBoxの選択状態とは
   * 別概念として管理する (Phase 1.9 UI改修指示5章)。 */
  selectedPanelKey: string | null
  /** 盤領域クリック時に呼ばれる (Phase 1.9, 要件5)。 */
  onSelectPanel: (key: string, panel: PanelPreview) => void
  /** 積算コードMasterで行が選択されている間はtrue (Phase 1.10 指示書4章/5章/7章)。
   * `bboxAddMode`(=ダミーDB側の対応ページがある場合のみ有効)とは異なり、
   * `selectedMasterItemId != null`のみで決まる。この間は盤領域のTooltip抑止・
   * 操作無効化を行う (盤の位置確認自体は妨げない)。 */
  masterItemSelected?: boolean
  detections: Detection[]
  selectedDetectionId: number | null
  highlightedDetectionId: number | null
  onSelectDetection: (detectionId: number) => void
  /** 積算コードMasterで行が選択されている間、Viewer上のドラッグをManual BBox作成にする (Phase 1.6)。 */
  bboxAddMode: boolean
  onCreateBBox: (rect: NormalizedRect) => void
  /** 選択中BBoxの四隅リサイズ/内部drag移動がmouseupで確定した時 (Phase 1.7、
   * Phase 1.11でBBox内部drag移動にも流用)。 */
  onResizeDetection: (detectionId: number, rect: NormalizedRect) => void
  /** 引出線ラベル帯のdragがmouseupで確定した時 (Phase 1.11 指示書10章/12章)。
   * BBox本体の座標は変えず、ラベル位置のみを更新する。 */
  onMoveDetectionLabel: (detectionId: number, x: number, y: number) => void
  /** ツールバーのBBox削除ボタン・Deleteキーから呼ばれる (Phase 1.7)。 */
  onDeleteSelectedDetection: () => void
  /** 空白領域クリックでBBox選択を解除する (Phase 1.7, 要件26)。 */
  onDeselectDetection: () => void
}

// フォールバック表示サイズ。実画像ロード完了後は実サイズ(naturalWidth/Height)へ切り替わる。
const FALLBACK_SIZE = { width: 1191, height: 842 }

export function DrawingViewer({
  productNo,
  pageNo,
  pageImageUrl,
  pageLabel,
  panels,
  selectedPanelKey,
  onSelectPanel,
  masterItemSelected = false,
  detections,
  selectedDetectionId,
  highlightedDetectionId,
  onSelectDetection,
  bboxAddMode,
  onCreateBBox,
  onResizeDetection,
  onMoveDetectionLabel,
  onDeleteSelectedDetection,
  onDeselectDetection,
}: Props) {
  const selectedDetection = detections.find((d) => d.id === selectedDetectionId) ?? null
  const hasPage = productNo != null && pageNo != null && pageImageUrl != null

  // 引出線hover中のDetection (Phase 1.11)。LeaderLineOverlay(引出線)が更新し、
  // DetectionOverlay(実BBox)がこれを見て通常非表示のBBoxを一時的に表示する
  // (要件8)。Detection/BBoxの選択状態(selectedDetectionId)や盤選択とは別軸。
  const [hoveredDetectionId, setHoveredDetectionId] = useState<number | null>(null)

  // ドラッグ中(未確定)のBBoxプレビュー (Phase 1.11 追加修正11章〜17章)。
  // DetectionOverlay(描画・drag操作の主体)とLeaderLineOverlay(引出線anchorの
  // リアルタイム追従)の両方が同じ値を参照できるよう、親であるこのコンポーネントで
  // 一元管理する (persistedBBoxはdetections配列そのもの、previewBBoxはこちら)。
  // Backendへの保存(PATCH)はmouseup時のonResizeDetectionのみが行い、
  // このstate自体はDBへ送らない (要件14)。
  const [previewBBox, setPreviewBBox] = useState<PreviewBBox | null>(null)

  // ページ切替時に古いhover状態を持ち越さない (別ページのDetection idが
  // たまたま一致することはないが、念のためクリアする)。
  useEffect(() => {
    setHoveredDetectionId(null)
    setPreviewBBox(null)
  }, [productNo, pageNo])

  return (
    <section className="drawing-viewer">
      <h2 className="drawing-viewer__heading">{hasPage ? pageLabel : '図面名'}</h2>
      <div className="drawing-viewer__stage">
        {!hasPage && (
          <div className="drawing-viewer__empty">左の図面一覧からページを選択してください</div>
        )}
        {hasPage && (
          <DrawingCanvas
            key={`${productNo}:${pageNo}`}
            mode="png"
            fileUrl={pageImageUrl}
            fallbackSize={FALLBACK_SIZE}
            bboxAddMode={bboxAddMode}
            onCreateBBox={onCreateBBox}
            selectedDetectionLabel={selectedDetection?.class_name ?? null}
            onDeleteSelectedDetection={onDeleteSelectedDetection}
            onBackgroundClick={onDeselectDetection}
          >
            <ProductPanelOverlay
              panels={panels}
              selectedPanelKey={selectedPanelKey}
              onSelectPanel={onSelectPanel}
              masterItemSelected={masterItemSelected}
            />
            <LeaderLineOverlay
              detections={detections}
              selectedDetectionId={selectedDetectionId}
              hoveredDetectionId={hoveredDetectionId}
              onHoverDetection={setHoveredDetectionId}
              onSelectDetection={onSelectDetection}
              onMoveLabel={onMoveDetectionLabel}
              previewBBox={previewBBox}
            />
            <DetectionOverlay
              detections={detections}
              selectedDetectionId={selectedDetectionId}
              highlightedDetectionId={highlightedDetectionId}
              hoveredDetectionId={hoveredDetectionId}
              onSelectDetection={onSelectDetection}
              onResizeDetection={onResizeDetection}
              previewBBox={previewBBox}
              onPreviewBBoxChange={(detectionId, rect) =>
                setPreviewBBox(rect ? { detectionId, rect } : null)
              }
            />
          </DrawingCanvas>
        )}
      </div>
    </section>
  )
}
