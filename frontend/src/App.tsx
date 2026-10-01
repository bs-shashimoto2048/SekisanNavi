import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  ApiError,
  createEvidenceDetection,
  createManualDetection,
  deleteDetection,
  evaluateEstimateResults,
  fetchDetectedPreview,
  fetchDetections,
  fetchDrawingPages,
  fetchEstimatePanels,
  fetchEstimateResults,
  fetchMasterItems,
  fetchPanel,
  fetchProductDrawings,
  fetchProjectInfo,
  overrideEstimateResultFactor,
  resetEstimateResultFactor,
  overrideEstimateResultQuantity,
  resetEstimateResultQuantity,
  updateDetectionBBox,
} from './api/client'
import { describeFetchError } from './api/errors'
import {
  TIE_TARGET_ID,
  assignDetectionToPanel,
  buildRealEstimateAggregation,
  resolveAssignmentTargetId,
} from './domain/estimateAggregationReal'
import { visiblePageNosForTarget } from './domain/estimateDrawingFilter'
import { formatTargetLabel } from './domain/estimateTargetLabel'
import { buildEstimateResultAggregation } from './domain/estimateResultAggregation'
import {
  EMPTY_EDIT_HISTORY,
  popRedo,
  popUndo,
  pushCommand,
  rebaseDetectionId,
  type EditCommand,
  type EditHistoryState,
} from './domain/editHistory'
import type {
  DetectedPreviewItem,
  Detection,
  DrawingPage,
  EstimateMasterItem,
  EstimatePanelInfo,
  EstimateResult,
  Panel,
  PanelPreview,
  ProductDrawing,
  ProjectInfo,
} from './types/domain'
import type { DetectionWithPage } from './domain/estimateAggregationReal'
import { shiftLabelWithBBox } from './utils/bbox'
import type { NormalizedRect } from './utils/bbox'
import {
  buildSearchWithProductPage,
  parsePageNoFromSearch,
  parseProductNoFromSearch,
} from './utils/urlState'
import { ProjectHeader } from './components/ProjectHeader/ProjectHeader'
import { DrawingNavigator } from './components/DrawingNavigator/DrawingNavigator'
import { DrawingViewer } from './components/DrawingViewer/DrawingViewer'
import { PanelInfo } from './components/PanelInfo/PanelInfo'
import { EstimateAggregation } from './components/EstimateAggregation/EstimateAggregation'
import { EstimateDetail, type DetailTabFilter } from './components/EstimateDetail/EstimateDetail'
import { EstimateMasterPicker } from './components/EstimateMasterPicker/EstimateMasterPicker'
import { DrawingEvidencePanel } from './components/DrawingEvidencePanel/DrawingEvidencePanel'
import { SystemSettings } from './components/SystemSettings/SystemSettings'
import { ProductSelector } from './components/ProductSelector/ProductSelector'
import { HelpPdfModal } from './components/HelpPdf/HelpPdfModal'
import { DecisionEventHistory } from './components/DecisionEventHistory/DecisionEventHistory'
import { PaneSplitter } from './components/Layout/PaneSplitter'
import { FloatingPanel, type FloatingPanelKind, type FloatingPanelRect } from './components/Layout/FloatingPanel'
import { PanelVisibilityToggles } from './components/Layout/PanelVisibilityToggles'
import { ViewerGuide } from './components/ViewerGuide/ViewerGuide'
import { usePaneWidth } from './hooks/usePaneWidth'
import { useFloatingPanelBgAlpha } from './hooks/useFloatingPanelBgAlpha'
import './App.css'

const HIGHLIGHT_DURATION_MS = 1800
// 所属変更の一時通知 (指示9章) を自動的に消すまでの時間。
const TARGET_CHANGE_NOTIFICATION_DURATION_MS = 4000
// [Issue #40 Phase 3] 積算結果の増減・係数変化を知らせる控えめなtoastを
// 自動的に消すまでの時間(Issue #40 8章「2〜3秒程度」の指示に沿う)。
const RULE_TOAST_DURATION_MS = 2600
// 同時に積み上がるtoastの最大件数(Issue #40 8章「最大数件スタック」)。
// 大量の変化が一度に起きた場合(例: 複数BBoxを連続削除)でも画面を埋め尽くさない。
const RULE_TOAST_MAX_STACK = 4

/** 積算結果の増減・係数変化を知らせるtoast1件分 (Issue #40 8章)。 */
interface RuleToast {
  id: number
  message: string
}

// input/textarea/select/contentEditable上のキー操作かどうかを判定する。
// Delete/Undo(Ctrl+Z)等、ブラウザ・input自身の挙動を不必要に奪わないためのガードとして
// 複数のキーボードショートカット処理から共有する (積算明細強化・Undo/Redo・要確認警告・
// 編集追従 指示6章: 「テキスト入力欄等でブラウザ／input自身のUndoが必要な場合は、
// それを不必要に奪わないようにする」)。
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

// 左ペイン幅 (UIレイアウト追加修正指示 10章)。初期値は変更前レイアウトの
// grid-template-columns (220px) をそのまま踏襲する。
// Issue #19 Phase 4: 右ペインは廃止した(盤情報もfloating panel化したため、
// 右ペイン自体が不要になった)。旧`RIGHT_PANE_*`定数・
// `sekisan-navi:right-pane-width`のlocalStorageキーは削除済み(残さない)。
const LEFT_PANE_INITIAL = 220
const LEFT_PANE_MIN = 140
const LEFT_PANE_MAX_VW_RATIO = 0.3
const LEFT_PANE_STORAGE_KEY = 'sekisan-navi:left-pane-width'

// 下部積算コードMaster領域の高さ (Phase 1.11 指示書24章〜26章)。既存のCSS既定値
// (260px) を初期値として踏襲する。min/maxは「Viewerが実質見えなくなる」
// 「Masterが操作不能になる」高さを避けるための制限 (指示書25章)。
// [追加修正: 積算コードMasterのfloating panel化] 従来はここで
// MASTER_PANE_HEIGHT_*定数(PaneSplitterによる高さ手動リサイズ+localStorage
// 復元)を持っていたが、盤情報/積算集約/積算明細と同じfloating panel
// (ドラッグ移動・リサイズ、セッション内保持)へ移行したため廃止した。

// メイン画面が既定で参照する製番 (Phase 1.8)。デモ用のダミーDetection/Panel/
// EstimateItem (db/seed.py) が実際に紐付けているのと同じ製番であり、
// 起動直後から実PNGサムネイル・実PDF・ダミー積算結果が揃って見える状態にするための
// 初期値。将来的にはシステム設定等へ切り出す余地があるが、Phase 1.8では
// 既存のPhase 1.5デモ製番をそのまま踏襲する (要件を超えた仕組みは作らない)。
const DEFAULT_PRODUCT_NO = 'A1GV2421'

// 初期表示状態の復元 (Phase 1.11 UI改修指示22章)。ブラウザreloadで表示中のプレビューが
// 消える問題への対応として、URL query (`?product=...&page=...`) を優先して使う。
// 実在確認はしない (呼び出し側の各useEffectが実データ取得結果を見て安全にfallbackする。
// 指示書23章: 存在しない場合はアプリを壊さず、先頭ページ等へfallbackする)。
function getInitialProductNo(): string {
  if (typeof window === 'undefined') return DEFAULT_PRODUCT_NO
  return parseProductNoFromSearch(window.location.search) ?? DEFAULT_PRODUCT_NO
}

function getInitialPageNo(): number | null {
  if (typeof window === 'undefined') return null
  return parsePageNoFromSearch(window.location.search)
}

function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  // ダミーDetection/PanelAreaと紐付けるためだけに保持するDB上の図面ページ一覧。
  // Phase 1.8以降、左ペイン(DrawingNavigator)の表示自体はこれではなく実製番の
  // PNGサムネイル(productPages)を使う。積算明細(③)の根拠図面ジャンプ時の
  // 製番/ページ番号の解決、および全ページ分のDetectionをまとめて取得する際の
  // 「ダミーDB page.id -> 実ページ番号」の対応付けにのみ使う。
  const [dbPages, setDbPages] = useState<DrawingPage[]>([])
  // 製番全体・全ページ分のDetection (積算集約・積算明細UI再構成)。旧EstimateTree用
  // だった`fetchEstimateItems()`(Phase 1 seed data)は廃止し、積算集約(②)・
  // 積算明細(③)と同じ実データ源(Detection)を1回のAPI呼び出しで取得する
  // (`fetchDetections()`を引数無しで呼ぶと全ページ分が返る仕様を利用。Backend API
  // 仕様の新設はしていない)。現在ページのみを表示するDetectionOverlay等が使う
  // 既存の`detections` stateとは別に持つ (責務が異なるため)。
  const [allDetections, setAllDetections] = useState<Detection[]>([])
  const [loading, setLoading] = useState(true)
  // 初期読込 (案件/図面一覧/積算結果) の失敗は再読み込み操作を出すため分けて持つ。
  const [initError, setInitError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // それ以外 (選択ページ変更に伴うDetection/PanelArea/Panel取得) の失敗。
  const [error, setError] = useState<string | null>(null)

  // 製番選択・左ペインPNGサムネイル (Phase 1.8)。初期値はURL query (?product=&page=)
  // があれば復元する (Phase 1.11 指示書22章)。
  const [activeProductNo, setActiveProductNo] = useState(getInitialProductNo)
  const [productPages, setProductPages] = useState<ProductDrawing[]>([])
  const [productPagesLoading, setProductPagesLoading] = useState(true)
  const [productPagesError, setProductPagesError] = useState<string | null>(null)
  const [selectedProductPageNo, setSelectedProductPageNo] = useState<number | null>(getInitialPageNo)
  // URLから復元した製番が実在しなかった場合の既定製番への自動fallbackは、
  // 二重発火・無限ループを避けるため1回だけ試みる (指示書23章)。
  const urlFallbackAttempted = useRef(false)

  const [detections, setDetections] = useState<Detection[]>([])
  const [selectedDetectionId, setSelectedDetectionId] = useState<number | null>(null)
  const [highlightedDetectionId, setHighlightedDetectionId] = useState<number | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  // detected_df.csv (YOLO検出結果) 由来の検出BBoxプレビュー (Phase 1.12)。
  // ダミーDB側の対応ページ(matchingDbPage)の有無に関係なく、実製番+実ページ番号
  // だけで取得できる (指示書1章/18章)。既存detections stateとは完全に別で管理する。
  const [detectedPreview, setDetectedPreview] = useState<DetectedPreviewItem[]>([])
  // estcode_df.csv (盤ごとの積算コード基本情報) 由来の盤情報 (Phase 1.14)。PAGE列を
  // 持たない製番単位のデータのため、ページ切替では再取得せず、製番切替時のみ取得する。
  const [estimatePanels, setEstimatePanels] = useState<EstimatePanelInfo[]>([])
  // 積算コードMaster全件 (id引き)。中央プレビューの積算コードHover表示 (次work指示1章)
  // でmaster_item_idから定格(rating)を引くために使う。EstimateMasterPickerも
  // 独自に全件取得しているが、責務が異なるためここでは別途取得する
  // (App.tsx側はHover表示用のMap、EstimateMasterPicker側はMaster一覧UI用)。
  const [masterItemById, setMasterItemById] = useState<Map<number, EstimateMasterItem>>(new Map())

  // 中央Viewerで選択中のproduct_df盤 (Phase 1.9)。Detection/BBoxの選択状態
  // (selectedDetectionId) とは独立した概念として管理する (要件5)。キー単体では
  // 表示側の再取得ができないため、クリック時に受け取ったPanelPreview本体も
  // 合わせて保持する (`panelKey`はページ内での一意性を保証するための識別子)。
  const [selectedPanel, setSelectedPanel] = useState<{ key: string; panel: PanelPreview } | null>(
    null,
  )

  // 積算集約(②)で選択中の対象。積算明細(③)と共有する状態で、nullは「総合計」
  // (フィルタなし)を表す (積算集約・積算明細UI再構成 指示13章: 両者を連動させる)。
  const [selectedEstimateTargetId, setSelectedEstimateTargetId] = useState<string | null>(null)
  // 積算明細(③)の行hover中のDetection id。Viewer側のBBox強調表示
  // (`DetectionOverlay`の`detailHoveredDetectionId`)へそのまま渡す。既存の
  // 引出線hover(`hoveredDetectionId`, DrawingViewer.tsx内で管理)とは別状態として
  // 持つ (指示21章: 混同しない)。
  const [detailHoveredDetectionId, setDetailHoveredDetectionId] = useState<number | null>(null)
  // 積算明細(③)のタブ (Issue #40 Phase 5: 全て/設計データ/図面判定/要確認/
  // 修正あり。判定方法+手修正状態の軸であり、対象(盤/製品全体)の切替とは
  // 独立)。EstimateDetail内部stateではなくApp.tsx側で持つ (Phase 4以前からの
  // controlled化を維持)。
  const [estimateDetailTabFilter, setEstimateDetailTabFilter] = useState<DetailTabFilter>('all')

  // セッション内編集メタ情報 (detectionId -> {編集日時, 編集シーケンス})。
  // Issue #40 Phase 5でEstimateDetailの「編集順」列自体は廃止したが、
  // `bumpEditMeta`呼び出し自体は他のBBox編集操作(移動/削除/Undo/Redo等)の
  // 一部として広く呼ばれ続けているため、呼び出し側を変更せずに済むよう
  // 記録自体は維持する(読み取り側が無いため、読み取り値は使わない)。
  const [, setEditMetaByDetectionId] = useState<
    Map<number, { editedAt: number; editSequence: number }>
  >(new Map())
  // 単調増加の通し番号 (Undo/Redoも含め、実データを変更する操作のたびに+1する)。
  const editSequenceRef = useRef(0)

  function bumpEditMeta(detectionId: number) {
    editSequenceRef.current += 1
    const editSequence = editSequenceRef.current
    const editedAt = Date.now()
    setEditMetaByDetectionId((prev) => {
      const next = new Map(prev)
      next.set(detectionId, { editedAt, editSequence })
      return next
    })
  }

  // Undo/Redo履歴 (指示6章)。実データを変更する編集操作(BBox移動/リサイズ・
  // Detection追加・削除)のみを対象とし、ページ移動・Hover・選択・ソート等は含めない。
  const [editHistory, setEditHistory] = useState<EditHistoryState>(EMPTY_EDIT_HISTORY)

  // 所属変更の一時通知 (指示9章)。nullの間は非表示。
  const [targetChangeNotification, setTargetChangeNotification] = useState<{
    code: string
    model: string | null
    fromLabel: string
    toLabel: string
  } | null>(null)

  const [isSettingsOpen, setSettingsOpen] = useState(false)
  const [isProductSelectorOpen, setProductSelectorOpen] = useState(false)
  // Issue #19 Phase 3: 積算資料PDF Help modal。SystemSettings/ProductSelectorと
  // 同じ「開閉のみを持つ独立したUI状態」で、製番・図面ページ・積算対象・BBox選択等
  // 他のstateには一切触れない(閉じても既存の作業状態を失わない)。
  const [isHelpOpen, setHelpOpen] = useState(false)

  // 積算コードMasterで「Manual BBox追加対象」として選択中のMaster Item (Phase 1.6)。
  const [selectedMasterItemId, setSelectedMasterItemId] = useState<number | null>(null)
  // [Issue #40 Phase 3] 「図面情報」で「BBox追加対象」として選択中のevidence_type_key。
  // `selectedMasterItemId`と同時に選択状態になることはない(一方を選ぶと他方を
  // 解除する。指示: 新UIの主導線ではmaster_item_idを直接選ばせない)。
  const [selectedEvidenceTypeKey, setSelectedEvidenceTypeKey] = useState<string | null>(null)
  // [Issue #40 Phase 3] 現在の積算結果一覧(ルール評価器の最新出力)。
  // BBox追加/削除/移動/resize後にevaluateEstimateResultsを呼び直し、
  // 前後の差分からtoast通知を作る(Issue #40 8章)。積算集約/積算明細UI自体は
  // 引き続き既存の`buildRealEstimateAggregation`(Detection.master_item_id
  // ベース)を使い続けており、この一覧は「差分検知専用」でPhase 3時点では
  // 画面表示には使わない(Phase 4で積算明細への統合を行う)。
  const [estimateResults, setEstimateResults] = useState<EstimateResult[]>([])
  const [ruleToasts, setRuleToasts] = useState<RuleToast[]>([])
  const ruleToastIdRef = useRef(0)

  // 左右ペインの幅 (UIレイアウト追加修正指示)。ドラッグでのリアルタイム変更 +
  // localStorageによる復元を1本のフックへ集約している (hooks/usePaneWidth.ts)。
  const [leftPaneWidth, resizeLeftPaneBy] = usePaneWidth(
    LEFT_PANE_STORAGE_KEY,
    LEFT_PANE_INITIAL,
    LEFT_PANE_MIN,
    LEFT_PANE_MAX_VW_RATIO,
  )
  // [PR #22追加仕様: floating panel透過度を設定画面から調整可能にする]
  // 盤情報/積算集約/積算明細/部品台帳の4panel共通の背景不透明度。
  // SystemSettingsのスライダーで変更し、CSS custom property
  // (`--floating-panel-bg-alpha`、直下`<div className="app-layout">`の
  // inline styleとして設定。下記JSX参照)経由で4panelへ一元反映する。
  const [floatingPanelBgAlpha, setFloatingPanelBgAlpha] = useFloatingPanelBgAlpha()
  // Issue #19 Phase 2: 積算集約・積算明細をViewer上のfloating panelとして個別に
  // 表示/非表示できるようにする。初期値は「既存利用性を損なわない設定」として
  // 両方表示(true)にする(従来の右ペイン常設と同じ見え方から始まる)。
  // セッション内のみのUI状態で、localStorageへは永続化しない(Phase 2指示:
  // レイアウト設定の永続化は今回非対象)。
  // Issue #19 Phase 4: 盤情報も同じ仕組みでfloating panel化する(初期値true)。
  // [追加修正] Issue #6由来の「見出しクリックでの折りたたみ」機能は、3領域とも
  // floating panel化したことに伴い廃止した(表示/非表示はこのstateのみで行う。
  // PanelInfo/EstimateAggregation/EstimateDetail自体からもcollapsed関連の
  // props/状態を削除済み)。
  const [panelInfoFloatingVisible, setPanelInfoFloatingVisible] = useState(true)
  const [estimateAggregationFloatingVisible, setEstimateAggregationFloatingVisible] = useState(true)
  const [estimateDetailFloatingVisible, setEstimateDetailFloatingVisible] = useState(true)
  // [追加修正: 積算コードMasterのfloating panel化] 従来はMainArea下段に
  // PaneSplitterで手動リサイズしながら常設していたが、他3panelと同じ
  // floating panelへ移行した。表示/非表示の考え方(初期値true、セッション内
  // のみ保持)も他3panelと揃える。
  const [estimateMasterFloatingVisible, setEstimateMasterFloatingVisible] = useState(true)
  // [Issue #31] Viewer内「操作ガイド」floating panel。既存4panelとは異なり、
  // 既定は非表示(指示B-4: 「デフォルトは非表示」)。表示ON/OFFの考え方
  // (セッション内のみ保持、localStorage永続化なし)自体は他4panelと揃える。
  const [viewerGuideVisible, setViewerGuideVisible] = useState(false)
  // [Issue #40 Phase 3] 「図面情報」floating panel。新しいBBox作成の主導線だが、
  // 導入初回は既存5panelの右端カスケード積み重ね・初期配置テスト群を不用意に
  // 壊さないよう、guideと同じく既定非表示にする(ユーザーが明示的にONにする)。
  const [drawingEvidenceFloatingVisible, setDrawingEvidenceFloatingVisible] = useState(false)

  // floating panel(盤情報/積算集約/積算明細/積算コードMaster)の位置・大きさ
  // ([追加修正] ドラッグ移動・リサイズ対応)。`FloatingPanel`コンポーネント
  // 自身のstateではなくここへ持ち上げているのは、表示ON/OFF(上記state)で
  // floating panelがunmountされても移動/リサイズ結果をセッション中は保持し
  // 続けるため(指示: 「ユーザーが移動/リサイズした後は、そのセッション中は
  // 状態を保持してください」)。`null`は「まだ初期配置を計算していない」ことを
  // 表し、`FloatingPanel`側が初回描画時にViewerの実際のサイズを見て計算する。
  // localStorageへは永続化しない(指示: 今回はセッション内保持で良い)。
  const [panelInfoRect, setPanelInfoRect] = useState<FloatingPanelRect | null>(null)
  const [aggregationRect, setAggregationRect] = useState<FloatingPanelRect | null>(null)
  const [detailRect, setDetailRect] = useState<FloatingPanelRect | null>(null)
  const [masterRect, setMasterRect] = useState<FloatingPanelRect | null>(null)
  // [Issue #40 Phase 3] 図面情報の位置・大きさ。既存4panelと同じ右端カスケードへ
  // 参加させる(`visibleFloatingKinds`に含める。下記コメント参照)。
  const [drawingEvidenceRect, setDrawingEvidenceRect] = useState<FloatingPanelRect | null>(null)
  // [Issue #31] 操作ガイドの位置・大きさ。右端カスケードの4panelとは独立して
  // 保持する(`visibleFloatingKinds`には含めない。下記コメント参照)。
  const [viewerGuideRect, setViewerGuideRect] = useState<FloatingPanelRect | null>(null)
  // floating panelの位置・大きさのクランプ基準となるコンテナ要素。
  const viewerWrapRef = useRef<HTMLDivElement>(null)

  // [Issue #25] 現在表示中のfloating panel種別一覧(固定の宣言順:
  // 盤情報→積算集約→積算明細→部品台帳)。`FloatingPanel`が「表示ONにした
  // 瞬間、自分より前に何枚表示中か」を数えて初期配置(右端寄せ+積み重ね)の
  // 段数を決めるために使う。表示ON/OFFの4state以外には一切依存しない。
  // [Issue #31] 操作ガイド(`viewerGuideVisible`)はこの配列へ意図的に含めない
  // (右端カスケードの積み重ね対象外、常にViewer左上へ単独配置するため。
  // `FloatingPanel.tsx`の`visibleKinds`コメント参照)。
  const visibleFloatingKinds = useMemo<FloatingPanelKind[]>(() => {
    const kinds: FloatingPanelKind[] = []
    if (panelInfoFloatingVisible) kinds.push('panelInfo')
    if (estimateAggregationFloatingVisible) kinds.push('aggregation')
    if (estimateDetailFloatingVisible) kinds.push('detail')
    if (estimateMasterFloatingVisible) kinds.push('master')
    // [Issue #40 Phase 3] 図面情報も業務情報/作業ツールpanelと同じ右端
    // カスケードへ参加させる(宣言順の末尾に追加。既存4panelの積み重ね段数
    // 計算には一切影響しない、追加のみ)。
    if (drawingEvidenceFloatingVisible) kinds.push('drawingEvidence')
    return kinds
  }, [
    panelInfoFloatingVisible,
    estimateAggregationFloatingVisible,
    estimateDetailFloatingVisible,
    estimateMasterFloatingVisible,
    drawingEvidenceFloatingVisible,
  ])

  // 初期データ読込 (案件情報 / ダミー図面一覧 / 全ページ分のDetection)。
  // `fetchDetections()`を引数無しで呼ぶとDB全件が返る (Backend側の既存の
  // 任意フィルタ仕様をそのまま利用。積算集約・積算明細UI再構成)。
  useEffect(() => {
    setLoading(true)
    setInitError(null)
    // 指示6章: データ再読込時はUndo/Redo履歴・編集順メタ情報をクリアする
    // (再読込後のDetection idは別物として扱われうるため、古い履歴を持ち越さない)。
    setEditHistory(EMPTY_EDIT_HISTORY)
    setEditMetaByDetectionId(new Map())
    editSequenceRef.current = 0
    Promise.all([fetchProjectInfo(), fetchDrawingPages(), fetchDetections()])
      .then(([projectInfo, drawingPages, allDets]) => {
        setProject(projectInfo)
        setDbPages(drawingPages)
        setAllDetections(allDets)
      })
      .catch((e: unknown) =>
        setInitError(describeFetchError(e, '案件情報・図面一覧・積算コード一覧の取得に失敗しました')),
      )
      .finally(() => setLoading(false))
  }, [reloadKey])

  // 製番切替に応じて、左ペイン用のPNGサムネイル一覧(+盤領域Overlay)を取得する
  // (Phase 1.8)。選択中ページが新しい一覧にも存在すればそのまま維持し (要件13章の
  // 根拠図面ジャンプが同じtickで対象ページを指定するケースに対応)、存在しなければ
  // 先頭ページへフォールバックする。
  useEffect(() => {
    setProductPagesLoading(true)
    setProductPagesError(null)
    fetchProductDrawings(activeProductNo)
      .then((drawings) => {
        setProductPages(drawings)
        setSelectedProductPageNo((current) =>
          current != null && drawings.some((d) => d.page_no === current)
            ? current
            : (drawings[0]?.page_no ?? null),
        )
      })
      .catch((e: unknown) => {
        // URL query等から復元した製番が実在しない場合、アプリを壊さず既定製番へ
        // 安全にfallbackする (Phase 1.11 指示書23章)。ユーザーがProductSelector経由で
        // 明示的に選んだ製番は事前に実在確認済みのため通常この経路には来ないが、
        // stale/不正なURLへの耐性として一度だけ試みる (無限ループ防止)。
        if (!urlFallbackAttempted.current && activeProductNo !== DEFAULT_PRODUCT_NO) {
          urlFallbackAttempted.current = true
          setActiveProductNo(DEFAULT_PRODUCT_NO)
          setSelectedProductPageNo(null)
          return
        }
        setProductPages([])
        setProductPagesError(describeFetchError(e, '製番の図面一覧を取得できませんでした'))
      })
      .finally(() => setProductPagesLoading(false))
  }, [activeProductNo])

  // 表示中の製番・PAGEをURL queryへ反映する (Phase 1.11 指示書22章)。pushStateではなく
  // replaceStateを使い、ページ/製番を切り替えるたびにブラウザ履歴を積み増さないように
  // する (通常のページ内操作でブラウザの「戻る」を連打する挙動にはしない)。
  useEffect(() => {
    if (typeof window === 'undefined') return
    const search = buildSearchWithProductPage(
      window.location.search,
      activeProductNo,
      selectedProductPageNo,
    )
    const newUrl = `${window.location.pathname}?${search}${window.location.hash}`
    window.history.replaceState(null, '', newUrl)
  }, [activeProductNo, selectedProductPageNo])

  // 現在選択中の実ページ(製番+ページ番号)に対応する、ダミーDB側のDrawingPage行。
  // Detection/PanelArea/盤パラメータはこのIDを介してのみ取得する。対応するダミー行が
  // 無い場合 (デモ製番以外を閲覧中、またはデモに無いページ) は単純に空表示になる
  // (ダミーデータを無理に紐付けない方針)。
  const matchingDbPage = useMemo(
    () =>
      dbPages.find(
        (p) => p.product_no === activeProductNo && p.source_page_no === selectedProductPageNo,
      ) ?? null,
    [dbPages, activeProductNo, selectedProductPageNo],
  )

  // 選択中の実ページに応じてDetectionを取得。
  // 盤範囲Overlayはダミー(PanelArea)ではなく実データ(product_df由来のpanels、
  // activeProductPage.panels)を中央Viewerへ表示するため、ここでは取得しない
  // (実画面未反映調査・修正指示 8章/11章: 二重表示を避ける)。
  useEffect(() => {
    const dbPageId = matchingDbPage?.id ?? null
    if (dbPageId == null) {
      setDetections([])
      return
    }
    fetchDetections(dbPageId)
      .then((fetched) => {
        setDetections(fetched)
        setError(null) // ページの正常取得時は以前のエラー表示が残っていればクリアする (追加修正 第4ラウンド5章)
      })
      .catch((e: unknown) => setError(describeFetchError(e, '図面上のDetectionを取得できませんでした')))
  }, [matchingDbPage])

  // detected_df.csv由来の検出BBoxプレビューを取得 (Phase 1.12指示書18章)。
  // ダミーDB側の対応ページ(matchingDbPage)には依存せず、実製番+実ページ番号のみで
  // 取得できる (上記のDetection取得effectとは独立)。ページ切替時は必ず一旦空へ
  // リセットしてから取得するため、別ページのBBoxが一瞬でも残ることはない。
  useEffect(() => {
    if (activeProductNo == null || selectedProductPageNo == null) {
      setDetectedPreview([])
      return
    }
    setDetectedPreview([])
    fetchDetectedPreview(activeProductNo, selectedProductPageNo)
      .then(setDetectedPreview)
      .catch((e: unknown) =>
        setError(describeFetchError(e, '検出結果プレビューを取得できませんでした')),
      )
  }, [activeProductNo, selectedProductPageNo])

  // estcode_df.csv由来の盤情報を取得 (Phase 1.14)。PAGE列を持たないデータのため、
  // 製番切替時のみ取得する (ページ切替では再取得しない)。
  useEffect(() => {
    if (activeProductNo == null) {
      setEstimatePanels([])
      return
    }
    fetchEstimatePanels(activeProductNo)
      .then((fetched) => {
        setEstimatePanels(fetched)
        setError(null)
      })
      .catch((e: unknown) => setError(describeFetchError(e, '盤情報を取得できませんでした')))
  }, [activeProductNo])

  // [Issue #40 Phase 3] 製番切替時に既存の積算結果(estimate_results)を取得する。
  // BBox操作の都度は`reevaluateEstimateResults`が評価器を再実行して上書きするため、
  // ここでは起動時/製番切替時の初期表示のみを担う(GETのみ、評価器は実行しない)。
  useEffect(() => {
    if (activeProductNo == null) {
      setEstimateResults([])
      return
    }
    fetchEstimateResults(activeProductNo)
      .then((results) => setEstimateResults(results))
      .catch((e: unknown) => setError(describeFetchError(e, '積算結果を取得できませんでした')))
  }, [activeProductNo])

  // 積算コードMaster全件をid引きのMapとして取得する (次work指示1章)。製番に依存しない
  // マスタデータのため、初回1回だけ取得する (EstimateMasterPicker.tsxの初回全件取得と
  // 同じ`fetchMasterItems({})`呼び出しだが、用途が異なるため別々に取得している)。
  useEffect(() => {
    fetchMasterItems({})
      .then((items) => {
        setMasterItemById(new Map(items.map((item) => [item.id, item])))
      })
      .catch((e: unknown) => setError(describeFetchError(e, '部品台帳を取得できませんでした')))
  }, [])

  // 選択中Detectionに紐づく盤情報を取得
  useEffect(() => {
    const detection = detections.find((d) => d.id === selectedDetectionId)
    if (!detection?.panel_id) {
      setPanel(null)
      return
    }
    fetchPanel(detection.panel_id)
      .then((fetched) => {
        setPanel(fetched)
        setError(null)
      })
      .catch((e: unknown) => setError(describeFetchError(e, '盤パラメータを取得できませんでした')))
  }, [selectedDetectionId, detections])

  const activeProductPage = useMemo(
    () => productPages.find((p) => p.page_no === selectedProductPageNo) ?? null,
    [productPages, selectedProductPageNo],
  )

  const pageLabel = activeProductPage
    ? (activeProductPage.drawing_name ?? `P${activeProductPage.page_no}`)
    : ''

  // 積算集約(②)・積算明細(③)向け: 現在の製番に属するDetectionだけを、
  // どのページ(実ページ番号)由来かを付けて絞り込む (積算集約・積算明細UI再構成)。
  // `allDetections`はDB全件のため、ダミーDB側`dbPages`で現在の製番のページに
  // 限定してから対応付ける。
  const productDetectionEntries = useMemo<DetectionWithPage[]>(() => {
    const pageNoByDbId = new Map(
      dbPages
        .filter((p) => p.product_no === activeProductNo && p.source_page_no != null)
        .map((p) => [p.id, p.source_page_no as number]),
    )
    const entries: DetectionWithPage[] = []
    for (const detection of allDetections) {
      const pageNo = pageNoByDbId.get(detection.drawing_page_id)
      if (pageNo != null) entries.push({ detection, pageNo })
    }
    return entries
  }, [allDetections, dbPages, activeProductNo])

  // ページ番号 -> そのページのPanelPreview[] (BBox所属判定に使う。ページごとの
  // 盤同士でのみ交差判定を行うため)。
  const panelsByPageNo = useMemo(
    () => new Map(productPages.map((p) => [p.page_no, p.panels])),
    [productPages],
  )

  const estimateAggregationData = useMemo(
    () =>
      buildRealEstimateAggregation({
        detections: productDetectionEntries,
        panelsByPageNo,
        estimatePanels,
        masterItemById,
      }),
    [productDetectionEntries, panelsByPageNo, estimatePanels, masterItemById],
  )

  // [Issue #40 Phase 5] 積算集約(②)をEstimateResult基準へ切り替える。対象
  // (盤/製品全体)一覧そのものは、既存の`estimateAggregationData.targets`
  // (product_df由来の盤一覧、Detectionの有無に関わらず確定している)を
  // そのまま再利用し、金額・数量の集約だけをEstimateResultから算出し直す
  // (`estimateResultAggregation.ts`のモジュールコメント参照)。
  const estimateResultAggregationData = useMemo(
    () =>
      buildEstimateResultAggregation({
        results: estimateResults,
        masterItemById,
        baseTargets: estimateAggregationData.targets,
      }),
    [estimateResults, masterItemById, estimateAggregationData.targets],
  )

  // [Issue #40 Phase 5] 積算明細(③)の根拠詳細(AI/手動の区別)表示用。
  const detectionById = useMemo(() => new Map(allDetections.map((d) => [d.id, d])), [allDetections])

  // dbPages由来のdrawingPageId -> 実ページ番号 のMap (積算明細強化・Undo/Redo・
  // 要確認警告・編集追従 指示8章)。Undo/Redoはキーボードショートカットで現在表示中の
  // ページに限らず発火しうるため、対象Detectionの実ページ番号を都度解決できるように
  // 公開しておく(`productDetectionEntries`内部の対応付けと同じもの)。
  const pageNoByDrawingPageId = useMemo(
    () =>
      new Map(
        dbPages
          .filter((p) => p.product_no === activeProductNo && p.source_page_no != null)
          .map((p) => [p.id, p.source_page_no as number]),
      ),
    [dbPages, activeProductNo],
  )


  // [Issue #40 Phase 6-A指示A-1] EstimateResult.status==='needs_review'の件数。
  // 旧Detectionベースの`tieDetailCount`(下記)とは別概念(新旧コード衝突も
  // 含むため)。積算確定ボタンの確定可否判定に使う(Backend側
  // `POST .../estimate-confirmations`も同じ条件でHTTP 422を返すため、
  // ここでの無効化はBackendの検証を前提にした補助的なものに留まる)。
  const estimateResultNeedsReviewCount = useMemo(
    () => estimateResults.filter((r) => r.status === 'needs_review').length,
    [estimateResults],
  )

  // 要確認(BBox所属判定でtieになった項目)の対象と件数 (指示7章)。0件になれば
  // 警告バナーは自動的に非表示になる(JSX側で`tieDetailCount > 0`のみ描画するため)。
  const tieTarget = useMemo(
    () => estimateAggregationData.targets.find((t) => t.type === 'tie') ?? null,
    [estimateAggregationData.targets],
  )
  const tieDetailCount = useMemo(
    () =>
      tieTarget == null
        ? 0
        : estimateAggregationData.detailItems.filter((d) => d.targetId === tieTarget.id).length,
    [estimateAggregationData.detailItems, tieTarget],
  )

  // 積算集約(②)で現在選択中の対象 (総合計の場合はnull)。
  const focusedEstimateTarget = useMemo(
    () => estimateAggregationData.targets.find((t) => t.id === selectedEstimateTargetId) ?? null,
    [estimateAggregationData.targets, selectedEstimateTargetId],
  )

  // 個別盤が選択されている場合のみ、Viewerの盤BBoxをその盤だけへ絞り込む
  // (盤フォーカス・積算明細再設計 指示1章)。製品全体・要確認・総合計選択時は
  // 盤BBox自体は絞り込まない(指示1章: 「盤BBox自体をどう表示するかは、判別の
  // 妨げにならない範囲で既存表示を維持して構わない」)。
  const viewerFocusPanel = useMemo(() => {
    if (focusedEstimateTarget?.type !== 'panel') return null
    if (focusedEstimateTarget.banMenno == null || focusedEstimateTarget.banNo == null) return null
    return { banMenno: focusedEstimateTarget.banMenno, banNo: focusedEstimateTarget.banNo }
  }, [focusedEstimateTarget])

  // 積算コード(master_item_id付きDetection)のリード線・BBox・ラベルを、選択中の
  // 対象に属するものだけへ絞り込む (指示1章)。「総合計」(null)の場合はフィルタ
  // しない。非積算コード(通常のAI検出プレビュー等)は対象の概念を持たないため、
  // 常にそのまま表示する(指示1章の「図面そのものは変更せず表示したまま」の趣旨)。
  const viewerDetections = useMemo(() => {
    if (selectedEstimateTargetId == null) return detections
    const focusedDetectionIds = new Set(
      estimateAggregationData.detailItems
        .filter((d) => d.targetId === selectedEstimateTargetId && d.pageNo === selectedProductPageNo)
        .map((d) => d.detectionId),
    )
    return detections.filter((d) => d.master_item_id == null || focusedDetectionIds.has(d.id))
  }, [detections, selectedEstimateTargetId, estimateAggregationData.detailItems, selectedProductPageNo])

  // [Issue #40 Phase 3] 根拠BBox(selectedDetectionId)→関係する積算結果、の逆引き。
  // `judgment_method=design_data`の積算結果はどのDetectionにも紐付かない
  // (evidence配列が空、またはdetection_idを持つevidenceが無い)ため、ここには
  // 現れない。これは意図的な設計であり、「設計データのみコードはViewer非表示」
  // (Issue #40 Phase 3指示)を、Viewer側で個別に除外処理をせずとも自然に満たす。
  const relatedEstimateResultsForSelectedDetection = useMemo(() => {
    if (selectedDetectionId == null) return []
    return estimateResults.filter((r) => r.evidence.some((ev) => ev.detection_id === selectedDetectionId))
  }, [estimateResults, selectedDetectionId])

  // [Issue #40 Phase 3] 積算結果→根拠BBox強調。既存の`flashDetection`(点滅表示、
  // 選択状態は変更しない)をそのまま再利用し、1件の積算結果が複数の根拠BBoxを
  // 持つ場合は全てを順に強調する。
  function handleFocusResultEvidence(result: EstimateResult) {
    for (const ev of result.evidence) {
      if (ev.detection_id != null) flashDetection(ev.detection_id)
    }
  }

  // [Issue #40 Phase 6-A指示A-1] 確定ボタンの「要確認タブで確認する」リンクから
  // 呼ぶ。要確認行は対象(盤/製品全体)を問わず存在しうるため、積算集約の対象は
  // 「総合計」(フィルタなし)へ戻した上で、積算明細のタブを「要確認」へ切り替える
  // (`needs_confirmation`タブはjudgment_method===needs_confirmationに加え
  // status===needs_reviewの行も対象に含む、EstimateDetail.tsx参照)。
  function handleNavigateToNeedsReview() {
    setSelectedEstimateTargetId(null)
    setEstimateDetailTabFilter('needs_confirmation')
  }

  // [Issue #40 Phase 4/5] 積算明細向けに、選択中の対象(盤/製品全体/総合計/
  // 要確認)へestimateResultsを絞り込む。積算集約(②、
  // `estimateResultAggregation.ts`)の対象分類と同じ規則にする(対象を
  // 切り替えたときに両パネルの内容が食い違わないようにするため)。
  //
  // フィルタ規則(このUI専用の表示上の約束であり、業務ルールを推測して
  // 決めたものではない):
  //   - 総合計(selectedEstimateTargetId === null): 絞り込まない(製番全体、
  //     要確認行も含む。積算集約の総合計と同じ「対象を問わず合算」規則)。
  //   - 要確認(tie、盤所属が一意でない、または新旧コードが重複):
  //     `status === 'needs_review'`の結果のみ。
  //   - 個別盤(focusedEstimateTarget.type === 'panel'): 要確認を除いた上で、
  //     その盤のbanMenno/banNoと一致する結果のみ。
  //   - 製品全体(focusedEstimateTarget.type === 'product'): 要確認を除いた
  //     上で、どの盤にも紐づかない結果(design_data判定等)のみ。
  const estimateResultsForSelectedTarget = useMemo(() => {
    if (selectedEstimateTargetId == null) return estimateResults
    // 要確認バケットは新旧どちらの経路(盤所属tie/コード重複)でも同じ
    // TIE_TARGET_ID文字列を使うため、対象idを直接比較する(旧
    // `estimateAggregationData.targets`にはコード重複由来の要確認は
    // 反映されないため、`focusedEstimateTarget`経由の判定に依存しない)。
    if (selectedEstimateTargetId === TIE_TARGET_ID) {
      return estimateResults.filter((r) => r.status === 'needs_review')
    }
    if (focusedEstimateTarget?.type === 'panel' && viewerFocusPanel != null) {
      return estimateResults.filter(
        (r) =>
          r.status !== 'needs_review' &&
          r.target_panel_ban_menno === viewerFocusPanel.banMenno &&
          r.target_panel_ban_no === viewerFocusPanel.banNo,
      )
    }
    if (focusedEstimateTarget?.type === 'product') {
      return estimateResults.filter((r) => r.status !== 'needs_review' && r.target_panel_ban_menno == null)
    }
    return []
  }, [estimateResults, selectedEstimateTargetId, focusedEstimateTarget, viewerFocusPanel])

  // [Issue #40 Phase 4] 係数の手修正・初期値復元。API呼び出し後、返ってきた
  // 最新の積算結果でestimateResults内の該当行だけを置き換える(reevaluate
  // (評価器の再実行)とは異なり、この操作単体では他の行に影響しないため
  // 全体を再取得しない)。
  async function handleOverrideEstimateResultFactor(result: EstimateResult, newFactor: number) {
    try {
      const updated = await overrideEstimateResultFactor(activeProductNo, result.id, { current_factor: newFactor })
      setEstimateResults((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      setError(null)
    } catch (e) {
      setError(describeFetchError(e, '係数の変更に失敗しました'))
    }
  }

  async function handleResetEstimateResultFactor(result: EstimateResult) {
    try {
      const updated = await resetEstimateResultFactor(activeProductNo, result.id)
      setEstimateResults((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      setError(null)
    } catch (e) {
      setError(describeFetchError(e, '係数の初期値復元に失敗しました'))
    }
  }

  // [Issue #40 Phase 6後半] 数量の手修正・初期値復元。係数の手修正と同じ
  // パターン(更新された行だけをestimateResultsへ反映、全体の再取得はしない)。
  async function handleOverrideEstimateResultQuantity(result: EstimateResult, newQuantity: number, reason: string) {
    try {
      const updated = await overrideEstimateResultQuantity(activeProductNo, result.id, {
        current_quantity: newQuantity,
        reason,
      })
      setEstimateResults((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      setError(null)
    } catch (e) {
      setError(describeFetchError(e, '数量の変更に失敗しました'))
    }
  }

  async function handleResetEstimateResultQuantity(result: EstimateResult) {
    try {
      const updated = await resetEstimateResultQuantity(activeProductNo, result.id)
      setEstimateResults((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
      setError(null)
    } catch (e) {
      setError(describeFetchError(e, '数量の初期値復元に失敗しました'))
    }
  }

  // 積算集約(②)の対象選択に連動して、左ペイン図面一覧(DrawingNavigator)を絞り込む
  // 対象ページ番号の集合 (積算対象連動の金額表示・図面一覧絞り込み 指示4章〜6章)。
  // nullは「総合計」(絞り込みなし)。BBox所属判定ロジックには一切触れず、既存の
  // panelsByPageNo(盤の実際の所属ページ)・detailItems(Detectionの実所属ページ)
  // だけから導出する (`domain/estimateDrawingFilter.ts`)。
  const visiblePageNos = useMemo(
    () => visiblePageNosForTarget(focusedEstimateTarget, estimateAggregationData.detailItems, panelsByPageNo),
    [focusedEstimateTarget, estimateAggregationData.detailItems, panelsByPageNo],
  )

  // 積算対象の切替で現在表示中のページが絞り込み対象外になった場合、対象内の
  // 先頭ページ(productPages配列の出現順=左ペインの表示順)へ自動的に移動する
  // (指示7章)。対象内であれば何もしない(不要なページ切替をしない、指示12章)。
  // 絞り込み結果が0件の場合は移動先が無いため、現在の表示のままにする
  // (指示5章: 図面一覧を空にしても構わない)。ページを実際に切り替える場合のみ、
  // 既存のhandleSelectPageと同じくBBox選択状態等をクリアする
  // (指示7章: 選択状態を残さない)。
  useEffect(() => {
    if (visiblePageNos == null) return // 総合計 = 絞り込みなし
    if (selectedProductPageNo != null && visiblePageNos.has(selectedProductPageNo)) return // 対象内のためそのまま
    const firstVisible = productPages.find((p) => visiblePageNos.has(p.page_no))
    if (firstVisible == null) return // 絞り込み結果が0件 (移動先が無い)
    setSelectedProductPageNo(firstVisible.page_no)
    setSelectedDetectionId(null)
    setHighlightedDetectionId(null)
    setSelectedPanel(null)
    setDetailHoveredDetectionId(null)
  }, [visiblePageNos, selectedProductPageNo, productPages])

  function handleSelectDetection(detectionId: number) {
    setSelectedDetectionId(detectionId)
  }

  // product_df盤領域のクリック選択 (Phase 1.9, 要件5/6)。別の盤をクリックした場合は
  // 即座に選択を切り替える (setStateの置き換えなので、事前のdeselectは不要)。
  function handleSelectPanel(key: string, panel: PanelPreview) {
    setSelectedPanel({ key, panel })
  }

  // 積算コードMasterの行選択トグル (要件6): 同じ行の再クリックで解除、
  // 別の行のクリックで選択を切り替える。同時に選択できるのは1件のみ。
  // [Issue #40 Phase 3] 図面情報の選択(selectedEvidenceTypeKey)とは排他にする
  // (どちらか一方だけがBBox追加モードの対象になる。指示: 新UIの主導線では
  // master_item_idを直接選ばせないが、既存の部品台帳自体は残すため、
  // 同時に両方が選択された状態を作らないことで「今どちらのモードか」を常に
  // 一意にする)。
  function handleSelectMasterItem(itemId: number) {
    setSelectedMasterItemId((current) => (current === itemId ? null : itemId))
    setSelectedEvidenceTypeKey(null)
  }

  // [Issue #40 Phase 3] 「図面情報」の選択トグル。`handleSelectMasterItem`と
  // 対になる新しい選択ハンドラ(排他選択、上記コメント参照)。
  function handleSelectEvidenceType(key: string) {
    setSelectedEvidenceTypeKey((current) => (current === key ? null : key))
    setSelectedMasterItemId(null)
  }

  // [Issue #40 Phase 3] 積算結果の増減・係数変化を知らせる控えめなtoastを
  // スタックへ積む(8章「2〜3秒程度・操作をブロックしない・最大数件スタック・
  // 大きなモーダルは使わない」)。同時に何件積まれても`RULE_TOAST_MAX_STACK`を
  // 超えた古いものは表示から溢れさせない(先入れ先出しで古いものを捨てる)。
  const pushRuleToast = useCallback((message: string) => {
    const id = ++ruleToastIdRef.current
    setRuleToasts((prev) => [...prev.slice(-(RULE_TOAST_MAX_STACK - 1)), { id, message }])
    window.setTimeout(() => {
      setRuleToasts((prev) => prev.filter((t) => t.id !== id))
    }, RULE_TOAST_DURATION_MS)
  }, [])

  // [Issue #40 Phase 3] 積算結果の再評価前後を突き合わせ、追加/削除/係数変化を
  // toastで通知する。`result_key`(評価器が算出する安定キー、Issue #40
  // Phase 2参照)が同じ行同士を同一の積算結果とみなす。
  const diffAndToastEstimateResults = useCallback(
    (before: EstimateResult[], after: EstimateResult[]) => {
      const beforeByKey = new Map(before.map((r) => [r.result_key, r]))
      const afterByKey = new Map(after.map((r) => [r.result_key, r]))
      const labelFor = (r: EstimateResult) => {
        const category = r.master_item_id != null ? masterItemById.get(r.master_item_id)?.category : null
        return category ? `${category} (${r.code})` : r.code
      }
      for (const r of after) {
        if (!beforeByKey.has(r.result_key)) pushRuleToast(`＋ ${labelFor(r)}`)
      }
      for (const r of before) {
        if (!afterByKey.has(r.result_key)) pushRuleToast(`－ ${labelFor(r)}`)
      }
      for (const r of after) {
        const prev = beforeByKey.get(r.result_key)
        if (prev != null && prev.current_factor !== r.current_factor) {
          pushRuleToast(`${r.code} 係数 ${prev.current_factor} → ${r.current_factor}`)
        }
      }
    },
    [masterItemById, pushRuleToast],
  )

  // [Issue #40 Phase 3] 図面情報付きBBoxの追加/削除/移動/resize/種類変更後に
  // ルール評価器を再実行する(指示: 「BBox追加/削除/移動/resize/図面情報変更後に
  // rule evaluatorを再実行」)。評価そのものが失敗しても、呼び出し元のBBox操作
  // 自体を失敗扱いにはしない(積算結果の再評価はあくまで副次的な反映であり、
  // 主操作(BBox保存)は既に成功しているため。エラーは控えめにerror bannerへ
  // 出すだけに留める)。
  const reevaluateEstimateResults = useCallback(async () => {
    try {
      const outcome = await evaluateEstimateResults(activeProductNo)
      setEstimateResults((before) => {
        diffAndToastEstimateResults(before, outcome.results)
        return outcome.results
      })
    } catch (e) {
      setError(describeFetchError(e, '積算結果の再評価に失敗しました'))
    }
  }, [activeProductNo, diffAndToastEstimateResults])

  // Drawing Viewer上のドラッグで確定したManual BBoxをBackendへ登録する (要件9/17)。
  // 登録後もMaster Itemの選択状態は維持し、同じ積算コードで連続追加できるようにする (要件8)。
  // ダミーDB側に対応する図面ページが無い(=デモ以外を閲覧中)場合は登録先が無いため
  // 何もしない (bboxAddMode自体もこの場合は有効にしない。Phase 1.8の方針: 新しく
  // 閲覧する実製番のページにダミー積算データを無理に紐付けない)。
  async function handleCreateManualBBox(rect: { x: number; y: number; w: number; h: number }) {
    if (matchingDbPage == null || selectedMasterItemId == null) return
    try {
      const input = {
        drawing_page_id: matchingDbPage.id,
        master_item_id: selectedMasterItemId,
        bbox_x: rect.x,
        bbox_y: rect.y,
        bbox_w: rect.w,
        bbox_h: rect.h,
      }
      const created = await createManualDetection(input)
      setDetections((prev) => [...prev, created])
      // 積算集約(②)・積算明細(③)は製番全体の`allDetections`から算出するため、
      // ここでも同期しないと新しく追加したBBoxが集計へ反映されない
      // (盤フォーカス・積算明細再設計での追加対応)。
      setAllDetections((prev) => [...prev, created])
      setError(null)
      // 指示2章: Detection追加は編集順を更新し、Undo/Redo履歴にも積む
      // (指示6章: 新しい編集操作はRedo履歴を破棄する。pushCommandがこれを行う)。
      bumpEditMeta(created.id)
      setEditHistory((h) => pushCommand(h, { kind: 'create', detectionId: created.id, input }))
      // [Issue #40 Phase 5] master_item_id直結のBBox(旧方式)も互換レイヤ経由で
      // EstimateResultへ変換されるため、追加後にルール評価器を再実行する。
      await reevaluateEstimateResults()
    } catch (e) {
      setError(describeFetchError(e, 'Manual BBoxの登録に失敗しました'))
    }
  }

  // [Issue #40 Phase 3] Drawing Viewer上のドラッグで確定した「図面情報」付き
  // BBoxをBackendへ登録する。`handleCreateManualBBox`の図面情報版(既存関数は
  // 変更しない、指示: 既存Manual BBoxとの互換維持)。登録後、ルール評価器を
  // 再実行して積算結果の増減をtoastで知らせる。
  async function handleCreateEvidenceBBox(rect: { x: number; y: number; w: number; h: number }) {
    if (matchingDbPage == null || selectedEvidenceTypeKey == null) return
    try {
      const input = {
        drawing_page_id: matchingDbPage.id,
        evidence_type_key: selectedEvidenceTypeKey,
        bbox_x: rect.x,
        bbox_y: rect.y,
        bbox_w: rect.w,
        bbox_h: rect.h,
      }
      const created = await createEvidenceDetection(input)
      setDetections((prev) => [...prev, created])
      setAllDetections((prev) => [...prev, created])
      setError(null)
      bumpEditMeta(created.id)
      setEditHistory((h) => pushCommand(h, { kind: 'create', detectionId: created.id, input }))
      await reevaluateEstimateResults()
    } catch (e) {
      setError(describeFetchError(e, '図面情報付きBBoxの登録に失敗しました'))
    }
  }

  // ダミーDB側のDrawingPage.idから、対応する実製番・実ページ番号へViewerを
  // 切り替える (Phase 1.8)。ページ遷移のみを行い、Detectionの選択/強調には
  // 一切関与しない (明細遷移後のBBox残留・Hover色・品名列修正 指示1章:
  // navigate/flash/selectの役割分離)。
  function navigateToPage(drawingPageId: number) {
    const target = dbPages.find((p) => p.id === drawingPageId)
    if (target?.product_no != null && target.source_page_no != null) {
      setActiveProductNo(target.product_no)
      setSelectedProductPageNo(target.source_page_no)
    }
  }

  // 対象Detectionを一時的に強調表示する (点滅アニメーション、既存の
  // `detection-overlay__bbox--flash`をそのまま再利用)。編集対象としての
  // 選択(selectedDetectionId)は一切変更しない。`HIGHLIGHT_DURATION_MS`経過後、
  // 他の強調と競合していなければ自動的に解除する (指示1章: 一定時間後に
  // 自動解除し、selected状態としては残さない)。
  function flashDetection(detectionId: number) {
    setHighlightedDetectionId(detectionId)
    window.setTimeout(() => {
      setHighlightedDetectionId((current) => (current === detectionId ? null : current))
    }, HIGHLIGHT_DURATION_MS)
  }

  // BBox編集(移動/リサイズ、Undo/Redoを含む)によってDetectionの所属(積算対象)が
  // 変わった場合に、画面全体を新所属へ追従させる共通処理 (積算明細強化・Undo/Redo・
  // 要確認警告・編集追従 指示8章〜15章)。通常編集・Undo・Redoのいずれからもこの
  // 関数だけを呼び、追従ロジックを個別に作らない (指示15章)。呼び出し側は
  // 「編集確定後(pointer up後)」にのみ呼ぶこと。ドラッグ中(未確定)は呼ばない
  // (DetectionOverlay.tsxのonResizeDetectionがmouseup時のみ呼ばれる既存の仕組みを
  // そのまま利用しているため、この関数自体はドラッグ中かどうかを気にする必要がない。
  // 指示8章の「編集中はUIを切り替えない」はこの既存の確定タイミングだけで満たされる)。
  //
  // BBox所属判定ロジック(assignDetectionToPanel)自体には一切変更を加えず、
  // 編集前/編集後それぞれのrectで同じ判定を1回ずつ呼んで比較するだけにしている。
  function followTargetChangeIfNeeded(
    detection: Detection,
    beforeRect: NormalizedRect,
    afterRect: NormalizedRect,
    pageNo: number,
    drawingPageId: number,
  ) {
    if (detection.master_item_id == null) return // 積算コードに紐づかないDetectionは対象の概念を持たない

    const panels = panelsByPageNo.get(pageNo) ?? []
    const beforeTargetId = resolveAssignmentTargetId(assignDetectionToPanel(beforeRect, panels))
    const afterTargetId = resolveAssignmentTargetId(assignDetectionToPanel(afterRect, panels))
    if (beforeTargetId === afterTargetId) return // 所属変わらず、何もしない (指示8章)

    // Undo/Redoはページ非依存のキーボードショートカットのため、対象Detectionが
    // 現在表示中のページと異なる場合がある。既存のnavigateToPageで先に移動する
    // (選択/強調には一切関与しないページ遷移専用の関数を再利用するだけ)。
    if (pageNo !== selectedProductPageNo) {
      navigateToPage(drawingPageId)
    }

    const beforeTarget = estimateAggregationData.targets.find((t) => t.id === beforeTargetId) ?? null
    const afterTarget = estimateAggregationData.targets.find((t) => t.id === afterTargetId) ?? null

    // 指示10章: 積算集約の対象・図面一覧(visiblePageNosがselectedEstimateTargetIdに
    // 連動)・Viewer盤フォーカス(viewerFocusPanelも同様)・積算明細を新所属へ切り替える。
    setSelectedEstimateTargetId(afterTargetId)
    // 指示13章: 選択状態は残さない。対象BBoxは既存flashで一時強調するだけにする。
    setSelectedDetectionId(null)
    flashDetection(detection.id)

    // 指示9章: 所属変更の一時通知。
    const code = detection.master_item_code ?? detection.class_name
    setTargetChangeNotification({
      code,
      model: detection.master_item_model,
      fromLabel: formatTargetLabel(beforeTarget),
      toLabel: formatTargetLabel(afterTarget),
    })
    window.setTimeout(() => setTargetChangeNotification(null), TARGET_CHANGE_NOTIFICATION_DURATION_MS)
  }

  // 左の図面一覧からの手動ページ切替 (要件26: 別図面ページへ移動でBBox選択を解除する)。
  // Phase 1.9 要件8: ページ切替時は選択中盤(product_df)も解除する。
  function handleSelectPage(pageNo: number) {
    setSelectedProductPageNo(pageNo)
    setSelectedDetectionId(null)
    setHighlightedDetectionId(null)
    setSelectedPanel(null)
    setDetailHoveredDetectionId(null)
  }

  // 製番切替 (Phase 1.8)。ProductSelectorから呼ばれる。ページ選択・BBox選択・
  // 選択中盤(product_df, Phase 1.9)もリセットする (新しい製番のページ一覧が
  // 届き次第、先頭ページへ切り替わる)。積算集約(②)の対象選択も、別製番では
  // 盤の識別子(面番号/盤番号)が意味を持たなくなるためリセットする。
  function handleSelectProduct(productNo: string) {
    setActiveProductNo(productNo)
    setSelectedProductPageNo(null)
    setSelectedDetectionId(null)
    setHighlightedDetectionId(null)
    setSelectedPanel(null)
    setDetailHoveredDetectionId(null)
    setSelectedEstimateTargetId(null)
    // 指示6章: 製番変更時はUndo/Redo履歴・編集順メタ情報をクリアする
    // (別製番ではDetection idの意味が変わるため、古い履歴を持ち越さない)。
    setEditHistory(EMPTY_EDIT_HISTORY)
    setEditMetaByDetectionId(new Map())
    editSequenceRef.current = 0
  }

  // 空白領域クリックによるBBox・選択中盤の選択解除 (要件26, Phase 1.9 要件10)。
  // DrawingCanvas側で実際のPanドラッグとは区別された「背景クリック」でのみ
  // 呼ばれるため、Pan操作の終了を誤って選択解除と扱うことはない。
  function handleDeselectDetection() {
    setSelectedDetectionId(null)
    setSelectedPanel(null)
  }

  // BBox削除 (Phase 1.7, 要件12-15)。Manual/AIの双方が対象。
  // 削除後は一覧から即時除去し、選択状態も解除する (要件14/26)。
  //
  // [追加修正 第4ラウンド1章〜6章] 対象Detectionが既にBackend上に存在しない
  // (404) 場合は、ユーザー操作上「対象BBoxは既に存在しない」という無害な
  // stale state に過ぎない。これを他の削除失敗(500・ネットワーク障害等)と
  // 同列の重大エラーとして画面上部へ常駐表示すると、リロードや別ページへの
  // 遷移をしても消えない古いエラーバナーが残り続けてしまう
  // (実際にこの状態がユーザーの実画面で発生していた根本原因)。
  // 404の場合はFrontend側のstale state(一覧・選択状態)を整合させるのみとし、
  // globalなerror bannerは出さない。500・ネットワーク障害等はこれまで通り表示する。
  const handleDeleteDetection = useCallback(async (detectionId: number) => {
    const existing = allDetections.find((d) => d.id === detectionId) ?? null
    try {
      await deleteDetection(detectionId)
      setDetections((prev) => prev.filter((d) => d.id !== detectionId))
      setAllDetections((prev) => prev.filter((d) => d.id !== detectionId))
      setSelectedDetectionId((current) => (current === detectionId ? null : current))
      setError(null) // 削除成功時は以前のエラー表示が残っていればクリアする (要件5)
      // 指示2章: Detection削除は編集順を更新する。
      bumpEditMeta(detectionId)
      // 指示6章: Undo/Redo対象は実データを変更する編集操作。ただし積算コードに
      // 紐づかないDetection(master_item_id === null)は、既存API
      // (createManualDetection)がmaster_item_idを必須とするため削除後の再作成が
      // できず、Undoを提供できない (指示18章で開示する既知の制約)。そのため
      // その場合は履歴へ積まない(編集順の更新はする)。
      // [Issue #40 Phase 3] Undo対応(既存のmaster_item_id経由と同じ理由:
      // 既存API(createManualDetection)はmaster_item_idを必須とするため、
      // 図面情報のみのDetection(master_item_id === null)はこの分岐に該当せず
      // 履歴へ積まれない。ただしこちらは`applyEditCommand`側の削除undo分岐で
      // evidence_type_key経由の再作成に対応させたため、実際にはevidence_type_key
      // を持つ行もUndo可能にする(下記の別条件を参照)。
      if (existing != null && (existing.master_item_id != null || existing.evidence_type_key != null)) {
        setEditHistory((h) => pushCommand(h, { kind: 'delete', detectionId, snapshot: existing }))
      }
      // [Issue #40 Phase 3/5] 積算コードに紐づくBBox(図面情報付き、または
      // 旧方式のmaster_item_id直結)の削除後、ルール評価器を再実行する
      // (Phase 5より、旧方式もEstimateResultへ変換されるため対象を広げた)。
      if (existing?.evidence_type_key != null || existing?.master_item_id != null) {
        await reevaluateEstimateResults()
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // 対象は既に存在しない = stale selectionを解消するだけでよい (要件3/4)。
        setDetections((prev) => prev.filter((d) => d.id !== detectionId))
        setAllDetections((prev) => prev.filter((d) => d.id !== detectionId))
        setSelectedDetectionId((current) => (current === detectionId ? null : current))
        setError(null)
        return
      }
      setError(describeFetchError(e, 'BBoxの削除に失敗しました'))
    }
  }, [allDetections, reevaluateEstimateResults])

  // BBoxリサイズ/移動保存 (Phase 1.7, 要件17/23/24。Phase 1.11でBBox内部drag移動にも
  // 流用)。mouseup時に一度だけ呼ばれる(ドラッグ中は呼ばれない。指示8章の
  // 「編集中はUIを切り替えない」はこの既存の確定タイミングだけで自然に満たされる)。
  async function handleResizeDetection(detectionId: number, rect: NormalizedRect) {
    const existing = allDetections.find((d) => d.id === detectionId) ?? null
    const beforeRect: NormalizedRect | null = existing
      ? { x: existing.bbox_x, y: existing.bbox_y, w: existing.bbox_w, h: existing.bbox_h }
      : null
    // 全体フォント拡大・BBox編集追従回帰修正 指示3章: BBoxを移動/リサイズした場合、
    // 引出線ラベルもBBoxとの相対配置を維持したまま一緒に動かす(回帰修正。以前は
    // ラベル位置が絶対座標のまま据え置かれ、線だけ伸びていた)。BBox本体と同じ
    // PATCH呼び出しで一緒に保存することで、Undo/Redoでも同じ経路(shiftLabelWithBBox
    // をbefore/after入れ替えで呼ぶだけ)で正しく戻せるようにする(指示4章)。
    const currentLabel =
      existing?.leader_label_x != null && existing?.leader_label_y != null
        ? { x: existing.leader_label_x, y: existing.leader_label_y }
        : null
    const newLabel = beforeRect != null ? shiftLabelWithBBox(currentLabel, beforeRect, rect) : null
    try {
      const updated = await updateDetectionBBox(detectionId, {
        bbox_x: rect.x,
        bbox_y: rect.y,
        bbox_w: rect.w,
        bbox_h: rect.h,
        ...(newLabel != null ? { leader_label_x: newLabel.x, leader_label_y: newLabel.y } : {}),
      })
      setDetections((prev) => prev.map((d) => (d.id === detectionId ? updated : d)))
      setAllDetections((prev) => prev.map((d) => (d.id === detectionId ? updated : d)))
      setError(null)
      // 指示2章: BBox移動/リサイズは編集順を更新し、Undo/Redo履歴にも積む。
      bumpEditMeta(detectionId)
      if (beforeRect != null) {
        setEditHistory((h) => pushCommand(h, { kind: 'bbox', detectionId, before: beforeRect, after: rect }))
        // 指示8章: 編集確定後にBBox所属判定を再実行し、所属が変化した場合のみ追従する。
        const pageNo = existing != null ? pageNoByDrawingPageId.get(existing.drawing_page_id) : null
        if (pageNo != null && existing != null) {
          followTargetChangeIfNeeded(updated, beforeRect, rect, pageNo, existing.drawing_page_id)
        }
      }
      // [Issue #40 Phase 3/5] 積算コードに紐づくBBox(図面情報付き、または
      // 旧方式のmaster_item_id直結)の移動/resize後、ルール評価器を再実行する
      // (指示: BBox移動/resize後にrule evaluatorを再実行。複数BBox条件
      // (VCT+CH等)は位置関係で成立/不成立が変わりうるため、単純な所属変更
      // だけでなく移動そのものが評価に影響しうる。Phase 5より、旧方式の
      // 盤所属変更もEstimateResultの再集計に反映する必要があるため対象を
      // 広げた)。
      if (existing?.evidence_type_key != null || existing?.master_item_id != null) {
        await reevaluateEstimateResults()
      }
    } catch (e) {
      setError(describeFetchError(e, 'BBoxのリサイズ保存に失敗しました'))
    }
  }

  // 引出線ラベル帯のdrag保存 (Phase 1.11 指示書10章/12章)。BBox本体(bbox_x/y/w/h)は
  // 現在の値のまま送り、leader_label_x/yのみを更新する (BBox位置とラベル位置は
  // 独立管理。Backend側もPATCHボディにleader_label_x/yが無い場合は既存値を保持する
  // 挙動のため、ここでは明示的に現在のbbox値+新しいラベル位置を送る)。
  async function handleMoveDetectionLabel(detectionId: number, x: number, y: number) {
    const detection = detections.find((d) => d.id === detectionId)
    if (!detection) return
    try {
      const updated = await updateDetectionBBox(detectionId, {
        bbox_x: detection.bbox_x,
        bbox_y: detection.bbox_y,
        bbox_w: detection.bbox_w,
        bbox_h: detection.bbox_h,
        leader_label_x: x,
        leader_label_y: y,
      })
      setDetections((prev) => prev.map((d) => (d.id === detectionId ? updated : d)))
      setAllDetections((prev) => prev.map((d) => (d.id === detectionId ? updated : d)))
      setError(null)
    } catch (e) {
      setError(describeFetchError(e, '引出線ラベル位置の保存に失敗しました'))
    }
  }

  // Deleteキーによる削除 (要件11/27)。入力欄・検索欄等にフォーカスがある場合は無効化する。
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Delete') return
      if (isEditableTarget(e.target)) return
      setSelectedDetectionId((current) => {
        if (current != null) {
          void handleDeleteDetection(current)
        }
        return current
      })
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleDeleteDetection])

  // Escキーによる現在の編集モード解除 (Phase 1.11 UI改修指示3章/28章)。
  // 一度のEscで複数の状態を予期せず全消去しないよう、現在アクティブな状態に応じて
  // 優先順位を1段階だけ解除する:
  //   1. BBox編集中(selectedDetectionId) → その選択のみ解除
  //   2. 積算コードMaster選択中(selectedMasterItemId) → その選択のみ解除
  //      (Manual BBox追加モード・crosshairカーソルも連動して終了する。
  //      bboxAddModeはselectedMasterItemIdから導出しているため自動的に解除される)
  //   3. 盤選択中(selectedPanel) → その選択のみ解除
  // Modal(SystemSettings/ProductSelector/HelpPdfModal)が開いている間は何もしない
  // (将来Modal自身がEscで閉じる機能を実装しても競合しないようにする。指示書3章)。
  // Issue #19 Phase 3: HelpPdfModal自身もEscキーでは閉じない(SystemSettings/
  // ProductSelectorと同じく、×ボタン/背景クリックのみで閉じる。指示: 既存modalの
  // Escape優先順位を壊さないことを優先し、新たなEscapeハンドリングを追加しない)。
  // input/textarea等にフォーカスがあっても「モード解除」として自然に働くよう、
  // Deleteキー処理とは異なりisEditableTargetのガードは設けない (指示書3章)。
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (isSettingsOpen || isProductSelectorOpen || isHelpOpen) return
      if (selectedDetectionId != null) {
        setSelectedDetectionId(null)
        return
      }
      if (selectedMasterItemId != null) {
        setSelectedMasterItemId(null)
        return
      }
      // [Issue #40 Phase 3] 図面情報選択(BBox追加モード)もEscapeで解除できる
      // ようにする(既存のselectedMasterItemIdと同じ優先順位段階)。
      if (selectedEvidenceTypeKey != null) {
        setSelectedEvidenceTypeKey(null)
        return
      }
      if (selectedPanel != null) {
        setSelectedPanel(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    isSettingsOpen,
    isProductSelectorOpen,
    isHelpOpen,
    selectedDetectionId,
    selectedMasterItemId,
    selectedEvidenceTypeKey,
    selectedPanel,
  ])

  // Undo/Redo本体 (積算明細強化・Undo/Redo・要確認警告・編集追従 指示6章)。
  // 実際のBackend呼び出し(方向で処理が変わる部分)はここで個別に書くが、所属追従
  // (followTargetChangeIfNeeded)は通常編集と完全に同じ1つの関数を呼ぶだけにしており、
  // Undo/Redo専用の追従ロジックは作っていない (指示15章)。
  //
  // create/deleteの取り消し・やり直しでBackendが新しいidを払い出した場合は、
  // 戻り値の`rebase`で呼び出し側(handleUndo/handleRedo)へ伝え、履歴スタック全体
  // (popした後に残る側も含む)を書き換えてもらう。
  async function applyEditCommand(
    command: EditCommand,
    direction: 'undo' | 'redo',
  ): Promise<{ rebase?: { oldId: number; newId: number } } | null> {
    try {
      if (command.kind === 'bbox') {
        const targetRect = direction === 'undo' ? command.before : command.after
        const existing = allDetections.find((d) => d.id === command.detectionId) ?? null
        // 盤情報1行化・3領域リサイズ拡張・Redo時引出線回帰修正 指示6章〜8章:
        // 「Redo時に引出線が飛ぶ」原因は、ラベルのシフト量・所属追従の「移動元」を
        // このコマンドのスナップショット(command.before/after。mousemove時にJS側で
        // 計算した値)から計算していたこと。Backendへの保存・PATCH応答で返る実際の
        // 値(existing.bbox_x/y/w/h)は浮動小数点の丸めでスナップショットとわずかに
        // 食い違うことがあり、これを「BBoxの移動元」として使うとラベルのシフト量が
        // わずかにズレる。Undo→Redoを繰り返すたびにこの誤差が積み重なり、
        // 「引出線が飛ぶ」不具合になっていた。修正: 「移動元」は必ずDetectionの
        // 現在の実際のbbox(existing)を基準にする。「移動先」(targetRect)は
        // このコマンドが記録した値をそのまま使う(そこはズレてはいけない値のため)。
        // これにより、ラベル位置は常に「アンカー(実際のBBox) + 相対オフセット」から
        // 導出される状態を保ち、絶対座標のスナップショットをラベル計算の基準に
        // しない (指示8章の「BBox基準の相対位置から導出する」という方針に沿う)。
        const currentRect: NormalizedRect | null = existing
          ? { x: existing.bbox_x, y: existing.bbox_y, w: existing.bbox_w, h: existing.bbox_h }
          : null
        const currentLabel =
          existing?.leader_label_x != null && existing?.leader_label_y != null
            ? { x: existing.leader_label_x, y: existing.leader_label_y }
            : null
        const newLabel = currentRect != null ? shiftLabelWithBBox(currentLabel, currentRect, targetRect) : currentLabel
        const updated = await updateDetectionBBox(command.detectionId, {
          bbox_x: targetRect.x,
          bbox_y: targetRect.y,
          bbox_w: targetRect.w,
          bbox_h: targetRect.h,
          ...(newLabel != null ? { leader_label_x: newLabel.x, leader_label_y: newLabel.y } : {}),
        })
        setDetections((prev) => prev.map((d) => (d.id === command.detectionId ? updated : d)))
        setAllDetections((prev) => prev.map((d) => (d.id === command.detectionId ? updated : d)))
        setError(null)
        bumpEditMeta(command.detectionId) // 指示2章: Undo/Redoも編集操作として編集順を更新する
        if (existing != null && currentRect != null) {
          const pageNo = pageNoByDrawingPageId.get(existing.drawing_page_id) ?? null
          // 指示15章: 「面1/盤1→面2/盤2」への移動をUndoした場合、BBoxを戻すだけで
          // なく「面2/盤2→面1/盤1」への画面追従も行う。所属判定の「移動元」も
          // 上記と同じ理由でcurrentRect(実際の現在値)を使う。
          if (pageNo != null) followTargetChangeIfNeeded(updated, currentRect, targetRect, pageNo, existing.drawing_page_id)
        }
        // [Issue #40 Phase 3] 図面情報付きBBoxのUndo/Redoによる移動後も、
        // 通常の移動/resizeと同様にルール評価器を再実行する。
        // [Issue #40 Phase 5] master_item_id直結の旧Manual BBoxも、互換レイヤ
        // 経由でEstimateResultへ変換されるようになったため、同様に再実行する。
        if (existing?.evidence_type_key != null || existing?.master_item_id != null) await reevaluateEstimateResults()
        return {}
      }

      if (command.kind === 'create') {
        // [Issue #40 Phase 3] command.inputの形(master_item_id経由か
        // evidence_type_key経由か)から、どちらの経路で作られたBBoxかを判別する
        // (`editHistory.ts::CreateEditCommand`のdocstring参照)。
        // [Issue #40 Phase 5] どちらの経路もEstimateResultへ変換されるため、
        // 再評価は経路を問わず必要(旧`isEvidenceBased`という名前のまま残すと
        // 誤解を招くため、意味に合わせて`isEstimateRelevant`とする)。
        const isEstimateRelevant = 'evidence_type_key' in command.input || 'master_item_id' in command.input
        if (direction === 'undo') {
          await deleteDetection(command.detectionId)
          setDetections((prev) => prev.filter((d) => d.id !== command.detectionId))
          setAllDetections((prev) => prev.filter((d) => d.id !== command.detectionId))
          setSelectedDetectionId((current) => (current === command.detectionId ? null : current))
          bumpEditMeta(command.detectionId)
          setError(null)
          if (isEstimateRelevant) await reevaluateEstimateResults()
          return {}
        }
        const created =
          'evidence_type_key' in command.input
            ? await createEvidenceDetection(command.input)
            : await createManualDetection(command.input)
        setDetections((prev) => [...prev, created])
        setAllDetections((prev) => [...prev, created])
        bumpEditMeta(created.id)
        setError(null)
        if (isEstimateRelevant) await reevaluateEstimateResults()
        return created.id !== command.detectionId
          ? { rebase: { oldId: command.detectionId, newId: created.id } }
          : {}
      }

      // command.kind === 'delete'
      if (direction === 'undo') {
        // [Issue #40 Phase 3] 図面情報のみのDetection(master_item_id===null,
        // evidence_type_key!==null)も、専用の作成APIで復元できるようにした。
        // どちらも持たないDetection(積算コードに紐づかない旧来のAI検出等)は
        // 引き続き復元できない (指示18章で開示する既知の制約。
        // handleDeleteDetection側でそもそもこの場合は履歴へ積んでいないため、
        // 通常はここへ到達しないが、念のため防御しておく)。
        if (command.snapshot.master_item_id == null && command.snapshot.evidence_type_key == null) {
          setError('このBBoxの削除は元に戻せません(積算コードに紐づかないBBoxのため)')
          return null
        }
        const created =
          command.snapshot.master_item_id != null
            ? await createManualDetection({
                drawing_page_id: command.snapshot.drawing_page_id,
                master_item_id: command.snapshot.master_item_id,
                bbox_x: command.snapshot.bbox_x,
                bbox_y: command.snapshot.bbox_y,
                bbox_w: command.snapshot.bbox_w,
                bbox_h: command.snapshot.bbox_h,
              })
            : await createEvidenceDetection({
                drawing_page_id: command.snapshot.drawing_page_id,
                // 直前のnullチェックにより、この分岐ではevidence_type_keyが
                // 必ず非nullであることが保証されている。
                evidence_type_key: command.snapshot.evidence_type_key as string,
                bbox_x: command.snapshot.bbox_x,
                bbox_y: command.snapshot.bbox_y,
                bbox_w: command.snapshot.bbox_w,
                bbox_h: command.snapshot.bbox_h,
              })
        setDetections((prev) => [...prev, created])
        setAllDetections((prev) => [...prev, created])
        bumpEditMeta(created.id)
        setError(null)
        // Backend既存APIの制約上、source_type/statusはmanual/reviewed固定でしか
        // 復元できない (元がAI検出だった場合、この点だけは完全には再現できない。
        // 指示18章で開示する既知の制約)。
        // [Issue #40 Phase 5] master_item_id直結の旧Manual BBoxもEstimateResult
        // 化されるため、evidence_type_key同様に再評価対象とする。
        if (command.snapshot.evidence_type_key != null || command.snapshot.master_item_id != null) {
          await reevaluateEstimateResults()
        }
        return created.id !== command.detectionId
          ? { rebase: { oldId: command.detectionId, newId: created.id } }
          : {}
      }
      await deleteDetection(command.detectionId)
      setDetections((prev) => prev.filter((d) => d.id !== command.detectionId))
      setAllDetections((prev) => prev.filter((d) => d.id !== command.detectionId))
      setSelectedDetectionId((current) => (current === command.detectionId ? null : current))
      bumpEditMeta(command.detectionId)
      setError(null)
      if (command.snapshot.evidence_type_key != null || command.snapshot.master_item_id != null) {
        await reevaluateEstimateResults()
      }
      return {}
    } catch (e) {
      setError(describeFetchError(e, direction === 'undo' ? 'Undoに失敗しました' : 'Redoに失敗しました'))
      return null
    }
  }

  // 盤情報1行化・3領域リサイズ拡張・Redo時引出線回帰修正 指示7章の調査観点
  // 「drag中のtemporary offsetがRedo後も残っていないか」に加え、Undo/Redo自体を
  // 連続で素早く実行(キーボード連打やUndo中のRedoクリック等)した場合の競合を防ぐ
  // ガード。`applyEditCommand`は`await updateDetectionBBox(...)`を挟む非同期処理の
  // ため、1回目の完了(state反映・再描画)を待たずに2回目を実行すると、
  // `allDetections`/`editHistory`のクロージャが古いままの状態で計算してしまい、
  // 結果としてBBox・ラベル位置の計算が食い違う恐れがある。実行中は新規の
  // Undo/Redoを受け付けないようにする (ボタンもdisabledにする。指示6章)。
  const isApplyingEditCommandRef = useRef(false)
  const [isApplyingEditCommand, setIsApplyingEditCommand] = useState(false)

  async function handleUndo() {
    if (isApplyingEditCommandRef.current) return
    const popped = popUndo(editHistory)
    if (popped == null) return
    isApplyingEditCommandRef.current = true
    setIsApplyingEditCommand(true)
    try {
      const result = await applyEditCommand(popped.command, 'undo')
      if (result == null) return // 失敗時は履歴を変更しない (何度でも再試行できるようにする)
      setEditHistory(
        result.rebase ? rebaseDetectionId(popped.next, result.rebase.oldId, result.rebase.newId) : popped.next,
      )
    } finally {
      isApplyingEditCommandRef.current = false
      setIsApplyingEditCommand(false)
    }
  }

  async function handleRedo() {
    if (isApplyingEditCommandRef.current) return
    const popped = popRedo(editHistory)
    if (popped == null) return
    isApplyingEditCommandRef.current = true
    setIsApplyingEditCommand(true)
    try {
      const result = await applyEditCommand(popped.command, 'redo')
      if (result == null) return
      setEditHistory(
        result.rebase ? rebaseDetectionId(popped.next, result.rebase.oldId, result.rebase.newId) : popped.next,
      )
    } finally {
      isApplyingEditCommandRef.current = false
      setIsApplyingEditCommand(false)
    }
  }

  // Ctrl+Z(Undo)/Ctrl+Shift+Z(Redo) (指示6章)。ハンドラを常に最新のクロージャへ
  // 差し替えるrefパターン(DetectionOverlay.tsxのpreviewBBoxRef等と同じ考え方)を使い、
  // editHistory等の変化のたびにeffect自体を再購読する必要をなくす。ref自体への
  // 書き込みはrender中ではなく専用のeffect(依存配列なし=毎回のcommit後に実行)で行う。
  const handleUndoRef = useRef(handleUndo)
  const handleRedoRef = useRef(handleRedo)
  useEffect(() => {
    handleUndoRef.current = handleUndo
    handleRedoRef.current = handleRedo
  })

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isSettingsOpen || isProductSelectorOpen || isHelpOpen) return
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key.toLowerCase() !== 'z') return
      // input/textarea等ではブラウザ/input自身のUndo/Redoを奪わない (指示6章)。
      if (isEditableTarget(e.target)) return
      e.preventDefault()
      if (e.shiftKey) {
        void handleRedoRef.current()
      } else {
        void handleUndoRef.current()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isSettingsOpen, isProductSelectorOpen, isHelpOpen])

  return (
    <div
      className="app-layout"
      // [PR #22追加仕様: floating panel透過度] CSS custom propertyとして
      // ここ(全floating panelの共通祖先)へ設定することで、
      // `FloatingPanel.css`側の`background: rgba(255, 255, 255,
      // var(--floating-panel-bg-alpha, 0.6))`に4panel共通で一元反映される。
      style={{ '--floating-panel-bg-alpha': floatingPanelBgAlpha } as CSSProperties}
    >
      <ProjectHeader
        project={project}
        loading={loading}
        onOpenProductViewer={() => setProductSelectorOpen(true)}
        onOpenSystemSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
      />
      {/* 指示7章: 要確認(BBox所属判定でtieになった項目)が1件以上ある場合、
          UI最上部に警告を表示する。0件になれば自動的に非表示になる。
          クリックで積算集約/積算明細の対象を「要確認」へ切り替える。 */}
      {tieDetailCount > 0 && (
        <button
          type="button"
          className="app-layout__tie-warning"
          onClick={() => setSelectedEstimateTargetId(TIE_TARGET_ID)}
        >
          ⚠ 積算先を確定できない項目が {tieDetailCount}件あります
        </button>
      )}
      {/* 指示6章: Undo/Redo (Ctrl+Z / Ctrl+Shift+Z のショートカットに加え、
          UI上のボタンでも操作できるようにする。不可の場合はdisabled)。 */}
      <div className="app-layout__edit-toolbar">
        <button
          type="button"
          onClick={() => void handleUndo()}
          disabled={editHistory.undoStack.length === 0 || isApplyingEditCommand}
        >
          ↶ 元に戻す
        </button>
        <button
          type="button"
          onClick={() => void handleRedo()}
          disabled={editHistory.redoStack.length === 0 || isApplyingEditCommand}
        >
          ↷ やり直す
        </button>
        {/* Issue #4 Phase A-2: decision_events(BBox追加/削除/移動・サイズ変更の
            判断履歴)を後から時系列で参照できる最小UI。積算集約パネル内の
            確定履歴(EstimateConfirmationHistory)とは性質が異なる(Detection編集
            そのものの履歴)ため、積算画面の作業導線を邪魔しないこの編集
            ツールバー側に置く。 */}
        <DecisionEventHistory productNo={activeProductNo} />
        {/* Issue #19 Phase 4: floating panel(盤情報・積算集約・積算明細)の表示
            トグルをUndo/Redoと同じツールバーの右端へ移動した(旧: Viewer上部の
            独立したfloating toggle bar)。 */}
        <PanelVisibilityToggles
          guideVisible={viewerGuideVisible}
          onToggleGuide={() => setViewerGuideVisible((v) => !v)}
          panelInfoVisible={panelInfoFloatingVisible}
          onTogglePanelInfo={() => setPanelInfoFloatingVisible((v) => !v)}
          aggregationVisible={estimateAggregationFloatingVisible}
          onToggleAggregation={() => setEstimateAggregationFloatingVisible((v) => !v)}
          detailVisible={estimateDetailFloatingVisible}
          onToggleDetail={() => setEstimateDetailFloatingVisible((v) => !v)}
          masterVisible={estimateMasterFloatingVisible}
          onToggleMaster={() => setEstimateMasterFloatingVisible((v) => !v)}
          drawingEvidenceVisible={drawingEvidenceFloatingVisible}
          onToggleDrawingEvidence={() => setDrawingEvidenceFloatingVisible((v) => !v)}
        />
      </div>
      {/* Issue #40 Phase 3・8章: ルール再評価による積算結果増減の控えめな通知。
          2〜3秒で自動消去され、操作をブロックしない(pushRuleToast参照)。 */}
      {ruleToasts.length > 0 && (
        <div className="app-layout__rule-toast-stack" role="status">
          {ruleToasts.map((toast) => (
            <div key={toast.id} className="app-layout__rule-toast">
              {toast.message}
            </div>
          ))}
        </div>
      )}
      {/* 指示9章: BBox編集によって積算先(面/盤)が変わった場合の一時通知。 */}
      {targetChangeNotification && (
        <div className="app-layout__target-change-toast" role="status">
          <strong>積算先が変更されました</strong>
          <div>
            {targetChangeNotification.code}
            {targetChangeNotification.model ? ` ${targetChangeNotification.model}` : ''}
          </div>
          <div>
            {targetChangeNotification.fromLabel} → {targetChangeNotification.toLabel}
          </div>
        </div>
      )}
      {initError && (
        <div className="app-layout__error">
          <span>{initError}</span>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)}>
            再読み込み
          </button>
        </div>
      )}
      {!initError && error && <div className="app-layout__error">{error}</div>}

      <div className="app-workspace">
        <div className="app-workspace__main">
          <div className="app-workspace__upper">
            <div className="app-workspace__nav" style={{ width: leftPaneWidth }}>
              <DrawingNavigator
                pages={productPages}
                selectedPageNo={selectedProductPageNo}
                onSelectPage={handleSelectPage}
                loading={productPagesLoading}
                error={productPagesError}
                visiblePageNos={visiblePageNos}
              />
            </div>
            <PaneSplitter onDrag={resizeLeftPaneBy} ariaLabel="図面一覧の幅を変更" />
            {/* Issue #19 Phase 2: 積算集約・積算明細を右ペインから外し、この
                Viewer上へfloating panelとして重ねて表示する。DrawingViewer自体
                (内部のOverlay z-index/pointer-events契約、docs/architecture.md
                15章)は変更せず、その外側にposition:relativeのコンテナを1枚
                追加して、floating panel/トグルバーをこのコンテナ基準で
                絶対配置するだけにしている。 */}
            <div className="app-workspace__viewer-wrap" ref={viewerWrapRef}>
              <DrawingViewer
                productNo={activeProductNo}
                pageNo={selectedProductPageNo}
                pageImageUrl={activeProductPage?.thumbnail_url ?? null}
                pageLabel={pageLabel}
                panels={activeProductPage?.panels ?? []}
                selectedPanelKey={selectedPanel?.key ?? null}
                onSelectPanel={handleSelectPanel}
                masterItemById={masterItemById}
                // [Issue #40 Phase 3] 図面情報の選択でも同じ「BBox追加準備中」の
                // 見た目(カーソル等)にする(両モードとも排他選択のため、常に
                // どちらか一方のみがtrueになる)。
                masterItemSelected={selectedMasterItemId != null || selectedEvidenceTypeKey != null}
                detectedPreview={detectedPreview}
                detections={viewerDetections}
                selectedDetectionId={selectedDetectionId}
                highlightedDetectionId={highlightedDetectionId}
                onSelectDetection={handleSelectDetection}
                bboxAddMode={
                  (selectedMasterItemId != null || selectedEvidenceTypeKey != null) && matchingDbPage != null
                }
                onCreateBBox={
                  selectedEvidenceTypeKey != null ? handleCreateEvidenceBBox : handleCreateManualBBox
                }
                onResizeDetection={handleResizeDetection}
                onMoveDetectionLabel={handleMoveDetectionLabel}
                onDeleteSelectedDetection={() => {
                  if (selectedDetectionId != null) void handleDeleteDetection(selectedDetectionId)
                }}
                onDeselectDetection={handleDeselectDetection}
                detailHoveredDetectionId={detailHoveredDetectionId}
                focusPanel={viewerFocusPanel}
              />
              <FloatingPanel
                visible={panelInfoFloatingVisible}
                kind="panelInfo"
                visibleKinds={visibleFloatingKinds}
                containerRef={viewerWrapRef}
                rect={panelInfoRect}
                onRectChange={setPanelInfoRect}
              >
                <PanelInfo
                  panel={panel}
                  panels={activeProductPage?.panels ?? []}
                  estimatePanels={estimatePanels}
                  selectedPanel={selectedPanel}
                  onSelectPanel={handleSelectPanel}
                />
              </FloatingPanel>
              <FloatingPanel
                visible={estimateAggregationFloatingVisible}
                kind="aggregation"
                visibleKinds={visibleFloatingKinds}
                containerRef={viewerWrapRef}
                rect={aggregationRect}
                onRectChange={setAggregationRect}
              >
                <EstimateAggregation
                  targets={estimateResultAggregationData.targets}
                  lineItems={estimateResultAggregationData.lineItems}
                  totalLineItems={estimateResultAggregationData.totalLineItems}
                  selectedTargetId={selectedEstimateTargetId}
                  onSelectTarget={setSelectedEstimateTargetId}
                  productNo={activeProductNo}
                  needsReviewCount={estimateResultNeedsReviewCount}
                  onNavigateToNeedsReview={handleNavigateToNeedsReview}
                />
              </FloatingPanel>
              <FloatingPanel
                visible={estimateDetailFloatingVisible}
                kind="detail"
                visibleKinds={visibleFloatingKinds}
                containerRef={viewerWrapRef}
                rect={detailRect}
                onRectChange={setDetailRect}
              >
                <EstimateDetail
                  results={estimateResultsForSelectedTarget}
                  masterItemById={masterItemById}
                  detectionById={detectionById}
                  tabFilter={estimateDetailTabFilter}
                  onTabFilterChange={setEstimateDetailTabFilter}
                  onOverrideResultFactor={handleOverrideEstimateResultFactor}
                  onResetResultFactor={handleResetEstimateResultFactor}
                  onOverrideResultQuantity={handleOverrideEstimateResultQuantity}
                  onResetResultQuantity={handleResetEstimateResultQuantity}
                  onFocusResultEvidence={handleFocusResultEvidence}
                />
              </FloatingPanel>
              {/* [追加修正: 積算コードMasterのfloating panel化] 従来は
                  MainArea下段に常設していたが、他3panelと同じくViewer上へ
                  floating panelとして重ねる。`EstimateMasterPicker`自体の
                  業務ロジック・選択状態・BBox追加モードとの連携は変更していない。 */}
              <FloatingPanel
                visible={estimateMasterFloatingVisible}
                kind="master"
                visibleKinds={visibleFloatingKinds}
                containerRef={viewerWrapRef}
                rect={masterRect}
                onRectChange={setMasterRect}
              >
                <EstimateMasterPicker selectedItemId={selectedMasterItemId} onSelectItem={handleSelectMasterItem} />
              </FloatingPanel>
              {/* [Issue #40 Phase 3] 「図面情報」floating panel。新しいBBox
                  作成の主導線。既存の部品台帳(EstimateMasterPicker)は変更せず
                  そのまま併存させる(指示: 既存Manual BBoxとの互換維持)。 */}
              <FloatingPanel
                visible={drawingEvidenceFloatingVisible}
                kind="drawingEvidence"
                visibleKinds={visibleFloatingKinds}
                containerRef={viewerWrapRef}
                rect={drawingEvidenceRect}
                onRectChange={setDrawingEvidenceRect}
              >
                <DrawingEvidencePanel
                  selectedKey={selectedEvidenceTypeKey}
                  onSelectKey={handleSelectEvidenceType}
                  relatedResults={relatedEstimateResultsForSelectedDetection}
                  onFocusResult={handleFocusResultEvidence}
                />
              </FloatingPanel>
              {/* [Issue #31] Viewer内「操作ガイド」。既存4panelと同じ
                  FloatingPanelシェルをそのまま再利用する(`kind="guide"`により
                  右端カスケードには混ぜず、常にViewer左上へ単独配置される。
                  `FloatingPanel.tsx::computeInitialRect`参照)。 */}
              <FloatingPanel
                visible={viewerGuideVisible}
                kind="guide"
                visibleKinds={visibleFloatingKinds}
                containerRef={viewerWrapRef}
                rect={viewerGuideRect}
                onRectChange={setViewerGuideRect}
              >
                <ViewerGuide />
              </FloatingPanel>
            </div>
          </div>
        </div>
      </div>

      {isSettingsOpen && (
        <SystemSettings
          onClose={() => setSettingsOpen(false)}
          floatingPanelBgAlpha={floatingPanelBgAlpha}
          onFloatingPanelBgAlphaChange={setFloatingPanelBgAlpha}
        />
      )}
      {isProductSelectorOpen && (
        <ProductSelector
          currentProductNo={activeProductNo}
          onSelect={handleSelectProduct}
          onClose={() => setProductSelectorOpen(false)}
        />
      )}
      {isHelpOpen && <HelpPdfModal onClose={() => setHelpOpen(false)} />}
    </div>
  )
}

export default App
