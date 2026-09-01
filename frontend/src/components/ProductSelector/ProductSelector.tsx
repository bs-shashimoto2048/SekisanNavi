import { useEffect, useState } from 'react'
import { ApiError, fetchProductInfo, searchProducts } from '../../api/client'
import './ProductSelector.css'

interface Props {
  currentProductNo: string
  onSelect: (productNo: string) => void
  onClose: () => void
}

const SEARCH_DEBOUNCE_MS = 250
const SEARCH_MIN_LENGTH = 2

/**
 * 製番検索・切替 (Phase 1.8, 要件1-4)。
 *
 * ルート直下には製番ディレクトリが900件超存在しうるため (docs/data-source.md)、
 * 起動時の全件取得・毎回の全件走査結果表示は行わない。前方一致検索
 * (`GET /api/products/search`) による候補表示を基本としつつ、ユーザーが完全な
 * 製番を入力した場合は候補に出ていなくても「開く」から直接存在確認できるようにする
 * (要件3)。
 *
 * 旧 `ProductViewer` (Phase 1.5) は「ダミー積算データと紐付かない独立画面」として
 * 実装していたが、Phase 1.8で「メイン画面が参照する製番を切り替える」役割へ変更した
 * ため、このコンポーネントは検索・選択のみに専念し、実際の図面表示は
 * メイン画面のDrawingNavigator/DrawingViewerが担う。
 */
export function ProductSelector({ currentProductNo, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<string[]>([])
  const [truncated, setTruncated] = useState(false)
  const [searching, setSearching] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length < SEARCH_MIN_LENGTH) {
      setMatches([])
      setTruncated(false)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      searchProducts(q)
        .then((res) => {
          setMatches(res.matches)
          setTruncated(res.truncated)
        })
        .catch(() => {
          // 検索候補の取得失敗は致命的ではないため、候補なし扱いに留める
          // (「開く」による直接存在確認は引き続き試行できる)。
          setMatches([])
          setTruncated(false)
        })
        .finally(() => setSearching(false))
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  async function handleOpen(productNo: string) {
    const trimmed = productNo.trim()
    if (!trimmed) return
    setOpening(true)
    setError(null)
    try {
      await fetchProductInfo(trimmed) // 候補になくても完全一致なら直接存在確認する (要件3)
      onSelect(trimmed)
      onClose()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '製番の確認に失敗しました。')
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="product-selector__backdrop" onClick={onClose}>
      <div className="product-selector" onClick={(e) => e.stopPropagation()}>
        <div className="product-selector__header">
          <h2>製番を切り替え</h2>
          <button type="button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>

        <p className="product-selector__current">現在の参照製番: {currentProductNo}</p>

        <div className="product-selector__form">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleOpen(query)}
            placeholder="例: A1GV24"
            autoFocus
          />
          <button type="button" onClick={() => handleOpen(query)} disabled={opening || !query.trim()}>
            開く
          </button>
        </div>

        {error && <p className="product-selector__error">{error}</p>}
        {searching && <p className="product-selector__status">検索中...</p>}

        <ul className="product-selector__candidates">
          {matches.map((m) => (
            <li key={m}>
              <button type="button" onClick={() => handleOpen(m)} disabled={opening}>
                {m}
              </button>
            </li>
          ))}
          {!searching && query.trim().length >= SEARCH_MIN_LENGTH && matches.length === 0 && (
            <li className="product-selector__empty">候補が見つかりません (完全な製番であれば「開く」で直接確認できます)</li>
          )}
        </ul>
        {truncated && (
          <p className="product-selector__truncated">候補が多いため一部のみ表示しています。絞り込んでください。</p>
        )}
      </div>
    </div>
  )
}
