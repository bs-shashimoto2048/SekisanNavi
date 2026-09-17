import { useEffect, useState } from 'react'

// [PR #22追加仕様: floating panel透過度を設定画面から調整可能にする]
// 盤情報/積算集約/積算明細/部品台帳の4panel共通で使う、floating panel背景の
// 不透明度(alpha)。範囲は「極端に透明/不透明になって可読性が壊れない」安全な
// 範囲として0.35〜0.90を採用した(Issueの例示範囲をそのまま採用。実ブラウザで
// 見た目を確認のうえ問題ないことを確認済み)。既定値0.6は、現行の
// `rgba(255,255,255,0.6)`グラス背景相当。
export const FLOATING_PANEL_BG_ALPHA_MIN = 0.35
export const FLOATING_PANEL_BG_ALPHA_MAX = 0.9
export const FLOATING_PANEL_BG_ALPHA_DEFAULT = 0.6
export const FLOATING_PANEL_BG_ALPHA_STORAGE_KEY = 'sekisan-navi:floating-panel-bg-alpha'

function clamp(value: number): number {
  return Math.min(FLOATING_PANEL_BG_ALPHA_MAX, Math.max(FLOATING_PANEL_BG_ALPHA_MIN, value))
}

/**
 * floating panel(盤情報/積算集約/積算明細/部品台帳)共通の背景不透明度を
 * 保持・永続化するフック(`hooks/usePaneWidth.ts`と同じ設計方針)。
 *
 * - 値は0.35(透過強め)〜0.90(不透明寄り)にclampする。破損値・範囲外の値は
 *   既定値(0.6)へフォールバックする。
 * - localStorageへ保存し、リロード後も復元する。データ参照ルート等の
 *   管理者向け設定(Backend DB・管理者パスワード必須)とは異なり、この設定は
 *   ユーザー個人の表示上の好みであり4panel共通の1設定のため、既存の
 *   左ペイン幅等と同じ「localStorageのみで完結する」永続化方式を踏襲する
 *   (Backend DBへは保存しない)。
 * - localStorageが使えない環境(プライベートブラウジング等)でも例外を投げず、
 *   その場合は単に永続化されないだけで機能自体は動作し続ける
 *   (`usePaneWidth.ts`と同じ防御方針)。
 * - 実際にpanelの背景へ反映する経路(CSS custom property
 *   `--floating-panel-bg-alpha`)の設定は呼び出し側(`App.tsx`)が行う。
 *   このフック自体はDOM/CSSを一切操作しない。
 */
export function useFloatingPanelBgAlpha(): [number, (value: number) => void] {
  const [alpha, setAlphaState] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(FLOATING_PANEL_BG_ALPHA_STORAGE_KEY)
      if (raw == null) return FLOATING_PANEL_BG_ALPHA_DEFAULT
      const parsed = Number(raw)
      // `usePaneWidth.ts`と同じ防御方針: 数値として壊れている場合はもちろん、
      // 現行の許容範囲外の場合も(スライダーの範囲を過去に変更した場合の
      // 残骸等を含め)境界値へ丸めず既定値へフォールバックする。
      if (!Number.isFinite(parsed)) return FLOATING_PANEL_BG_ALPHA_DEFAULT
      if (parsed < FLOATING_PANEL_BG_ALPHA_MIN || parsed > FLOATING_PANEL_BG_ALPHA_MAX) {
        return FLOATING_PANEL_BG_ALPHA_DEFAULT
      }
      return parsed
    } catch {
      return FLOATING_PANEL_BG_ALPHA_DEFAULT
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(FLOATING_PANEL_BG_ALPHA_STORAGE_KEY, String(alpha))
    } catch {
      // localStorageが使えない環境でも致命的にしない(保存されないだけ)。
    }
  }, [alpha])

  function setAlpha(value: number) {
    setAlphaState(clamp(value))
  }

  return [alpha, setAlpha]
}
