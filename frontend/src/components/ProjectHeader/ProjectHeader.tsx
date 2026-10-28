import type { AnalysisStatus, ProductHeader, ProjectInfo } from '../../types/domain'
import './ProjectHeader.css'

// 解析状態のラベル・色は暫定 (要件9)。将来値そのものが変わる可能性がある。
const STATUS_LABEL: Record<AnalysisStatus, string> = {
  not_analyzed: '未解析',
  analyzing: '解析中',
  needs_review: '確認待ち',
  confirmed: '確定',
}

interface Props {
  project: ProjectInfo | null
  /** 選択中の製番。project_info が別案件のデモ値なら、その業務情報を隠して製番だけ表示する。 */
  currentProductNo?: string | null
  /** 選択中の製番の整理番号・盤名称(製番フォルダのdesign.csv由来)。取得前・失敗時はnull。
   * 製番を選んでいる間は、整理番号・盤名称はこの値だけを使い、無い項目は「—」にする(project_infoの別製番の値は出さない)。 */
  productHeader?: ProductHeader | null
  loading: boolean
  onOpenProductViewer: () => void
  onOpenSystemSettings: () => void
  /** 「資料」ポップアップ(複数PDF参照、`data/help/reference-pdfs/`)を開く。
   * 旧「積算資料」ボタン(単一固定PDF、Issue #19 Phase 3)はこのボタンへ統合した
   * ため廃止した(資料機能の一本化)。 */
  onOpenReferencePdfs: () => void
}

export function ProjectHeader({
  project,
  currentProductNo,
  productHeader,
  loading,
  onOpenProductViewer,
  onOpenSystemSettings,
  onOpenReferencePdfs,
}: Props) {
  const projectMatchesSelection = currentProductNo == null || project?.seiban === currentProductNo
  const selectedProductNo = currentProductNo ?? project?.seiban
  // 製番を選んでいるときは、project_infoが同じ製番のものである場合に限って補完に使う(業務側が登録した値)。
  const projectForSelection = projectMatchesSelection ? project : null
  const seiriNo = currentProductNo == null ? project?.seiri_no : (productHeader?.seiri_no ?? projectForSelection?.seiri_no)
  const panelName = currentProductNo == null ? project?.panel_name : (productHeader?.panel_name ?? projectForSelection?.panel_name)
  return (
    <header className="project-header">
      {/* UI視覚階層改善 指示6章: 表示名のみ「Sekisan Navi」へ変更する。
          repository名・package名・directory名・Backend名称等の内部識別子は対象外。
          UI視覚階層改善 追加修正(タイトルSaaS化): 整理番号・製番等のHeader業務情報
          (`project-header__info`)とは別の専用class(`__brand`)にし、タイポグラフィ
          だけでプロダクト名らしく見せる(画像/SVG/Canvasロゴは作らない)。 */}
      <span className="project-header__brand">Sekisan Navi</span>
      {loading && <div className="project-header__loading">読込中...</div>}
      {(project || selectedProductNo) && (
        <div className="project-header__info">
          <span>整理番号: {seiriNo || '—'}</span>
          <span>盤名称: {panelName || '—'}</span>
          {projectMatchesSelection && project && (
            <>
              <span className={`project-header__status project-header__status--${project.analysis_status}`}>
                解析状態: {STATUS_LABEL[project.analysis_status]}
              </span>
              <button type="button" disabled title="PoCでは未実装 (実解析は今後接続予定)">
                解析実行
              </button>
            </>
          )}
          {selectedProductNo && <span>製番: {selectedProductNo}</span>}
        </div>
      )}
      <div className="project-header__actions">
        <button type="button" onClick={onOpenProductViewer}>
          製番を開く
        </button>
        {/* 資料機能の一本化: PDF資料を開くボタンはこれ1つだけにする
            (`data/help/reference-pdfs/`配下の複数PDFを一覧・閲覧する)。
            指示: 鮮やかな赤で視認しやすくする(他のボタンの配色は変えない)。 */}
        <button
          type="button"
          className="project-header__reference-pdf-button"
          onClick={onOpenReferencePdfs}
          title="資料フォルダのPDFを参照する"
        >
          資料
        </button>
        <button type="button" onClick={onOpenSystemSettings} title="管理者向け設定">
          システム設定
        </button>
      </div>
    </header>
  )
}
