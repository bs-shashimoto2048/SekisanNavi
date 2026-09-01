import type { DrawingPage, EstimateItem, EstimateSourceType, EstimateStatus } from '../../types/domain'
import './EstimateTree.css'

const SOURCE_LABEL: Record<EstimateSourceType, string> = {
  program: 'プログラム',
  ai: 'AI',
  manual: '手動',
}

const STATUS_LABEL: Record<EstimateStatus, string> = {
  auto: '自動',
  confirmed: '確定',
  needs_review: '要確認',
  excluded: '除外',
}

interface Props {
  items: EstimateItem[]
  pagesById: Map<number, DrawingPage>
  onNavigateReference: (drawingPageId: number, detectionId: number | null) => void
}

function groupByCategory(items: EstimateItem[]): [string, EstimateItem[]][] {
  const order: string[] = []
  const groups = new Map<string, EstimateItem[]>()
  for (const item of items) {
    if (!groups.has(item.category)) {
      groups.set(item.category, [])
      order.push(item.category)
    }
    groups.get(item.category)!.push(item)
  }
  return order.map((category) => [category, groups.get(category)!])
}

/**
 * 積算結果をTree表示する (要件13)。
 * 根拠図面クリックで onNavigateReference を呼び、Viewer側でページ移動・BBox選択・
 * 一時強調表示を行わせる。
 */
export function EstimateTree({ items, pagesById, onNavigateReference }: Props) {
  const groups = groupByCategory(items)

  return (
    <section className="estimate-tree">
      <h2 className="estimate-tree__heading">積算結果</h2>
      {groups.map(([category, categoryItems]) => (
        <div key={category} className="estimate-tree__group">
          <div className="estimate-tree__category">{category}</div>
          <ul className="estimate-tree__items">
            {categoryItems.map((item) => (
              <li key={item.id}>
                <div className={`estimate-tree__item estimate-tree__item--${item.status}`}>
                  <span className="estimate-tree__code">{item.code}</span>
                  <span className="estimate-tree__name">
                    {item.item_name}
                    {item.model ? ` ${item.model}` : ''}
                  </span>
                  <span className="estimate-tree__badge">{SOURCE_LABEL[item.source_type]}</span>
                  <span className="estimate-tree__badge estimate-tree__badge--status">
                    {STATUS_LABEL[item.status]}
                  </span>
                </div>
                <ul className="estimate-tree__references">
                  {item.references.map((ref) => {
                    const page = pagesById.get(ref.drawing_page_id)
                    return (
                      <li key={ref.id}>
                        <button
                          type="button"
                          className="estimate-tree__reference"
                          onClick={() => onNavigateReference(ref.drawing_page_id, ref.detection_id)}
                          title={ref.reason ?? undefined}
                        >
                          {page ? page.drawing_name : `図面 #${ref.drawing_page_id}`}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
