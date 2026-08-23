// Mark a point, then undo everything since. A snapshot is the exact text of a
// set of files at one moment; restoring is a whole-file replacement per changed
// file, computed as a plan so the caller can see it before anything is written.
//
// Absence is data here. A file the reader could not read is left out of the
// map, and that missing key records "this file did not exist", which is a
// different fact from "this file was empty". Every comparison below reads a
// missing key that way.
import type { EditPlan, FileEdit } from './edit.ts'
import type { ToolOutput } from './query.ts'
import type { Workspace } from './workspace.ts'

export type Snapshot = {
  readonly label: string
  readonly takenAt: number
  readonly files: ReadonlyMap<string, string>
}

// File access is a parameter, not an ambient capability (PS-005): the pure core
// below never learns whether the text came from disk, from the index, or from a
// test's map.
export type FileReader = {
  readonly read: (file: string) => Promise<string | undefined>
}

const declined = (text: string): EditPlan => ({ ok: false, text })

const listOf = (files: readonly string[]): string => files.join(', ')

// Time arrives as a number and is only formatted here (PS-045); nothing in this
// module reads a clock.
const timeOf = (takenAt: number): string => new Date(takenAt).toISOString()

export const takeSnapshot = async (
  reader: FileReader,
  label: string,
  takenAt: number,
  files: readonly string[],
): Promise<Snapshot> => {
  const read = await Promise.all(
    files.map(async (file) => {
      const text = await reader.read(file)
      return text === undefined ? [] : [[file, text] as const]
    }),
  )
  return { label, takenAt, files: new Map(read.flat()) }
}

// The common case: the texts are already parsed in the workspace, so a snapshot
// of everything indexed costs no IO at all.
export const snapshotOfWorkspace = (
  workspace: Workspace,
  label: string,
  takenAt: number,
): Snapshot => ({
  label,
  takenAt,
  files: new Map([...workspace.sources].map(([file, source]) => [file, source.text] as const)),
})

const allFiles = (
  snapshot: Snapshot,
  current: ReadonlyMap<string, string>,
): readonly string[] => [...new Set([...snapshot.files.keys(), ...current.keys()])].sort()

export const changedSince = (
  snapshot: Snapshot,
  current: ReadonlyMap<string, string>,
): readonly string[] =>
  allFiles(snapshot, current).filter((file) => snapshot.files.get(file) !== current.get(file))

const addedSince = (
  snapshot: Snapshot,
  current: ReadonlyMap<string, string>,
): readonly string[] =>
  changedSince(snapshot, current).filter((file) => !snapshot.files.has(file))

const missingSince = (
  snapshot: Snapshot,
  current: ReadonlyMap<string, string>,
): readonly string[] => changedSince(snapshot, current).filter((file) => !current.has(file))

// The offsets below are computed against `current`, never against the snapshot.
// The plan is applied by `writeEdits` in io.ts, which re-reads each file and
// compares it against the indexed text before writing, so `end` must be the
// length of the text that is on disk right now. Using the snapshot's length
// would truncate every file that grew and overrun every file that shrank —
// which is the obvious bug in this function, and it corrupts files.
const restoreEdit = (
  file: string,
  snapshotText: string,
  currentText: string,
): FileEdit => ({ file, start: 0, end: currentText.length, text: snapshotText })

export const restorePlan = (
  snapshot: Snapshot,
  current: ReadonlyMap<string, string>,
): EditPlan => {
  const changed = changedSince(snapshot, current)
  if (changed.length === 0) return declined(`nothing changed since ${snapshot.label}`)
  const added = addedSince(snapshot, current)
  const missing = missingSince(snapshot, current)
  // A partial revert that leaves a created file behind, or that cannot bring a
  // deleted file back, is a silent half-undo — the exact failure this tool
  // exists to prevent — so the whole restore is declined and the files named.
  const problems = [
    ...(added.length === 0
      ? []
      : [`created since the snapshot; an edit plan cannot remove ${added.length === 1 ? 'it' : 'them'}: ${listOf(added)}`]),
    ...(missing.length === 0
      ? []
      : [`present at snapshot time and now missing: ${listOf(missing)}`]),
  ]
  if (problems.length > 0) {
    return declined([`cannot restore ${snapshot.label}:`, ...problems].join('\n'))
  }
  const edits = changed.flatMap((file) => {
    const snapshotText = snapshot.files.get(file)
    const currentText = current.get(file)
    return snapshotText === undefined || currentText === undefined
      ? []
      : [restoreEdit(file, snapshotText, currentText)]
  })
  return {
    ok: true,
    edits,
    summary: `restored ${edits.length} file${edits.length === 1 ? '' : 's'} to ${snapshot.label} (taken ${timeOf(snapshot.takenAt)})`,
  }
}

const directionOf = (
  snapshot: Snapshot,
  current: ReadonlyMap<string, string>,
  file: string,
): string =>
  !snapshot.files.has(file)
    ? 'added since the snapshot'
    : !current.has(file)
      ? 'deleted since the snapshot'
      : 'modified since the snapshot'

export const describeSnapshot = (
  snapshot: Snapshot,
  current: ReadonlyMap<string, string>,
): ToolOutput => {
  const changed = changedSince(snapshot, current)
  const header = `${snapshot.label} — taken ${timeOf(snapshot.takenAt)}, ${snapshot.files.size} file${snapshot.files.size === 1 ? '' : 's'}`
  const count =
    changed.length === 0
      ? 'nothing changed since'
      : `${changed.length} file${changed.length === 1 ? '' : 's'} changed since:`
  return {
    ok: true,
    text: [header, count]
      .concat(changed.map((file) => `  ${file} — ${directionOf(snapshot, current, file)}`))
      .join('\n'),
  }
}
