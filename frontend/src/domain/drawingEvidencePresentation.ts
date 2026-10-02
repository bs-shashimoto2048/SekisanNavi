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
import type { ApplicableUnit, EvidenceUsage, JudgmentMethod, JudgmentScope } from '../types/domain'

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

// Issue #40 Phase 4: 積算明細のルール結果行で判定方法を表示する際に使う
// (`app/domain/estimate_rules.py::JudgmentMethod`のUI表示規則そのもの、
// Issue #40 1章「設計データ/図面判定/要確認」)。
export const JUDGMENT_METHOD_LABELS: Record<JudgmentMethod, string> = {
  design_data: '設計データ',
  drawing_judgment: '図面判定',
  needs_confirmation: '要確認',
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

export function judgmentMethodLabel(method: JudgmentMethod): string {
  return JUDGMENT_METHOD_LABELS[method] ?? method
}

// [Issue #40 Phase 6-B] 設計データ根拠(`EstimateResultEvidence.design_data_ref`)
// のJSON内`field`(`app.services.design_data_context.py::DesignDataContext`の
// 属性名)を作業者向け日本語へ変換する。内部field名をそのまま表示しない方針
// (指示B-1)。
export const DESIGN_DATA_FIELD_LABELS: Record<string, string> = {
  ban_menno: '面',
  ban_no: '盤',
  ban_meisyou: '盤名称',
  model: '型式',
  ban_h1: '正面高さ',
  ban_h2: '背面高さ',
  ban_w: '幅',
  ban_d: '奥行',
  ban_connect: '接続',
}

export function designDataFieldLabel(field: string): string {
  return DESIGN_DATA_FIELD_LABELS[field] ?? field
}

// 設計データ条件の比較演算子(`app.domain.estimate_rules.py::
// StandardConditionField.operator`)を作業者向けの記号・日本語へ変換する。
// `starts_with`/`in`(Issue #40 Phase 6-E追加)は記号で表せないため、
// `formatDesignDataCondition`側で個別に文章化する(このmapは`==`/`!=`/
// `>=`/`<=`/`>`/`<`の記号表示にのみ使う)。
export const DESIGN_DATA_OPERATOR_LABELS: Record<string, string> = {
  '==': '=',
  '!=': '≠',
  '>=': '≥',
  '<=': '≤',
  '>': '>',
  '<': '<',
}

export function designDataOperatorLabel(operator: string): string {
  return DESIGN_DATA_OPERATOR_LABELS[operator] ?? operator
}

/** 設計データ根拠1条件分(Issue #40 Phase 6-B、`design_data_ref`のJSON内
 * `conditions`配列1件分)。`expected_value`は`in`演算子の場合は候補値の配列
 * になる(Issue #40 Phase 6-E)。 */
export interface DesignDataRefCondition {
  field: string
  operator: string
  expected_value: number | string | (number | string)[]
  actual_value: number | string | null
}

/** OR条件のグループ1件分(Issue #40 Phase 6-F `design_data_any_of`に対応)。
 * `matched`はこのグループ(AND)が判定時点で成立していたかどうか。 */
export interface DesignDataRefAnyOfGroup {
  matched: boolean
  conditions: DesignDataRefCondition[]
}

/** `design_data_ref`のJSON構造(Issue #40 Phase 6-B、Phase 6-FでOR対応)。
 * `panel`は`"面番号:盤番号"`形式の物理盤キー、`conditions`はAND条件(この
 * 結果の判定に実際に使われた設計データ条件のみ、`DesignDataContext`の全
 * フィールドではない)。`any_of`はOR条件のグループ一覧で、Phase 6-F以前の
 * 値には存在しない(その場合`undefined`。「いずれか1つ成立」というOR制約
 * 自体が無かった、という意味であり、値を推測で埋めない)。 */
export interface DesignDataRef {
  panel: string | null
  conditions: DesignDataRefCondition[]
  any_of?: DesignDataRefAnyOfGroup[]
}

function parseDesignDataRefCondition(c: unknown): DesignDataRefCondition | null {
  if (typeof c !== 'object' || c === null) return null
  const obj = c as Record<string, unknown>
  if (typeof obj.field !== 'string' || typeof obj.operator !== 'string') return null
  const expected = obj.expected_value
  const expectedValue: number | string | (number | string)[] =
    Array.isArray(expected) || typeof expected === 'number' || typeof expected === 'string'
      ? (expected as number | string | (number | string)[])
      : String(expected)
  const actual = obj.actual_value
  const actualValue: number | string | null =
    typeof actual === 'number' || typeof actual === 'string' ? actual : null
  return { field: obj.field, operator: obj.operator, expected_value: expectedValue, actual_value: actualValue }
}

function parseDesignDataRefConditions(raw: unknown): DesignDataRefCondition[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(parseDesignDataRefCondition)
    .filter((c): c is DesignDataRefCondition => c !== null)
}

/** `design_data_ref`(JSON文字列)をパースする。不正なJSON・期待した形で
 * ない場合はnullを返す(表示側は根拠なしとして扱う。推測で埋めない)。 */
export function parseDesignDataRef(ref: string | null | undefined): DesignDataRef | null {
  if (ref == null) return null
  try {
    const parsed: unknown = JSON.parse(ref)
    if (typeof parsed !== 'object' || parsed === null) return null
    const obj = parsed as Record<string, unknown>
    const panel = typeof obj.panel === 'string' ? obj.panel : null
    const conditions = parseDesignDataRefConditions(obj.conditions)
    const anyOf = Array.isArray(obj.any_of)
      ? obj.any_of
          .filter(
            (g): g is Record<string, unknown> =>
              typeof g === 'object' && g !== null && typeof (g as Record<string, unknown>).matched === 'boolean',
          )
          .map((g) => ({
            matched: g.matched as boolean,
            conditions: parseDesignDataRefConditions(g.conditions),
          }))
      : undefined
    return anyOf !== undefined ? { panel, conditions, any_of: anyOf } : { panel, conditions }
  } catch {
    return null
  }
}

/** 設計データ条件1件を作業者向けの1行へ整形する(指示B-1の表示例と同じ
 * 順序: フィールド名: 実際値 演算子 期待値)。`starts_with`/`in`
 * (Issue #40 Phase 6-E追加)は記号で表せないため個別に文章化する
 * (例: 「型式: IS2 が "IS" で始まる」「型式: IS2 が [IS1, IS2] のいずれか」)。 */
export function formatDesignDataCondition(condition: DesignDataRefCondition): string {
  const actual = condition.actual_value ?? '不明'
  const fieldLabel = designDataFieldLabel(condition.field)
  if (condition.operator === 'starts_with') {
    return `${fieldLabel}: ${actual} が "${condition.expected_value}" で始まる`
  }
  if (condition.operator === 'in') {
    const list = Array.isArray(condition.expected_value)
      ? condition.expected_value.join(', ')
      : String(condition.expected_value)
    return `${fieldLabel}: ${actual} が [${list}] のいずれか`
  }
  return `${fieldLabel}: ${actual} ${designDataOperatorLabel(condition.operator)} ${condition.expected_value}`
}

/** OR条件(`design_data_any_of`)の各グループを、成立/不成立が分かる形で
 * 作業者向けの複数行へ整形する(Issue #40 Phase 6-F指示B: 「どのOR枝が
 * 成立したか」を後から説明可能にする)。グループ内が複数条件(AND)の場合は
 * " かつ "で連結する。 */
export function formatDesignDataAnyOfGroups(groups: DesignDataRefAnyOfGroup[]): string[] {
  return groups.map((g) => {
    const text = g.conditions.map(formatDesignDataCondition).join(' かつ ')
    return `${g.matched ? '○' : '×'} ${text}`
  })
}
