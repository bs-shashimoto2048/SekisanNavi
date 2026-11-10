import './PanelBoxCodeSelector.css'
import type { EstimateMasterItem, EstimateResult } from '../../types/domain'
import {
  BOX_SELECTION_STATE_LABEL,
  boxCodeOptionGroups,
  boxItemLabel,
  boxPanelLabel,
  boxSelectionState,
} from '../../domain/boxCodeSelection'

interface Props {
  result: EstimateResult
  masterItemById: Map<number, EstimateMasterItem>
  /** 同じ盤の箱コードを置き換える(行は増えない)。 */
  onChange: (masterItemId: number) => void
  /** 手修正を取り消して自動選定へ戻す。 */
  onReset: () => void
}

/**
 * 箱コード自動選定の行(`result_key = box:面:盤`)のコードセル。
 *
 * 選定状態(自動選定/手修正/要確認)を常に表示し、コードは選択欄で変更できる。盤の見出し直下に、
 * 「箱体 | 状態 | コード選択 | 自動選定に戻す」を折り返さず 1 行で並べる(対象盤はスクリーンリーダー用に
 * 選択欄の aria-label へ持たせ、見出し行が盤を示す)。
 * 選択肢はその盤の品名カテゴリのコードだけ(接続情報が不明な盤は箱3カテゴリすべて)。
 * コード未確定(要確認)の行は、選ぶまで空欄(「コードを選択」)のまま。
 */
export function PanelBoxCodeSelector({ result, masterItemById, onChange, onReset }: Props) {
  const groups = boxCodeOptionGroups(result, masterItemById.values())
  const state = boxSelectionState(result)
  const selectedValue = result.master_item_id != null ? String(result.master_item_id) : ''
  const panel = boxPanelLabel(result)

  return (
    <div className={`estimate-box-code estimate-box-code--${state}`}>
      <span className="estimate-box-code__label">箱体</span>
      <span className="estimate-box-code__state" data-state={state}>
        {BOX_SELECTION_STATE_LABEL[state]}
      </span>
      <select
        className="estimate-box-code__select"
        aria-label={`${panel}の箱コード`}
        value={selectedValue}
        onChange={(e) => {
          const id = Number(e.target.value)
          if (Number.isFinite(id) && e.target.value !== '') onChange(id)
        }}
      >
        {result.master_item_id == null && <option value="">コードを選択</option>}
        {groups.map((group) => (
          <optgroup key={group.category} label={group.category}>
            {group.items.map((item) => (
              <option key={item.id} value={item.id}>
                {boxItemLabel(item)}
              </option>
            ))}
          </optgroup>
        ))}
        {/* 現在のコードが選択肢に無い場合(マスタ未取得など)でも、表示値を失わない。 */}
        {result.master_item_id != null && !groups.some((g) => g.items.some((i) => i.id === result.master_item_id)) && (
          <option value={result.master_item_id}>{result.code}</option>
        )}
      </select>
      {result.code_overridden && (
        <button type="button" className="estimate-box-code__reset" onClick={onReset}>
          自動選定に戻す
        </button>
      )}
    </div>
  )
}
