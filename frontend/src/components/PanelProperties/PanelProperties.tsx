import type { AttributeSource, Panel, PanelPreview } from '../../types/domain'
import './PanelProperties.css'

// 取得元の表示ラベル (要件12)。W/D/H等の項目名はここにハードコードしない。
const SOURCE_LABEL: Record<AttributeSource, string> = {
  design_data: '設計データ',
  ai: 'AI検出',
  manual: '手動入力',
}

interface Props {
  panel: Panel | null
  /** 中央Viewerで選択中のproduct_df盤情報 (Phase 1.9)。選択されている場合は
   * こちらを優先して表示する (要件11)。ダミーDB由来の`panel`とは独立した概念。 */
  selectedProductPanel: PanelPreview | null
}

// product_dfの値をnull安全に表示する (要件14)。null/undefined/NaN/空文字は
// "-" とし、`undefined`/`null`/`NaN` という文字列をそのままUIへ出さない。
function formatValue(value: string | number | null | undefined, unit?: string): string {
  if (value == null) return '-'
  if (typeof value === 'number' && Number.isNaN(value)) return '-'
  if (typeof value === 'string' && value.trim() === '') return '-'
  return unit ? `${value} ${unit}` : String(value)
}

/**
 * 選択中の盤情報を表示する。
 *
 * Phase 1.9: 中央Viewerでproduct_df盤領域を選択した場合、`selectedProductPanel`が
 * 優先して表示される (指示書11章)。何も選択していない場合は、従来通りDetectionに
 * 紐づくダミーDBの`panel`情報を表示する (後方互換。属性リストはAPIから受け取った
 * panel.attributesをそのまま描画するのみで、個別の属性名(W/D/H/BAN_NO等)を
 * コンポーネント側にハードコードしない。要件12)。
 */
export function PanelProperties({ panel, selectedProductPanel }: Props) {
  return (
    <section className="panel-properties">
      <h2 className="panel-properties__heading">盤パラメータ</h2>
      {!selectedProductPanel && !panel && (
        <p className="panel-properties__empty">盤が選択されていません</p>
      )}
      {selectedProductPanel && (
        <>
          <div className="panel-properties__title">
            {selectedProductPanel.ban_menno}/{selectedProductPanel.ban_no} /{' '}
            {formatValue(selectedProductPanel.ban_meisyou)}
          </div>
          <table className="panel-properties__table">
            <tbody>
              <tr>
                <th>PAGE</th>
                <td>{formatValue(selectedProductPanel.page_no)}</td>
              </tr>
              <tr>
                <th>面番号</th>
                <td>{formatValue(selectedProductPanel.ban_menno)}</td>
              </tr>
              <tr>
                <th>盤番号</th>
                <td>{formatValue(selectedProductPanel.ban_no)}</td>
              </tr>
              <tr>
                <th>盤名称</th>
                <td>{formatValue(selectedProductPanel.ban_meisyou)}</td>
              </tr>
              <tr>
                <th>表示種別</th>
                <td>{formatValue(selectedProductPanel.ban_type)}</td>
              </tr>
              <tr>
                <th>H1</th>
                <td>{formatValue(selectedProductPanel.ban_h1, 'mm')}</td>
              </tr>
              <tr>
                <th>H2</th>
                <td>{formatValue(selectedProductPanel.ban_h2, 'mm')}</td>
              </tr>
              <tr>
                <th>W</th>
                <td>{formatValue(selectedProductPanel.ban_w, 'mm')}</td>
              </tr>
              <tr>
                <th>D</th>
                <td>{formatValue(selectedProductPanel.ban_d, 'mm')}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
      {!selectedProductPanel && panel && (
        <>
          <div className="panel-properties__title">
            {panel.panel_no} / {panel.name}
          </div>
          <table className="panel-properties__table">
            <tbody>
              {[...panel.attributes]
                .sort((a, b) => a.display_order - b.display_order)
                .map((attr) => (
                  <tr key={attr.id}>
                    <th>{attr.label}</th>
                    <td>
                      {attr.value}
                      {attr.unit ? ` ${attr.unit}` : ''}
                    </td>
                    <td className="panel-properties__source">{SOURCE_LABEL[attr.source]}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
