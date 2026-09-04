import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  createManualDetection,
  deleteDetection,
  fetchDetectedPreview,
  fetchDetections,
  fetchDrawingPages,
  fetchEstimatePanels,
  fetchMasterItems,
  fetchPanel,
  fetchProductDrawings,
  fetchProjectInfo,
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
import { EstimateDetail, type DetailSourceFilter } from './components/EstimateDetail/EstimateDetail'
import { EstimateMasterPicker } from './components/EstimateMasterPicker/EstimateMasterPicker'
import { SystemSettings } from './components/SystemSettings/SystemSettings'
import { ProductSelector } from './components/ProductSelector/ProductSelector'
import { PaneSplitter } from './components/Layout/PaneSplitter'
import { usePaneWidth } from './hooks/usePaneWidth'
import './App.css'

const HIGHLIGHT_DURATION_MS = 1800
// 積算明細強化・Undo/Redo・要確認警告・編集追従 指示5章/13章: 編集直後の行強調
// (積算明細)・BBox flash(Viewer, 既存HIGHLIGHT_DURATION_MSを再利用)を止める
// タイミング。「2〜3秒程度」の指示に沿って2500msとする。
const EDIT_FOLLOW_HIGHLIGHT_DURATION_MS = 2500
// 所属変更の一時通知 (指示9章) を自動的に消すまでの時間。
const TARGET_CHANGE_NOTIFICATION_DURATION_MS = 4000

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

// 左右ペイン幅 (UIレイアウト追加修正指示 10章)。初期値は変更前レイアウトの
// grid-template-columns (220px / 300px) をそのまま踏襲する。
const LEFT_PANE_INITIAL = 220
const LEFT_PANE_MIN = 140
const LEFT_PANE_MAX_VW_RATIO = 0.3
const RIGHT_PANE_INITIAL = 300
const RIGHT_PANE_MIN = 220
const RIGHT_PANE_MAX_VW_RATIO = 0.4
const LEFT_PANE_STORAGE_KEY = 'sekisan-navi:left-pane-width'
const RIGHT_PANE_STORAGE_KEY = 'sekisan-navi:right-pane-width'

// 下部積算コードMaster領域の高さ (Phase 1.11 指示書24章〜26章)。既存のCSS既定値
// (260px) を初期値として踏襲する。min/maxは「Viewerが実質見えなくなる」
// 「Masterが操作不能になる」高さを避けるための制限 (指示書25章)。
const MASTER_PANE_HEIGHT_INITIAL = 260
const MASTER_PANE_HEIGHT_MIN = 120
const MASTER_PANE_HEIGHT_MAX_VH_RATIO = 0.6
const MASTER_PANE_HEIGHT_STORAGE_KEY = 'sekisan-navi:master-pane-height'

// 右ペイン②「積算集約」の高さ (盤フォーカス・積算明細再設計 指示6章)。
// 盤情報は内容量に応じた自動高さのまま、残り領域を積算集約(この値)と
// 積算明細(flex:1で残りを埋める)の2つで分割し、その境界だけドラッグできるようにする。
// min値は「操作不能にならない最低高さ」の目安 (指示6章の例に準拠)。
const ESTIMATE_AGGREGATION_HEIGHT_INITIAL = 260
const ESTIMATE_AGGREGATION_HEIGHT_MIN = 180
const ESTIMATE_AGGREGATION_HEIGHT_MAX_VH_RATIO = 0.6
const ESTIMATE_AGGREGATION_HEIGHT_STORAGE_KEY = 'sekisan-navi:estimate-aggregation-height'
// 積算明細側も同様に最低高さを設ける (flex:1で伸縮するため直接pxでは持たないが、
// CSS側のmin-heightとして同じ値を使う。指示6章の例に準拠)。
const ESTIMATE_DETAIL_HEIGHT_MIN = 180

// 盤情報1行化・3領域リサイズ拡張・Redo時引出線回帰修正 指示3章/5章: 右ペイン
// 「盤情報」の高さも、積算集約・積算明細と同じ`usePaneWidth`フックでリサイズ可能に
// する(盤情報↔積算集約の間にも1本splitterを追加する)。1行化により1カードあたりの
// 高さが下がったため、初期値は「5件が概ね見える」目安の低めの値にしておく
// (指示3章の例: 盤情報80〜100px・積算集約180px・積算明細180pxを最低高さとして踏襲)。
const PANEL_INFO_HEIGHT_INITIAL = 180
const PANEL_INFO_HEIGHT_MIN = 90
const PANEL_INFO_HEIGHT_MAX_VH_RATIO = 0.5
const PANEL_INFO_HEIGHT_STORAGE_KEY = 'sekisan-navi:panel-info-height'

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
  // 積算明細(③)の情報源タブ。所属変更追従(積算明細強化・Undo/Redo・要確認警告・
  // 編集追従 指示12章)でApp.tsx側から強制的に「全て」へ切り替える必要があるため、
  // 従来のEstimateDetail内部stateからcontrolledへ昇格させた。
  const [estimateDetailSourceFilter, setEstimateDetailSourceFilter] = useState<DetailSourceFilter>('all')

  // 積算明細の「編集順」列用のセッション内編集メタ情報 (指示1章/2章)。
  // detectionId -> {編集日時, 編集シーケンス}。Backend側に永続的な編集日時が
  // 存在しないため、あくまでFrontendセッション内での編集順として扱う
  // (「更新日時」とは呼ばない)。
  const [editMetaByDetectionId, setEditMetaByDetectionId] = useState<
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

  // 編集直後、積算明細側で一時的に強調・自動スクロールする対象のDetection id
  // (指示5章/13章)。Viewer側の一時強調は既存の`highlightedDetectionId`/
  // `flashDetection`をそのまま再利用するため、ここでは積算明細用のみ別途持つ。
  const [editFollowDetectionId, setEditFollowDetectionId] = useState<number | null>(null)

  // 所属変更の一時通知 (指示9章)。nullの間は非表示。
  const [targetChangeNotification, setTargetChangeNotification] = useState<{
    code: string
    model: string | null
    fromLabel: string
    toLabel: string
  } | null>(null)

  const [isSettingsOpen, setSettingsOpen] = useState(false)
  const [isProductSelectorOpen, setProductSelectorOpen] = useState(false)

  // 積算コードMasterで「Manual BBox追加対象」として選択中のMaster Item (Phase 1.6)。
  const [selectedMasterItemId, setSelectedMasterItemId] = useState<number | null>(null)

  // 左右ペインの幅 (UIレイアウト追加修正指示)。ドラッグでのリアルタイム変更 +
  // localStorageによる復元を1本のフックへ集約している (hooks/usePaneWidth.ts)。
  const [leftPaneWidth, resizeLeftPaneBy] = usePaneWidth(
    LEFT_PANE_STORAGE_KEY,
    LEFT_PANE_INITIAL,
    LEFT_PANE_MIN,
    LEFT_PANE_MAX_VW_RATIO,
  )
  const [rightPaneWidth, resizeRightPaneBy] = usePaneWidth(
    RIGHT_PANE_STORAGE_KEY,
    RIGHT_PANE_INITIAL,
    RIGHT_PANE_MIN,
    RIGHT_PANE_MAX_VW_RATIO,
  )
  // 下部積算コードMaster領域の高さ (Phase 1.11 指示書24章〜26章)。左右ペイン幅と
  // 同じフックを`dimension: 'height'`で再利用し、保存方式を統一する (指示書26章)。
  const [masterPaneHeight, resizeMasterPaneBy] = usePaneWidth(
    MASTER_PANE_HEIGHT_STORAGE_KEY,
    MASTER_PANE_HEIGHT_INITIAL,
    MASTER_PANE_HEIGHT_MIN,
    MASTER_PANE_HEIGHT_MAX_VH_RATIO,
    'height',
  )
  // 右ペイン②「積算集約」の高さ (盤フォーカス・積算明細再設計 指示6章/7章)。
  // 積算明細はflex:1でこの残り(かつ`ESTIMATE_DETAIL_HEIGHT_MIN`以上)を使う。
  const [estimateAggregationHeight, resizeEstimateAggregationBy] = usePaneWidth(
    ESTIMATE_AGGREGATION_HEIGHT_STORAGE_KEY,
    ESTIMATE_AGGREGATION_HEIGHT_INITIAL,
    ESTIMATE_AGGREGATION_HEIGHT_MIN,
    ESTIMATE_AGGREGATION_HEIGHT_MAX_VH_RATIO,
    'height',
  )
  // 右ペイン①「盤情報」の高さ (指示3章/5章: 盤情報↔積算集約の間にもsplitterを追加する)。
  const [panelInfoHeight, resizePanelInfoBy] = usePaneWidth(
    PANEL_INFO_HEIGHT_STORAGE_KEY,
    PANEL_INFO_HEIGHT_INITIAL,
    PANEL_INFO_HEIGHT_MIN,
    PANEL_INFO_HEIGHT_MAX_VH_RATIO,
    'height',
  )

  // Issue #6: 右ペイン3領域(盤情報/積算集約/積算明細)をそれぞれ独立して
  // 折りたたみ可能にする。デフォルトはすべて展開(false)。積算対象選択・
  // 図面一覧連動・Viewer連動・Undo/Redo等、他のロジックには一切接続しない
  // 独立したUI状態のため、localStorageへは永続化しない(リロードのたびに
  // 「初期表示は3項目ともOPEN」を素直に満たす)。
  const [panelInfoCollapsed, setPanelInfoCollapsed] = useState(false)
  const [estimateAggregationCollapsed, setEstimateAggregationCollapsed] = useState(false)
  const [estimateDetailCollapsed, setEstimateDetailCollapsed] = useState(false)

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

  // 積算コードMaster全件をid引きのMapとして取得する (次work指示1章)。製番に依存しない
  // マスタデータのため、初回1回だけ取得する (EstimateMasterPicker.tsxの初回全件取得と
  // 同じ`fetchMasterItems({})`呼び出しだが、用途が異なるため別々に取得している)。
  useEffect(() => {
    fetchMasterItems({})
      .then((items) => {
        setMasterItemById(new Map(items.map((item) => [item.id, item])))
      })
      .catch((e: unknown) => setError(describeFetchError(e, '積算コードMasterを取得できませんでした')))
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

  // 積算明細の「編集順」列: セッション内編集メタ情報をEstimateDetailItemへ後付けする
  // (`estimateAggregationReal.ts`はこの値の存在を関知しない。指示1章)。
  const detailItemsWithEditMeta = useMemo(
    () =>
      estimateAggregationData.detailItems.map((item) => {
        const meta = editMetaByDetectionId.get(item.detectionId)
        return meta ? { ...item, editedAt: meta.editedAt, editSequence: meta.editSequence } : item
      }),
    [estimateAggregationData.detailItems, editMetaByDetectionId],
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
  function handleSelectMasterItem(itemId: number) {
    setSelectedMasterItemId((current) => (current === itemId ? null : itemId))
  }

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
    } catch (e) {
      setError(describeFetchError(e, 'Manual BBoxの登録に失敗しました'))
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

    // 積算明細側の自動スクロール+一時強調 (指示13章)。
    setEditFollowDetectionId(detection.id)
    window.setTimeout(() => {
      setEditFollowDetectionId((current) => (current === detection.id ? null : current))
    }, EDIT_FOLLOW_HIGHLIGHT_DURATION_MS)

    // 指示12章: 編集したDetectionが現在の情報源タブで表示されなくなる場合のみ
    // 「全て」へ切り替える。design_dataは実データに存在しないため常に見えなくなる扱い。
    setEstimateDetailSourceFilter((current) => {
      if (current === 'all') return current
      if (current === 'design_data') return 'all'
      return current === detection.source_type ? current : 'all'
    })

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

  // 積算明細(③)の図面セルクリック: ページ遷移+対象BBoxの一時強調のみを行う
  // (指示17章: 既存のViewerナビゲーション機構(ページ遷移)を再利用しつつ、
  // 次々々work指示1章により「編集対象として選択(selectedDetectionId)する」
  // 動作は行わないよう分離した。これにより遷移後にESCを押さなくても
  // BBoxの選択状態が残らない)。
  function handleNavigateReference(drawingPageId: number, detectionId: number | null) {
    navigateToPage(drawingPageId)
    if (detectionId != null) {
      flashDetection(detectionId)
    }
    // ページが切り替わるため、選択中盤(product_df)・BBox選択・積算明細hover状態
    // も解除する (Phase 1.9, 要件8の趣旨: 表示中ページと選択状態の不一致を防ぐ。
    // 指示1章: 遷移先で無関係なBBoxが選択状態のまま残らないようにする)。
    setSelectedDetectionId(null)
    setSelectedPanel(null)
    setDetailHoveredDetectionId(null)
  }

  // 積算明細(③)の行(または根拠セル)hover: Viewer上の対応BBoxを一時的に強調する
  // (指示18章〜20章)。Hoverだけでは絶対にページ遷移しない (Clickとの役割分離)。
  // 別図面の明細をhoverしても、DrawingViewer/DetectionOverlayは現在ページの
  // detectionsしか描画しないため、該当Detectionが見つからず自然に何も強調されない。
  function handleHoverEstimateDetail(detectionId: number | null) {
    setDetailHoveredDetectionId(detectionId)
  }

  // 左の図面一覧からの手動ページ切替 (要件26: 別図面ページへ移動でBBox選択を解除する)。
  // handleNavigateReference は移動直後に選択し直すため、こちらとは別経路にしている。
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
      if (existing != null && existing.master_item_id != null) {
        setEditHistory((h) => pushCommand(h, { kind: 'delete', detectionId, snapshot: existing }))
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
  }, [allDetections])

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
  // Modal(SystemSettings/ProductSelector)が開いている間は何もしない
  // (将来Modal自身がEscで閉じる機能を実装しても競合しないようにする。指示書3章)。
  // input/textarea等にフォーカスがあっても「モード解除」として自然に働くよう、
  // Deleteキー処理とは異なりisEditableTargetのガードは設けない (指示書3章)。
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (isSettingsOpen || isProductSelectorOpen) return
      if (selectedDetectionId != null) {
        setSelectedDetectionId(null)
        return
      }
      if (selectedMasterItemId != null) {
        setSelectedMasterItemId(null)
        return
      }
      if (selectedPanel != null) {
        setSelectedPanel(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isSettingsOpen, isProductSelectorOpen, selectedDetectionId, selectedMasterItemId, selectedPanel])

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
        return {}
      }

      if (command.kind === 'create') {
        if (direction === 'undo') {
          await deleteDetection(command.detectionId)
          setDetections((prev) => prev.filter((d) => d.id !== command.detectionId))
          setAllDetections((prev) => prev.filter((d) => d.id !== command.detectionId))
          setSelectedDetectionId((current) => (current === command.detectionId ? null : current))
          bumpEditMeta(command.detectionId)
          setError(null)
          return {}
        }
        const created = await createManualDetection(command.input)
        setDetections((prev) => [...prev, created])
        setAllDetections((prev) => [...prev, created])
        bumpEditMeta(created.id)
        setError(null)
        return created.id !== command.detectionId
          ? { rebase: { oldId: command.detectionId, newId: created.id } }
          : {}
      }

      // command.kind === 'delete'
      if (direction === 'undo') {
        // 積算コードに紐づかないDetectionは既存API(createManualDetection)が
        // master_item_idを必須とするため復元できない (指示18章で開示する既知の制約。
        // handleDeleteDetection側でそもそもこの場合は履歴へ積んでいないため、
        // 通常はここへ到達しないが、念のため防御しておく)。
        if (command.snapshot.master_item_id == null) {
          setError('このBBoxの削除は元に戻せません(積算コードに紐づかないBBoxのため)')
          return null
        }
        const created = await createManualDetection({
          drawing_page_id: command.snapshot.drawing_page_id,
          master_item_id: command.snapshot.master_item_id,
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
      if (isSettingsOpen || isProductSelectorOpen) return
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
  }, [isSettingsOpen, isProductSelectorOpen])

  return (
    <div className="app-layout">
      <ProjectHeader
        project={project}
        loading={loading}
        onOpenProductViewer={() => setProductSelectorOpen(true)}
        onOpenSystemSettings={() => setSettingsOpen(true)}
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
      </div>
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
            <DrawingViewer
              productNo={activeProductNo}
              pageNo={selectedProductPageNo}
              pageImageUrl={activeProductPage?.thumbnail_url ?? null}
              pageLabel={pageLabel}
              panels={activeProductPage?.panels ?? []}
              selectedPanelKey={selectedPanel?.key ?? null}
              onSelectPanel={handleSelectPanel}
              masterItemById={masterItemById}
              masterItemSelected={selectedMasterItemId != null}
              detectedPreview={detectedPreview}
              detections={viewerDetections}
              selectedDetectionId={selectedDetectionId}
              highlightedDetectionId={highlightedDetectionId}
              onSelectDetection={handleSelectDetection}
              bboxAddMode={selectedMasterItemId != null && matchingDbPage != null}
              onCreateBBox={handleCreateManualBBox}
              onResizeDetection={handleResizeDetection}
              onMoveDetectionLabel={handleMoveDetectionLabel}
              onDeleteSelectedDetection={() => {
                if (selectedDetectionId != null) void handleDeleteDetection(selectedDetectionId)
              }}
              onDeselectDetection={handleDeselectDetection}
              detailHoveredDetectionId={detailHoveredDetectionId}
              focusPanel={viewerFocusPanel}
            />
          </div>

          <PaneSplitter
            onDrag={(delta) => resizeMasterPaneBy(-delta)}
            ariaLabel="積算コードMasterの高さを変更"
            axis="y"
          />
          <EstimateMasterPicker
            selectedItemId={selectedMasterItemId}
            onSelectItem={handleSelectMasterItem}
            height={masterPaneHeight}
          />
        </div>

        <PaneSplitter
          onDrag={(delta) => resizeRightPaneBy(-delta)}
          ariaLabel="右ペインの幅を変更"
        />

        <div className="app-workspace__right" style={{ width: rightPaneWidth }}>
          {/* 盤情報1行化・3領域リサイズ拡張・Redo時引出線回帰修正 指示3章/5章:
              盤情報・積算集約・積算明細の3領域すべてを高さ制御可能にする。
              盤情報↔積算集約の間にもsplitterを追加し、複数盤表示時に盤情報が
              大きな高さを占有する問題を、ユーザー自身が調整できるようにする
              (右ペイン全体を押し広げるのではなく、3領域間で高さを分け合う)。 */}
          {/* Issue #6: 折りたたみ中のセクションは`height:'auto'`(内容=見出しのみに
              自然に縮む)にし、隣接領域(下記right-lower、ひいてはその中の
              積算集約/積算明細)へ高さを還元する。折りたたみ中は対応するsplitterも
              非表示にする(ドラッグしても見た目に反映されない「不自然な」操作を
              避けるため。指示: 折りたたみ中の高さ計算・ドラッグ挙動が不自然に
              ならないようにする)。 */}
          <div
            className="app-workspace__panel-info-wrap"
            style={{ height: panelInfoCollapsed ? 'auto' : panelInfoHeight }}
          >
            <PanelInfo
              panel={panel}
              panels={activeProductPage?.panels ?? []}
              estimatePanels={estimatePanels}
              selectedPanel={selectedPanel}
              onSelectPanel={handleSelectPanel}
              collapsed={panelInfoCollapsed}
              onToggleCollapsed={() => setPanelInfoCollapsed((c) => !c)}
            />
          </div>
          {!panelInfoCollapsed && (
            <PaneSplitter
              onDrag={(delta) => resizePanelInfoBy(delta)}
              ariaLabel="盤情報の高さを変更"
              axis="y"
            />
          )}
          {/* 積算集約(②)と積算明細(③)で残り領域を分割する (盤フォーカス・積算明細
              再構成 指示6章)。Issue #6: 積算明細が折りたたまれている間は、積算集約
              側がflex:1で残り領域全体を引き継ぐ(旧来のドラッグ幅指定は一時的に
              無視する。積算明細を再度開くと元の高さ指定へ戻る)。 */}
          <div className="app-workspace__right-lower">
            <div
              className="app-workspace__estimate-aggregation-wrap"
              style={
                estimateDetailCollapsed
                  ? { flex: '1 1 auto', minHeight: 0 }
                  : { height: estimateAggregationCollapsed ? 'auto' : estimateAggregationHeight, flexShrink: 0 }
              }
            >
              <EstimateAggregation
                targets={estimateAggregationData.targets}
                lineItems={estimateAggregationData.lineItems}
                totalLineItems={estimateAggregationData.totalLineItems}
                selectedTargetId={selectedEstimateTargetId}
                onSelectTarget={setSelectedEstimateTargetId}
                collapsed={estimateAggregationCollapsed}
                onToggleCollapsed={() => setEstimateAggregationCollapsed((c) => !c)}
                productNo={activeProductNo}
              />
            </div>
            {!estimateAggregationCollapsed && !estimateDetailCollapsed && (
              <PaneSplitter
                onDrag={(delta) => resizeEstimateAggregationBy(delta)}
                ariaLabel="積算集約の高さを変更"
                axis="y"
              />
            )}
            <div
              className="app-workspace__estimate-detail-wrap"
              style={
                estimateDetailCollapsed
                  ? { flex: '0 0 auto' }
                  : { flex: '1 1 auto', minHeight: ESTIMATE_DETAIL_HEIGHT_MIN }
              }
            >
              <EstimateDetail
                detailItems={detailItemsWithEditMeta}
                targets={estimateAggregationData.targets}
                selectedTargetId={selectedEstimateTargetId}
                currentPageNo={selectedProductPageNo}
                onNavigateReference={handleNavigateReference}
                onHoverDetail={handleHoverEstimateDetail}
                sourceFilter={estimateDetailSourceFilter}
                onSourceFilterChange={setEstimateDetailSourceFilter}
                editFollowDetectionId={editFollowDetectionId}
                collapsed={estimateDetailCollapsed}
                onToggleCollapsed={() => setEstimateDetailCollapsed((c) => !c)}
              />
            </div>
          </div>
        </div>
      </div>

      {isSettingsOpen && <SystemSettings onClose={() => setSettingsOpen(false)} />}
      {isProductSelectorOpen && (
        <ProductSelector
          currentProductNo={activeProductNo}
          onSelect={handleSelectProduct}
          onClose={() => setProductSelectorOpen(false)}
        />
      )}
    </div>
  )
}

export default App
