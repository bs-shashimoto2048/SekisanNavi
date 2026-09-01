import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ApiError,
  createManualDetection,
  deleteDetection,
  fetchDetections,
  fetchDrawingPages,
  fetchEstimateItems,
  fetchPanel,
  fetchProductDrawings,
  fetchProjectInfo,
  updateDetectionBBox,
} from './api/client'
import { describeFetchError } from './api/errors'
import type {
  Detection,
  DrawingPage,
  EstimateItem,
  Panel,
  PanelPreview,
  ProductDrawing,
  ProjectInfo,
} from './types/domain'
import type { NormalizedRect } from './utils/bbox'
import {
  buildSearchWithProductPage,
  parsePageNoFromSearch,
  parseProductNoFromSearch,
} from './utils/urlState'
import { ProjectHeader } from './components/ProjectHeader/ProjectHeader'
import { DrawingNavigator } from './components/DrawingNavigator/DrawingNavigator'
import { DrawingViewer } from './components/DrawingViewer/DrawingViewer'
import { PanelProperties } from './components/PanelProperties/PanelProperties'
import { EstimateTree } from './components/EstimateTree/EstimateTree'
import { EstimateMasterPicker } from './components/EstimateMasterPicker/EstimateMasterPicker'
import { SystemSettings } from './components/SystemSettings/SystemSettings'
import { ProductSelector } from './components/ProductSelector/ProductSelector'
import { PaneSplitter } from './components/Layout/PaneSplitter'
import { usePaneWidth } from './hooks/usePaneWidth'
import './App.css'

const HIGHLIGHT_DURATION_MS = 1800

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
  // ダミーDetection/PanelArea/積算結果 (EstimateTree) と紐付けるためだけに保持する
  // DB上の図面ページ一覧。Phase 1.8以降、左ペイン(DrawingNavigator)の表示自体は
  // これではなく実製番のPNGサムネイル(productPages)を使う。EstimateTreeの
  // 「根拠図面」表示名、および根拠図面ジャンプ時の製番/ページ番号の解決にのみ使う。
  const [dbPages, setDbPages] = useState<DrawingPage[]>([])
  const [estimateItems, setEstimateItems] = useState<EstimateItem[]>([])
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

  // 中央Viewerで選択中のproduct_df盤 (Phase 1.9)。Detection/BBoxの選択状態
  // (selectedDetectionId) とは独立した概念として管理する (要件5)。キー単体では
  // 表示側の再取得ができないため、クリック時に受け取ったPanelPreview本体も
  // 合わせて保持する (`panelKey`はページ内での一意性を保証するための識別子)。
  const [selectedPanel, setSelectedPanel] = useState<{ key: string; panel: PanelPreview } | null>(
    null,
  )

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

  // 初期データ読込 (案件情報 / ダミー図面一覧 / 積算結果)
  useEffect(() => {
    setLoading(true)
    setInitError(null)
    Promise.all([fetchProjectInfo(), fetchDrawingPages(), fetchEstimateItems()])
      .then(([projectInfo, drawingPages, items]) => {
        setProject(projectInfo)
        setDbPages(drawingPages)
        setEstimateItems(items)
      })
      .catch((e: unknown) =>
        setInitError(describeFetchError(e, '案件情報・図面一覧・積算結果の取得に失敗しました')),
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

  const pagesById = useMemo(() => new Map(dbPages.map((p) => [p.id, p])), [dbPages])

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
      const created = await createManualDetection({
        drawing_page_id: matchingDbPage.id,
        master_item_id: selectedMasterItemId,
        bbox_x: rect.x,
        bbox_y: rect.y,
        bbox_w: rect.w,
        bbox_h: rect.h,
      })
      setDetections((prev) => [...prev, created])
      setError(null)
    } catch (e) {
      setError(describeFetchError(e, 'Manual BBoxの登録に失敗しました'))
    }
  }

  // 積算結果Treeの根拠図面クリック: Viewerを対象ページへ移動し、対象BBoxを選択、
  // 一時的に強調表示する (要件13)。根拠図面はダミーDB側のDrawingPage idで
  // 表現されているため、対応する製番/ページ番号を引いてから製番・選択ページを
  // 切り替える (Phase 1.8)。
  function handleNavigateReference(drawingPageId: number, detectionId: number | null) {
    const target = dbPages.find((p) => p.id === drawingPageId)
    if (target?.product_no != null && target.source_page_no != null) {
      setActiveProductNo(target.product_no)
      setSelectedProductPageNo(target.source_page_no)
    }
    if (detectionId != null) {
      setSelectedDetectionId(detectionId)
      setHighlightedDetectionId(detectionId)
      window.setTimeout(() => setHighlightedDetectionId(null), HIGHLIGHT_DURATION_MS)
    }
    // ページが切り替わるため、選択中盤(product_df)も解除する (Phase 1.9, 要件8の
    // 趣旨: 表示中ページと選択盤の不一致を防ぐ)。
    setSelectedPanel(null)
  }

  // 左の図面一覧からの手動ページ切替 (要件26: 別図面ページへ移動でBBox選択を解除する)。
  // handleNavigateReference は移動直後に選択し直すため、こちらとは別経路にしている。
  // Phase 1.9 要件8: ページ切替時は選択中盤(product_df)も解除する。
  function handleSelectPage(pageNo: number) {
    setSelectedProductPageNo(pageNo)
    setSelectedDetectionId(null)
    setHighlightedDetectionId(null)
    setSelectedPanel(null)
  }

  // 製番切替 (Phase 1.8)。ProductSelectorから呼ばれる。ページ選択・BBox選択・
  // 選択中盤(product_df, Phase 1.9)もリセットする (新しい製番のページ一覧が
  // 届き次第、先頭ページへ切り替わる)。
  function handleSelectProduct(productNo: string) {
    setActiveProductNo(productNo)
    setSelectedProductPageNo(null)
    setSelectedDetectionId(null)
    setHighlightedDetectionId(null)
    setSelectedPanel(null)
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
    try {
      await deleteDetection(detectionId)
      setDetections((prev) => prev.filter((d) => d.id !== detectionId))
      setSelectedDetectionId((current) => (current === detectionId ? null : current))
      setError(null) // 削除成功時は以前のエラー表示が残っていればクリアする (要件5)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // 対象は既に存在しない = stale selectionを解消するだけでよい (要件3/4)。
        setDetections((prev) => prev.filter((d) => d.id !== detectionId))
        setSelectedDetectionId((current) => (current === detectionId ? null : current))
        setError(null)
        return
      }
      setError(describeFetchError(e, 'BBoxの削除に失敗しました'))
    }
  }, [])

  // BBoxリサイズ/移動保存 (Phase 1.7, 要件17/23/24。Phase 1.11でBBox内部drag移動にも
  // 流用)。mouseup時に一度だけ呼ばれる。
  async function handleResizeDetection(detectionId: number, rect: NormalizedRect) {
    try {
      const updated = await updateDetectionBBox(detectionId, {
        bbox_x: rect.x,
        bbox_y: rect.y,
        bbox_w: rect.w,
        bbox_h: rect.h,
      })
      setDetections((prev) => prev.map((d) => (d.id === detectionId ? updated : d)))
      setError(null)
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
      setError(null)
    } catch (e) {
      setError(describeFetchError(e, '引出線ラベル位置の保存に失敗しました'))
    }
  }

  // Deleteキーによる削除 (要件11/27)。入力欄・検索欄等にフォーカスがある場合は無効化する。
  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target.isContentEditable
      )
    }

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

  return (
    <div className="app-layout">
      <ProjectHeader
        project={project}
        loading={loading}
        onOpenProductViewer={() => setProductSelectorOpen(true)}
        onOpenSystemSettings={() => setSettingsOpen(true)}
      />
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
              masterItemSelected={selectedMasterItemId != null}
              detections={detections}
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
          <PanelProperties panel={panel} selectedProductPanel={selectedPanel?.panel ?? null} />
          <EstimateTree
            items={estimateItems}
            pagesById={pagesById}
            onNavigateReference={handleNavigateReference}
          />
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
