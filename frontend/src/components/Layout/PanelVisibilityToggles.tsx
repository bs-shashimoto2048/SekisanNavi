import './PanelVisibilityToggles.css'

interface Props {
  /** [Issue #31] Viewer内「操作ガイド」floating panelの表示トグル。既存4panel
   * (業務情報の表示・操作)とは役割が異なるクイックリファレンスのため、
   * 一覧の先頭・専用のニュートラルなグレー系配色+区切り線で分離する。 */
  guideVisible: boolean
  onToggleGuide: () => void
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
  /** [Issue #40 Phase 3] 図面情報。新しいBBox作成の主導線であり、既存の
   * 部品台帳(masterVisible)と並ぶ「作業ツール」グループの一員として配置する。 */
  drawingEvidenceVisible: boolean
  onToggleDrawingEvidence: () => void
}

/**
 * floating panel(操作ガイド・盤情報・積算集約・積算明細・積算コードMaster)の
 * 表示トグル群 (Issue #19 Phase 4、Issue #31で操作ガイドを追加)。
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
 * 別グループとして配置する。
 *
 * [Issue #31] Viewer内「操作ガイド」も同様に、業務情報を表示する3panel・
 * 作業ツールの部品台帳のいずれとも異なる役割(操作方法のクイックリファレンス)
 * であるため、一覧の**先頭**に区切り線を挟んで独立配置する。既定は非表示
 * (`guideVisible=false`)。
 *
 * [Issue #34] 5ボタンはそれぞれ個別のkind別識別色を持つ
 * (`.panel-visibility-toggles__button--panelInfo`(blue)/`--aggregation`
 * (purple)/`--detail`(indigo/blue-violet)/`--tool`(部品台帳、navy/slate)/
 * `--guide`(gray))。以前は盤情報・積算集約・積算明細の3つが同じviolet系を
 * 共有していたが、対応するFloatingPanelのタイトルバー・外枠と同じ色に
 * 揃えるため分離した。色の値そのものはこのCSSファイルにはハードコードせず、
 * `FloatingPanel.css`の`:root`が定義するcustom property
 * (`--panel-theme-<kind>-*`)を直接参照する(値の定義箇所を1つに保つ)。
 */
export function PanelVisibilityToggles({
  guideVisible,
  onToggleGuide,
  panelInfoVisible,
  onTogglePanelInfo,
  aggregationVisible,
  onToggleAggregation,
  detailVisible,
  onToggleDetail,
  masterVisible,
  onToggleMaster,
  drawingEvidenceVisible,
  onToggleDrawingEvidence,
}: Props) {
  return (
    <div className="panel-visibility-toggles">
      <button
        type="button"
        className="panel-visibility-toggles__button panel-visibility-toggles__button--guide"
        aria-pressed={guideVisible}
        title={guideVisible ? '操作ガイドを隠す' : '操作ガイドを表示'}
        onClick={onToggleGuide}
      >
        操作ガイド
      </button>
      <span className="panel-visibility-toggles__divider" aria-hidden="true" />
      <button
        type="button"
        className="panel-visibility-toggles__button panel-visibility-toggles__button--panelInfo"
        aria-pressed={panelInfoVisible}
        title={panelInfoVisible ? '盤情報を隠す' : '盤情報を表示'}
        onClick={onTogglePanelInfo}
      >
        盤情報
      </button>
      <button
        type="button"
        className="panel-visibility-toggles__button panel-visibility-toggles__button--aggregation"
        aria-pressed={aggregationVisible}
        title={aggregationVisible ? '積算集約を隠す' : '積算集約を表示'}
        onClick={onToggleAggregation}
      >
        積算集約
      </button>
      <button
        type="button"
        className="panel-visibility-toggles__button panel-visibility-toggles__button--detail"
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
      {/* [Issue #40 Phase 3] 新しいBBox作成の主導線。部品台帳と同じ
          「作業ツール」グループに並べる(区切り線の追加はしない)。 */}
      <button
        type="button"
        className="panel-visibility-toggles__button panel-visibility-toggles__button--drawingEvidence"
        aria-pressed={drawingEvidenceVisible}
        title={drawingEvidenceVisible ? '図面情報を隠す' : '図面情報を表示'}
        onClick={onToggleDrawingEvidence}
      >
        図面情報
      </button>
    </div>
  )
}
