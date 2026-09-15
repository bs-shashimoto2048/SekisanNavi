import type { ReactNode } from 'react'
import './FloatingPanel.css'

interface Props {
  /** 表示中かどうか (Issue #19 Phase 2: 上位のトグルバーから個別にON/OFFできる)。
   * false の間はCSSで隠すのではなく、DOMへ描画しない。Viewer操作(BBox選択/
   * ドラッグ等)のヒットテスト対象から完全に外すため。 */
  visible: boolean
  /** 既定配置。ドラッグ移動・自由配置は今回のPhase 2では対象外(指示: floating
   * panelのドラッグ移動/自由リサイズは必須にしない)。積算集約=Viewer右上寄り、
   * 積算明細=Viewer右下寄りに固定し、両方表示時も重ならないようにする。 */
  position: 'aggregation' | 'detail'
  /** 内包する`EstimateAggregation`/`EstimateDetail`自身の折りたたみ状態
   * (Issue #6の既存機能、そのまま維持)。折りたたみ中はこのシェル自身の高さも
   * 見出し分だけに縮める(`App.tsx`側で右ペイン3領域が行っていたのと同じ
   * 「隣接領域へ高さを還元する」考え方を、floating化後もこのpanel単体に適用する)。 */
  collapsed: boolean
  children: ReactNode
}

/**
 * 積算集約・積算明細をViewer上へ重ねて表示するためのfloating panelシェル
 * (Issue #19 Phase 2: 右ペインから積算集約・積算明細を外し、図面Viewerを
 * 最大化する)。
 *
 * `EstimateAggregation`/`EstimateDetail`自体は一切変更せず、このシェルで
 * 包むだけで配置場所を右ペイン→Viewer上へ変更する(既存componentを極力
 * 再利用する方針)。両コンポーネントは元々「親から高さを100%で受け取る」設計
 * (`height:100%`、旧右ペインのwrapper divが高さを指定していたのと同じ契約)の
 * ため、このシェル側のCSS(`FloatingPanel.css`)で固定の高さを与え、内部は
 * 各コンポーネント自身の内部スクロールに任せる。
 */
export function FloatingPanel({ visible, position, collapsed, children }: Props) {
  if (!visible) return null
  return (
    <div
      className={`floating-panel floating-panel--${position}`}
      style={collapsed ? { height: 'auto' } : undefined}
    >
      {children}
    </div>
  )
}
