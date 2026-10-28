import { useEffect, useRef, useState } from 'react'
import type { SteelOutline } from '../../types/domain'
import { classifyMaterialSpec } from '../../domain/materialGroups'
import { groupSteelItems, matchCabtype, type CabtypeMatch } from '../../domain/steelOutline'

interface Props {
  /** 外形図の鋼材データ。undefined=この欄を出さない(既存の呼び出し・テストへの影響を避ける)。
   * null=取得中。 */
  steel: SteelOutline | null | undefined
  /** 製番全体の箱体型式(estimatePanels[].model)。選択中のページ・盤には連動しない。 */
  panelModels: Array<string | null | undefined>
  /** PanelInfoの上段カードとして表示するときの初期展開状態。 */
  defaultExpanded?: boolean
}

function MatchNote({ match }: { match: CabtypeMatch }) {
  switch (match.kind) {
    case 'match':
      return (
        <p className="steel-section__match steel-section__match--ok" data-match="match">
          ✓ 箱体型式 {match.model} と一致
        </p>
      )
    case 'mismatch':
      return (
        <p className="steel-section__match steel-section__match--ng" data-match="mismatch">
          ✗ 箱体型式({match.models.join(' / ')})と一致しません
        </p>
      )
    case 'unknown-no-model':
      return (
        <p className="steel-section__match steel-section__match--warn" data-match="unknown">
          △ 箱体型式の情報がないため、対応は不明です
        </p>
      )
    default:
      return (
        <p className="steel-section__match steel-section__match--warn" data-match="unknown">
          △ CABTYPEの記載がないため、対応は不明です
        </p>
      )
  }
}

const STATUS_MESSAGE: Record<string, string> = {
  invalid: '鋼材データを読み込めませんでした',
  no_outline: '外形図の鋼材データがありません',
  unavailable: '鋼材データを取得できませんでした',
}

/**
 * 図面情報パネルの「鋼材」欄(折りたたみ)。material.csv のうち、製番の外形図1ページぶん(Backendが選ぶ)を表示する。
 * 選択中の図面ページには連動しない。表示文言はすべて固定文(例外文言・パス・製番は受け取らない)。
 * 材料仕様の `未記載`(記載なし)と `無し`(明示値)は、元の文字列のまま区別して表示する。
 */
export function SteelSection({ steel, panelModels, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const sectionRef = useRef<HTMLElement>(null)
  const mountedRef = useRef(false)
  // 盤情報パネルは小さく内部スクロールのため、展開したとき欄全体が見える位置までスクロールする
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    if (expanded) sectionRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [expanded])
  if (steel === undefined) return null

  let body: React.ReactNode
  if (steel === null) {
    body = <p className="steel-section__empty">読み込み中…</p>
  } else if (steel.status === 'ok' && steel.items.length > 0) {
    const source = [steel.source_drawing_name, steel.source_page != null ? `P${steel.source_page}` : null]
      .filter((s) => s)
      .join(' ')
    body = (
      <div className="steel-section__body">
        <p className="steel-section__source">表示元: {source || '外形図'}</p>
        {groupSteelItems(steel.items).map((group, gi) => (
          <section className="steel-section__group" key={gi} data-testid="steel-group">
            <dl className="steel-section__head">
              <div>
                <dt>記号名</dt>
                <dd>{group.symbolName || '-'}</dd>
              </div>
              <div>
                <dt>CABTYPE</dt>
                <dd>{group.cabtype || '-'}</dd>
              </div>
            </dl>
            <MatchNote match={matchCabtype(group.cabtype, panelModels)} />
            <table className="steel-section__table">
              <thead>
                <tr>
                  <th>構成部名</th>
                  <th>材料仕様</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((item, ii) => (
                  <tr key={ii}>
                    <td>{item.component_name || '-'}</td>
                    <td
                      className={`material-info__spec--${classifyMaterialSpec(item.material_spec)}`}
                      data-spec-kind={classifyMaterialSpec(item.material_spec)}
                    >
                      {item.material_spec || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    )
  } else {
    body = <p className="steel-section__empty">{STATUS_MESSAGE[steel.status] ?? '鋼材データがありません'}</p>
  }

  return (
    <section className="steel-section panel-info__summary-card" aria-label="鋼材" ref={sectionRef}>
      <h3 className="steel-section__heading">
        <button
          type="button"
          className="steel-section__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
        >
          <span className="steel-section__caret">{expanded ? '▾' : '▸'}</span> 鋼材
        </button>
      </h3>
      {expanded && body}
    </section>
  )
}
