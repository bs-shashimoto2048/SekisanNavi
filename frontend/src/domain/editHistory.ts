// 積算明細強化・Undo/Redo・要確認警告・編集追従 指示6章: Undo/Redo履歴のスタック
// 管理そのもの (push/undo/redo/ID付け替え) を、実際のBackend API呼び出しや
// Reactの状態更新から切り離した純粋関数として保持する。副作用(fetch呼び出し・
// setState)はApp.tsx側が担い、このモジュールは「今どういう履歴状態にあるべきか」
// だけを計算する。
import type { Detection, ManualDetectionCreateInput } from '../types/domain'
import type { NormalizedRect } from '../utils/bbox'

/** BBoxの移動/リサイズ確定 (Phase 1.7のonResizeDetection相当)。 */
export interface BBoxEditCommand {
  kind: 'bbox'
  detectionId: number
  before: NormalizedRect
  after: NormalizedRect
}

/** Manual BBox新規追加。Undo=削除、Redo=同じ内容で再作成する
 * (Backend側で新しいidが払い出されるため、再作成後は`rebaseDetectionId`で
 * このコマンド自身のdetectionIdを書き換える)。 */
export interface CreateEditCommand {
  kind: 'create'
  detectionId: number
  input: ManualDetectionCreateInput
}

/** Detection削除。Undo=削除前スナップショットから再作成、Redo=削除。
 * 既存API(createManualDetection)しか使わないため、Manual扱い(source_type='manual',
 * status='reviewed')で復元される制約がある (AI Detectionの削除をUndoした場合、
 * 元がAIでも復元後はManual表示になる。Backend側がsource_type/statusを
 * クライアント指定させない既存仕様のため。指示18章で開示する既知の制約)。 */
export interface DeleteEditCommand {
  kind: 'delete'
  detectionId: number
  snapshot: Detection
}

export type EditCommand = BBoxEditCommand | CreateEditCommand | DeleteEditCommand

export interface EditHistoryState {
  undoStack: EditCommand[]
  redoStack: EditCommand[]
}

export const EMPTY_EDIT_HISTORY: EditHistoryState = { undoStack: [], redoStack: [] }

/** 新しい編集操作を履歴へ積む。既存のRedo履歴は破棄する
 * (指示6章:「新しい編集を行った場合、Redo履歴を破棄」)。 */
export function pushCommand(state: EditHistoryState, command: EditCommand): EditHistoryState {
  return { undoStack: [...state.undoStack, command], redoStack: [] }
}

/** Undo対象のコマンドを取り出す(スタックからは取り除いた状態を返すだけで、
 * 実際にBackendへ反映するのは呼び出し側の責務)。Undo不可(空)ならnull。 */
export function popUndo(
  state: EditHistoryState,
): { command: EditCommand; next: EditHistoryState } | null {
  if (state.undoStack.length === 0) return null
  const command = state.undoStack[state.undoStack.length - 1]
  return {
    command,
    next: { undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, command] },
  }
}

/** Redo対象のコマンドを取り出す。Redo不可(空)ならnull。 */
export function popRedo(
  state: EditHistoryState,
): { command: EditCommand; next: EditHistoryState } | null {
  if (state.redoStack.length === 0) return null
  const command = state.redoStack[state.redoStack.length - 1]
  return {
    command,
    next: { undoStack: [...state.undoStack, command], redoStack: state.redoStack.slice(0, -1) },
  }
}

/** create/deleteの再作成でBackendが新しいdetectionIdを払い出した際、Undo/Redo
 * 双方のスタック内にある同じdetectionIdへの参照を新IDへ一括で書き換える
 * (指示6章: 「Undo/Redoによって所属面/盤が変化した場合も所属再判定を実施」の前提として、
 * そもそもIDが変わっても後続のUndo/Redoが正しい対象を指し続けられるようにする)。 */
export function rebaseDetectionId(state: EditHistoryState, oldId: number, newId: number): EditHistoryState {
  const rebase = (cmds: EditCommand[]): EditCommand[] =>
    cmds.map((c) => (c.detectionId === oldId ? { ...c, detectionId: newId } : c))
  return { undoStack: rebase(state.undoStack), redoStack: rebase(state.redoStack) }
}
