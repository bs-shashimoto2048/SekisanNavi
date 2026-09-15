import './FloatingPanelToggleBar.css'

interface Props {
  aggregationVisible: boolean
  onToggleAggregation: () => void
  detailVisible: boolean
  onToggleDetail: () => void
}

/**
 * Viewer右上に常設する、floating panel(積算集約・積算明細)の表示トグルバー
 * (Issue #19 Phase 2: 上位のメニュー/トグルから各情報表示を個別にON/OFF
 * できるようにする)。
 *
 * トグル状態自体はセッション内のみで保持し、localStorageへは永続化しない
 * (Phase 2指示: 「レイアウト設定のlocalStorageの永続化」は今回非対象)。
 * ボタンの文言自体でON/OFFの現在状態と次の動作を示すため、`aria-pressed`
 * (状態)に加えて視覚的なON/OFF表現(`.floating-panel-toggle-bar__button`の
 * `[aria-pressed="true"]`)も付与する。
 */
export function FloatingPanelToggleBar({
  aggregationVisible,
  onToggleAggregation,
  detailVisible,
  onToggleDetail,
}: Props) {
  return (
    <div className="floating-panel-toggle-bar">
      <button
        type="button"
        className="floating-panel-toggle-bar__button"
        aria-pressed={aggregationVisible}
        onClick={onToggleAggregation}
      >
        積算集約{aggregationVisible ? 'を隠す' : 'を表示'}
      </button>
      <button
        type="button"
        className="floating-panel-toggle-bar__button"
        aria-pressed={detailVisible}
        onClick={onToggleDetail}
      >
        積算明細{detailVisible ? 'を隠す' : 'を表示'}
      </button>
    </div>
  )
}
