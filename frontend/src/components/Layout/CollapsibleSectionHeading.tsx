import './CollapsibleSectionHeading.css'

interface Props {
  title: string
  collapsed: boolean
  onToggle: () => void
  /** 呼び出し側の既存見出しclass(`panel-info__heading`等)をそのまま`<h2>`へ渡す。
   * 背景色・左アクセント・paddingといった見た目は各コンポーネントのCSSが正であり、
   * このコンポーネントは開閉の振る舞い(トグルボタン化+chevron表示)だけを追加する
   * (Issue #6: 新しい見出しデザインを作らない)。 */
  headingClassName: string
}

/**
 * 右ペイン3領域(盤情報・積算集約・積算明細)共通の「折りたたみ可能な見出し」
 * (Issue #6: Improve estimation target visibility and collapsible right pane
 * sections)。
 *
 * 3領域とも全く同じ振る舞い(クリックで開閉・chevron表示・aria-expanded)を
 * 必要とするため、`PaneSplitter`と同様に共通コンポーネント化する(3箇所へ
 * 同じクリックハンドラ・アクセシビリティ属性を複製すると修正時に3箇所直す
 * 羽目になるため。単なる色等の静的値の重複とは異なり、ここでは重複させない
 * 判断とする)。
 *
 * 見出し自体の高さ・paddingは変えない: `<h2>`要素はそのまま(既存の背景・
 * border-left等を維持)、その中の`<button>`はpadding:0/background:transparent/
 * font:inheritとし、既存の`.estimate-detail__sort-button`等と同じ
 * 「クリック領域だけ広げ、見た目には何も足さない」ボタンパターンを踏襲する。
 */
export function CollapsibleSectionHeading({ title, collapsed, onToggle, headingClassName }: Props) {
  return (
    <h2 className={headingClassName}>
      <button
        type="button"
        className="collapsible-section-heading__toggle"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <span className="collapsible-section-heading__chevron" aria-hidden="true">
          {collapsed ? '▶' : '▼'}
        </span>
        {title}
      </button>
    </h2>
  )
}
