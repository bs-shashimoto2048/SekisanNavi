// 右ペイン下部「積算集約」「積算明細」のデータモデル。
//
// `types/domain.ts`には入れず、あえてこのファイルへ分離している理由は従来と同じ:
// `domain.ts`はBackend APIのJSONと直接対応する型のみを置く場所であり、このファイルの
// 型は複数の実APIレスポンス(Detection・PanelPreview・EstimateMasterItem等)を
// Frontend側で組み合わせて導出した派生データであって、単一のBackendエンドポイントの
// レスポンス型そのものではないため区別している。

import type { DetectionStatus } from './domain'

/** 積算対象の種類。
 *
 * - `product`: 製品全体 (どの盤BBoxとも交差しなかった積算コードの集計)。
 * - `panel`: 個別の盤 (根拠BBoxが盤BBoxと交差面積を持つ積算コードの集計)。
 *   同一の物理盤(面番号+盤番号)は、複数の図面(ページ)にまたがって存在しても
 *   1つの対象として扱う (次々work指示: 積算集約・積算明細UI再構成)。
 * - `tie`: 複数の盤と同一の最大交差面積で並び、機械的に一意へ決定できなかった
 *   積算コードの集計 (「そのケースを報告する」ための専用バケット)。
 */
export type EstimateTargetType = 'product' | 'panel' | 'tie'

/** 積算対象 (製品全体 / 各盤 / 要確認)。
 *
 * 重要: `type: 'product'`(製品全体)は他の対象(盤)の集計結果ではなく、
 * どの盤BBoxとも交差しなかった積算コードのみを集めた独立対象である。
 * 製番総積算金額は「製品全体の積算金額 + 各盤の個別積算金額の合計」であり、
 * 製品全体を他対象から再集計することは決して行わない。
 */
export interface EstimateTarget {
  id: string
  type: EstimateTargetType
  name: string
  /** `type === 'panel'`の場合のみ設定する実識別子 (次々work指示3章:
   * 「面番号 X / 盤番号 Y : 盤名称」という選択肢表示に使う。表示文字列を
   * キーとして使わず、この実識別子で内部判定する)。 */
  banMenno: number | null
  banNo: number | null
}

/** 情報源。実データのDetection.source_type('ai'|'manual')から直接判定できる値
 * のみを使う (実データから判定できないものを仮に割り当てない)。旧プロトタイプ
 * にあった'design_data'はDetectionに対応する実フィールドが無いため廃止した。 */
export type EstimateSource = 'ai' | 'manual'

/** 積算明細1行 = 「対象×情報源×積算コード(masterItemId)」の集約単位
 * (積算集約側の数量集約キー。詳細は`estimateAggregationReal.ts`のコメント参照)。
 *
 * Sekisan Navi 追加修正指示(積算集約の数量集約)により、対象別集約
 * (`targetId`が実在する対象を指す。個別盤/製品全体/要確認の各対象を選んだ時に使う)
 * に加えて、対象を横断して1つのmasterItemIdへさらに束ねた「総合計」専用の行
 * (`targetId === null`)も同じ型で表現する。`targetId`がnullの行は複数の対象に
 * またがる合算であり、単一の対象バッジを持たない。 */
export interface EstimateLineItem {
  /** 対象別行: `${targetId}:${masterItemId}:${source}`。
   * 総合計行(対象横断): `${masterItemId}:${source}` (targetIdを含まない)。 */
  id: string
  /** 対象別行では実在する対象のid。総合計行(対象を横断して合算した行)では
   * 単一の対象を代表できないためnull。 */
  targetId: string | null
  source: EstimateSource
  /** 積算コードMaster(estimate_master_items)の行id。同一行への複数Detectionの
   * 参照をquantityとして束ねる際のキーの一部として使う。 */
  masterItemId: number
  /** 積算コード (Detection.master_item_code、無ければclass_nameへfallback)。 */
  code: string
  /** 分類 (Detection.master_item_category)。実データに無い場合はnull。 */
  category: string | null
  /** 型式 / 定格等の識別情報。`${model} / ${rating}`の形式。値が無い項目は
   * 省略し、両方無ければcodeを使う。 */
  content: string
  /** 同一対象内で同一masterItemId・同一sourceのDetectionが複数あった件数。 */
  quantity: number
  /** 積算コードMaster.total_price_a(総合価格A)をそのまま使う (次々work指示10章:
   * 正式な「単価」として確定した値ではない暫定表示)。値がMaster側に無い(null)
   * 場合はnullのまま保持し、0や推測値で埋めない。 */
  unitPrice: number | null
  /** unitPrice × quantity。unitPriceがnullの場合はamountもnull (金額不明を
   * 明示する。0円と混同しない)。 */
  amount: number | null
  /** この明細行を構成する実Detection.idの一覧 (追跡確認用)。 */
  detectionIds: number[]
}

/** 積算明細1行 = Detection(根拠BBox)1件そのもの。積算集約(`EstimateLineItem`)と
 * 異なり、同一コードでも数量集約せず、1 Detection = 1行を原則とする
 * (「どの図面のどの箇所に付けられた情報か」を追跡できるようにするため)。
 *
 * 表示列は品名/コード/型式/定格/図面/状態の6列 (盤フォーカス・積算明細再設計
 * 指示2章)。`content`(型式+定格の結合文字列、積算集約向け)ではなく、列ごとに
 * 分離した`model`/`rating`を持つ。 */
export interface EstimateDetailItem {
  /** DetectionのidをそのままString化したもの (一覧のkeyにも使う)。 */
  id: string
  detectionId: number
  /** ダミーDB側のDrawingPage.id。Viewerナビゲーション(`onNavigateReference`、
   * 既存EstimateTreeと同じ関数)へそのまま渡す。 */
  drawingPageId: number
  /** 実ページ番号 (製番+この値でどの図面かが分かる)。 */
  pageNo: number
  targetId: string
  source: EstimateSource
  masterItemId: number
  /** 積算コード。 */
  code: string
  /** 品名。独立した品名DB列ではなく、積算コードMaster画面(EstimateMasterPicker.tsx)
   * のタブ名称(`estimate_master_items.category`を`getCategoryPresentation`で
   * 表示名変換したもの)を再利用している (明細遷移後のBBox残留・Hover色・品名列
   * 修正 指示3章)。categoryが無い場合のみnull ("-"表示)。 */
  itemName: string | null
  /** 型式 (Detection.master_item_model)。 */
  model: string | null
  /** 定格 (estimate_master_items.rating)。 */
  rating: string | null
  /** 実データのDetection.status (pending/reviewed/needs_review/excluded)。
   * 積算集約とは異なり、ここでは実データの値をそのまま見せる (捏造しない)。
   * 表示側で○/△/×の3記号へ変換する (`EstimateDetail.tsx`参照)。 */
  status: DetectionStatus
  /** このDetectionが最後に編集された日時 (epoch ms)。Backend側に永続的な編集日時が
   * 存在しないため、Frontendセッション内でのみ記録する「編集順」であり、
   * 「更新日時」ではない (積算明細強化・Undo/Redo・要確認警告・編集追従 指示1章)。
   * このセッション中に一度も編集されていない場合はnull。App.tsx側で
   * `estimateAggregationData.detailItems`へ後付けするため、
   * `estimateAggregationReal.ts`はこの値の存在を一切関知しない。 */
  editedAt: number | null
  /** 編集順を表す単調増加の通し番号 (App.tsxが管理するセッション内カウンタ)。
   * 日時が同一秒に複数回編集された場合の順序を保つため、ソートは基本的に
   * この値を使う。未編集の行は0。 */
  editSequence: number
}

/** `EstimateAggregation`/`EstimateDetail`コンポーネントが受け取るデータ全体。 */
export interface EstimateAggregationData {
  targets: EstimateTarget[]
  /** 対象別に数量集約した行(`targetId`が実在する対象を指す)。個別盤/製品全体/
   * 要確認のいずれかを選択している間、`EstimateAggregation`はこちらを対象idで
   * 絞り込んで表示する。 */
  lineItems: EstimateLineItem[]
  /** 「総合計」(対象フィルタなし)専用に、全対象を横断してmasterItemId+情報源単位で
   * 再集約した行(`targetId`は常にnull)。Sekisan Navi 追加修正指示(積算集約の
   * 数量集約)6章: 「総合計」でも同一積算コードを1行にまとめ、数量・金額を
   * 対象横断で合算するために追加した。`lineItems`を対象で絞り込んだ結果を単純結合
   * するのではなく、この専用行を使うことで、同じmasterItemIdが複数の盤に
   * またがる場合でも1行にまとまる。 */
  totalLineItems: EstimateLineItem[]
  detailItems: EstimateDetailItem[]
}
