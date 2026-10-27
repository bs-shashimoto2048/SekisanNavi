import { useEffect, useRef, useState } from 'react'
import { ApiError, fetchProductInfo, searchProducts } from '../../api/client'
import './ProductSelector.css'

interface Props {
  currentProductNo: string
  onSelect: (productNo: string) => void
  onClose: () => void
}

const SEARCH_DEBOUNCE_MS = 250

/**
 * 製番検索・切替 (Phase 1.8, 要件1-4)。
 *
 * [追加修正: 製番選択の一覧表示] 以前は2文字以上入力するまで候補を表示しなかったが、
 * 指示により「既存の製番入力欄の下に、参照先フォルダ内の製番フォルダ名を一覧表示する」
 * ことになったため、入力欄が空の状態(=マウント直後)でも`searchProducts('')`を呼び、
 * ルート直下の全製番フォルダ(`_`始まりを除く、Backend側`search_product_dirs`が除外する)
 * を一覧表示する。入力に応じた絞り込みは部分一致・大文字小文字区別なし(Backend側で
 * 実施)。ルート直下には製番ディレクトリが900件超存在しうるため (docs/data-source.md)、
 * `truncated`(Backendが`limit`で打ち切ったか)はそのまま案内表示に使う。
 * ユーザーが完全な製番を入力した場合は、一覧に出ていなくても「開く」から直接
 * 存在確認できる(要件3、手入力による指定は変更していない)。
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

  // [追加修正: 製番選択の一覧表示] 空クエリでルート直下全件(900件超になりうる)を
  // 都度取得するようになったことで、短い絞り込みクエリ(高速)と空クエリ/緩い
  // クエリ(低速、実ファイルシステム走査)のリクエストが同時に飛び交いやすくなった。
  // 並び順が保証されないため、後から打ったクエリの結果より前に打ったクエリの
  // 低速な結果が遅れて返ってくると、画面が古い(現在のinputと食い違う)候補一覧で
  // 上書きされてしまう。`latestQueryRef`で「今まさに表示すべきクエリ」を保持し、
  // 各リクエストの完了時にそれと一致する場合のみ反映することで、古いレスポンスに
  // よる上書きを防ぐ(AbortControllerではなく、Backend側の`getJson`に手を入れずに
  // 完結させるための最小限の対処)。
  const latestQueryRef = useRef('')

  useEffect(() => {
    const q = query.trim()
    latestQueryRef.current = q
    setSearching(true)
    const timer = setTimeout(() => {
      searchProducts(q)
        .then((res) => {
          if (latestQueryRef.current !== q) return
          setMatches(res.matches)
          setTruncated(res.truncated)
        })
        .catch(() => {
          if (latestQueryRef.current !== q) return
          // 検索候補の取得失敗は致命的ではないため、候補なし扱いに留める
          // (「開く」による直接存在確認は引き続き試行できる)。
          setMatches([])
          setTruncated(false)
        })
        .finally(() => {
          if (latestQueryRef.current === q) setSearching(false)
        })
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
          {/* [追加修正: 製番選択の一覧表示] 指示の文言通り「該当する製番がありません」を
              表示する(入力が空でも一覧自体が0件の場合を含む)。 */}
          {!searching && matches.length === 0 && (
            <li className="product-selector__empty">該当する製番がありません</li>
          )}
        </ul>
        {truncated && (
          <p className="product-selector__truncated">候補が多いため一部のみ表示しています。絞り込んでください。</p>
        )}
      </div>
    </div>
  )
}
