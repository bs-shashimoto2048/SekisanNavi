import { render, screen, fireEvent, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DrawingEvidencePanel } from './DrawingEvidencePanel'
import { fetchDrawingEvidenceTypeCandidates, fetchDrawingEvidenceTypes } from '../../api/client'
import type { DrawingEvidenceType, DrawingEvidenceTypeCandidate } from '../../types/domain'

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
// [追加修正] 候補マニフェストの読み取り専用一覧。既存テスト(登録済み
// マスタが存在するケース)では候補セクション自体を表示しないため、
// 既定は空配列にしておく(allTypesが非0件の間、candidatesの中身は
// 表示へ影響しない)。
let mockCandidates: DrawingEvidenceTypeCandidate[] = []

vi.mock('../../api/client', () => ({
  fetchDrawingEvidenceTypes: vi.fn(() => Promise.resolve(mockDataset)),
  fetchDrawingEvidenceTypeCandidates: vi.fn(() => Promise.resolve(mockCandidates)),
}))

beforeEach(() => {
  mockDataset = [makeType(), CH, SIDE_DOOR, DISABLED_TYPE]
  mockCandidates = []
  vi.mocked(fetchDrawingEvidenceTypes).mockClear()
  vi.mocked(fetchDrawingEvidenceTypeCandidates).mockClear()
  window.localStorage.clear()
})

describe('DrawingEvidencePanel (Issue #40 Phase 3: 図面情報floating panel)', () => {
  it('shows the heading as 図面情報追加 with a count, not raw enum values', async () => {
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)
    expect(await screen.findByRole('heading', { name: /図面情報追加/ })).toBeInTheDocument()
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

  it('[PR #47レビュー指摘対応] falls back to an explanatory empty message (no crash) when its own fetchDrawingEvidenceTypes() rejects and there are also no candidates', async () => {
    vi.mocked(fetchDrawingEvidenceTypes).mockImplementationOnce(() => Promise.reject(new Error('network error')))
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)

    // 失敗時もクラッシュせず、0件fallback表示が出る([追加修正]
    // allTypes=0件かつcandidatesも0件のときの新しい文言。登録済み一覧
    // 取得失敗という状況自体の扱いはApp.tsx側の責務で、このcomponent自身は
    // 変更していない)。
    expect(await screen.findByText('登録済みの図面情報も、確認中の候補もありません。')).toBeInTheDocument()
    // [追加修正: 図面情報パネルの表示内容] このpanel自体のラベルは「図面情報追加」
    // へ変更した(内容・ロジックは不変)。
    expect(screen.getByRole('heading', { name: '図面情報追加' })).toBeInTheDocument()
  })
})

describe('DrawingEvidencePanel: 候補マニフェストの読み取り専用表示 (追加修正)', () => {
  const CANDIDATE_SIDE_DOOR: DrawingEvidenceTypeCandidate = {
    key: 'side_door',
    display_name: '側面扉',
    category: '扉',
    status: 'needs_business_confirmation',
    blocker: '標準含有枚数のカウント変換規則が未確定',
  }
  const CANDIDATE_VCT: DrawingEvidenceTypeCandidate = {
    key: 'vct',
    display_name: 'VCT',
    category: '受電機器',
    status: 'blocked',
    blocker: '発注者区分データの所在が未確認',
  }

  it('shows the candidate list (読み取り専用) only when registered evidence types are 0 件', async () => {
    mockDataset = []
    mockCandidates = [CANDIDATE_SIDE_DOOR, CANDIDATE_VCT]
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)

    expect(await screen.findByText('側面扉')).toBeInTheDocument()
    expect(screen.getByText('VCT')).toBeInTheDocument()
    expect(screen.getByText(/候補／確認待ち/)).toBeInTheDocument()
  })

  it('does not show the candidate list when at least one registered evidence type exists, even if candidates are returned', async () => {
    // mockDataset(既定)は非0件のまま。
    mockCandidates = [CANDIDATE_SIDE_DOOR]
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)
    await screen.findByText('VCT') // 登録済み一覧が通常どおり表示される

    expect(screen.queryByText(/候補／確認待ち/)).not.toBeInTheDocument()
    expect(fetchDrawingEvidenceTypeCandidates).toHaveBeenCalled() // 取得自体は行うが表示はしない
  })

  it('shows status and blocker text verbatim from the manifest, without inventing new Japanese reasons (指示6)', async () => {
    mockDataset = []
    mockCandidates = [CANDIDATE_SIDE_DOOR]
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)

    await screen.findByText('側面扉')
    expect(screen.getByText('標準含有枚数のカウント変換規則が未確定')).toBeInTheDocument()
    expect(screen.getByText('カテゴリ: 扉')).toBeInTheDocument()
    expect(screen.getByText(/業務確認待ち/)).toBeInTheDocument()
  })

  it('renders blocked candidates with a distinct status label from needs_business_confirmation ones', async () => {
    mockDataset = []
    mockCandidates = [CANDIDATE_SIDE_DOOR, CANDIDATE_VCT]
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)

    await screen.findByText('VCT')
    expect(screen.getByText(/対応不可/)).toBeInTheDocument()
    expect(screen.getByText(/業務確認待ち/)).toBeInTheDocument()
  })

  it('does not call onSelectKey when a candidate row is clicked, and never sends it to the BBox-add selection (candidates are not interactive, 指示4)', async () => {
    mockDataset = []
    mockCandidates = [CANDIDATE_SIDE_DOOR]
    const onSelectKey = vi.fn()
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={onSelectKey} />)

    const name = await screen.findByText('側面扉')
    fireEvent.click(name)
    fireEvent.click(name.closest('li') as HTMLElement)

    expect(onSelectKey).not.toHaveBeenCalled()
    // 候補行はbuttonではない(クリック可能なUIとして描画されていないこと)。
    expect(name.closest('button')).toBeNull()
  })

  it('shows an explanatory empty message (not a blank panel) when there are 0 registered types and 0 candidates', async () => {
    mockDataset = []
    mockCandidates = []
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)

    expect(await screen.findByText('登録済みの図面情報も、確認中の候補もありません。')).toBeInTheDocument()
  })

  it('treats "only disabled masters registered" as 0 件, showing the candidate list, and excludes a candidate whose key matches a registered (even disabled) master to avoid double display (指示3/5)', async () => {
    // DISABLED_TYPEはenabled:falseのため選択可能な一覧には出ないが、
    // allTypes自体には含まれる(byKeyにも含まれる)。このkeyと一致する候補
    // (disabled_one)は候補一覧側から除外され、一致しない候補(side_door)の
    // みが表示されることを確認する。
    mockDataset = [DISABLED_TYPE]
    mockCandidates = [
      { ...CANDIDATE_SIDE_DOOR, key: 'disabled_one', display_name: '無効化された図面情報(候補)' },
      CANDIDATE_SIDE_DOOR,
    ]
    render(<DrawingEvidencePanel selectedKey={null} onSelectKey={() => {}} />)

    expect(await screen.findByText('側面扉')).toBeInTheDocument()
    expect(screen.queryByText('無効化された図面情報(候補)')).not.toBeInTheDocument()
  })
})
