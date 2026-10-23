import { useEffect, useRef, useState } from 'react'
import type { DesignPage, DesignPages } from '../../types/domain'
import './DrawingNavigator.css'
import './DesignPageList.css'

interface Props {
  /** design.csv基準の図面一覧(取得前はnull)。 */
  designPages: DesignPages | null
  /** 選択中の行のキー(文字列)。 */
  selectedKey: string | null
  onSelect: (item: DesignPage) => void
  /** 各行のサムネイル画像のURL(キーから作る)。推論用PNGのある行は元の推論PNG、無い行は表示用プレビューPNG
   * (どちらも中央ビューアーと同じURLなので、選択時はブラウザのキャッシュが使われる)。 */
  thumbnailUrl: (key: string) => string
  /** 積算集約(②)の対象選択に連動した絞り込み(既存の図面一覧と同じ)。指定時は、推論用PNGがあり
   * `inference_page_no`がこの集合に含まれる行だけを表示する。 */
  visiblePageNos?: Set<number> | null
  /** 図面の選択(ダイアログ)を開く。指定すると、一覧の上に「表示 N / M 件」と「図面の選択」ボタンを出す。 */
  onOpenPicker?: () => void
  /** design.csv にある図面の総数(選択前)。「表示 N / M 件」のMに使う。 */
  totalCount?: number
  /** 製番を選んだ直後で、まだ表示する図面を選んでいない間はtrue。図面は出さず、選択を促す。 */
  awaitingSelection?: boolean
}

const MODE_BADGE: Record<DesignPage['mode'], { text: string; title: string }> = {
  inference: { text: '推論', title: '推論用の画像・推論結果を表示します' },
  preview: { text: 'プレビュー', title: '表示用プレビュー(推論結果・枠は表示しません)' },
  unavailable: { text: '画像なし', title: '表示用の画像が作成されていません' },
}

/** 取得状況ごとの固定文言(例外文言・パスは受け取らない)。 */
const STATUS_MESSAGE: Record<DesignPages['status'], string> = {
  ok: '',
  empty: '表示できる図面がありません',
  missing: 'design.csv がないため、図面一覧を表示できません',
  invalid: 'design.csv を読み込めないため、図面一覧を表示できません',
}

interface ThumbProps {
  item: DesignPage
  src: string
}

/** サムネイル。画像が無い行・読み込みに失敗した行は固定のプレースホルダーを出し、一覧全体は壊さない。
 * 画像は遅延読み込み(画面に近づくまで取得しない)。枠の大きさは先に確保し、読み込みで一覧がずれない。 */
function Thumb({ item, src }: ThumbProps) {
  const [failed, setFailed] = useState(false)
  const showImage = item.mode !== 'unavailable' && !failed
  return (
    <span className="design-page-list__thumb">
      {showImage ? (
        <img
          className="design-page-list__thumb-img"
          src={src}
          alt={`ページ番号 ${item.page_label}　${item.drawing_name}`.trim()}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="design-page-list__thumb-placeholder">画像なし</span>
      )}
    </span>
  )
}

/**
 * design.csv(ページ番号・図名)を基準にした図面一覧。各行は図面のサムネイル付きで、ページ番号は
 * 文字列のまま表示する(`01`と`1`は別の行)。図面を選ぶと中央ビューアーに表示される。
 */
export function DesignPageList({
  designPages,
  selectedKey,
  onSelect,
  thumbnailUrl,
  visiblePageNos = null,
  onOpenPicker,
  totalCount,
  awaitingSelection = false,
}: Props) {
  const listRef = useRef<HTMLUListElement>(null)
  // 選択が変わったとき(別の経路での選択を含む)に、選択中のカードが一覧の表示範囲に入るようスクロールする。
  // 最小限の移動(nearest)にとどめ、すでに見えているときは動かさない。
  useEffect(() => {
    if (selectedKey == null) return
    const el = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-design-key]') ?? []).find(
      (e) => e.getAttribute('data-design-key') === selectedKey,
    )
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedKey])

  if (designPages == null) {
    return (
      <nav className="drawing-navigator">
        <h2 className="drawing-navigator__heading">図面一覧</h2>
        <p className="drawing-navigator__status">読み込み中...</p>
      </nav>
    )
  }
  const items =
    visiblePageNos == null
      ? designPages.items
      : designPages.items.filter((i) => i.inference_page_no != null && visiblePageNos.has(i.inference_page_no))

  return (
    <nav className="drawing-navigator design-page-list" aria-label="design.csv の図面一覧">
      <h2 className="drawing-navigator__heading">図面一覧</h2>
      {awaitingSelection && (
        <div className="design-page-list__awaiting">
          <p className="drawing-navigator__status">表示する図面を選択してください</p>
          {onOpenPicker && (
            <button type="button" className="design-page-list__pick-button" onClick={onOpenPicker}>
              図面の選択
            </button>
          )}
        </div>
      )}
      {!awaitingSelection && onOpenPicker && (
        <div className="design-page-list__select-bar">
          <span className="design-page-list__select-count">
            表示 {designPages.items.length} / {totalCount ?? designPages.items.length} 件
          </span>
          <button type="button" className="design-page-list__pick-button" onClick={onOpenPicker}>
            図面の選択
          </button>
        </div>
      )}
      {designPages.status !== 'ok' && (
        <p className="drawing-navigator__status drawing-navigator__status--error">
          {STATUS_MESSAGE[designPages.status]}
        </p>
      )}
      {designPages.status === 'ok' && !awaitingSelection && items.length === 0 && (
        <p className="drawing-navigator__status">該当する図面はありません</p>
      )}
      {!awaitingSelection && items.length > 0 && (
        <ul className="design-page-list__items" ref={listRef}>
          {items.map((item) => {
            const badge = MODE_BADGE[item.mode]
            const selected = item.key === selectedKey
            const src = thumbnailUrl(item.key)
            return (
              <li key={item.key}>
                <button
                  type="button"
                  className={'design-page-list__item' + (selected ? ' design-page-list__item--selected' : '')}
                  aria-current={selected ? 'true' : undefined}
                  data-design-key={item.key}
                  onClick={() => onSelect(item)}
                  title={`ページ番号 ${item.page_label}　${item.drawing_name}`}
                >
                  {/* カード上部: design.csv のページ番号(元の表記のまま)を図名より前に表示する。
                      面番号/盤番号(元データがあるページだけ。無いページは出さない)は、その下に表示する */}
                  <span className="design-page-list__head">
                    <span className="design-page-list__title">
                      <span className="design-page-list__no" title="design.csv のページ番号">
                        {item.page_label}
                      </span>
                      {'　'}
                      <span className="design-page-list__name">{item.drawing_name || '(図名なし)'}</span>
                      {selected && <span className="design-page-list__current">表示中</span>}
                    </span>
                    {item.ban_labels.length > 0 && (
                      <span className="design-page-list__ban" title="面番号/盤番号">
                        <span className="design-page-list__ban-label">面/盤</span>
                        <span className="design-page-list__ban-value">{item.ban_labels.join('、')}</span>
                      </span>
                    )}
                  </span>
                  <Thumb key={src} item={item} src={src} />
                  {/* カード下部: 表示の種類(推論/プレビュー/画像なし) */}
                  <span className="design-page-list__foot">
                    <span
                      className={`design-page-list__badge design-page-list__badge--${item.mode}`}
                      title={badge.title}
                    >
                      {badge.text}
                    </span>
                  </span>                </button>
              </li>
            )
          })}
        </ul>
      )}
    </nav>
  )
}
