import './PanelVisibilityToggles.css'

interface Props {
  panelInfoVisible: boolean
  onTogglePanelInfo: () => void
  aggregationVisible: boolean
  onToggleAggregation: () => void
  detailVisible: boolean
  onToggleDetail: () => void
  /** [追加修正: 積算コードMasterのfloating panel化] 情報系3panelとは別枠
   * (視覚的な区切り + ツール系配色)で表示ON/OFFを切り替える。 */
  masterVisible: boolean
  onToggleMaster: () => void
}

/**
 * floating panel(盤情報・積算集約・積算明細・積算コードMaster)の表示
 * トグル群 (Issue #19 Phase 4)。
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
 *
 * [追加修正: 積算コードMasterのfloating panel化] 積算コードMasterは
 * 「表示情報」の3panelとは異なり、BBox追加操作へ直接つながる「作業ツール」
 * であるため、区切り線(`.panel-visibility-toggles__divider`)を挟んで
 * 別グループとして配置し、専用のslate系配色
 * (`.panel-visibility-toggles__button--tool`)を与える。
 */
export function PanelVisibilityToggles({
  panelInfoVisible,
  onTogglePanelInfo,
  aggregationVisible,
  onToggleAggregation,
  detailVisible,
  onToggleDetail,
  masterVisible,
  onToggleMaster,
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
      <span className="panel-visibility-toggles__divider" aria-hidden="true" />
      {/* [追加修正: UI名称変更] ユーザー向け表示名を「積算コードMaster」から
          「部品台帳」へ変更した(props名`masterVisible`/`onToggleMaster`等の
          内部命名は変更していない)。 */}
      <button
        type="button"
        className="panel-visibility-toggles__button panel-visibility-toggles__button--tool"
        aria-pressed={masterVisible}
        title={masterVisible ? '部品台帳を隠す' : '部品台帳を表示'}
        onClick={onToggleMaster}
      >
        部品台帳
      </button>
    </div>
  )
}
