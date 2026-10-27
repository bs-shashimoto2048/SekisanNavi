import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PanelVisibilityToggles } from './PanelVisibilityToggles'
import type { EstimateTarget } from '../../types/estimateAggregation'

function makeTarget(overrides: Partial<EstimateTarget> = {}): EstimateTarget {
  return { id: 'product', type: 'product', name: '製番仕様', banMenno: null, banNo: null, ...overrides }
}

function renderToggles(overrides: Partial<Parameters<typeof PanelVisibilityToggles>[0]> = {}) {
  return render(
    <PanelVisibilityToggles
      guideVisible={false}
      onToggleGuide={() => {}}
      panelInfoVisible={true}
      onTogglePanelInfo={() => {}}
      aggregationVisible={true}
      onToggleAggregation={() => {}}
      detailVisible={true}
      onToggleDetail={() => {}}
      masterVisible={false}
      onToggleMaster={() => {}}
      drawingEvidenceVisible={true}
      onToggleDrawingEvidence={() => {}}
      targets={[makeTarget()]}
      selectedTargetId={null}
      onSelectTarget={() => {}}
      {...overrides}
    />,
  )
}

// 指示(ヘッダーボタン群の並び替え): 「『操作ガイド』ボタンを一番左へ移動する。
// 対象プルダウンをボタン群の一番最後(右端)へ移動する。それ以外のボタンの
// 順序、機能、対象プルダウンの選択肢・連動動作は変更しない」。
// 指示(図面情報パネルの表示内容): 旧「盤情報」専用ボタンは廃止し、その内容
// (`panelInfoVisible`/`onTogglePanelInfo`配線)は「図面情報」という名前の
// ボタンで表示する。旧「図面情報」ボタン(`drawingEvidenceVisible`/
// `onToggleDrawingEvidence`配線)は「図面情報追加」という名前に変わった。
describe('PanelVisibilityToggles: ヘッダーボタン群の並び順', () => {
  it('orders children as 操作ガイド → 図面情報 → 図面情報追加 → 積算集約 → 積算明細 → 部品台帳 → 対象select (操作ガイドが先頭、対象が末尾、他は従来の相対順を維持)', () => {
    const { container } = renderToggles()
    expect(screen.getAllByRole('combobox')).toHaveLength(1)

    const children = Array.from(container.querySelector('.panel-visibility-toggles')!.children)
    const indexOf = (predicate: (el: Element) => boolean) => children.findIndex(predicate)

    const guideIndex = indexOf((el) => el.textContent === '操作ガイド')
    const panelInfoIndex = indexOf((el) => el.textContent === '図面情報')
    const drawingEvidenceIndex = indexOf((el) => el.textContent === '図面情報追加')
    const aggregationIndex = indexOf((el) => el.textContent === '積算集約')
    const detailIndex = indexOf((el) => el.textContent === '積算明細')
    const toolIndex = indexOf((el) => el.textContent === '部品台帳')
    const selectLabelIndex = indexOf((el) => el.className === 'target-selector__label')

    // 操作ガイドが一番左(他のどの要素よりも前)。
    expect(guideIndex).toBe(0)
    // 対象selectが一番右(他のどの要素よりも後)。
    expect(selectLabelIndex).toBe(children.length - 1)
    // それ以外のボタンの相対順序(図面情報→図面情報追加→積算集約→積算明細→部品台帳)は維持。
    expect(panelInfoIndex).toBeLessThan(drawingEvidenceIndex)
    expect(drawingEvidenceIndex).toBeLessThan(aggregationIndex)
    expect(aggregationIndex).toBeLessThan(detailIndex)
    expect(detailIndex).toBeLessThan(toolIndex)
    expect(toolIndex).toBeLessThan(selectLabelIndex)
  })

  it('scrolls horizontally instead of clipping/wrapping when the row is too narrow to fit everything (指示: 狭い画面幅でも並び順が保たれ、レイアウトが崩れないことを確認する)', () => {
    // 対象selectが一番右端に来たことで、画面が狭い場合にツールバー外へ
    // 見切れてしまう恐れがある(並び替え前は右端が操作ガイドだった)。
    // jsdomは実レイアウトを行わないため、実際にスクロール可能になる
    // ピクセル単位の確認は実ブラウザ(Playwright)で別途行う。ここでは
    // 「要素が縮んだり画面外へ押し出されたりするのではなく、横スクロールで
    // 対応する」という設計(CSS宣言)自体を検証する。
    const { container } = renderToggles()
    const toggles = container.querySelector('.panel-visibility-toggles') as HTMLElement
    expect(getComputedStyle(toggles).overflowX).toBe('auto')
    expect(getComputedStyle(toggles).minWidth).toBe('0px')

    // 各ボタン・区切り線・対象selectは、横スクロール領域内で個別に縮んだり
    // 文字が折り返んだりしない(flex-shrink: 0 + white-space: nowrap)。
    const button = screen.getByRole('button', { name: '操作ガイド' })
    expect(getComputedStyle(button).whiteSpace).toBe('nowrap')
    expect(getComputedStyle(button).flexShrink).toBe('0')

    const divider = container.querySelector('.panel-visibility-toggles__divider') as HTMLElement
    expect(getComputedStyle(divider).flexShrink).toBe('0')

    const selectLabel = container.querySelector('.target-selector__label') as HTMLElement
    expect(getComputedStyle(selectLabel).flexShrink).toBe('0')
  })

  it('keeps the 図面情報 toggle button (旧「盤情報」、panelInfoVisible配線) fully functional (clickable, aria-pressed reflects visibility)', () => {
    const onTogglePanelInfo = vi.fn()
    renderToggles({ panelInfoVisible: true, onTogglePanelInfo })
    const button = screen.getByRole('button', { name: '図面情報' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    button.click()
    expect(onTogglePanelInfo).toHaveBeenCalledTimes(1)
  })

  it('keeps the 図面情報追加 toggle button (旧「図面情報」、drawingEvidenceVisible配線) fully functional (clickable, aria-pressed reflects visibility)', () => {
    const onToggleDrawingEvidence = vi.fn()
    renderToggles({ drawingEvidenceVisible: true, onToggleDrawingEvidence })
    const button = screen.getByRole('button', { name: '図面情報追加' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    button.click()
    expect(onToggleDrawingEvidence).toHaveBeenCalledTimes(1)
  })

  it('does not interfere with the other panel toggle buttons (図面情報/図面情報追加/積算集約/積算明細/部品台帳/操作ガイド all remain present and clickable)', () => {
    const handlers = {
      onTogglePanelInfo: vi.fn(),
      onToggleDrawingEvidence: vi.fn(),
      onToggleAggregation: vi.fn(),
      onToggleDetail: vi.fn(),
      onToggleMaster: vi.fn(),
      onToggleGuide: vi.fn(),
    }
    renderToggles(handlers)

    for (const [name, handler] of [
      ['図面情報', handlers.onTogglePanelInfo],
      ['図面情報追加', handlers.onToggleDrawingEvidence],
      ['積算集約', handlers.onToggleAggregation],
      ['積算明細', handlers.onToggleDetail],
      ['部品台帳', handlers.onToggleMaster],
      ['操作ガイド', handlers.onToggleGuide],
    ] as const) {
      const button = screen.getByRole('button', { name })
      button.click()
      expect(handler).toHaveBeenCalledTimes(1)
    }
  })

  it('shares the same selectedTargetId/targets as both 積算集約 and 積算明細 would (controlled by the same App.tsx state)', () => {
    const onSelectTarget = vi.fn()
    const targets = [makeTarget(), { id: 'panel:1:1', type: 'panel' as const, name: '高圧受電盤', banMenno: 1, banNo: 1 }]
    renderToggles({ targets, selectedTargetId: 'panel:1:1', onSelectTarget })
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('panel:1:1')
  })
})
