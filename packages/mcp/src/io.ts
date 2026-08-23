// The IO edge: holds the repository open, rebuilds only what changed since the
// last call, and writes edit plans back to disk.
//
// Files are parsed here rather than taken from the compiler program the index
// was built with, because nothing outside symbol resolution needs a checker and
// a second program costs seconds. The offsets still line up: both readings come
// from the same bytes, and both are re-read when a file changes.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import ts from 'typescript'
import { collectSourceFiles } from '../../check/src/scan.ts'
import {
  changedPaths,
  openSession,
  scanTimestamps,
  toRepoRelative,
  updateSession,
  watchRepo,
  type IndexSession,
  type RepoWatch,
} from '../../codemap/src/index.ts'
import { applyEdits, editsByFile, overlapping, type FileEdit } from './edit.ts'
import { createCompiler, type Compiler } from './compiler.ts'
import { snapshotOfWorkspace, type Snapshot } from './checkpoint.ts'
import type { Workspace } from './workspace.ts'

// Outcome of writing edits to disk: modified file paths on success, error text on failure.
export type WriteResult =
  | { readonly ok: true; readonly files: readonly string[] }
  | { readonly ok: false; readonly text: string }

// One repository, held open between calls. `touched` collects paths as the
// watcher reports them and as this module writes them; `timestamps` is what the
// next scan is compared against.
type OpenRepo = {
  readonly repoDir: string
  readonly session: IndexSession
  readonly workspace: Workspace
  readonly watch: RepoWatch | undefined
  readonly touched: Set<string>
  readonly timestamps: ReadonlyMap<string, number>
}

let current: OpenRepo | undefined

// Git is read, never written: `symbol_diff` needs the previous text and
// nothing here changes history.
const runGit = (repoDir: string, args: readonly string[]): Promise<string | undefined> =>
  new Promise((resolveWith) => {
    execFile('git', [...args], { cwd: repoDir, maxBuffer: 1 << 24 }, (error, stdout) =>
      resolveWith(error === null ? stdout : undefined),
    )
  })

// `ratchet.json` is not source and is not indexed, but `escape_hatch_index`
// needs its baseline and the tools that walk the workspace all filter to `.ts`,
// so carrying its text here costs nothing and saves a second file reader.
const sourcePaths = async (repoDir: string): Promise<readonly string[]> => [
  ...(await collectSourceFiles(repoDir)).map((path) => toRepoRelative(repoDir, path)),
  'ratchet.json',
]

// Unreadable files are dropped rather than defaulted to empty: a deleted file
// should leave the workspace, not sit in it as an empty one.
const parseSources = async (
  repoDir: string,
  files: readonly string[],
): Promise<readonly (readonly [string, ts.SourceFile])[]> => {
  const parsed = await Promise.all(
    files.map(async (file) => {
      const text = await readFile(resolve(repoDir, file), 'utf8').catch(() => undefined)
      return text === undefined
        ? []
        : [[file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)] as const]
    }),
  )
  return parsed.flat()
}

// The watcher starts before the first index is built, so an edit made during
// the build is not lost.
const openRepo = async (repoDir: string): Promise<OpenRepo> => {
  const touched = new Set<string>()
  const watch = watchRepo(repoDir, (file) => touched.add(file))
  const [session, sources, timestamps] = await Promise.all([
    openSession(repoDir, Date.now()),
    sourcePaths(repoDir).then((files) => parseSources(repoDir, files)),
    scanTimestamps(repoDir),
  ])
  return {
    repoDir,
    session,
    workspace: { index: session.index, sources: new Map(sources) },
    watch,
    touched,
    timestamps,
  }
}

// Two signals, unioned. The scan is the authority — it cannot miss a change,
// and over this repository's 143 files it costs about 3ms. The watcher adds the
// changes a modification time does not show, such as a file restored with its
// old timestamp, and it is free to consult. When the platform offers no
// recursive watch there is simply nothing to add.
const changesSince = async (
  repo: OpenRepo,
): Promise<{
  readonly files: readonly string[]
  readonly timestamps: ReadonlyMap<string, number>
}> => {
  const marked = [...repo.touched]
  repo.touched.clear()
  const timestamps = await scanTimestamps(repo.repoDir)
  return {
    files: [...new Set([...marked, ...changedPaths(repo.timestamps, timestamps)])],
    timestamps,
  }
}

const rebuild = async (
  repo: OpenRepo,
  changed: readonly string[],
  timestamps: ReadonlyMap<string, number>,
): Promise<OpenRepo> => {
  const session = await updateSession(repo.session, changed, Date.now())
  const changedSources = new Set(changed.filter((file) => file.endsWith('.ts')))
  const reparsed = await parseSources(repo.repoDir, [...changedSources])
  const sources = new Map([
    ...[...repo.workspace.sources].filter(([file]) => !changedSources.has(file)),
    ...reparsed,
  ])
  return { ...repo, session, workspace: { index: session.index, sources }, timestamps }
}

// Loads or reloads the workspace, tracking changes since the last call.
export const loadWorkspace = async (repoDir: string): Promise<Workspace> => {
  const repo = current
  if (repo === undefined || repo.repoDir !== repoDir) {
    repo?.watch?.close()
    current = await openRepo(repoDir)
    return current.workspace
  }
  const { files, timestamps } = await changesSince(repo)
  if (files.length === 0) return repo.workspace
  current = await rebuild(repo, files, timestamps)
  return current.workspace
}

// A write is a change the watcher would report too, but not necessarily before
// the next call arrives, so it is recorded directly.
const markChanged = (files: readonly string[]): void => {
  files.forEach((file) => current?.touched.add(file))
}

// Offsets in a plan are only meaningful against the text they were computed
// from, so the file is re-read and compared before anything is written. A
// mismatch means the repository moved underneath the plan.
const writeFileEdits = async (
  repoDir: string,
  workspace: Workspace,
  file: string,
  edits: readonly FileEdit[],
): Promise<string | undefined> => {
  const expected = workspace.sources.get(file)?.text
  const path = resolve(repoDir, file)
  const onDisk = await readFile(path, 'utf8').catch(() => undefined)
  if (expected === undefined || onDisk === undefined) return `${file}: not readable`
  if (onDisk !== expected) return `${file}: changed since it was indexed`
  await writeFile(path, applyEdits(onDisk, edits), 'utf8')
  return undefined
}

// The overlap check is here rather than in each tool because this is the only
// way to disk. Two edits whose ranges nest are applied back to front, so the
// outer one lands second and overwrites the inner one with the text it already
// replaced — a corrupted file and no error anywhere. Refusing costs a round
// trip; not refusing costs the file.
export const writeEdits = async (
  repoDir: string,
  workspace: Workspace,
  edits: readonly FileEdit[],
): Promise<WriteResult> => {
  const collisions = overlapping(edits)
  if (collisions.length > 0)
    return {
      ok: false,
      text: [`${collisions.length} overlapping edits; nothing written:`, ...collisions].join('\n'),
    }
  const grouped = [...editsByFile(edits).entries()]
  const problems = await Promise.all(
    grouped.map(([file, fileEdits]) => writeFileEdits(repoDir, workspace, file, fileEdits)),
  )
  const files = grouped.map(([file]) => file)
  markChanged(files)
  const failures = problems.filter((problem): problem is string => problem !== undefined)
  return failures.length > 0 ? { ok: false, text: failures.join('\n') } : { ok: true, files }
}

// The bound program is built on demand and thrown away: binding the repository
// costs seconds, and only a minority of tools need it. Callers that need it
// twice in one request should pass the value along rather than ask again.
export const loadCompiler = async (repoDir: string): Promise<Compiler> => {
  const workspace = await loadWorkspace(repoDir)
  const texts = new Map([...workspace.sources].map(([file, source]) => [file, source.text]))
  return createCompiler(repoDir, texts, workspace)
}

// Snapshots live here because `checkpoint` and `revert` are two calls: the
// value has to outlive the first one. Bounded, because a snapshot is a full
// copy of every indexed source text.
const snapshotLimit = 10

let snapshots: readonly Snapshot[] = []

// Records a snapshot and retains it for later restoration or comparison.
export const takeCheckpoint = (workspace: Workspace, label: string, takenAt: number): Snapshot => {
  const snapshot = snapshotOfWorkspace(workspace, label, takenAt)
  snapshots = [snapshot, ...snapshots.filter((held) => held.label !== label)].slice(0, snapshotLimit)
  return snapshot
}

// No label means the most recent one, which is what a caller undoing the thing
// they just did means every time.
export const heldSnapshot = (label: string | undefined): Snapshot | undefined =>
  label === undefined ? snapshots[0] : snapshots.find((held) => held.label === label)

// Returns the labels of all held checkpoints, in reverse chronological order.
export const heldLabels = (): readonly string[] => snapshots.map((snapshot) => snapshot.label)

// Extracts the current source texts from the workspace.
export const textsOf = (workspace: Workspace): ReadonlyMap<string, string> =>
  new Map([...workspace.sources].map(([file, source]) => [file, source.text]))

// What the working tree looked like at the last commit, for `symbol_diff`. Only
// the files the workspace indexes are read: anything else would show up as a
// removal.
export const loadHeadTexts = async (
  repoDir: string,
  workspace: Workspace,
): Promise<ReadonlyMap<string, string>> => {
  const entries = await Promise.all(
    [...workspace.sources.keys()].map(async (file) => {
      const text = await runGit(repoDir, ['show', `HEAD:${file}`])
      return text === undefined ? [] : [[file, text] as const]
    }),
  )
  return new Map(entries.flat())
}

// The filesystem half of `rename_file`: the edit plan rewrites the importers,
// and the file itself still has to move.
export const moveFile = async (
  repoDir: string,
  from: string,
  to: string,
): Promise<string | undefined> => {
  const target = resolve(repoDir, to)
  const problem = await mkdir(dirname(target), { recursive: true })
    .then(() => rename(resolve(repoDir, from), target))
    .then(() => undefined)
    .catch((error: unknown) => (error instanceof Error ? error.message : String(error)))
  if (problem === undefined) markChanged([from, to])
  return problem
}
