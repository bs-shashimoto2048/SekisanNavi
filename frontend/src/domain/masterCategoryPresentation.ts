// このファイルはスクリプト(gen_category_presentation_v2.py)で生成した。
// internal(キー)はbackend/app/domain/master_categories.pyのALLOWED_CATEGORIESと
// 完全に一致する必要がある(半角/全角の手打ちミスを避けるため、生成時に
// backend側のタプルから直接読み込んでいる)。

/**
 * 積算コードMasterのカテゴリ(品名)ごとの表示情報 (Phase 1.10/1.11)。
 *
 * Excel由来のcategory原文(internal, 半角カナ・半角中点混在)をDB上で書き換える
 * 必要はない。表示名の全角統一・配色は表示専用の変換としてこのファイルへ
 * 一元管理し、Frontend各所(Master tab / Manual BBox / 引出線)に同じHEX値を
 * 重複して書かない (Phase 1.10 9章/15章、Phase 1.11 1章/2章/30章)。
 *
 * Phase 1.11: 13カテゴリすべてに重複しない固有色を割り当てた (旧: 5系統の
 * グループ色)。`colors`はCSSカスタムプロパティとして各要素へ注入する
 * (`style`経由。`--tab-bg`等)。CSS側は`var(--tab-bg)`等を参照するだけにし、
 * HEX/RGBA値そのものはこのファイルにのみ存在させる。
 */
export interface MasterCategoryColors {
  /** Masterタブの背景色 (淡色)。 */
  tabBg: string
  /** Masterタブの境界線・選択中タブの上辺強調に使う。 */
  tabBorder: string
  /** Masterタブの文字色。淡色背景に対して十分なコントラストを確保する。 */
  tabFg: string
  /** Manual BBoxの枠線色 (このカテゴリで作成したBBox・編集中BBoxに使用)。 */
  bboxBorder: string
  /** Manual BBoxのhover/editing時の薄い塗りつぶし色 (低alphaのrgba)。 */
  bboxFill: string
  /** 引出線(斜線+水平帯の枠)の色。通常`bboxBorder`と同じ値。 */
  leaderColor: string
  /** 引出線ラベル(「コード 型式」)の文字色。 */
  leaderTextColor: string
}

export interface MasterCategoryPresentation {
  /** Excel由来のcategory原文 (DB/APIのcategory値と完全一致)。 */
  internal: string
  /** UI表示用の全角統一ラベル。 */
  label: string
  /** 表示順 (0始まり)。業務指定の13品名順 (=Backend APIの返却順) と一致させる。 */
  order: number
  /** このカテゴリの配色一式。 */
  colors: MasterCategoryColors
}

export const MASTER_CATEGORY_PRESENTATION: readonly MasterCategoryPresentation[] = [
  {
    internal: '箱･単独',
    label: '箱・単独',
    order: 0,
    colors: {
      tabBg: '#edf2f8',
      tabBorder: '#7eaddd',
      tabFg: '#184c81',
      bboxBorder: '#2a73bb',
      bboxFill: 'rgba(41, 127, 214, 0.14)',
      leaderColor: '#2a73bb',
      leaderTextColor: '#184c81',
    },
  },
  {
    internal: '箱･左右',
    label: '箱・左右',
    order: 1,
    colors: {
      tabBg: '#edf5f8',
      tabBorder: '#7ec5dd',
      tabFg: '#186781',
      bboxBorder: '#2a97bb',
      bboxFill: 'rgba(41, 171, 214, 0.14)',
      leaderColor: '#2a97bb',
      leaderTextColor: '#186781',
    },
  },
  {
    internal: '箱･中',
    label: '箱・中',
    order: 2,
    colors: {
      tabBg: '#ededf8',
      tabBorder: '#7e86dd',
      tabFg: '#182181',
      bboxBorder: '#2a37bb',
      bboxFill: 'rgba(41, 55, 214, 0.14)',
      leaderColor: '#2a37bb',
      leaderTextColor: '#182181',
    },
  },
  {
    internal: '内部ﾊﾟﾈﾙ',
    label: '内部パネル',
    order: 3,
    colors: {
      tabBg: '#edf8f2',
      tabBorder: '#7eddad',
      tabFg: '#18814d',
      bboxBorder: '#2abb73',
      bboxFill: 'rgba(41, 214, 128, 0.14)',
      leaderColor: '#2abb73',
      leaderTextColor: '#18814d',
    },
  },
  {
    internal: '底板',
    label: '底板',
    order: 4,
    colors: {
      tabBg: '#edf8f6',
      tabBorder: '#7eddcd',
      tabFg: '#18816f',
      bboxBorder: '#2abba3',
      bboxFill: 'rgba(41, 214, 185, 0.14)',
      leaderColor: '#2abba3',
      leaderTextColor: '#18816f',
    },
  },
  {
    internal: '盤間の仕切・遮蔽',
    label: '盤間の仕切・遮蔽',
    order: 5,
    colors: {
      tabBg: '#f1f8ed',
      tabBorder: '#a6dd7e',
      tabFg: '#448118',
      bboxBorder: '#67bb2a',
      bboxFill: 'rgba(113, 214, 41, 0.14)',
      leaderColor: '#67bb2a',
      leaderTextColor: '#448118',
    },
  },
  {
    internal: '附属品加算価格',
    label: '附属品加算価格',
    order: 6,
    colors: {
      tabBg: '#f8f2ed',
      tabBorder: '#ddad7e',
      tabFg: '#814c18',
      bboxBorder: '#bb732a',
      bboxFill: 'rgba(214, 128, 41, 0.14)',
      leaderColor: '#bb732a',
      leaderTextColor: '#814c18',
    },
  },
  {
    internal: '箱体価格倍率',
    label: '箱体価格倍率',
    order: 7,
    colors: {
      tabBg: '#f8f5ed',
      tabBorder: '#ddc57e',
      tabFg: '#816718',
      bboxBorder: '#bb972a',
      bboxFill: 'rgba(214, 171, 41, 0.14)',
      leaderColor: '#bb972a',
      leaderTextColor: '#816718',
    },
  },
  {
    internal: 'ﾊﾟﾈﾙ',
    label: 'パネル',
    order: 8,
    colors: {
      tabBg: '#f2edf8',
      tabBorder: '#ad7edd',
      tabFg: '#4c1881',
      bboxBorder: '#732abb',
      bboxFill: 'rgba(127, 41, 214, 0.14)',
      leaderColor: '#732abb',
      leaderTextColor: '#4c1881',
    },
  },
  {
    internal: 'OPA用ｱﾝｸﾞﾙ枠',
    label: 'OPA用アングル枠',
    order: 9,
    colors: {
      tabBg: '#f5edf8',
      tabBorder: '#c57edd',
      tabFg: '#671881',
      bboxBorder: '#972abb',
      bboxFill: 'rgba(171, 41, 214, 0.14)',
      leaderColor: '#972abb',
      leaderTextColor: '#671881',
    },
  },
  {
    internal: '金網',
    label: '金網',
    order: 10,
    colors: {
      tabBg: '#f8edf3',
      tabBorder: '#dd7eb5',
      tabFg: '#811855',
      bboxBorder: '#bb2a7f',
      bboxFill: 'rgba(214, 41, 142, 0.14)',
      leaderColor: '#bb2a7f',
      leaderTextColor: '#811855',
    },
  },
  {
    internal: '入力（主回路銅帯）',
    label: '入力（主回路銅帯）',
    order: 11,
    colors: {
      tabBg: '#f7f2ee',
      tabBorder: '#cea88d',
      tabFg: '#734626',
      bboxBorder: '#a66a3f',
      bboxFill: 'rgba(191, 117, 64, 0.14)',
      leaderColor: '#a66a3f',
      leaderTextColor: '#734626',
    },
  },
  {
    internal: '銅帯',
    label: '銅帯',
    order: 12,
    colors: {
      tabBg: '#f7efee',
      tabBorder: '#ce988d',
      tabFg: '#733326',
      bboxBorder: '#a6503f',
      bboxFill: 'rgba(191, 85, 64, 0.14)',
      leaderColor: '#a6503f',
      leaderTextColor: '#733326',
    },
  },
]

const BY_INTERNAL = new Map(MASTER_CATEGORY_PRESENTATION.map((p) => [p.internal, p]))

// 中立的なフォールバック配色 (想定外のcategory値が来た場合のみ使用)。
const FALLBACK_COLORS: MasterCategoryColors = {
  tabBg: '#f3f4f6',
  tabBorder: '#d1d5db',
  tabFg: '#4b5563',
  bboxBorder: 'rgba(75, 85, 99, 0.8)',
  bboxFill: 'rgba(75, 85, 99, 0.14)',
  leaderColor: 'rgba(75, 85, 99, 0.8)',
  leaderTextColor: '#4b5563',
}

/**
 * category内部値から表示情報を引く。未知のcategory (想定外データ) の場合は
 * 内部値をそのままlabelとして使い、中立色にフォールバックする
 * (Backend側で13品名にフィルタ済みのため通常発生しないが、フォールバックにより
 * 画面が壊れることを避ける)。
 */
export function getCategoryPresentation(
  internal: string | null | undefined,
): MasterCategoryPresentation {
  if (internal == null) {
    return { internal: '', label: '', order: MASTER_CATEGORY_PRESENTATION.length, colors: FALLBACK_COLORS }
  }
  return (
    BY_INTERNAL.get(internal) ?? {
      internal,
      label: internal,
      order: MASTER_CATEGORY_PRESENTATION.length,
      colors: FALLBACK_COLORS,
    }
  )
}

/** CSSカスタムプロパティとして要素のstyleへ注入するためのオブジェクトを作る。
 * (Reactの`style`属性はカスタムプロパティを直接キーに使えるため、
 * `style={{ ...toCssVars(colors) }}`のように展開して使う。) */
export function toCssVars(colors: MasterCategoryColors): Record<string, string> {
  return {
    '--cat-tab-bg': colors.tabBg,
    '--cat-tab-border': colors.tabBorder,
    '--cat-tab-fg': colors.tabFg,
    '--cat-bbox-border': colors.bboxBorder,
    '--cat-bbox-fill': colors.bboxFill,
    '--cat-leader-color': colors.leaderColor,
    '--cat-leader-text': colors.leaderTextColor,
  }
}
