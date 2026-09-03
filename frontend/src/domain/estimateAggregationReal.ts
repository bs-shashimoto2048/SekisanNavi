// 積算集約(右ペイン②)・積算明細(右ペイン③)を実データから組み立てるロジック。
//
// 入力は現在Frontendが保持している以下のみで、Backend APIの新設は行わない。
//   - detections: 製番全体・全ページ分のDetection[](各行がどのページ由来かを
//     `pageNo`で付与済み)。`master_item_id != null`の行だけが「積算コード」として
//     集計対象になる (`LeaderLineOverlay`が引出線を出す条件と同じ)。
//   - panelsByPageNo: ページ番号 -> そのページのPanelPreview[] (product_df由来の
//     盤BBox一覧。BBox所属判定は同一ページ内の盤同士でのみ行う)。
//   - estimatePanels: 製番全体のEstimatePanelInfo[] (盤名称の表示優先、
//     `PanelInfo`と同じ考え方)。
//   - masterItemById: 積算コードMaster全件のid引きMap (単価・定格の参照用)。
//
// 「同一の物理盤(面番号+盤番号)は複数の図面(ページ)にまたがって存在しうる」
// (積算集約・積算明細UI再構成 指示) ため、盤ターゲットの識別キーはページ番号を
// 含まない`面番号:盤番号`のみとする。ページごとの盤一覧グルーピング
// (`PanelInfo.tsx`, `utils/panel.ts::banGroupKey`)とは目的が異なるため、
// あちらの関数は流用せずこのファイル内に専用のキーを持つ。
import type { Detection, EstimateMasterItem, EstimatePanelInfo, PanelPreview } from '../types/domain'
import type { NormalizedRect } from '../utils/bbox'
import { intersectionArea } from '../utils/bbox'
import { getCategoryPresentation } from './masterCategoryPresentation'
import type {
  EstimateAggregationData,
  EstimateDetailItem,
  EstimateLineItem,
  EstimateSource,
  EstimateTarget,
} from '../types/estimateAggregation'

export const PRODUCT_TARGET_ID = 'product'
export const TIE_TARGET_ID = '__tie__'
export const TIE_TARGET_NAME = '要確認（複数盤の交差面積が同値）'

function bboxOf(detection: Detection): NormalizedRect {
  return { x: detection.bbox_x, y: detection.bbox_y, w: detection.bbox_w, h: detection.bbox_h }
}

/** 物理盤の識別キー (面番号:盤番号のみ。ページ番号を含まない)。同一盤が複数の
 * 図面にまたがって存在しても、この関数は常に同じキーを返す。 */
function physicalPanelKey(panel: PanelPreview): string {
  return `${panel.ban_menno}:${panel.ban_no}`
}

export function panelTargetId(panel: PanelPreview): string {
  return `panel:${physicalPanelKey(panel)}`
}

interface PanelHit {
  panel: PanelPreview
  area: number
}

export type PanelAssignment =
  | { kind: 'product' }
  | { kind: 'panel'; panel: PanelPreview; area: number }
  /** 最大交差面積が複数の異なる盤で完全同値だった場合。勝手な優先順位を付けず、
   * 呼び出し側で「要確認」として報告する。 */
  | { kind: 'tie'; candidates: PanelHit[] }

/**
 * 根拠BBox(積算コードのDetection)が、同一ページ内のどの盤へ所属するかを判定する。
 * BBox所属判定ロジック自体は前回から変更していない。
 *
 * 判定順:
 *   1. 各盤BBoxとの交差面積(`intersectionArea`、中心点判定は使わない)を求める。
 *   2. 交差する盤が0件 → 製品全体。
 *   3. 交差する盤が1件 → その盤。
 *   4. 交差する盤が2件以上 → 交差面積が最大の盤。
 *   5. 最大交差面積が複数の"異なる盤"で完全同値 → tie (要確認として報告)。
 *
 * 同一の物理盤(`physicalPanelKey`が同じ)の別矢視同士がたまたま同点になった場合は、
 * どちらを採用しても最終的な所属先(物理盤)は変わらないため、tieとして扱わない。
 */
export function assignDetectionToPanel(bbox: NormalizedRect, panels: PanelPreview[]): PanelAssignment {
  const hits: PanelHit[] = []
  for (const panel of panels) {
    const area = intersectionArea(bbox, panel.normalized_rect)
    if (area > 0) hits.push({ panel, area })
  }
  if (hits.length === 0) return { kind: 'product' }

  const maxArea = Math.max(...hits.map((h) => h.area))
  const winners = hits.filter((h) => h.area === maxArea)
  const winnerGroups = new Set(winners.map((w) => physicalPanelKey(w.panel)))
  if (winnerGroups.size > 1) {
    return { kind: 'tie', candidates: winners }
  }
  return { kind: 'panel', panel: winners[0].panel, area: winners[0].area }
}

/** `assignDetectionToPanel`の結果を、積算対象セレクトが使う実識別子(targetId)へ
 * 変換する (積算明細強化・Undo/Redo・要確認警告・編集追従 指示8章: BBox編集確定後の
 * 所属再判定で、旧所属/新所属をtargetId同士で比較するために使う。所属判定ロジック
 * (assignDetectionToPanel)自体は変更していない)。 */
export function resolveAssignmentTargetId(assignment: PanelAssignment): string {
  if (assignment.kind === 'product') return PRODUCT_TARGET_ID
  if (assignment.kind === 'panel') return panelTargetId(assignment.panel)
  return TIE_TARGET_ID
}

/** 盤名称の解決 (`PanelInfo.tsx`と同じ優先順位: estcode_df.csvの値を優先し、
 * 無ければproduct_df自身の値、それも空ならBAN_MENNO/BAN_NOを使う)。 */
function resolvePanelName(panel: PanelPreview, estimatePanels: EstimatePanelInfo[]): string {
  const matched = estimatePanels.find(
    (e) => e.ban_menno === panel.ban_menno && e.ban_no === panel.ban_no,
  )
  const name = matched?.ban_meisyou ?? panel.ban_meisyou
  return name && name.trim() !== '' ? name : `${panel.ban_menno}/${panel.ban_no}`
}

/** 型式/定格から明細行の識別情報テキストを組み立てる。
 * 両方無ければコード(またはclass_name)自身を表示し、空文字にはしない。 */
function buildContent(model: string | null, rating: string | null, fallback: string): string {
  const parts = [model, rating].filter((v): v is string => !!v && v.trim() !== '')
  return parts.length > 0 ? parts.join(' / ') : fallback
}

/** 集計対象の1 Detectionと、それが属する図面ページ番号の組。呼び出し側
 * (App.tsx)がダミーDB由来のDrawingPage.idからページ番号を解決した上で渡す。 */
export interface DetectionWithPage {
  detection: Detection
  pageNo: number
}

interface BuildParams {
  detections: DetectionWithPage[]
  /** ページ番号 -> そのページのPanelPreview[]。`ProductDrawing.panels`をそのまま
   * ページ番号引きのMapにしたもの。 */
  panelsByPageNo: Map<number, PanelPreview[]>
  estimatePanels: EstimatePanelInfo[]
  masterItemById: Map<number, EstimateMasterItem>
}

/**
 * 実データから積算集約・積算明細データを組み立てる。
 *
 * 集約キー(積算集約側の数量集約): `対象ID:masterItemId:情報源`。
 *   - masterItemIdはestimate_master_items.idそのもの (= Detection.master_item_id)
 *     であり、同一masterItemIdは常に同一のcode/model/rating/単価を指すことが
 *     保証されているため、コード文字列や型式文字列を個別に比較する必要がない。
 *   - 情報源(Detection.source_type)もキーに含める。同じmasterItemIdでもAI検出と
 *     手動追加が混在する場合、由来の異なる行を1行へ無条件に合算すると出自が
 *     分からなくなるため、実データに基づく区別としてキーに残す。
 *
 * 積算明細(`detailItems`)は数量集約を一切行わず、Detection 1件 = 1行のまま返す
 * (積算集約・積算明細UI再構成 指示14章: 「どの図面のどの箇所に付けられた情報か」
 * を追跡できるようにするため)。
 */
export function buildRealEstimateAggregation({
  detections,
  panelsByPageNo,
  estimatePanels,
  masterItemById,
}: BuildParams): EstimateAggregationData {
  // 現在ページに限らず、製番全体の盤ターゲットを1つずつ用意する。同一物理盤が
  // 複数ページにまたがって存在しても、最初に見つかった代表行を名称解決に使う。
  const panelTargetsByKey = new Map<string, EstimateTarget>()
  for (const pagePanels of panelsByPageNo.values()) {
    for (const panel of pagePanels) {
      const key = physicalPanelKey(panel)
      if (!panelTargetsByKey.has(key)) {
        panelTargetsByKey.set(key, {
          id: panelTargetId(panel),
          type: 'panel',
          name: resolvePanelName(panel, estimatePanels),
          banMenno: panel.ban_menno,
          banNo: panel.ban_no,
        })
      }
    }
  }

  const lineItems = new Map<string, EstimateLineItem>()
  const detailItems: EstimateDetailItem[] = []
  const tieDetectionIds: number[] = []

  for (const { detection, pageNo } of detections) {
    if (detection.master_item_id == null) continue // 積算コードとして紐づいていない行は対象外

    const pagePanels = panelsByPageNo.get(pageNo) ?? []
    const assignment = assignDetectionToPanel(bboxOf(detection), pagePanels)
    let targetId: string
    if (assignment.kind === 'product') {
      targetId = PRODUCT_TARGET_ID
    } else if (assignment.kind === 'panel') {
      targetId = panelTargetId(assignment.panel)
    } else {
      targetId = TIE_TARGET_ID
      tieDetectionIds.push(detection.id)
    }

    const masterItemId = detection.master_item_id
    const source: EstimateSource = detection.source_type === 'ai' ? 'ai' : 'manual'
    const master = masterItemById.get(masterItemId) ?? null
    const model = detection.master_item_model?.trim() || null
    const rating = master?.rating?.trim() || null
    const code = detection.master_item_code ?? detection.class_name
    const content = buildContent(model, rating, code)
    const unitPrice = master?.total_price_a ?? null

    // --- 積算集約: 数量集約あり ---
    const key = `${targetId}:${masterItemId}:${source}`
    const existing = lineItems.get(key)
    if (existing) {
      existing.quantity += 1
      existing.detectionIds.push(detection.id)
      existing.amount = existing.unitPrice != null ? existing.unitPrice * existing.quantity : null
    } else {
      lineItems.set(key, {
        id: key,
        targetId,
        source,
        masterItemId,
        code,
        category: detection.master_item_category,
        content,
        quantity: 1,
        unitPrice,
        amount: unitPrice, // quantity=1の初回はunitPriceそのもの (nullならnullのまま)
        detectionIds: [detection.id],
      })
    }

    // --- 積算明細: 数量集約なし。Detection 1件 = 1行 ---
    // 品名(itemName)は独立した品名DB列ではなく、積算コードMaster画面
    // (EstimateMasterPicker.tsx)がタブ名として表示しているのと全く同じ変換
    // (`getCategoryPresentation(category).label`)を再利用する (明細遷移後の
    // BBox残留・Hover色・品名列修正 指示3章)。estimate_master_items.category
    // (半角カナ・半角中点混在の内部値)をそのまま出さず、Master Picker側の
    // タブ表示名と常に同じ文字列になるようにし、表示文字列を別途ハードコードして
    // 二重管理しない。categoryがnullの場合は空文字列が返るため、既存の
    // "-"表示規則に合わせてnullへ変換する。
    // 型式(model)・定格(rating)は積算集約の`content`と異なり、6カラム表示のため
    // 列ごとに分離して保持する。
    const categoryLabel = getCategoryPresentation(detection.master_item_category).label
    detailItems.push({
      id: String(detection.id),
      detectionId: detection.id,
      drawingPageId: detection.drawing_page_id,
      pageNo,
      targetId,
      source,
      masterItemId,
      code,
      itemName: categoryLabel.trim() !== '' ? categoryLabel : null,
      model,
      rating,
      status: detection.status,
      // editedAt/editSequenceはこの関数が関知しないFrontendセッション内の状態
      // (積算明細強化・Undo/Redo・要確認警告・編集追従 指示1章)。App.tsx側が
      // 実際の値を上書きする前提の既定値(未編集扱い)としてここではnull/0を置く。
      editedAt: null,
      editSequence: 0,
    })
  }

  const targets: EstimateTarget[] = [
    { id: PRODUCT_TARGET_ID, type: 'product', name: '製品全体', banMenno: null, banNo: null },
    ...Array.from(panelTargetsByKey.values()).sort((a, b) => (a.banMenno ?? 0) - (b.banMenno ?? 0)),
  ]
  if (tieDetectionIds.length > 0) {
    targets.push({ id: TIE_TARGET_ID, type: 'tie', name: TIE_TARGET_NAME, banMenno: null, banNo: null })
  }

  return { targets, lineItems: Array.from(lineItems.values()), detailItems }
}
