import { useEffect, useRef, useState } from 'react'
import type { DesignPage } from '../../types/domain'
import './DesignPagePicker.css'

interface Props {
  productNo: string
  /** design.csv基準の図面一覧(対応するPDFがある図面のすべて。並びは一覧と同じ)。 */
  items: DesignPage[]
  /** すでに確定している「除外した図面のキー」。未確定(初回)は空 = すべて選択済みで開く。 */
  initialExcluded: ReadonlySet<string>
  /** true=選び直し(キャンセルできる)、false=製番を選んだ直後の最初の選択(キャンセル不可)。 */
  cancelable: boolean
  /** 「開く」。除外する(チェックを外した)図面のキーを渡す。 */
  onConfirm: (excluded: Set<string>) => void
  onCancel: () => void
}

const MODE_LABEL: Record<DesignPage['mode'], string> = {
  inference: '推論',
  preview: 'プレビュー',
  unavailable: '画像なし',
}

/**
 * 製番を選んだあと、図面一覧を開く前に「どの図面を表示するか」を選ぶ画面。
 * design.csv のページ番号(元の表記のまま)と図名を並べ、既定ではPDFがある図面をすべて選択済みにする。
 * 「開く」で選択を確定し、選んだ図面だけが左ペインのサムネイル一覧に載る。
 */
export function DesignPagePicker({ productNo, items, initialExcluded, cancelable, onConfirm, onCancel }: Props) {
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(items.filter((i) => !initialExcluded.has(i.key)).map((i) => i.key)),
  )
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const count = checked.size
  const canOpen = count > 0

  function confirm() {
    if (!canOpen) return
    onConfirm(new Set(items.filter((i) => !checked.has(i.key)).map((i) => i.key)))
  }

  return (
    <div className="design-page-picker__backdrop">
      <div
        className="design-page-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-page-picker-title"
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && cancelable) {
            e.stopPropagation()
            onCancel()
          }
        }}
      >
        <h2 id="design-page-picker-title" className="design-page-picker__title">
          表示する図面を選択
        </h2>
        <p className="design-page-picker__lead">
          製番 {productNo} の図面です。チェックした図面だけを、左の図面一覧に表示します(既定はすべて選択)。
        </p>
        <div className="design-page-picker__bar">
          <button type="button" onClick={() => setChecked(new Set(items.map((i) => i.key)))}>
            すべて選択
          </button>
          <button type="button" onClick={() => setChecked(new Set())}>
            すべて解除
          </button>
          <span className="design-page-picker__count" aria-live="polite">
            {count} / {items.length} 件を選択
          </span>
        </div>
        <ul className="design-page-picker__list">
          {items.map((item) => (
            <li key={item.key}>
              <label className="design-page-picker__row">
                <input
                  type="checkbox"
                  checked={checked.has(item.key)}
                  onChange={() => toggle(item.key)}
                  data-design-key={item.key}
                />
                <span className="design-page-picker__no" title="design.csv のページ番号">
                  {item.page_label}
                </span>
                <span className="design-page-picker__name">{item.drawing_name || '(図名なし)'}</span>
                <span className={`design-page-picker__mode design-page-picker__mode--${item.mode}`}>
                  {MODE_LABEL[item.mode]}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {!canOpen && <p className="design-page-picker__warn">1件以上の図面を選択してください。</p>}
        <div className="design-page-picker__actions">
          {cancelable && (
            <button type="button" onClick={onCancel}>
              キャンセル
            </button>
          )}
          <button type="button" className="design-page-picker__open" onClick={confirm} disabled={!canOpen}>
            開く
          </button>
        </div>
      </div>
    </div>
  )
}
