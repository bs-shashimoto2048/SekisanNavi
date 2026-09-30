// 図面情報マスタ (Issue #40 Phase 2で新設、Phase 3で初めてUIに表示する)の
// 内部enum値 -> 作業者向け日本語ラベルの変換。
//
// Backend `app.domain.estimate_rules`の内部enum値(英語スネークケース)を
// そのままUIへ出さない(Issue #40 Phase 3指示: 「作業者向けには英語enumを
// 表示しない」)。値そのものの一覧はBackend側と重複管理せず、この
// モジュールが唯一のラベル定義箇所とする(`EstimateMasterPicker`が
// `category`文字列をハードコードせずBackendの順序をそのまま使うのとは異なり、
// enum値自体は`types/domain.ts`の型定義に固定されているため、ここでの
// ラベル対応表は安全に固定できる)。
import type { ApplicableUnit, EvidenceUsage, JudgmentScope } from '../types/domain'

export const USAGE_LABELS: Record<EvidenceUsage, string> = {
  estimate_target: '積算対象',
  condition: '判定条件',
  both: '両方',
}

export const JUDGMENT_SCOPE_LABELS: Record<JudgmentScope, string> = {
  position: '位置',
  range: '範囲',
  panel: '盤全体',
  drawing: '図面全体',
  product: '製番全体',
  design_data: '設計データ',
}

export const APPLICABLE_UNIT_LABELS: Record<ApplicableUnit, string> = {
  face: '1面',
  unit: '1台',
  product: '1製番',
  location: '1か所',
  sheet: '1枚',
  actual_quantity: '実数量',
  other: 'その他',
}

export function usageLabel(usage: EvidenceUsage): string {
  return USAGE_LABELS[usage] ?? usage
}

export function judgmentScopeLabel(scope: JudgmentScope): string {
  return JUDGMENT_SCOPE_LABELS[scope] ?? scope
}

export function applicableUnitLabel(unit: ApplicableUnit): string {
  return APPLICABLE_UNIT_LABELS[unit] ?? unit
}
