// 積算集約(右ペイン②)をEstimateResultベースで組み立てるロジック (Issue #40 Phase 5)。
//
// Phase 4までの`estimateAggregationReal.ts`(Detectionベース)は積算明細
// 「全て/AI/設計情報/マニュアル」タブ向けに残すが、積算集約(このファイル)は
// Phase 5方針(積算結果の正本はEstimateResult)に合わせてこちらへ切り替える。
//
// **集約軸** (Phase 5指示3章): 対象(盤/製品全体)× コード。数量は
// `EstimateResult.quantity`をそのままSUMする(既存rule evaluatorの
// quantity算定結果を尊重し、ここで数量を再算定しない。指示3章の
// 「1台×3成立→数量3」等は、評価器が既にその通りの`quantity`を持つ
// EstimateResult行を複数/1件生成済みであることを前提に、単純合算だけで
// 正しい値になる)。
//
// **要確認(旧'tie')バケット**: `status === 'needs_review'`の結果は、
// 本来の対象(盤/製品全体)の行へは混ぜず、専用の「要確認」対象バケットへ
// まとめる(盤所属が機械的に一意へ決定できなかった場合、または新旧経路が
// 同一コードを算出し一意に統合できなかった場合の両方を含む。Phase 5指示13章
// 「一意に判断できない場合は要確認として残す」)。旧`__tie__`と同じtarget id/
// 表示上の型(`type: 'tie'`)を再利用し、既存のUI警告表示
// (`EstimateAggregation.tsx`の`selectedTarget?.type === 'tie'`分岐)を
// そのまま使う。ただし「総合計」には引き続き含める(旧`tie`検出時の既存挙動
// (`totalLineItems`は対象を問わず合算)を踏襲し、意図しない仕様変更をしない)。
//
// **対象一覧(`targets`)は既存の`estimateAggregationReal.ts`が算出した
// 盤一覧をそのまま流用する**(呼び出し側から`baseTargets`として渡す)。
// EstimateResultの有無だけから対象一覧を作ると、現時点でコードが1件も
// 付いていない盤が「対象」セレクトの選択肢から消えてしまい、既存の
// 「どの盤にも(空でも)対象として切り替えられる」体験を後退させてしまう
// ため、盤の実在判定自体は変更しない(product_df由来の盤一覧はDetectionの
// 有無に関わらず確定しているため)。 */
import type { EstimateMasterItem, EstimateResult } from '../types/domain'
import type { EstimateLineItem, EstimateTarget } from '../types/estimateAggregation'

export const PRODUCT_TARGET_ID = 'product'
export const TIE_TARGET_ID = '__tie__'
export const TIE_TARGET_NAME = '要確認（盤所属が確定できない、または新旧コードが重複）'

function panelTargetId(banMenno: number, banNo: number): string {
  return `panel:${banMenno}:${banNo}`
}

/** 対象別に絞り込んで使う`lineItems`と、総合計専用の`totalLineItems`。
 * 既存の`EstimateAggregation`コンポーネントへそのまま渡せるよう、
 * `types/estimateAggregation.ts`の型をそのまま再利用する。 */
export interface EstimateResultAggregationData {
  targets: EstimateTarget[]
  lineItems: EstimateLineItem[]
  totalLineItems: EstimateLineItem[]
}

interface BuildParams {
  results: EstimateResult[]
  masterItemById: Map<number, EstimateMasterItem>
  /** 対象(盤/製品全体)一覧の元データ。既存`estimateAggregationReal.ts`の
   * `buildRealEstimateAggregation(...).targets`をそのまま渡す想定
   * (`type: 'tie'`の要素は無視して、このモジュール自身が算出した
   * needs_reviewバケットへ差し替える)。 */
  baseTargets: EstimateTarget[]
}

function targetIdFor(result: EstimateResult): string {
  if (result.status === 'needs_review') return TIE_TARGET_ID
  if (result.target_panel_ban_menno != null && result.target_panel_ban_no != null) {
    return panelTargetId(result.target_panel_ban_menno, result.target_panel_ban_no)
  }
  return PRODUCT_TARGET_ID
}

function buildContent(result: EstimateResult, master: EstimateMasterItem | null): string {
  const model = master?.model?.trim() || null
  const rating = master?.rating?.trim() || null
  const parts = [model, rating].filter((v): v is string => !!v)
  return parts.length > 0 ? parts.join(' / ') : result.code
}

function accumulate(
  map: Map<string, EstimateLineItem>,
  key: string,
  targetId: string | null,
  result: EstimateResult,
  master: EstimateMasterItem | null,
) {
  const existing = map.get(key)
  if (existing) {
    existing.quantity += result.quantity
    existing.detectionIds.push(...result.evidence.map((e) => e.detection_id).filter((id): id is number => id != null))
    // 指示10章: 0円として合算しない。グループ内に1件でもprice=NULLがあれば、
    // そのグループのamount自体をNULLにする(合計不明であることを明示する)。
    existing.amount = existing.amount == null || result.price == null ? null : existing.amount + result.price
    return
  }
  map.set(key, {
    id: key,
    targetId,
    source: 'manual',
    masterItemId: result.master_item_id ?? -1,
    code: result.code,
    category: master?.category ?? null,
    content: buildContent(result, master),
    quantity: result.quantity,
    unitPrice: result.unit_price,
    amount: result.price,
    detectionIds: result.evidence.map((e) => e.detection_id).filter((id): id is number => id != null),
  })
}

/**
 * EstimateResult一覧から積算集約データ(対象別`lineItems`・総合計専用
 * `totalLineItems`・対象一覧`targets`)を組み立てる。
 *
 * 金額の集約(Phase 5指示10章): `EstimateResult.price`(既に
 * `unit_price × quantity × current_factor`で計算済み)をそのままSUMする。
 * priceがNULLの結果が1件でも含まれるグループは、そのグループの`amount`を
 * NULLにする(0円として合算しない。呼び出し側の`EstimateAggregation`が
 * 既存の「単価未設定」表示でNULL件数を明示する)。
 */
export function buildEstimateResultAggregation({
  results,
  masterItemById,
  baseTargets,
}: BuildParams): EstimateResultAggregationData {
  const lineItems = new Map<string, EstimateLineItem>()
  const totalLineItems = new Map<string, EstimateLineItem>()
  let hasNeedsReview = false

  for (const result of results) {
    const master = result.master_item_id != null ? (masterItemById.get(result.master_item_id) ?? null) : null
    const targetId = targetIdFor(result)
    if (targetId === TIE_TARGET_ID) hasNeedsReview = true

    const key = `${targetId}:${result.master_item_id ?? result.code}`
    accumulate(lineItems, key, targetId, result, master)

    const totalKey = `${result.master_item_id ?? result.code}`
    accumulate(totalLineItems, totalKey, null, result, master)
  }

  const targets: EstimateTarget[] = baseTargets.filter((t) => t.type !== 'tie')
  if (hasNeedsReview) {
    targets.push({ id: TIE_TARGET_ID, type: 'tie', name: TIE_TARGET_NAME, banMenno: null, banNo: null })
  }

  return {
    targets,
    lineItems: Array.from(lineItems.values()),
    totalLineItems: Array.from(totalLineItems.values()),
  }
}
