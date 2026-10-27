import type { EstimateTarget } from '../../types/estimateAggregation'
import { TargetSelector } from './TargetSelector'
import './PanelVisibilityToggles.css'

interface Props {
  /** [Issue #31] Viewer内「操作ガイド」floating panelの表示トグル。既存4panel
   * (業務情報の表示・操作)とは役割が異なるクイックリファレンスのため、
   * 専用のニュートラルなグレー系配色+区切り線で他と分離する。[追加修正:
   * ヘッダーボタン群の並び替え]指示により一覧の一番左へ配置する
   * (Issue #40 Phase 6-Cで先頭→末尾、今回の指示で再び先頭へ。下記
   * コンポーネントdoc参照)。 */
  guideVisible: boolean
  onToggleGuide: () => void
  /** [追加修正: 図面情報パネルの表示内容] このvisible/toggleの実体
   * (`App.tsx`側のstate名・`<FloatingPanel kind="panelInfo">`配下で
   * `<PanelInfo>`を表示する、という配線)は変更していないが、ボタンの
   * ラベルは旧「盤情報」から「図面情報」へ変更した(指示により旧「盤情報」
   * パネルの内容をこの「図面情報」の表示内容として移す。専用のボタンだった
   * 「盤情報」自体は廃止する)。 */
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
  /** [Issue #40 Phase 3] 図面情報タイプ選択+新しいBBox作成の主導線。
   * [追加修正: 図面情報パネルの表示内容] このvisible/toggleの実体・配線
   * (`<FloatingPanel kind="drawingEvidence">`配下で`<DrawingEvidencePanel>`を
   * 表示する)は変更していないが、旧「盤情報」パネルの内容が「図面情報」の
   * 名を引き継いだことに伴い、ボタンのラベルは「図面情報追加」へ変更した
   * (BBox作成機能・`selectedEvidenceTypeKey`/`evidence_type_key`の配線・
   * 参照するマスタ/候補データはいずれも維持)。 */
  drawingEvidenceVisible: boolean
  onToggleDrawingEvidence: () => void
  /** [追加修正: 対象プルダウンの統合] 積算集約・積算明細で重複していた
   * 「対象」選択プルダウンを1つにまとめ、常時表示されるこのツールバー側に
   * 置く(積算集約・積算明細どちらのfloating panelが非表示でも対象を
   * 切り替えられるようにするため)。[追加修正: ヘッダーボタン群の並び替え]
   * 指示により、配置場所は当初の「図面情報」ボタンの位置からボタン群の
   * 一番右端へ変更した。選択肢・集計/絞り込みロジックはApp.tsx側で
   * 一元管理する既存の`selectedEstimateTargetId`をそのまま共有するだけで、
   * ここでは変更しない。 */
  targets: EstimateTarget[]
  selectedTargetId: string | null
  onSelectTarget: (targetId: string | null) => void
}

/**
 * floating panel(図面情報・図面情報追加・積算集約・積算明細・部品台帳・
 * 操作ガイド)の表示トグル群 (Issue #19 Phase 4、Issue #31で操作ガイドを追加、
 * Issue #40 Phase 6-Cで表示順を新ワークフロー準拠へ整理)。
 *
 * Phase 2ではViewer右上に独立したfloating toggle barとして浮かせていたが、
 * 追加UI修正指示により、Undo/Redoボタンと同じ編集ツールバー
 * (`app-layout__edit-toolbar`)の右端へ移動した。
 *
 * [追加修正: 図面情報パネルの表示内容] 旧「盤情報」専用ボタンは廃止した。
 * 旧「盤情報」パネル(`PanelInfo.tsx`、表示データ・取得・切替ロジックは不変)の
 * 内容は、このボタン群では「図面情報」という名前で表示する。旧「図面情報」
 * パネル(`DrawingEvidencePanel.tsx`、図面情報タイプ選択+BBox作成の入口、
 * ロジックは不変)は「図面情報追加」という名前に変わった。`visible`/`onToggle`
 * propの実体(`panelInfoVisible`→`PanelInfo`、`drawingEvidenceVisible`→
 * `DrawingEvidencePanel`という配線)自体は変更していない。2つのpanelが同時に
 * 開いていても、互いに表示内容が重複することはない(別々の情報を持つ)。
 *
 * **表示順**: [Issue #40 Phase 6-C]で「図面を見る→図面情報を選ぶ→BBox作成→
 * 積算結果確認」という主操作フローに沿って整理した後、[追加修正: ヘッダー
 * ボタン群の並び替え]指示で「操作ガイド」を一番左へ、「対象」プルダウン
 * (積算集約・積算明細で重複していた選択リストを統合したもの、
 * `TargetSelector`参照)をボタン群の一番右端へ移動した。現在の並びは
 * 操作ガイド / 図面情報 / 図面情報追加 / 積算集約 / 積算明細 / 部品台帳 /
 * 対象 。「図面情報」(盤情報を見る)→「図面情報追加」(新しい図面情報タイプを
 * 選んでBBoxを足す)という読み順になるよう隣接させている。「操作ガイド」が
 * 操作方法のクイックリファレンスという他と性質の異なる位置づけであること、
 * 「対象」が特定のpanelに属さない横断的な選択状態であることは変わらないため、
 * それぞれの隣に区切り線を保って視覚的に分離している。トグル状態自体は
 * セッション内のみ保持し、localStorageへは永続化しない。
 *
 * 追加UI修正指示(ボタン文言・配色): 旧来は「盤情報を隠す/盤情報を表示」の
 * ように文言でON/OFFを切り替えていたが冗長なため廃止し、ボタン表示文字は
 * 常に固定ラベルにした。ON/OFF状態は`aria-pressed`と専用配色
 * (PanelVisibilityToggles.css、Undo/Redo等の通常操作ボタンとは異なる色調)
 * のみで表現する。
 *
 * [Issue #34] 6ボタンはそれぞれ個別のkind別識別色を持つ
 * (`.panel-visibility-toggles__button--panelInfo`(blue、現「図面情報」)/
 * `--aggregation`(purple)/`--detail`(indigo/blue-violet)/`--tool`
 * (部品台帳、navy/slate)/`--drawingEvidence`(green、現「図面情報追加」)/
 * `--guide`(gray))。ボタンのラベル変更に伴いkind名と表示名が一致しなくなったが、
 * 色の定義箇所(`FloatingPanel.css`の`:root`、`--panel-theme-<kind>-*`)を
 * 1つに保つことを優先し、kind名自体は変更していない(各ボタンは自分自身が
 * 開く`FloatingPanel`と常に同じ色のまま)。
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
  targets,
  selectedTargetId,
  onSelectTarget,
}: Props) {
  return (
    <div className="panel-visibility-toggles">
      {/* [追加修正: ヘッダーボタン群の並び替え] 指示により「操作ガイド」を
          一番左へ移動した(以前は末尾、Issue #31/Phase 6-C当時の「クイック
          リファレンスのため末尾」という位置づけ自体は変えていない。区切り線を
          右側へ付け直すことで、グレー系配色+区切り線による視覚的な分離は
          維持する)。 */}
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
      {/* [追加修正: 図面情報パネルの表示内容] 旧「盤情報」パネル(`PanelInfo`)の
          内容を表示するボタン。表示データ・取得・切替ロジックは不変。専用
          ボタンだった「盤情報」は廃止し、このボタンがその役割を引き継ぐ。 */}
      <button
        type="button"
        className="panel-visibility-toggles__button panel-visibility-toggles__button--panelInfo"
        aria-pressed={panelInfoVisible}
        title={panelInfoVisible ? '図面情報を隠す' : '図面情報を表示'}
        onClick={onTogglePanelInfo}
      >
        図面情報
      </button>
      {/* [追加修正: 図面情報パネルの表示内容] 旧「図面情報」パネル
          (`DrawingEvidencePanel`、図面情報タイプ選択+新しいBBox作成の主導線)。
          ロジックは不変、ボタンのラベルのみ「図面情報追加」に変更した。 */}
      <button
        type="button"
        className="panel-visibility-toggles__button panel-visibility-toggles__button--drawingEvidence"
        aria-pressed={drawingEvidenceVisible}
        title={drawingEvidenceVisible ? '図面情報追加を隠す' : '図面情報追加を表示'}
        onClick={onToggleDrawingEvidence}
      >
        図面情報追加
      </button>
      <span className="panel-visibility-toggles__divider" aria-hidden="true" />
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
      {/* [追加修正: ヘッダーボタン群の並び替え] 指示により「対象」プルダウンを
          ボタン群の一番右端へ移動した(以前は「図面情報」ボタンの位置)。
          選択肢・集計/絞り込みロジック・App.tsx側の共有stateはいずれも
          変更していない。 */}
      <TargetSelector targets={targets} selectedTargetId={selectedTargetId} onSelectTarget={onSelectTarget} />
    </div>
  )
}
