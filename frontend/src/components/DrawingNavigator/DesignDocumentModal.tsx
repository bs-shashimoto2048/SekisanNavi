import { designDocumentFileUrl } from '../../api/client'
import type { DesignDocument } from '../../types/domain'
import './DesignDocumentModal.css'

interface Props {
  productNo: string
  document: DesignDocument
  onClose: () => void
}

/**
 * 図面一覧の最上段の書類(共通製作仕様書・設計作図完了シート)のPDFを表示するmodal。
 * PDF表示はブラウザ標準のPDF viewer(`<iframe>`)に委譲する(旧HelpPdfModalと同じ方式。独自のPDF viewerは導入しない)。
 * 図面ページの選択・盤・積算対象などのstateには一切触れない(開閉だけ)。PDFのURLは書類専用の経路
 * (`/design-documents/{key}/file`。図面ページ番号の経路は使わない)。
 */
export function DesignDocumentModal({ productNo, document, onClose }: Props) {
  return (
    <div className="help-pdf-modal__backdrop" onClick={onClose}>
      <div className="help-pdf-modal" role="dialog" aria-label={document.label} onClick={(e) => e.stopPropagation()}>
        <div className="help-pdf-modal__header">
          <h2>{document.label}</h2>
          <button type="button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="help-pdf-modal__body">
          <iframe
            className="help-pdf-modal__frame"
            src={designDocumentFileUrl(productNo, document.key)}
            title={`${document.label}のPDF`}
          />
        </div>
      </div>
    </div>
  )
}
