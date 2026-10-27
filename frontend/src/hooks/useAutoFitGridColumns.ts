import { useLayoutEffect } from 'react'
import type { RefObject } from 'react'

/**
 * CSS Gridベースの疑似表(1行=独立したgrid container、`PanelInfo`が使う
 * 「`<button>`自身をgridにして行全体をクリック可能にする」パターン)で、
 * 列幅を見出し/表示データの実際の自然な幅へ揃えるための共通hook
 * (Issue #40 追加修正: 表・データグリッド形式の一覧のカラム幅改善)。
 *
 * `<table>`の`table-layout: auto`(`auto-fit-table`、index.css参照)は
 * ブラウザが複数行をまたいで自動的に列幅を揃えてくれるが、CSS Gridでは
 * 各行が別々のgrid containerである限り、列(トラック)のサイズは行ごとに
 * 独立して決まってしまい、`grid-template-columns: max-content`を行の
 * class側で指定しただけでは行ごとに幅がずれる。
 *
 * このhookは、`containerRef`配下にある`data-auto-col="N"`属性付きの全セルを
 * 横断して集計し、列(N)ごとの最大自然幅(nowrap状態でのscrollWidth)を
 * `containerRef`の要素上のCSS変数`--auto-col-N`として設定する。呼び出し側は
 * 各行(ヘッダ行・データ行とも)の`grid-template-columns`に
 * `var(--auto-col-0) var(--auto-col-1) ...`を指定するだけでよく、列幅の
 * px値を個別にCSSへハードコードする必要がない。
 *
 * - `deps`に実際の表示内容(行データ)を渡すことで、データ・絞り込みの変更時に
 *   再計測される。
 * - 画面幅の変更(floating panelのリサイズ含む)にも`ResizeObserver`で追従する。
 * - jsdom(テスト環境)は`scrollWidth`等のレイアウト計測を実装していないため、
 *   テスト上は常に0扱いになる(クラッシュはしない)。実際の列幅確認は
 *   実ブラウザで行う(このリポジトリの既存方針、`docs/coding-conventions.md`
 *   「テスト」節参照)。
 */
export function useAutoFitGridColumns(
  containerRef: RefObject<HTMLElement | null>,
  columnCount: number,
  deps: unknown[],
): void {
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    function recalc() {
      if (!container) return
      for (let col = 0; col < columnCount; col++) {
        let maxWidth = 0
        const cells = container.querySelectorAll<HTMLElement>(`[data-auto-col="${col}"]`)
        cells.forEach((cell) => {
          maxWidth = Math.max(maxWidth, cell.scrollWidth)
        })
        container.style.setProperty(`--auto-col-${col}`, `${maxWidth}px`)
      }
    }

    recalc()

    const observer = new ResizeObserver(recalc)
    observer.observe(container)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, columnCount, ...deps])
}
