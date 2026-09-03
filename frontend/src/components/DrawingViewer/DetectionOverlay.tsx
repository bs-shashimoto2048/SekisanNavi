import { useEffect, useRef, useState } from 'react'
import type { Detection } from '../../types/domain'
import type { Corner, NormalizedRect } from '../../utils/bbox'
import { moveRect, resizeRect } from '../../utils/bbox'
import { getCategoryPresentation, toCssVars } from '../../domain/masterCategoryPresentation'

// リサイズ時の最低BBoxサイズ。Backend (ManualDetectionCreateIn/DetectionBBoxUpdateIn)
// の下限 (0.001) と揃えておき、Frontendのプレビューと保存結果がずれないようにする。
const MIN_BBOX_SIZE = 0.001

// クリック(選択)とBBox内部drag(移動)の誤認を防ぐための最小移動量
// (画面ピクセル、zoom非依存)。DrawingCanvas.tsxのMIN_DRAG_PXと同じ考え方 (Phase 1.11 指示書4章)。
const MIN_DRAG_PX = 6

const CORNERS: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

/** ドラッグ中(未確定)のBBoxプレビュー。DrawingViewer.tsxが保持し、
 * DetectionOverlay(描画・drag操作)とLeaderLineOverlay(引出線anchorの
 * リアルタイム追従)の両方へ渡す (Phase 1.11 追加修正11章〜17章)。
 * confirm(DB保存)はmouseup時のみ行い、mousemove毎にはPATCHしない (要件14)。 */
export interface PreviewBBox {
  detectionId: number
  rect: NormalizedRect
}

interface Props {
  detections: Detection[]
  selectedDetectionId: number | null
  highlightedDetectionId: number | null
  /** 引出線をhover中のDetection (Phase 1.11)。積算Master Itemに紐づくBBoxは
   * 通常時非表示のため、このidに一致する間だけ確認用に表示する (要件8)。 */
  hoveredDetectionId?: number | null
  /** 積算明細(右ペイン③)の行をhover中のDetection (積算集約・積算明細UI再構成
   * 指示18章〜21章)。`hoveredDetectionId`(引出線hover)とは発生源が異なる別状態
   * として持つ (指示21章: 既存のBBoxや選択表示と混同しないよう別途持たせる)。
   * 通常非表示のBBoxを一時表示する点は共通だが、視覚的な強調スタイル
   * (半透明塗りつぶし+太めの枠)は`--detail-hover`修飾クラスで区別する。 */
  detailHoveredDetectionId?: number | null
  onSelectDetection: (detectionId: number) => void
  /** 選択中BBoxのリサイズ/移動がmouseupで確定した時に呼ばれる
   * (Phase 1.7, 要件17/23。Phase 1.11でBBox内部drag=移動にも流用する)。 */
  onResizeDetection?: (detectionId: number, rect: NormalizedRect) => void
  /** ドラッグ中(未確定)のBBoxプレビュー。DrawingViewer.tsxで管理する共有stateを
   * そのまま受け取る (Phase 1.11 追加修正15章: persistedBBox/previewBBoxの分離)。
   * このコンポーネント自身のmousemoveハンドラが`onPreviewBBoxChange`経由で
   * 都度更新し、LeaderLineOverlay側は読み取るだけ (どちらも同じ値を見る)。 */
  previewBBox?: PreviewBBox | null
  /** mousemoveの度に呼ばれ、ドラッグ中のプレビュー座標をDrawingViewer側のstateへ
   * 反映する (Backendへは送らない。mouseup時のonResizeDetectionのみがDB保存を行う。
   * 要件14)。ドラッグ終了時はnullを渡してクリアする。 */
  onPreviewBBoxChange?: (detectionId: number, rect: NormalizedRect | null) => void
}

/**
 * Detection(AI検出・Manual追加BBox)のBBoxをオーバーレイ表示する。
 *
 * bbox_x/y/w/h は 0.0〜1.0 の正規化座標 (該当ページのPDF原寸に対する比率) として
 * 保持されているため、単純に %表示に変換するだけでよい。このコンポーネントは
 * 親要素 (DrawingCanvasのcontent領域、= zoom後のピクセルサイズを持つ) に対して
 * position:absolute; inset:0 で重なるため、ズーム・パン・ウィンドウリサイズが
 * 起きても位置関係はずれない。
 *
 * Manual/AIの視覚的区別 (Phase 1.6, 要件16): source_typeに応じたCSSクラスに加え、
 * ラベルへ "✎" を付け、色の見分けに依存せず判別できるようにする。
 * status (selected/needs_review/excluded/flash等) は既存の表示を優先する
 * (CSS側で status クラスを source_type クラスより後に定義し上書きする)。
 *
 * **Phase 1.11: BBox = 内部・編集情報 / 引出線 = 通常表示、の分離**。
 * 積算Master Itemに紐づくManual BBox (`master_item_id != null`) は、通常時
 * BBox矩形を表示しない (`LeaderLineOverlay`が代わりに引出線を表示する)。
 * 表示されるのは (a) 選択中(編集中)、(b) 引出線hover中(`hoveredDetectionId`一致)、
 * のいずれかの場合のみ。AI Detection (master_item_id === null) は既存通り常時表示
 * のまま変更しない (要件29: 既存AI Detectionの表示方式を勝手に変更しない)。
 * 表示する場合の色は、固定の青系ではなく`master_item_category`から
 * `masterCategoryPresentation.ts`経由で解決した配色を使う (要件2)。
 *
 * 四隅リサイズ (Phase 1.7, 要件16-21) + BBox内部drag移動 (Phase 1.11, 要件4):
 * 選択中のBBox (Manual/AI問わず) にのみ四隅ハンドルを表示し、内部dragでの移動も
 * 選択中のみ有効にする (通常のクリック=選択とは、最小移動量(MIN_DRAG_PX)未満かで
 * 区別する。DrawingCanvasのManual BBox作成時と同じ考え方)。
 * ハンドルは通常のBBoxボタンと同じくbutton要素にすることで、DrawingCanvas側の
 * 「button要素上のmousedownはPan/Manual BBox追加の開始としない」ガードにそのまま
 * 乗り、Pan/新規追加との競合を避けている。ドラッグ中はこのコンポーネント内の
 * ローカル状態でプレビューのみ更新し、mouseup時に一度だけ onResizeDetection を呼ぶ
 * (mousemove毎のBackend更新はしない)。
 */
export function DetectionOverlay({
  detections,
  selectedDetectionId,
  highlightedDetectionId,
  hoveredDetectionId = null,
  detailHoveredDetectionId = null,
  onSelectDetection,
  onResizeDetection,
  previewBBox = null,
  onPreviewBBoxChange,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const activeResizeRef = useRef<{
    detectionId: number
    corner: Corner
    original: NormalizedRect
  } | null>(null)
  const activeMoveRef = useRef<{
    detectionId: number
    original: NormalizedRect
    startNormX: number
    startNormY: number
    startClientX: number
    startClientY: number
    moved: boolean
  } | null>(null)
  // previewBBoxは本来DrawingViewer.tsxが保持するstateをprops経由で受け取る想定
  // (Phase 1.11 追加修正15章)。ただし`onPreviewBBoxChange`が渡されない呼び出し元
  // (既存のDetectionOverlay単体テスト等、リフト前の使い方)でも壊れないよう、
  // その場合のみこのコンポーネント内部にフォールバックのstateを持つ
  // (「onChangeを渡せばcontrolled、渡さなければuncontrolled」という一般的なReactの
  // 慣習と同じ考え方)。本番のDrawingViewer経由では常に両propsを渡すため、常にcontrolled。
  const [internalPreview, setInternalPreview] = useState<PreviewBBox | null>(null)
  const isControlled = onPreviewBBoxChange != null
  const effectivePreview = isControlled ? previewBBox : internalPreview

  // mouseupハンドラ (mount時に1度だけ張るuseEffect) からは常に最新値を読みたいため、
  // refへ都度反映する。
  const previewBBoxRef = useRef(effectivePreview)
  previewBBoxRef.current = effectivePreview

  // controlled/uncontrolledいずれの場合も同じ経路でpreviewを更新するヘルパー。
  // 呼び出し元(親)へ通知しつつ、uncontrolledの場合のみ内部stateも更新する。
  const updatePreviewRef = useRef<(detectionId: number, rect: NormalizedRect | null) => void>(() => {})
  updatePreviewRef.current = (detectionId, rect) => {
    onPreviewBBoxChange?.(detectionId, rect)
    if (!isControlled) setInternalPreview(rect ? { detectionId, rect } : null)
  }

  // 全体フォント拡大・BBox編集追従回帰修正 指示2章で判明した根本原因の修正:
  // 下のuseEffectは`window`へのmousemove/mouseup購読を1度だけ張る設計のため
  // (依存配列`[]`、パフォーマンス上の意図的な選択)、そのクロージャは
  // **マウント時点**の`onResizeDetection`を捕まえたまま更新されない
  // (stale closure)。`onResizeDetection`自体はApp.tsx側で毎レンダー新しい関数
  // (`handleResizeDetection`、`allDetections`等の最新stateを閉じ込めている)として
  // 渡されるため、このコンポーネントが「データがまだ空/未確定なタイミング」で
  // 最初にマウントされると、以後のBBox移動/リサイズ確定はずっとその「空だった
  // 頃の」`handleResizeDetection`を呼び続けてしまい、`allDetections.find(...)`が
  // 何も見つけられず`followTargetChangeIfNeeded`(所属追従・Toast)が一切発火しない
  // ……という不具合が実際に起きていた。Undo/Redoの`Ctrl+Z`ショートカット
  // (App.tsx側、常にrefパターンで最新化)と同じ「常に最新を指すref」パターンで解消する。
  const onResizeDetectionRef = useRef(onResizeDetection)
  useEffect(() => {
    onResizeDetectionRef.current = onResizeDetection
  })

  useEffect(() => {
    function pointerToNormalized(clientX: number, clientY: number): { x: number; y: number } | null {
      const el = overlayRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height }
    }

    function handleMouseMove(e: MouseEvent) {
      const resizing = activeResizeRef.current
      if (resizing) {
        const point = pointerToNormalized(e.clientX, e.clientY)
        if (!point) return
        const rect = resizeRect(resizing.original, resizing.corner, point.x, point.y, MIN_BBOX_SIZE)
        // DrawingViewer側のstateを更新するのみ (Backendへは送らない。要件14)。
        // LeaderLineOverlayも同じstateを見るため、引出線のanchorがリアルタイムで
        // 追従する (追加修正11章〜13章)。
        updatePreviewRef.current(resizing.detectionId, rect)
        return
      }
      const moving = activeMoveRef.current
      if (moving) {
        const point = pointerToNormalized(e.clientX, e.clientY)
        if (!point) return
        const movedPx = Math.max(
          Math.abs(e.clientX - moving.startClientX),
          Math.abs(e.clientY - moving.startClientY),
        )
        if (movedPx >= MIN_DRAG_PX) moving.moved = true
        const dx = point.x - moving.startNormX
        const dy = point.y - moving.startNormY
        const rect = moveRect(moving.original, dx, dy)
        updatePreviewRef.current(moving.detectionId, rect)
      }
    }

    function handleMouseUp() {
      const resizing = activeResizeRef.current
      if (resizing) {
        activeResizeRef.current = null
        const current = previewBBoxRef.current
        updatePreviewRef.current(resizing.detectionId, null)
        if (current && current.detectionId === resizing.detectionId) {
          onResizeDetectionRef.current?.(resizing.detectionId, current.rect)
        }
        return
      }
      const moving = activeMoveRef.current
      if (moving) {
        activeMoveRef.current = null
        const current = previewBBoxRef.current
        updatePreviewRef.current(moving.detectionId, null)
        // 最小移動量未満 = クリックとみなし、移動として保存しない (指示書4章の
        // 「クリックと移動の誤認防止」。選択自体は通常のonClickが別途処理する)。
        if (moving.moved && current && current.detectionId === moving.detectionId) {
          onResizeDetectionRef.current?.(moving.detectionId, current.rect)
        }
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleCornerMouseDown(e: React.MouseEvent, detection: Detection, corner: Corner) {
    e.preventDefault()
    e.stopPropagation()
    const original: NormalizedRect = {
      x: detection.bbox_x,
      y: detection.bbox_y,
      w: detection.bbox_w,
      h: detection.bbox_h,
    }
    activeResizeRef.current = { detectionId: detection.id, corner, original }
    updatePreviewRef.current(detection.id, original)
  }

  // BBox内部drag = 移動 (Phase 1.11 要件4)。編集中(選択中)のBBoxでのみ有効にする
  // (要件9: 通常/hover時は移動不可、editing時のみ)。
  function handleBboxMouseDown(e: React.MouseEvent, detection: Detection, isSelected: boolean) {
    if (!isSelected) return // 未選択時のmousedownは通常のクリック(選択)に任せる
    if (e.button !== 0) return
    const el = overlayRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const startNormX = (e.clientX - rect.left) / rect.width
    const startNormY = (e.clientY - rect.top) / rect.height
    activeMoveRef.current = {
      detectionId: detection.id,
      original: { x: detection.bbox_x, y: detection.bbox_y, w: detection.bbox_w, h: detection.bbox_h },
      startNormX,
      startNormY,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    }
  }

  return (
    <div className="detection-overlay" ref={overlayRef}>
      {detections.map((detection) => {
        const isSelected = detection.id === selectedDetectionId
        const isHighlighted = detection.id === highlightedDetectionId
        const isManual = detection.source_type === 'manual'
        const isMasterLinked = detection.master_item_id != null
        const isHoveredViaLeader = detection.id === hoveredDetectionId
        const isDetailHovered = detection.id === detailHoveredDetectionId
        // Phase 1.11 指示書7章/8章/9章: 積算Master Itemに紐づくBBoxは、選択中(編集中)・
        // 引出線hover中・積算明細hover中・一時強調中(`isHighlighted`。明細遷移後の
        // BBox残留・Hover色・品名列修正 指示1章: 選択せずに一時フォーカスするフローを
        // 追加したため、選択されていなくても強調表示中は描画する必要がある)の
        // いずれかでなければ矩形を描画しない。AI Detectionは従来通り常時表示のまま
        // (要件29)。
        if (isMasterLinked && !isSelected && !isHoveredViaLeader && !isDetailHovered && !isHighlighted) return null

        const preview = effectivePreview?.detectionId === detection.id ? effectivePreview.rect : null
        const bboxX = preview ? preview.x : detection.bbox_x
        const bboxY = preview ? preview.y : detection.bbox_y
        const bboxW = preview ? preview.w : detection.bbox_w
        const bboxH = preview ? preview.h : detection.bbox_h

        const categoryColors = isMasterLinked
          ? getCategoryPresentation(detection.master_item_category).colors
          : null

        return (
          <div key={detection.id}>
            <button
              type="button"
              className={
                'detection-overlay__bbox' +
                (isManual ? ' detection-overlay__bbox--manual' : '') +
                ` detection-overlay__bbox--${detection.status}` +
                (isSelected ? ' detection-overlay__bbox--selected' : '') +
                (isHighlighted ? ' detection-overlay__bbox--flash' : '') +
                (categoryColors ? ' detection-overlay__bbox--category' : '') +
                (isSelected ? ' detection-overlay__bbox--move-cursor' : '') +
                // 積算明細Hover強調は情報源(実データのsource_type)に応じた色にする
                // (明細遷移後のBBox残留・Hover色・品名列修正 指示2章)。既存の
                // AI=青(#3b82f6)/マニュアル=紫(#7c3aed)の配色(下記--manual等と同じ)を
                // そのまま再利用し、新たな色体系は増やさない。
                (isDetailHovered ? ` detection-overlay__bbox--detail-hover-${detection.source_type}` : '')
              }
              style={{
                left: `${bboxX * 100}%`,
                top: `${bboxY * 100}%`,
                width: `${bboxW * 100}%`,
                height: `${bboxH * 100}%`,
                ...(categoryColors ? toCssVars(categoryColors) : {}),
              }}
              title={
                `${detection.class_name} ` +
                (isManual ? '(手動追加)' : `(confidence: ${detection.confidence ?? '-'})`)
              }
              onClick={() => onSelectDetection(detection.id)}
              onMouseDown={(e) => handleBboxMouseDown(e, detection, isSelected)}
            >
              <span className="detection-overlay__label">
                {isManual && '✎ '}
                {detection.class_name}
              </span>
            </button>
            {isSelected &&
              CORNERS.map((corner) => {
                const cx = corner.includes('left') ? bboxX : bboxX + bboxW
                const cy = corner.includes('top') ? bboxY : bboxY + bboxH
                return (
                  <button
                    key={corner}
                    type="button"
                    className={`detection-overlay__handle detection-overlay__handle--${corner}`}
                    style={{ left: `${cx * 100}%`, top: `${cy * 100}%` }}
                    aria-label={`BBoxサイズ変更 (${corner})`}
                    onMouseDown={(e) => handleCornerMouseDown(e, detection, corner)}
                  />
                )
              })}
          </div>
        )
      })}
    </div>
  )
}
