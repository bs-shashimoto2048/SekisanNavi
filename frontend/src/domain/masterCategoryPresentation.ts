// このファイルはスクリプト(gen_category_presentation_v2.py)で生成した。
// internal(キー)はbackend/app/domain/master_categories.pyのALLOWED_CATEGORIESと
// 完全に一致する必要がある(半角/全角の手打ちミスを避けるため、生成時に
// backend側のタプルから直接読み込んでいる)。
//
// UI視覚階層改善 追加修正指示 14章〜24章: Masterタブの視認性強化のため、
// 各カテゴリの`tabBg`/`tabBorder`/`tabFg`のみを手動で強化した(色相はそのまま、
// 各カテゴリの`bboxBorder`が持つ色相を基準に彩度・明度を再構成し、隣接する
// 近似カテゴリでも識別しやすくした)。`bboxBorder`/`bboxFill`/`leaderColor`/
// `leaderTextColor`(Manual BBox・引出線が参照する値)は指示24章の方針どおり
// 意図的に一切変更していない。再度スクリプトを実行するとこの手動調整は
// 失われるため、スクリプト側を更新しない限り再生成しないこと。
//
// UI視覚階層改善 第5ラウンド 指示5章: 「箱・単独」「箱・左右」の`tabActiveBg`を
// さらに彩度を落として微調整した(色相は維持)。Header(#1d4ed8)と同時に画面へ
// 表示された際、同じ「濃い青」に見えて競合していたため、より落ち着いた
// steel-blue寄りへ寄せてStructureのコバルトと区別しやすくした。白文字との
// コントラスト比はいずれも改善している(旧#2d76be:4.72→新#356697:6.00、
// 旧#247c99:4.75→新#2d6c80:5.89)。
//
// UI配色 最終微調整ラウンド 指示8章〜10章: 「濃色→中濃色」の方針で、白文字との
// コントラスト比が概ねWCAG AA(4.5:1)を維持できる範囲でのみ`tabActiveBg`の
// lightnessを+5〜10%引き上げた(色相・彩度は維持)。既に4.5:1ぎりぎりまで
// 明るくしていたカテゴリ(内部パネル・底板・盤間の仕切・遮蔽・附属品加算価格・
// 箱体価格倍率・金網・入力（主回路銅帯）・銅帯の8カテゴリ)はこれ以上コントラストを
// 落とすと白文字の可読性(指示10章「再び選択が分かりづらくならないこと」)を
// 損なうため、そのカテゴリだけ据え置いている。余地のあった5カテゴリのみ調整:
// 箱・単独 #356697→#3f79b3(contrast 6.00→4.57)、箱・左右 #357f97
// (5.89→4.53)、箱・中 #303fcf→#5965d9(7.67→4.90)、パネル #8030cf→#9755d8
// (6.48→4.56)、OPA用アングル枠 #a730cf→#b045d4(5.29→4.52)。

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
  /** Masterタブの背景色 (淡色、未選択タブに使う)。 */
  tabBg: string
  /** 選択中タブ・Master table headerの背景色 (UI視覚階層改善 追加修正第4
   * ラウンド 2章/3章/9章)。カテゴリ色相を保ったまま、白文字(`tabActiveFg`)との
   * コントラスト比が概ねWCAG AA(4.5:1)以上になる明度まで意図的に暗くしてある
   * (第2/第3ラウンドでは同じ名前を「tabBgより一段濃い淡色」として使っていたが、
   * 今回「選択中は濃色+白抜き」という最終形に置き換えた)。 */
  tabActiveBg: string
  /** 選択中タブ・table headerの文字色。今回は全カテゴリ`#fff`で統一
   * (追加修正第4ラウンド 18章)。 */
  tabActiveFg: string
  /** Masterタブの境界線・選択中タブの上辺強調に使う。 */
  tabBorder: string
  /** Masterタブの文字色 (未選択タブ用)。淡色背景に対して十分なコントラストを
   * 確保する。 */
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
      tabBg: '#e3ebf2',
      tabActiveBg: '#3f79b3',
      tabActiveFg: '#fff',
      tabBorder: '#4b8fd2',
      tabFg: '#153d66',
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
      tabBg: '#e3eef2',
      tabActiveBg: '#357f97',
      tabActiveFg: '#fff',
      tabBorder: '#4bb1d2',
      tabFg: '#155266',
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
      tabBg: '#e3e5f2',
      tabActiveBg: '#5965d9',
      tabActiveFg: '#fff',
      tabBorder: '#4b57d2',
      tabFg: '#151c66',
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
      tabBg: '#e3f2eb',
      tabActiveBg: '#1f8452',
      tabActiveFg: '#fff',
      tabBorder: '#4bd28f',
      tabFg: '#15663d',
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
      tabBg: '#e3f2ef',
      tabActiveBg: '#1e8070',
      tabActiveFg: '#fff',
      tabBorder: '#4bd2bc',
      tabFg: '#156658',
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
      tabBg: '#e9f2e3',
      tabActiveBg: '#47801e',
      tabActiveFg: '#fff',
      tabBorder: '#84d24b',
      tabFg: '#376615',
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
      tabBg: '#f2ebe3',
      tabActiveBg: '#a56627',
      tabActiveFg: '#fff',
      tabBorder: '#d28f4b',
      tabFg: '#663d15',
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
      tabBg: '#f2eee3',
      tabActiveBg: '#8c7221',
      tabActiveFg: '#fff',
      tabBorder: '#d2b14b',
      tabFg: '#665215',
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
      tabBg: '#ebe3f2',
      tabActiveBg: '#9755d8',
      tabActiveFg: '#fff',
      tabBorder: '#8f4bd2',
      tabFg: '#3d1566',
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
      tabBg: '#eee3f2',
      tabActiveBg: '#b045d4',
      tabActiveFg: '#fff',
      tabBorder: '#b14bd2',
      tabFg: '#521566',
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
      tabBg: '#f2e3ec',
      tabActiveBg: '#cf308d',
      tabActiveFg: '#fff',
      tabBorder: '#d24b9a',
      tabFg: '#661544',
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
      tabBg: '#f0eae6',
      tabActiveBg: '#ae6029',
      tabActiveFg: '#fff',
      tabBorder: '#bf875f',
      tabFg: '#5a3820',
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
      tabBg: '#f0e7e6',
      tabActiveBg: '#ca492f',
      tabActiveFg: '#fff',
      tabBorder: '#bf6f5f',
      tabFg: '#5a2a20',
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
  tabActiveBg: '#4b5563',
  tabActiveFg: '#fff',
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
    '--cat-tab-active-bg': colors.tabActiveBg,
    '--cat-tab-active-fg': colors.tabActiveFg,
    '--cat-tab-border': colors.tabBorder,
    '--cat-tab-fg': colors.tabFg,
    '--cat-bbox-border': colors.bboxBorder,
    '--cat-bbox-fill': colors.bboxFill,
    '--cat-leader-color': colors.leaderColor,
    '--cat-leader-text': colors.leaderTextColor,
  }
}
