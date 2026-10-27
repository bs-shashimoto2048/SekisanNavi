import type { EstimateTarget } from '../../types/estimateAggregation'
import { ALL_OPTION_VALUE, targetOptionLabel } from '../../domain/estimateTargetLabel'
import './TargetSelector.css'

interface Props {
  targets: EstimateTarget[]
  /** 現在選択中の対象。nullは「総合計」(フィルタなし、全対象合算)を表す。 */
  selectedTargetId: string | null
  onSelectTarget: (targetId: string | null) => void
}

/**
 * 「対象」(総合計/製番仕様/各盤/要確認)を選ぶ共通プルダウン。
 *
 * **統合の経緯**: 以前は積算集約(`EstimateAggregation`)と積算明細
 * (`EstimateDetail`)がそれぞれ同じ`targets`/`selectedTargetId`を共有する
 * `<select>`を個別に描画しており、見た目は2箇所、選択状態の実体はApp.tsx側の
 * 1つのstateという「同じものを操作する入口が2つある」状態だった。指示により
 * 重複をなくし、この共通componentへ一本化した。選択肢・集計/絞り込みロジック・
 * 保存データ/API値はいずれも変更していない(App.tsxが一元管理する
 * `selectedEstimateTargetId`をそのまま共有するだけ)。
 *
 * **配置場所**: 指示によりボタン群の右端とする
 * (`PanelVisibilityToggles`内、「部品台帳」ボタンの次)。積算集約・積算明細の
 * どちらが非表示(floating panel OFF)でも対象を切り替えられるよう、常時
 * 表示される編集ツールバー側に置く。
 *
 * **Viewer連動中の強調表示**: 旧`EstimateAggregation`側の select が持っていた
 * 「個別盤選択中は外側リングで強調する」視覚効果(指示8章「Viewer連動中の
 * 対象表示」)をそのまま引き継ぐ(`selectedTargetId != null`で判定、
 * 旧実装と同じ条件)。
 */
export function TargetSelector({ targets, selectedTargetId, onSelectTarget }: Props) {
  const isTargetFocused = selectedTargetId != null

  return (
    <label className="target-selector__label">
      対象
      <select
        className={'target-selector__select' + (isTargetFocused ? ' target-selector__select--focused' : '')}
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
  )
}
