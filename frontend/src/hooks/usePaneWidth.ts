import { useEffect, useState } from 'react'

/**
 * 左右ペインの幅、および下部Master領域の高さ (Phase 1.11 指示書24章〜26章) を
 * ドラッグでリアルタイムに変更できるようにするフック
 * (UIレイアウト追加修正指示 4章/5章/10章/18章)。
 *
 * - サイズは px で保持し、`min` px 〜 `viewport * maxViewportRatio` px の範囲に
 *   clampする (ペインが完全に潰れたり、画面のほとんどを占有したりしないようにする)。
 *   `dimension`が`'height'`の場合は`window.innerHeight`、既定の`'width'`の場合は
 *   `window.innerWidth`を基準にする (Phase 1.11指示書26章: 「左右ペイン幅の既存保存
 *   方式があればそれと統一する」ため、Master高さのリサイズにも同じフックを再利用する)。
 * - `storageKey` を指定するとlocalStorageへ保存し、再読み込み後もサイズを復元する
 *   (Backend DBへは保存しない。要件18)。保存値が壊れている・範囲外の場合は
 *   初期値へフォールバックする (古いキー形式の残骸や手動改変への防御)。
 * - localStorageが使えない環境 (プライベートブラウジング等) でも例外を投げず、
 *   その場合は単に永続化されないだけで機能自体は動作し続ける。
 */
export function usePaneWidth(
  storageKey: string,
  initial: number,
  min: number,
  maxViewportRatio: number,
  dimension: 'width' | 'height' = 'width',
): [number, (deltaPx: number) => void] {
  function viewportMax(): number {
    const viewport = dimension === 'height' ? window.innerHeight : window.innerWidth
    return viewport * maxViewportRatio
  }

  const [size, setSize] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw == null) return initial
      const parsed = Number(raw)
      if (!Number.isFinite(parsed)) return initial
      if (parsed < min || parsed > viewportMax()) return initial
      return parsed
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(size))
    } catch {
      // localStorageが使えない環境でも致命的にしない (保存されないだけ)。
    }
  }, [storageKey, size])

  function resizeBy(deltaPx: number) {
    setSize((s) => Math.min(viewportMax(), Math.max(min, s + deltaPx)))
  }

  return [size, resizeBy]
}
