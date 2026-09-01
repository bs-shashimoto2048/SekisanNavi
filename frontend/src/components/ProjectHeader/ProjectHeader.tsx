import type { AnalysisStatus, ProjectInfo } from '../../types/domain'
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
  loading: boolean
  onOpenProductViewer: () => void
  onOpenSystemSettings: () => void
}

export function ProjectHeader({ project, loading, onOpenProductViewer, onOpenSystemSettings }: Props) {
  return (
    <header className="project-header">
      <div className="project-header__title">Sekisan Navi / 積算ナビ</div>
      {loading && <div className="project-header__loading">読込中...</div>}
      {project && (
        <div className="project-header__info">
          <span>整理番号: {project.seiri_no}</span>
          <span>製番: {project.seiban}</span>
          <span>盤名称: {project.panel_name}</span>
          <span className={`project-header__status project-header__status--${project.analysis_status}`}>
            解析状態: {STATUS_LABEL[project.analysis_status]}
          </span>
          <button type="button" disabled title="PoCでは未実装 (実解析は今後接続予定)">
            解析実行
          </button>
        </div>
      )}
      <div className="project-header__actions">
        <button type="button" onClick={onOpenProductViewer}>
          製番を開く
        </button>
        <button type="button" onClick={onOpenSystemSettings} title="管理者向け設定">
          システム設定
        </button>
      </div>
    </header>
  )
}
