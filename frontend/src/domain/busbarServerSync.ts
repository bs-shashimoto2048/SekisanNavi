// 主回路銅帯: サーバー保存済みの選択(GET busbar-selections)と、このブラウザーの localStorage の統合。
//
// 保存経路の整理(この統合を入れる前後で共通):
//   - 正本(積算に反映される内容)はサーバーの `estimate_busbar_selections`(面ごとの確定行 = コード+係数)。
//   - localStorage は「画面の入力状態」(4項目の選択・入力途中の行を含む)で、サーバーへは確定行だけが
//     PUT(その面の全行を置換)で送られる。
//   - 製番を開いたとき、サーバーの内容を図面情報へ復元する(別ブラウザー・localStorage 空でも同じ行を表示)。
//     この復元は**表示だけ**で、サーバーへは何も送らない(PUT しない)。
//
// 競合時の優先順位(面・行IDごと。`mergeServerBusbar`):
//   1. サーバーが持つ行 → サーバーの値を表示する(コード→4項目へ逆引き、係数はそのまま)。
//      localStorage の同じ行IDが別の値(完全選択済み)だった場合は、サーバー値を表示して
//      `conflict` として利用者に知らせる(黙って上書きしない・サーバーへ再送もしない)。
//   2. サーバーに無く、localStorage にだけある行:
//        - 4項目が確定していない入力途中の行 → そのまま残す(黙って失わない。サーバーには送られていない)。
//        - 確定済みの行 → 表示しない(他のブラウザーで削除済み/サーバーに保存されていない行を、
//          古い localStorage から復活させない)。`dropped` として知らせる。
//   3. サーバーの行のコードが対応表(busbarCodes)に無く、4項目へ戻せない場合 → 表示はできないが、
//      その面を保存するときに行が消えないよう `preserved` として保持し、PUT に含める(`unmapped` として知らせる)。
import { BUSBAR_DATA, statusOf, type BusbarSelection } from './busbarCodes'
import { BUSBAR_FACTOR_OPTIONS, type BusbarRow, type BusbarRowsByFace } from './busbarSelections'

/** `GET /api/products/{no}/busbar-selections` の1行。 */
export interface ServerBusbarRow {
  ban_menno: number
  row_id: string
  code: string
  factor: number
}

export type BusbarSyncIssue =
  | {
      kind: 'conflict'
      face: string
      rowId: string
      /** このブラウザーの保存値(完全選択済みなら確定コード、入力途中なら null)。 */
      localCode: string | null
      localFactor: number
      serverCode: string
      serverFactor: number
    }
  | { kind: 'dropped'; face: string; rowId: string; code: string; factor: number }
  | { kind: 'unmapped'; face: string; rowId: string; code: string }

export interface BusbarServerMergeResult {
  rows: BusbarRowsByFace
  /** 表示できない(コードが対応表に無い)サーバー行。その面の保存時に PUT へ含めて消さない。 */
  preserved: Record<string, ServerBusbarRow[]>
  issues: BusbarSyncIssue[]
}

const RECORD_BY_CODE = new Map(BUSBAR_DATA.map((record) => [record.code, record]))

/** 確定コードを4項目の選択へ逆引きする。対応表に無いコードは null。 */
export function selectionFromCode(code: string): BusbarSelection | null {
  const record = RECORD_BY_CODE.get(code)
  if (!record) return null
  return {
    spec: record.spec,
    phase: record.phase,
    voltage: record.voltage,
    kva: String(record.kva),
  }
}

function confirmedCode(row: BusbarRow): string | null {
  const status = statusOf(row.selection)
  return status.kind === 'unique' ? status.record.code : null
}

function sanitizeFactor(factor: number): number {
  return BUSBAR_FACTOR_OPTIONS.some((value) => value === factor) ? factor : 1.0
}

/**
 * サーバー保存済みの行と、このブラウザーの localStorage の行を統合する(優先順位は上のコメント)。
 * 行の並びは localStorage の並びを保ち、サーバーにだけある行を後ろへ追加する。
 */
export function mergeServerBusbar(local: BusbarRowsByFace, server: ServerBusbarRow[]): BusbarServerMergeResult {
  const issues: BusbarSyncIssue[] = []
  const preserved: Record<string, ServerBusbarRow[]> = {}
  const serverByFace = new Map<string, ServerBusbarRow[]>()
  for (const row of server) {
    const face = String(row.ban_menno)
    serverByFace.set(face, [...(serverByFace.get(face) ?? []), row])
  }

  const faces = new Set([...Object.keys(local), ...serverByFace.keys()])
  const rows: BusbarRowsByFace = {}

  for (const face of faces) {
    const serverRows = serverByFace.get(face) ?? []
    const serverById = new Map(serverRows.map((row) => [row.row_id, row]))
    const merged: BusbarRow[] = []
    const seenServerIds = new Set<string>()

    const toRow = (serverRow: ServerBusbarRow): BusbarRow | null => {
      const selection = selectionFromCode(serverRow.code)
      if (selection === null) return null
      return { id: serverRow.row_id, selection, factor: sanitizeFactor(serverRow.factor) }
    }

    for (const localRow of local[face] ?? []) {
      const serverRow = serverById.get(localRow.id)
      if (serverRow) {
        seenServerIds.add(serverRow.row_id)
        const serverView = toRow(serverRow)
        if (serverView === null) continue // 後でまとめて unmapped として扱う
        const localCode = confirmedCode(localRow)
        if (localCode !== serverRow.code || localRow.factor !== serverView.factor) {
          issues.push({
            kind: 'conflict',
            face,
            rowId: localRow.id,
            localCode,
            localFactor: localRow.factor,
            serverCode: serverRow.code,
            serverFactor: serverView.factor,
          })
        }
        merged.push(serverView)
        continue
      }
      const code = confirmedCode(localRow)
      if (code === null) {
        merged.push(localRow) // 入力途中の行は失わない(サーバーには送られていない)
      } else {
        issues.push({ kind: 'dropped', face, rowId: localRow.id, code, factor: localRow.factor })
      }
    }

    for (const serverRow of serverRows) {
      const view = toRow(serverRow)
      if (view === null) {
        preserved[face] = [...(preserved[face] ?? []), serverRow]
        issues.push({ kind: 'unmapped', face, rowId: serverRow.row_id, code: serverRow.code })
      } else if (!seenServerIds.has(serverRow.row_id)) {
        merged.push(view)
      }
    }

    if (merged.length > 0) rows[face] = merged
  }

  return { rows, preserved, issues }
}

/** 利用者へ知らせる文言(1件1行)。 */
export function describeBusbarSyncIssue(issue: BusbarSyncIssue): string {
  const face = `面${issue.face}`
  switch (issue.kind) {
    case 'conflict': {
      const local = issue.localCode === null ? '入力途中' : `コード${issue.localCode}・係数${issue.localFactor}`
      return `${face}の銅帯(${issue.rowId}): このブラウザーの保存値(${local})とサーバーの保存値(コード${issue.serverCode}・係数${issue.serverFactor})が異なるため、サーバーの値を表示しています。`
    }
    case 'dropped':
      return `${face}の銅帯(${issue.rowId}): コード${issue.code}・係数${issue.factor}はサーバーに保存されていないため、このブラウザーの古い保存内容は表示しません。`
    case 'unmapped':
      return `${face}の銅帯(${issue.rowId}): コード${issue.code}は選択欄の対応表に無いため表示できません(その面を編集してもサーバーの保存内容は消しません)。`
  }
}
