import './ViewerGuide.css'

interface OperationRow {
  operation: string
  method: string
}

// Issue #31 指示どおりの内容(操作方法/文言)。docs/user-guide.mdの正式な詳細
// マニュアルを置き換えるものではなく、あくまで作業中に確認できる簡易な
// クイックリファレンスに限定する(全文Markdown埋め込みは対象外)。
// [Issue #40 Phase 6-C指示10章] 「BBox追加」の方法を、旧来の部品台帳経由
// (積算コード直接選択)から新ワークフローの図面情報経由へ更新した
// (部品台帳は補助機能として引き続き使用可能、下記SCREENS参照)。
const OPERATIONS: OperationRow[] = [
  { operation: '拡大・縮小', method: 'マウスホイール' },
  { operation: '図面移動', method: 'ホイール押し込み + drag' },
  { operation: '全体表示', method: 'ホイール押し込みダブルクリック / Fit' },
  { operation: 'BBox選択', method: '左クリック' },
  { operation: 'BBox移動', method: 'BBox内を左drag' },
  { operation: 'BBoxサイズ変更', method: '四隅を左drag' },
  { operation: 'BBox追加', method: '図面情報で項目選択 → 図面上を左drag' },
  { operation: 'ラベル移動', method: 'ラベルを左drag' },
  { operation: '元に戻す', method: '「元に戻す」' },
  { operation: 'やり直す', method: '「やり直す」' },
]

interface ScreenRow {
  name: string
  description: string
}

// [Issue #40 Phase 6-C指示10章] 新ワークフローの主導線である「図面情報」を
// 先頭にし、「部品台帳」には補助機能であることを明記する。
const SCREENS: ScreenRow[] = [
  { name: '図面情報', description: '図面上で見えている根拠(VCT/CH等)を選ぶ' },
  { name: '盤情報', description: '盤の寸法・型式' },
  { name: '積算集約', description: '数量・金額の集計' },
  { name: '積算明細', description: 'BBox単位の根拠・数量/係数の修正' },
  { name: '部品台帳', description: '(補助) 積算コードを直接指定したい場合のみ使用' },
]

// [Issue #40 Phase 6-C指示10章] 「図面を見る→図面情報を選ぶ→根拠BBox作成→
// 自動再評価→積算結果が増減→積算集約/積算明細で確認→必要なら数量/係数を
// 修正→根拠へ戻る→要確認を解消→確定」という主操作フローを、作業中にその場で
// 確認できる短いステップへ要約したもの(指示: 「短く」)。
const WORKFLOW_STEPS: string[] = [
  '図面情報を選ぶ',
  '図面を囲む',
  '積算結果を確認',
  '必要なら数量/係数を修正',
  '要確認を解消',
  '確定',
]

/**
 * Viewer内「操作ガイド」floating panel (Issue #31、Issue #40 Phase 6-Cで
 * 新ワークフローへ内容を更新)。
 *
 * `docs/user-guide.md`(正式な詳細マニュアル)を置き換えるものではなく、
 * 作業中にマウス操作や主要floating panelの役割をその場で確認できる、
 * 軽量なクイックリファレンスに限定する(指示B-5/B-6、全文Markdown埋め込みは
 * 対象外)。他5panel(`DrawingEvidencePanel`/`PanelInfo`/`EstimateAggregation`/
 * `EstimateDetail`/`EstimateMasterPicker`)と同じく、`FloatingPanel`のシェルに
 * 包まれて表示/非表示・drag・resize・最前面化・透過度・clampの対象になる
 * (`FloatingPanel.tsx`参照)。見出し(`<h2>`)はFloatingPanel側の
 * ドラッグハンドル判定を兼ねる。
 */
export function ViewerGuide() {
  return (
    <section className="viewer-guide">
      <h2 className="viewer-guide__heading">操作ガイド</h2>

      <div className="viewer-guide__scroll">
        {/* [Issue #40 Phase 6-C指示10章] 新フローを先頭に短く示す。 */}
        <h3 className="viewer-guide__section-title">基本の流れ</h3>
        <ol className="viewer-guide__workflow-list">
          {WORKFLOW_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <h3 className="viewer-guide__section-title">基本操作</h3>
        <table className="viewer-guide__table">
          <thead>
            <tr>
              <th>操作</th>
              <th>方法</th>
            </tr>
          </thead>
          <tbody>
            {OPERATIONS.map((row) => (
              <tr key={row.operation}>
                <td>{row.operation}</td>
                <td>{row.method}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="viewer-guide__section-title">画面を見る</h3>
        <ul className="viewer-guide__screen-list">
          {SCREENS.map((row) => (
            <li key={row.name}>
              <strong>{row.name}</strong>: {row.description}
            </li>
          ))}
        </ul>

        <p className="viewer-guide__footer">
          <strong>詳しい操作方法はユーザーガイドを参照</strong>
        </p>
      </div>
    </section>
  )
}
