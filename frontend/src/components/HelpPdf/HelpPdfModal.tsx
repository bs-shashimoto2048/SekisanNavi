import { useEffect, useState } from 'react'
import { fetchHelpPdfStatus, helpPdfFileUrl } from '../../api/client'
import { describeFetchError } from '../../api/errors'
import './HelpPdfModal.css'

interface Props {
  onClose: () => void
}

type LoadState = 'loading' | 'available' | 'unavailable' | 'error'

/**
 * 積算資料PDFをHelpとして参照するためのmodal (Issue #19 Phase 3)。
 *
 * 積算コードMasterを置き換えるものではなく、あくまで参考資料の閲覧専用。
 * PDF表示自体はブラウザ標準のPDF viewer(`<iframe>`)に委譲し、独自PDF viewer・
 * PDF.jsは導入しない(指示: 今回は導入しない)。
 *
 * `SystemSettings`と同じbackdrop+中央パネルのmodalパターンを踏襲する
 * (指示: 既存componentを極力再利用する / 最小変更で実装する)。
 *
 * **lazy loading**: modalが開いた時点でまず軽量な存在確認API
 * (`fetchHelpPdfStatus`)のみを呼び、配置されている場合のみ`<iframe>`の`src`へ
 * 実PDFファイルのURLを設定する。未配置・エラー時はPDFファイル自体を一切
 * リクエストしない(指示: modalを開くまでPDFを読み込まない。閉じた状態でも
 * 同様にリクエストしない=このcomponent自体がunmountされている間は何もしない)。
 *
 * **作業状態の非破壊**: このcomponentはApp.tsx側の製番・図面ページ・積算対象・
 * BBox選択等のstateには一切触れない(SystemSettingsと同じく、開閉のON/OFF以外の
 * 副作用を持たない)。そのため閉じても既存の作業状態は失われない。
 */
export function HelpPdfModal({ onClose }: Props) {
  const [state, setState] = useState<LoadState>('loading')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchHelpPdfStatus()
      .then((status) => {
        if (cancelled) return
        setState(status.available ? 'available' : 'unavailable')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setErrorMessage(describeFetchError(e, '積算資料の確認に失敗しました'))
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="help-pdf-modal__backdrop" onClick={onClose}>
      <div className="help-pdf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="help-pdf-modal__header">
          <h2>積算資料</h2>
          <button type="button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>

        <div className="help-pdf-modal__body">
          {state === 'loading' && <p className="help-pdf-modal__message">確認中...</p>}
          {state === 'error' && <p className="help-pdf-modal__message">{errorMessage}</p>}
          {state === 'unavailable' && (
            <p className="help-pdf-modal__message">
              積算資料が配置されていません。管理者に配置を依頼してください。
            </p>
          )}
          {state === 'available' && (
            // ブラウザ標準のPDF表示に委譲する (独自PDF viewer/PDF.jsは導入しない)。
            <iframe className="help-pdf-modal__frame" src={helpPdfFileUrl()} title="積算資料PDF" />
          )}
        </div>
      </div>
    </div>
  )
}
