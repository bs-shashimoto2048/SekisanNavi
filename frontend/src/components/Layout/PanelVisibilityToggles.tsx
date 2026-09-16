import './PanelVisibilityToggles.css'

interface Props {
  panelInfoVisible: boolean
  onTogglePanelInfo: () => void
  aggregationVisible: boolean
  onToggleAggregation: () => void
  detailVisible: boolean
  onToggleDetail: () => void
}

/**
 * floating panel(盤情報・積算集約・積算明細)の表示トグル群 (Issue #19
 * Phase 4)。
 *
 * Phase 2ではViewer右上に独立したfloating toggle barとして浮かせていたが、
 * 追加UI修正指示により、Undo/Redoボタンと同じ編集ツールバー
 * (`app-layout__edit-toolbar`)の右端へ移動した。ボタン自体の機能・
 * `aria-pressed`によるON/OFF表現は変更していない。
 *
 * 表示順は左から「盤情報」「積算集約」「積算明細」の固定順(指示通り)。
 * トグル状態自体はセッション内のみで保持し、localStorageへは永続化しない。
 */
export function PanelVisibilityToggles({
  panelInfoVisible,
  onTogglePanelInfo,
  aggregationVisible,
  onToggleAggregation,
  detailVisible,
  onToggleDetail,
}: Props) {
  return (
    <div className="panel-visibility-toggles">
      <button
        type="button"
        className="panel-visibility-toggles__button"
        aria-pressed={panelInfoVisible}
        onClick={onTogglePanelInfo}
      >
        盤情報{panelInfoVisible ? 'を隠す' : 'を表示'}
      </button>
      <button
        type="button"
        className="panel-visibility-toggles__button"
        aria-pressed={aggregationVisible}
        onClick={onToggleAggregation}
      >
        積算集約{aggregationVisible ? 'を隠す' : 'を表示'}
      </button>
      <button
        type="button"
        className="panel-visibility-toggles__button"
        aria-pressed={detailVisible}
        onClick={onToggleDetail}
      >
        積算明細{detailVisible ? 'を隠す' : 'を表示'}
      </button>
    </div>
  )
}
