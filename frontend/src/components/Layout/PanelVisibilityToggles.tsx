import './PanelVisibilityToggles.css'

interface Props {
  /** [Issue #31] Viewer内「操作ガイド」floating panelの表示トグル。既存4panel
   * (業務情報の表示・操作)とは役割が異なるクイックリファレンスのため、
   * 一覧の末尾・専用のニュートラルなグレー系配色+区切り線で分離する
   * (Issue #40 Phase 6-Cで先頭→末尾へ配置を変更、下記コンポーネントdoc参照)。 */
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
  /** [Issue #40 Phase 3] 図面情報。新しいBBox作成の主導線であり、Phase 6-Cで
   * 新ワークフローの起点として一覧の先頭へ配置する。 */
  drawingEvidenceVisible: boolean
  onToggleDrawingEvidence: () => void
}

/**
 * floating panel(図面情報・盤情報・積算集約・積算明細・部品台帳・操作ガイド)の
 * 表示トグル群 (Issue #19 Phase 4、Issue #31で操作ガイドを追加、
 * Issue #40 Phase 6-Cで表示順を新ワークフロー準拠へ整理)。
 *
 * Phase 2ではViewer右上に独立したfloating toggle barとして浮かせていたが、
 * 追加UI修正指示により、Undo/Redoボタンと同じ編集ツールバー
 * (`app-layout__edit-toolbar`)の右端へ移動した。
 *
 * **[Issue #40 Phase 6-C] 表示順**: 「図面を見る→図面情報を選ぶ→BBox作成→
 * 積算結果確認」という主操作フローに沿って、左から
 * 図面情報 / 盤情報 / 積算集約 / 積算明細 / 部品台帳 / 操作ガイド の順へ
 * 整理した(指示2章)。新UIの主導線である「図面情報」を先頭、業務情報を表示する
 * 3panel(盤情報/積算集約/積算明細)を中央、旧来の直接コード選択である
 * 「部品台帳」を補助ツールとして後方、操作方法のクイックリファレンスである
 * 「操作ガイド」を末尾に配置する。トグル状態自体はセッション内のみ保持し、
 * localStorageへは永続化しない。
 *
 * 追加UI修正指示(ボタン文言・配色): 旧来は「盤情報を隠す/盤情報を表示」の
 * ように文言でON/OFFを切り替えていたが冗長なため廃止し、ボタン表示文字は
 * 常に固定ラベルにした。ON/OFF状態は`aria-pressed`と専用配色
 * (PanelVisibilityToggles.css、Undo/Redo等の通常操作ボタンとは異なる色調)
 * のみで表現する。
 *
 * [Issue #34] 6ボタンはそれぞれ個別のkind別識別色を持つ
 * (`.panel-visibility-toggles__button--panelInfo`(blue)/`--aggregation`
 * (purple)/`--detail`(indigo/blue-violet)/`--tool`(部品台帳、navy/slate)/
 * `--drawingEvidence`/`--guide`(gray))。色の値そのものはこのCSSファイルには
 * ハードコードせず、`FloatingPanel.css`の`:root`が定義するcustom property
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
      {/* [Issue #40 Phase 6-C] 新しいBBox作成の主導線。新ワークフローの起点
          として一覧の先頭に配置する。 */}
      <button
        type="button"
        className="panel-visibility-toggles__button panel-visibility-toggles__button--drawingEvidence"
        aria-pressed={drawingEvidenceVisible}
        title={drawingEvidenceVisible ? '図面情報を隠す' : '図面情報を表示'}
        onClick={onToggleDrawingEvidence}
      >
        図面情報
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
          内部命名は変更していない)。[Issue #40 Phase 6-C] 新ワークフローでは
          補助ツールの位置づけのため、業務情報3panelより後方へ配置する。 */}
      <button
        type="button"
        className="panel-visibility-toggles__button panel-visibility-toggles__button--tool"
        aria-pressed={masterVisible}
        title={masterVisible ? '部品台帳を隠す' : '部品台帳を表示'}
        onClick={onToggleMaster}
      >
        部品台帳
      </button>
      <span className="panel-visibility-toggles__divider" aria-hidden="true" />
      {/* [Issue #31][Issue #40 Phase 6-C] 操作方法のクイックリファレンスで
          あるため、一覧の末尾に配置する。 */}
      <button
        type="button"
        className="panel-visibility-toggles__button panel-visibility-toggles__button--guide"
        aria-pressed={guideVisible}
        title={guideVisible ? '操作ガイドを隠す' : '操作ガイドを表示'}
        onClick={onToggleGuide}
      >
        操作ガイド
      </button>
    </div>
  )
}
