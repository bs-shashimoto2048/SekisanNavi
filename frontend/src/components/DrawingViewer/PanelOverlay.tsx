import type { PanelArea } from '../../types/domain'

interface Props {
  areas: PanelArea[]
}

/**
 * 盤範囲 (Panel Overlay)。
 *
 * 仕様は未確定 (docs/data-model.md 参照)。Detectionとは完全に独立した
 * Overlay Layerとして実装しており、座標系(0.0〜1.0正規化)のみ共通化している。
 * 1つの盤が同一ページ内に複数の範囲 (正面/背面/側面等) を持つ場合を想定し、
 * 複数の矩形を同時に描画できる。
 */
export function PanelOverlay({ areas }: Props) {
  return (
    <div className="panel-overlay">
      {areas.map((area) => (
        <div
          key={area.id}
          className="panel-overlay__area"
          style={{
            left: `${area.area_x * 100}%`,
            top: `${area.area_y * 100}%`,
            width: `${area.area_w * 100}%`,
            height: `${area.area_h * 100}%`,
          }}
          title={area.label ?? undefined}
        >
          {area.label && <span className="panel-overlay__label">{area.label}</span>}
        </div>
      ))}
    </div>
  )
}
