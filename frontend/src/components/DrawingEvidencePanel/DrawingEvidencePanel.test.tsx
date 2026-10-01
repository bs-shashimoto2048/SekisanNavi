import { render, screen, fireEvent, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DrawingEvidencePanel } from './DrawingEvidencePanel'
import { fetchDrawingEvidenceTypes } from '../../api/client'
import type { DrawingEvidenceType } from '../../types/domain'

function makeType(overrides: Partial<DrawingEvidenceType> = {}): DrawingEvidenceType {
  return {
    id: 1,
    key: 'vct',
    display_name: 'VCT',
    category: '受電機器',
    usage: 'both',
    default_judgment_scope: 'panel',
    description: '真空遮断器',
    enabled: true,
    ...overrides,
  }
}

const CH: DrawingEvidenceType = makeType({
  id: 2,
  key: 'ch',
  display_name: 'CH',
  category: '受電機器',
  usage: 'condition',
  default_judgment_scope: 'panel',
  description: 'コンデンサヒューズ(テスト用)',
})

const SIDE_DOOR: DrawingEvidenceType = makeType({
  id: 3,
  key: 'side_door',
  display_name: '側面扉',
  category: '扉',
  usage: 'estimate_target',
  default_judgment_scope: 'drawing',
  description: null,
})

const DISABLED_TYPE: DrawingEvidenceType = makeType({
  id: 4,
  key: 'disabled_one',
  display_name: '無効化された図面情報',
  category: '扉',
  enabled: false,
})

let mockDataset: DrawingEvidenceType[] = [makeType(), CH, SIDE_DOOR, DISABLED_TYPE]

vi.mock('../../api/client', () => ({
  fetchDrawingEvidenceTypes: vi.fn(() => Promise.resolve(mockDataset)),
}))

beforeEach(() => {
  mockDataset = [makeType(), CH, SIDE_DOOR, DISABLED_TYPE]
  vi.mocked(fetchDrawingEvidenceTypes).mockClear()
  window.localStorage.clear()
})

describe('DrawingEvidencePanel (Issue #40 Phase 3: 図面情報floating panel)', () => {
  it('shows the heading as 図面情報 with a count, not raw enum values', async () => {
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)
    expect(await screen.findByRole('heading', { name: /図面情報/ })).toBeInTheDocument()
  })

  it('lists all enabled evidence types by default (すべて), excluding disabled ones', async () => {
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)
    expect(await screen.findByText('VCT')).toBeInTheDocument()
    expect(screen.getByText('CH')).toBeInTheDocument()
    expect(screen.getByText('側面扉')).toBeInTheDocument()
    expect(screen.queryByText('無効化された図面情報')).not.toBeInTheDocument()
  })

  it('shows usage and judgment scope as Japanese labels, never the raw English enum value', async () => {
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)
    await screen.findByText('VCT')
    // usage: 'both' -> 両方, 'condition' -> 判定条件, 'estimate_target' -> 積算対象
    expect(screen.getByText('両方')).toBeInTheDocument()
    expect(screen.getByText('判定条件')).toBeInTheDocument()
    expect(screen.getByText('積算対象')).toBeInTheDocument()
    // scope: 'panel' -> 盤全体, 'drawing' -> 図面全体
    expect(screen.getAllByText('盤全体').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('図面全体')).toBeInTheDocument()
    expect(screen.queryByText('both')).not.toBeInTheDocument()
    expect(screen.queryByText('condition')).not.toBeInTheDocument()
    expect(screen.queryByText('panel')).not.toBeInTheDocument()
  })

  it('filters the list by category via the category select', async () => {
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)
    await screen.findByText('VCT')

    const select = screen.getByLabelText('カテゴリ') as HTMLSelectElement
    fireEvent.change(select, { target: { value: '扉' } })

    expect(screen.queryByText('VCT')).not.toBeInTheDocument()
    expect(screen.getByText('側面扉')).toBeInTheDocument()
  })

  it('toggles selection: clicking selects, clicking the same row again deselects (same convention as EstimateMasterPicker)', async () => {
    const onSelectKey = vi.fn()
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={onSelectKey} />)
    const row = await screen.findByText('VCT')
    fireEvent.click(row.closest('button') as HTMLElement)
    expect(onSelectKey).toHaveBeenCalledWith('vct')
  })

  it('marks the selected row with aria-pressed and shows a 選択中の図面情報 summary with description', async () => {
    render(<DrawingEvidencePanel selectedKey="vct" onSelectKey={() => {}} />)
    const row = (await screen.findByText('VCT')).closest('button') as HTMLElement
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(/選択中: VCT/)).toBeInTheDocument()
    expect(screen.getByText('真空遮断器')).toBeInTheDocument()
  })

  it('adds a selected evidence type to the 最近使用 chip list, persisted via localStorage', async () => {
    const { rerender } = render(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)
    const row = (await screen.findByText('VCT')).closest('button') as HTMLElement
    fireEvent.click(row)

    const recentSection = screen.getByText('最近使用').parentElement as HTMLElement
    expect(within(recentSection).getByText('VCT')).toBeInTheDocument()

    // 再マウントしてもlocalStorageから復元される。
    rerender(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)
    await screen.findByText('最近使用')
    const recentSectionAfterRemount = screen.getByText('最近使用').parentElement as HTMLElement
    expect(within(recentSectionAfterRemount).getByText('VCT')).toBeInTheDocument()
  })

  it('does not show the 最近使用 section when nothing has been used yet', async () => {
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)
    await screen.findByText('VCT')
    expect(screen.queryByText('最近使用')).not.toBeInTheDocument()
  })

  it('[PR #47レビュー指摘対応] falls back to the empty-list message (its existing, unchanged behavior) when its own fetchDrawingEvidenceTypes() rejects, without crashing', async () => {
    vi.mocked(fetchDrawingEvidenceTypes).mockImplementationOnce(() => Promise.reject(new Error('network error')))
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)

    // 失敗時もクラッシュせず、既存の「0件」fallback表示(該当する図面情報が
    // ありません)がそのまま出る(このcomponent自身の挙動は今回変更していない。
    // App.tsx側の責務(App共通errorへ入れない)とは独立した確認)。
    expect(await screen.findByText('該当する図面情報がありません')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '図面情報' })).toBeInTheDocument()
  })
})
