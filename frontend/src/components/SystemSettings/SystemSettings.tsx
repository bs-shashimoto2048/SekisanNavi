import { useEffect, useState } from 'react'
import { ApiError, fetchDataSource, testDataSourceConnection, updateDataSource } from '../../api/client'
import {
  FLOATING_PANEL_BG_ALPHA_DEFAULT,
  FLOATING_PANEL_BG_ALPHA_MAX,
  FLOATING_PANEL_BG_ALPHA_MIN,
} from '../../hooks/useFloatingPanelBgAlpha'
import './SystemSettings.css'

interface Props {
  onClose: () => void
  /** floating panel(盤情報/積算集約/積算明細/部品台帳)共通の背景不透明度
   * (PR #22追加仕様)。0.35〜0.90の範囲。 */
  floatingPanelBgAlpha: number
  onFloatingPanelBgAlphaChange: (value: number) => void
}

/**
 * 管理者用システム設定画面 (Phase 1.5)。
 *
 * Phase 1.5では最低限「データ参照ルート」のみを変更可能にする (要件11)。
 * 設定変更・接続確認はいずれも管理者パスワードが必須であり、その検証は
 * 必ずBackend側 (PUT /api/settings/data-source, POST .../test) で行われる。
 * このコンポーネントはパスワードの正誤を自分で判定しない。
 *
 * [PR #22追加仕様: floating panel透過度] 上記とは別に、floating panel
 * (盤情報/積算集約/積算明細/部品台帳)共通の背景不透明度スライダーもここへ
 * 追加した。こちらはユーザー個人の表示上の好みであり、Backend側の
 * データ参照設定とは無関係のため、管理者パスワードを必要としない
 * (`hooks/useFloatingPanelBgAlpha.ts`がlocalStorageのみで永続化する)。
 */
export function SystemSettings({
  onClose,
  floatingPanelBgAlpha,
  onFloatingPanelBgAlphaChange,
}: Props) {
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

        {/* [PR #22追加仕様: floating panel透過度] データ参照ルート設定(管理者
            パスワード必須)とは独立した、ユーザー個人の表示設定。読込中判定
            (`loading`、データ参照ルートの取得待ち)の外側に置き、常に操作可能
            にする。 */}
        <div className="system-settings__section">
          <h3 className="system-settings__section-heading">表示設定</h3>
          <label className="system-settings__field">
            <span>
              floating panel透過度
              <span className="system-settings__value-badge">
                {Math.round(floatingPanelBgAlpha * 100)}%
              </span>
            </span>
            <input
              type="range"
              min={FLOATING_PANEL_BG_ALPHA_MIN}
              max={FLOATING_PANEL_BG_ALPHA_MAX}
              step={0.01}
              value={floatingPanelBgAlpha}
              onChange={(e) => onFloatingPanelBgAlphaChange(Number(e.target.value))}
              aria-label="floating panel透過度"
            />
          </label>
          <p className="system-settings__note">
            盤情報・積算集約・積算明細・部品台帳の4panel共通の背景透過度です。値を下げるほど
            図面が透けて見えます(枠線・文字・表の配色は変わりません)。既定値は
            {Math.round(FLOATING_PANEL_BG_ALPHA_DEFAULT * 100)}%です。
          </p>
        </div>

        <hr className="system-settings__divider" />

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
