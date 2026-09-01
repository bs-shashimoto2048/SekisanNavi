import { useEffect, useState } from 'react'
import { ApiError, fetchDataSource, testDataSourceConnection, updateDataSource } from '../../api/client'
import './SystemSettings.css'

interface Props {
  onClose: () => void
}

/**
 * 管理者用システム設定画面 (Phase 1.5)。
 *
 * Phase 1.5では最低限「データ参照ルート」のみを変更可能にする (要件11)。
 * 設定変更・接続確認はいずれも管理者パスワードが必須であり、その検証は
 * 必ずBackend側 (PUT /api/settings/data-source, POST .../test) で行われる。
 * このコンポーネントはパスワードの正誤を自分で判定しない。
 */
export function SystemSettings({ onClose }: Props) {
  const [root, setRoot] = useState('')
  const [exists, setExists] = useState<boolean | null>(null)
  const [adminPassword, setAdminPassword] = useState('')
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDataSource()
      .then((d) => {
        setRoot(d.root)
        setExists(d.exists)
      })
      .finally(() => setLoading(false))
  }, [])

  async function handleTest() {
    setBusy(true)
    setTestResult(null)
    try {
      const result = await testDataSourceConnection(root, adminPassword)
      setTestResult(result)
    } catch (e) {
      setTestResult({ success: false, message: e instanceof ApiError ? e.message : '接続確認に失敗しました。' })
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    setBusy(true)
    setSaveMessage(null)
    try {
      const result = await updateDataSource(root, adminPassword)
      setRoot(result.root)
      setExists(result.exists)
      setSaveMessage('保存しました。')
    } catch (e) {
      setSaveMessage(e instanceof ApiError ? e.message : '保存に失敗しました。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="system-settings__backdrop" onClick={onClose}>
      <div className="system-settings" onClick={(e) => e.stopPropagation()}>
        <div className="system-settings__header">
          <h2>システム設定</h2>
          <button type="button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>

        {loading ? (
          <p>読込中...</p>
        ) : (
          <>
            <label className="system-settings__field">
              <span>
                データ参照ルート
                {exists != null && (
                  <span className={`system-settings__badge ${exists ? 'ok' : 'ng'}`}>
                    {exists ? '存在します' : '未確認/存在しません'}
                  </span>
                )}
              </span>
              <input
                type="text"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                placeholder={String.raw`\\host\share\path`}
              />
            </label>

            <label className="system-settings__field">
              <span>管理者パスワード</span>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
              />
            </label>

            <div className="system-settings__actions">
              <button type="button" onClick={handleTest} disabled={busy || !adminPassword}>
                接続確認
              </button>
              <button type="button" onClick={handleSave} disabled={busy || !adminPassword}>
                変更を保存
              </button>
            </div>

            {testResult && (
              <p className={`system-settings__result ${testResult.success ? 'ok' : 'ng'}`}>
                {testResult.success ? '接続成功' : `接続失敗: ${testResult.message}`}
              </p>
            )}
            {saveMessage && <p className="system-settings__result">{saveMessage}</p>}

            <p className="system-settings__note">
              ※ 通常の製番・図面参照には管理者パスワードは不要です。設定の変更・接続確認のみ
              管理者パスワードが必要です。
            </p>
          </>
        )}
      </div>
    </div>
  )
}
