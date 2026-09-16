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
 * (`app-layout__edit-toolbar`)の右端へ移動した。
 *
 * 表示順は左から「盤情報」「積算集約」「積算明細」の固定順(指示通り)。
 * トグル状態自体はセッション内のみで保持し、localStorageへは永続化しない。
 *
 * 追加UI修正指示(ボタン文言・配色): 旧来は「盤情報を隠す/盤情報を表示」の
 * ように文言でON/OFFを切り替えていたが冗長なため廃止し、ボタン表示文字は
 * 常に固定ラベル(「盤情報」「積算集約」「積算明細」)にした。ON/OFF状態は
 * `aria-pressed`と専用配色(PanelVisibilityToggles.css、Undo/Redo等の
 * 通常操作ボタンとは異なる色調)のみで表現する。
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
        title={panelInfoVisible ? '盤情報を隠す' : '盤情報を表示'}
        onClick={onTogglePanelInfo}
      >
        盤情報
      </button>
      <button
        type="button"
        className="panel-visibility-toggles__button"
        aria-pressed={aggregationVisible}
        title={aggregationVisible ? '積算集約を隠す' : '積算集約を表示'}
        onClick={onToggleAggregation}
      >
        積算集約
      </button>
      <button
        type="button"
        className="panel-visibility-toggles__button"
        aria-pressed={detailVisible}
        title={detailVisible ? '積算明細を隠す' : '積算明細を表示'}
        onClick={onToggleDetail}
      >
        積算明細
      </button>
    </div>
  )
}
