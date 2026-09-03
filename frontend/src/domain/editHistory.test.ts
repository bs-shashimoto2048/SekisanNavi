import { describe, expect, it } from 'vitest'
import {
  EMPTY_EDIT_HISTORY,
  popRedo,
  popUndo,
  pushCommand,
  rebaseDetectionId,
  type BBoxEditCommand,
} from './editHistory'

function bboxCommand(detectionId: number): BBoxEditCommand {
  return {
    kind: 'bbox',
    detectionId,
    before: { x: 0.1, y: 0.1, w: 0.05, h: 0.05 },
    after: { x: 0.2, y: 0.2, w: 0.05, h: 0.05 },
  }
}

describe('editHistory (積算明細強化・Undo/Redo・要確認警告・編集追従 指示6章)', () => {
  it('pushCommand adds to the undo stack and clears the redo stack (新しい編集でRedo履歴を破棄)', () => {
    const afterFirst = pushCommand(EMPTY_EDIT_HISTORY, bboxCommand(1))
    const popped = popUndo(afterFirst)
    expect(popped).not.toBeNull()
    const afterUndo = popped!.next
    expect(afterUndo.redoStack).toHaveLength(1)

    const afterNewEdit = pushCommand(afterUndo, bboxCommand(2))
    expect(afterNewEdit.redoStack).toHaveLength(0)
    expect(afterNewEdit.undoStack.map((c) => c.detectionId)).toEqual([2])
  })

  it('popUndo returns null when there is nothing to undo', () => {
    expect(popUndo(EMPTY_EDIT_HISTORY)).toBeNull()
  })

  it('popRedo returns null when there is nothing to redo', () => {
    expect(popRedo(EMPTY_EDIT_HISTORY)).toBeNull()
  })

  it('moves a command from undo to redo and back, preserving LIFO order across multiple commands', () => {
    let state = pushCommand(EMPTY_EDIT_HISTORY, bboxCommand(1))
    state = pushCommand(state, bboxCommand(2))

    const undo1 = popUndo(state)!
    expect(undo1.command.detectionId).toBe(2) // 最後に積んだものから戻す
    state = undo1.next
    expect(state.undoStack.map((c) => c.detectionId)).toEqual([1])
    expect(state.redoStack.map((c) => c.detectionId)).toEqual([2])

    const redo1 = popRedo(state)!
    expect(redo1.command.detectionId).toBe(2)
    state = redo1.next
    expect(state.undoStack.map((c) => c.detectionId)).toEqual([1, 2])
    expect(state.redoStack).toHaveLength(0)
  })

  it('rebaseDetectionId rewrites every command referencing the old id, in both stacks', () => {
    let state = pushCommand(EMPTY_EDIT_HISTORY, bboxCommand(101))
    state = pushCommand(state, bboxCommand(101))
    const undo1 = popUndo(state)! // 1件をredoへ積んでおく (undo/redo両方に101を残す)
    state = undo1.next
    expect(state.undoStack.map((c) => c.detectionId)).toEqual([101])
    expect(state.redoStack.map((c) => c.detectionId)).toEqual([101])

    const rebased = rebaseDetectionId(state, 101, 205)
    expect(rebased.undoStack.map((c) => c.detectionId)).toEqual([205])
    expect(rebased.redoStack.map((c) => c.detectionId)).toEqual([205])
  })

  it('rebaseDetectionId does not touch commands for unrelated detection ids', () => {
    const state = pushCommand(EMPTY_EDIT_HISTORY, bboxCommand(1))
    const rebased = rebaseDetectionId(state, 999, 1000)
    expect(rebased.undoStack.map((c) => c.detectionId)).toEqual([1])
  })
})
