// The IO edge: holds the repository open, rebuilds only what changed since the
// last call, and writes edit plans back to disk.
//
// Files are parsed here rather than taken from the compiler program the index
// was built with, because nothing outside symbol resolution needs a checker and
// a second program costs seconds. The offsets still line up: both readings come
// from the same bytes, and both are re-read when a file changes.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
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
import { applyEdits, editsByFile, type FileEdit } from './edit.ts'
import { createCompiler, type Compiler } from './compiler.ts'
import type { Workspace } from './workspace.ts'

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

const sourcePaths = async (repoDir: string): Promise<readonly string[]> =>
  (await collectSourceFiles(repoDir)).map((path) => toRepoRelative(repoDir, path))

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

export const writeEdits = async (
  repoDir: string,
  workspace: Workspace,
  edits: readonly FileEdit[],
): Promise<WriteResult> => {
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
