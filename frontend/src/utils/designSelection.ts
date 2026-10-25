import type { DesignPage } from '../types/domain'

// design.csv基準の図面一覧で、「どの図面を左ペインに表示するか」の選択状態(製番ごと)。
//
// 保持方法: ブラウザーの localStorage に、**除外した図面のキー**(ページ番号の文字列。PDF名の綴り)だけを製番ごとに保存する。
// - 除外側を保存するので、design.csv に図面が増えても、既定どおり「選択済み」で現れる(気付かないうちに隠れない)。
// - サーバー・DB・出力フォルダには何も書かない(この端末のブラウザーだけの設定。他の端末とは共有されない)。
// - 保存が無い(null)= その製番ではまだ選択を確定していない。保存が壊れている・使えない場合も null 扱い(既定=全件選択)。

const KEY_PREFIX = 'sekisan-navi:design-selection:v1:'

function storageKey(productNo: string): string {
  return `${KEY_PREFIX}${productNo}`
}

/** 保存済みの「除外した図面のキー」。未保存・不正な内容・localStorageが使えない場合は null。 */
export function loadExcludedKeys(productNo: string): Set<string> | null {
  try {
    const raw = window.localStorage.getItem(storageKey(productNo))
    if (raw == null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const excluded = (parsed as { excluded?: unknown }).excluded
    if (!Array.isArray(excluded) || !excluded.every((k) => typeof k === 'string')) return null
    return new Set(excluded as string[])
  } catch {
    return null
  }
}

/** 選択を確定したときに保存する。保存できなくても(容量・プライベートモード等)画面は止めない。 */
export function saveExcludedKeys(productNo: string, excluded: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(storageKey(productNo), JSON.stringify({ excluded: Array.from(excluded) }))
  } catch {
    // 保存できない環境では、この画面を開いている間だけ選択が有効になる
  }
}

/** 除外していない図面(一覧の並びは入力のまま)。 */
export function selectedItems(items: readonly DesignPage[], excluded: ReadonlySet<string>): DesignPage[] {
  return items.filter((i) => !excluded.has(i.key))
}
