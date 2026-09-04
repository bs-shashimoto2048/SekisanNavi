import { useMemo, useState } from 'react'
import type { EstimateLineItem, EstimateTarget } from '../../types/estimateAggregation'
import { formatTargetLabel } from '../../domain/estimateTargetLabel'
import { CollapsibleSectionHeading } from '../Layout/CollapsibleSectionHeading'
import { EstimateConfirmationAction } from './EstimateConfirmationAction'
import './EstimateAggregation.css'

/** 対象セレクトの「総合計」を表す値。実対象(製品全体/各盤/要確認)のidとは
 * 衝突しない空文字を使い、`onSelectTarget`にはnullを渡す (総合計は実データ上の
 * 分類バケットではなく「フィルタなし」というUI上の見方であるため、
 * `domain/estimateAggregationReal.ts`側には実体を持たせない)。 */
const ALL_OPTION_VALUE = ''

// Sekisan Navi PR #2 追加修正指示(積算集約テーブルにソート機能を追加) 6章/13章:
// 積算明細(EstimateDetail)の既存ソートUI/挙動(1回目クリック=昇順・2回目=降順、
// ▲/▼表示)をそのまま踏襲する。ただしソート状態自体は積算明細と完全に独立させる
// (14章)ため、型・stateともにこのコンポーネント内に閉じて持ち、積算明細側とは
// 一切共有しない。
type AggregationSortColumn = 'code' | 'content' | 'unitPrice' | 'quantity' | 'amount'
type SortDirection = 'asc' | 'desc'

const COLUMN_DEFS: { column: AggregationSortColumn; label: string; className: string }[] = [
  { column: 'code', label: 'コード', className: 'estimate-aggregation__col-code' },
  { column: 'content', label: '内容', className: 'estimate-aggregation__col-content' },
  { column: 'unitPrice', label: '単価(暫定)', className: 'estimate-aggregation__col-price' },
  { column: 'quantity', label: '数量', className: 'estimate-aggregation__col-qty' },
  { column: 'amount', label: '金額', className: 'estimate-aggregation__col-amount' },
]

// 「内容」列は積算明細(EstimateDetail)の`naturalCollator`と同じ設定
// (日本語ロケール・数字を数値として比較)を使う (4章/16章: 既存の日本語比較実装を
// 再利用し、独自の比較方式を新設しない)。積算明細側のインスタンスは
// モジュール非公開のため、同じ設定で新たにインスタンスを作る(ロジックの複製ではなく
// 設定の再利用)。
const naturalCollator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })

/** コードの数値安全な比較 (4章)。積算明細の`compareItems`内'code'caseと同じロジック
 * (数値として解釈できる場合は数値比較、できない場合のみ文字列比較にfallbackする)。
 * 例: "2" < "10" < "100" が文字列比較(lexicographic)だと崩れるため、数値比較を優先する。 */
function compareCode(codeA: string, codeB: string): number {
  const numA = Number(codeA)
  const numB = Number(codeB)
  if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB
  return codeA.localeCompare(codeB, 'ja')
}

/**
 * 積算集約の行をソートする。表示専用の処理であり、
 * `domain/estimateAggregationReal.ts`側の対象絞り込み→masterItemId:source集約→
 * 数量・金額確定というロジックは一切変更しない(12章: ソートは常に集約確定後の
 * 行配列に対して行う、集約そのものへは関与しない)。
 *
 * - 同値時は常にコード昇順にtie-breakする (15章: 再描画のたびに順序が
 *   不定にならないようにするための安定順序)。tie-break自体はソート方向に関わらず
 *   常に昇順にする(降順ソート中でも、同値グループの内部順序が毎回変わらないための
 *   固定基準として使うだけで、tie-break自体を「降順」にする意味はないため)。
 * - 単価・金額はnull(Master側に単価が無い等)を許容する列のため、
 *   「昇順・降順どちらでも欠損値は常に末尾」(17章)を満たすよう、値ありグループと
 *   値なしグループへ分けてから別々にソートし、最後に結合する
 *   (単純に基準比較を反転するだけの実装だと降順時にnullが先頭に来てしまうため、
 *   意図的にこの二段構成にしている)。
 */
function sortAggregationItems(
  items: EstimateLineItem[],
  column: AggregationSortColumn,
  direction: SortDirection,
): EstimateLineItem[] {
  const sign = direction === 'asc' ? 1 : -1

  function withTieBreak(
    cmp: (a: EstimateLineItem, b: EstimateLineItem) => number,
  ): (a: EstimateLineItem, b: EstimateLineItem) => number {
    return (a, b) => {
      const primary = cmp(a, b)
      if (primary !== 0) return sign * primary
      return compareCode(a.code, b.code)
    }
  }

  if (column === 'unitPrice' || column === 'amount') {
    const getValue = (item: EstimateLineItem): number | null => (column === 'unitPrice' ? item.unitPrice : item.amount)
    const withValue = items.filter((item) => getValue(item) != null)
    const withoutValue = items.filter((item) => getValue(item) == null)
    withValue.sort(withTieBreak((a, b) => (getValue(a) as number) - (getValue(b) as number)))
    // 欠損値同士は昇順/降順を問わず常にコード昇順 (17章: 末尾に固定するための
    // 内部順序であり、ここでも降順方向を反映させる意味はない)。
    withoutValue.sort((a, b) => compareCode(a.code, b.code))
    return [...withValue, ...withoutValue]
  }

  const copy = [...items]
  if (column === 'code') {
    copy.sort((a, b) => sign * compareCode(a.code, b.code))
  } else if (column === 'content') {
    copy.sort(withTieBreak((a, b) => naturalCollator.compare(a.content, b.content)))
  } else {
    // quantity: 常に非nullのためnull分離は不要。
    copy.sort(withTieBreak((a, b) => a.quantity - b.quantity))
  }
  return copy
}

interface Props {
  targets: EstimateTarget[]
  /** 対象別に数量集約した行(個別盤/製品全体/要確認を選んでいる間、対象idで
   * 絞り込んで使う)。 */
  lineItems: EstimateLineItem[]
  /** 「総合計」専用に、対象を横断してmasterItemId+情報源単位で再集約した行
   * (Sekisan Navi 追加修正指示: 積算集約の数量集約 6章)。`targetId`は常にnull。 */
  totalLineItems: EstimateLineItem[]
  /** 現在選択中の対象。nullは「総合計」(フィルタなし、全対象合算)を表す。
   * 積算明細(③)・Viewer盤フォーカスと共有する状態のため、App.tsxで一元管理し、
   * ここへcontrolledで渡す。 */
  selectedTargetId: string | null
  onSelectTarget: (targetId: string | null) => void
  /** Issue #6: 見出しクリックでの開閉状態。App.tsxが保持するcontrolled state
   * (盤情報↔積算集約↔積算明細の高さ配分をApp.tsx側のwrapper divで切り替える
   * 必要があるため)。積算対象選択・ソート状態・Undo/Redo等、他のロジックには
   * 一切接続しない独立したUI状態。 */
  collapsed?: boolean
  onToggleCollapsed?: () => void
  /** Issue #4 Phase B-3: 積算確定操作のボタンに使う、現在Viewerで開いている
   * 実製番。積算確定は対象セレクトの選択状態とは無関係に常に製番全体が対象の
   * ため、既存の`selectedTargetId`とは別に受け取る(意味を混同しない)。 */
  productNo?: string | null
}

function formatCurrency(amount: number): string {
  return `${amount.toLocaleString('ja-JP')}円`
}

function formatNumber(value: number): string {
  return value.toLocaleString('ja-JP')
}

interface AmountSum {
  total: number
  /** 単価がMaster側に無く(null)、合計へ含められなかった明細の件数
   * (0円として黙って合算しない。推測で埋めず不足を報告する)。 */
  unknownCount: number
}

function sumAmounts(items: EstimateLineItem[]): AmountSum {
  let total = 0
  let unknownCount = 0
  for (const item of items) {
    if (item.amount == null) {
      unknownCount += 1
      continue
    }
    total += item.amount
  }
  return { total, unknownCount }
}

/** 対象セレクトの選択肢ラベル。盤の選択肢には必ず面番号/盤番号/盤名称を表示し、
 * 盤名称だけにはしない。 */
function targetOptionLabel(target: EstimateTarget): string {
  if (target.type === 'panel' && target.banMenno != null && target.banNo != null) {
    return `面番号 ${target.banMenno} / 盤番号 ${target.banNo} : ${target.name}`
  }
  return target.name
}

/** 上部金額表示のラベル (積算対象連動の金額表示・図面一覧絞り込み 指示1章)。
 * 「総合計」以外を選択している間に「製番合計」のまま表示すると全製番の合計と
 * 誤認しうるため、選択中の対象に応じてラベル自体を切り替える。個別盤は
 * 盤名称だけだと同名盤と区別できないため、面番号/盤番号という実識別子を必ず含める
 * (指示1章: 「面1 / 盤1 小計」のように対象が一意に分かる表現を優先)。
 * ラベルの共通部分は`formatTargetLabel`(積算明細強化・Undo/Redo・要確認警告・
 * 編集追従 指示9章の所属変更通知と共有)へ切り出し、二重管理しない。 */
function headerAmountLabel(selectedTargetId: string | null, target: EstimateTarget | null): string {
  if (selectedTargetId == null) return '製番合計'
  return `${formatTargetLabel(target)} 小計`
}

/**
 * 右ペイン②「積算集約」領域 (積算金額・単価・数量を確認する場所)。
 *
 * **役割の分離**: ここは金額を確認する場所であり、「どの図面のどの位置を
 * 根拠にしているか」を追跡する役割は右ペイン③「積算明細」(`EstimateDetail`)が
 * 担う。両者を混同しない。
 *
 * **対象の切替はセレクト方式**: `<select>`で総合計/製品全体/各盤を切り替える。
 * 盤の選択肢は表示文字列ではなく`target.id`(実識別子、`panel:面番号:盤番号`形式)
 * で内部判定する。個別盤を選択すると、中央ViewerもApp.tsx側でその盤へ絞り込まれる
 * (盤フォーカス・積算明細再設計 指示1章)。
 *
 * **「製品全体」の独立性**: 「製品全体」は各盤の合計ではなく、どの盤BBoxとも
 * 交差しなかった積算コードのみの独立集計 (BBox所属判定ロジックは変更していない)。
 * 「総合計」は製品全体+全盤(要確認を含む)の単純合算であり、対象別の再集計ではなく
 * 対象フィルタを外して全明細を単純合算するだけ。
 *
 * **`単価`列は暫定表示**: `estimate_master_items.total_price_a`(総合価格A)を
 * そのまま使っているが、業務上正式な「単価」と確定した値ではないため、列見出しに
 * 「(暫定)」を明示する。
 *
 * **上部金額表示は選択中の対象に連動する** (積算対象連動の金額表示・図面一覧絞り込み
 * 指示1章/2章)。総合計(全対象合算)を選択中は従来通り「製番合計」、それ以外は
 * 「製品全体 小計」「面X / 盤Y 小計」のように対象専用のラベル+金額を表示し、
 * 全製番合計と誤認されないようにする。この金額は表下部にあった旧`小計`と全く同じ
 * 計算(`visibleItems`の合算)を1箇所で行った結果を使い回しているだけで、
 * 上下で別々に再計算していない (指示2章: 計算ロジックは1つのまま)。旧`小計`表示は
 * この上部表示と完全に重複するため削除した (指示2章の整理方針A)。
 *
 * **タイトル・上部金額・対象セレクト・表ヘッダを固定し、表データ行のみを
 * 内部スクロールする** (盤フォーカス・積算明細再設計 指示5章)。`<thead>`に
 * `position:sticky`を使い、上部金額は`<table>`の外(スクロール領域の外)に置くことで
 * 確実に常時見えるようにしている。
 */
export function EstimateAggregation({
  targets,
  lineItems,
  totalLineItems,
  selectedTargetId,
  onSelectTarget,
  collapsed = false,
  onToggleCollapsed = () => {},
  productNo = null,
}: Props) {
  // ソート列/方向は「ユーザーが選んだ表示上の好み」であり、対象切替(総合計/製品全体/
  // 個別盤/要確認)やBBox編集によるデータ更新とは無関係のため、積算明細と同様に
  // このコンポーネント自身のuseStateとして持つ (9章/10章/11章: 対象切替・データ更新の
  // どちらでもリセットされない。親の再描画では値は保持される)。初期値はコード昇順
  // (3章/8章)。
  const [sortColumn, setSortColumn] = useState<AggregationSortColumn>('code')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const totalCodeCount = lineItems.reduce((sum, item) => sum + item.detectionIds.length, 0)

  const targetNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of targets) map.set(t.id, t.name)
    return map
  }, [targets])

  // Sekisan Navi 追加修正指示(積算集約の数量集約) 6章: 「総合計」選択時
  // (selectedTargetId===null)は対象別`lineItems`を単純結合するのではなく、
  // 対象を横断して既にmasterItemId+情報源単位で集約済みの`totalLineItems`を使う。
  // これにより、同一積算コードが複数の盤にまたがっていても総合計では1行にまとまる。
  // 個別盤/製品全体/要確認を選択している間は、従来どおり対象別`lineItems`を
  // 対象idで絞り込む(この時点で既に対象内で数量集約済みのため、絞り込むだけでよい)。
  const visibleItems = useMemo(
    () =>
      selectedTargetId == null ? totalLineItems : lineItems.filter((item) => item.targetId === selectedTargetId),
    [lineItems, totalLineItems, selectedTargetId],
  )
  // 上部金額表示 (旧: 「製番合計」固定 + 表下部の「対象別小計」の2箇所) を
  // この1つの計算へ統合した (指示2章/3章)。総合計選択時はvisibleItems===lineItems
  // (全対象)になるため、従来の「製番合計」と数値上も完全に一致する。
  const { total: headerAmount, unknownCount: headerUnknownCount } = useMemo(
    () => sumAmounts(visibleItems),
    [visibleItems],
  )
  const selectedTarget = targets.find((t) => t.id === selectedTargetId) ?? null
  const headerLabel = headerAmountLabel(selectedTargetId, selectedTarget)
  // Viewerが現在この対象へフォーカスしている(=個別盤を選択中)ことをセレクト自体の
  // 見た目でも示す (指示8章「Viewer連動中の対象表示」)。
  const isViewerFocused = selectedTarget != null

  // ソートは常にvisibleItems(対象絞り込み・数量集約が確定した後の行配列)に対して
  // 行う (12章)。上部金額表示(headerAmount)はsumAmounts(visibleItems)のままで、
  // 表示順を変えても合計自体は変わらない(24章: 並び替えは表示順のみに影響し、
  // 数量・金額・製番合計には一切影響しない)。
  const sortedItems = useMemo(
    () => sortAggregationItems(visibleItems, sortColumn, sortDirection),
    [visibleItems, sortColumn, sortDirection],
  )

  function handleHeaderClick(column: AggregationSortColumn) {
    if (column === sortColumn) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  return (
    <section className="estimate-aggregation">
      <div className="estimate-aggregation__fixed-top">
        <CollapsibleSectionHeading
          title="積算集約"
          collapsed={collapsed}
          onToggle={onToggleCollapsed}
          headingClassName="estimate-aggregation__heading"
        />

        {/* Issue #4 Phase B-3: 積算確定ボタンは、積算コード0件の場合の空表示
            (下記totalCodeCount===0分岐)とは無関係に常に表示する(0件確定を
            UI側で独自に禁止しない方針のため。あえてtotalCodeCountの条件の外に置く)。 */}
        {!collapsed && <EstimateConfirmationAction productNo={productNo} />}

        {/* Issue #6: 折りたたみ時は見出しだけを残し、本文(製番合計・対象セレクト・
            要確認警告・表)はすべて非表示にする。積算対象の選択状態(selectedTargetId)
            自体はApp.tsx側で保持されたまま変化しない。 */}
        {!collapsed && (
          totalCodeCount === 0 ? (
            <p className="estimate-aggregation__empty">現在の製番に付加されている積算コードがありません</p>
          ) : (
            <>
              <div className="estimate-aggregation__grand-total">
                {headerLabel}
                {headerUnknownCount > 0 && (
                  <span className="estimate-aggregation__warn"> (単価未設定 {headerUnknownCount}件を含まず)</span>
                )}{' '}
                <strong>{formatCurrency(headerAmount)}</strong>
              </div>
              <div className="estimate-aggregation__summary">
                <span>
                  積算コード <strong>{totalCodeCount}</strong>件
                </span>
              </div>

              <label className="estimate-aggregation__target-select-label">
                対象
                <select
                  className={
                    'estimate-aggregation__target-select' +
                    (isViewerFocused ? ' estimate-aggregation__target-select--focused' : '')
                  }
                  value={selectedTargetId ?? ALL_OPTION_VALUE}
                  onChange={(e) => onSelectTarget(e.target.value === ALL_OPTION_VALUE ? null : e.target.value)}
                >
                  <option value={ALL_OPTION_VALUE}>総合計</option>
                  {targets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {targetOptionLabel(target)}
                    </option>
                  ))}
                </select>
              </label>

              {selectedTarget?.type === 'tie' && (
                <p className="estimate-aggregation__warn estimate-aggregation__warn--block">
                  根拠BBoxが複数の盤と同じ交差面積で重なっており、機械的に一意の盤へ決定
                  できませんでした。実図面を確認し、手動で判断してください。
                </p>
              )}
            </>
          )
        )}
      </div>

      {!collapsed && totalCodeCount > 0 && (
        <>
          <div className="estimate-aggregation__table-scroll">
            <table className="estimate-aggregation__table">
              <thead>
                <tr>
                  {COLUMN_DEFS.map(({ column, label, className }) => {
                    const isActive = sortColumn === column
                    return (
                      <th
                        key={column}
                        className={className}
                        aria-sort={isActive ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                      >
                        <button
                          type="button"
                          className="estimate-aggregation__sort-button"
                          onClick={() => handleHeaderClick(column)}
                          aria-label={`${label}でソート`}
                        >
                          {label}
                          {isActive && (
                            <span className="estimate-aggregation__sort-indicator">
                              {sortDirection === 'asc' ? '▲' : '▼'}
                            </span>
                          )}
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedItems.length === 0 && (
                  <tr>
                    <td className="estimate-aggregation__empty-cell" colSpan={5}>
                      明細がありません
                    </td>
                  </tr>
                )}
                {sortedItems.map((item) => (
                  <tr key={item.id}>
                    <td className="estimate-aggregation__col-code">{item.code}</td>
                    <td className="estimate-aggregation__col-content">
                      {/* 対象バッジは「この行がどの対象に属するか」を示すためのもの。
                          個別盤/製品全体/要確認を選択中の行は対象idを持つが、対象自体が
                          表示上部で既に分かっているため出さない(従来どおり)。「総合計」
                          は対象を横断して集約した行(item.targetId===null)のため、
                          単一の対象を代表できずバッジ自体を出さない(Sekisan Navi
                          追加修正指示: 積算集約の数量集約 14章「単一Detectionへ
                          persistent selectionするような挙動にはしない」の趣旨に沿い、
                          誤解を招くバッジ表示はしない)。 */}
                      {item.targetId != null && targetNameById.has(item.targetId) && (
                        <span className="estimate-aggregation__badge estimate-aggregation__badge--target">
                          {targetNameById.get(item.targetId)}
                        </span>
                      )}
                      <span className="estimate-aggregation__content-text">{item.content}</span>
                    </td>
                    <td className="estimate-aggregation__col-price">
                      {item.unitPrice != null ? formatCurrency(item.unitPrice) : '未設定'}
                    </td>
                    <td className="estimate-aggregation__col-qty">{formatNumber(item.quantity)}</td>
                    <td className="estimate-aggregation__col-amount">
                      {item.amount != null ? formatCurrency(item.amount) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="estimate-aggregation__fixed-bottom">
            <p className="estimate-aggregation__footnote">
              ※単価は積算コードMasterの「総合価格A」を暫定的に表示しています。正式な価格仕様として確定した値ではありません。
            </p>
          </div>
        </>
      )}
    </section>
  )
}
