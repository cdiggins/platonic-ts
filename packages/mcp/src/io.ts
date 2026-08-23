// The IO edge: builds the workspace, caches it until the repository changes,
// and writes edit plans back to disk.
//
// Files are parsed here rather than taken from the compiler program the index
// was built with, because nothing outside symbol resolution needs a checker and
// a second program costs seconds. The offsets still line up: both readings come
// from the same bytes, and any write invalidates the cache.
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import ts from 'typescript'
import { collectSourceFiles } from '../../check/src/scan.ts'
import { indexRepo, toRepoRelative } from '../../codemap/src/index.ts'
import { applyEdits, editsByFile, type FileEdit } from './edit.ts'
import type { Workspace } from './workspace.ts'

export type WriteResult =
  | { readonly ok: true; readonly files: readonly string[] }
  | { readonly ok: false; readonly text: string }

// Newest modification time plus file count: enough to notice any edit, an
// addition, or a deletion, and far cheaper than rebuilding to find out.
const repoStamp = async (repoDir: string): Promise<string> => {
  const files = await collectSourceFiles(repoDir)
  const times = await Promise.all(
    files.map((file) => stat(file).then((info) => info.mtimeMs).catch(() => 0)),
  )
  return `${files.length}:${Math.max(0, ...times)}`
}

const parseSources = async (
  repoDir: string,
): Promise<ReadonlyMap<string, ts.SourceFile>> => {
  const files = await collectSourceFiles(repoDir)
  const parsed = await Promise.all(
    files.map(async (file) => {
      const text = await readFile(file, 'utf8').catch(() => '')
      const key = toRepoRelative(repoDir, file.split(sep).join('/'))
      return [key, ts.createSourceFile(key, text, ts.ScriptTarget.Latest, true)] as const
    }),
  )
  return new Map(parsed)
}

const buildWorkspace = async (repoDir: string, now: number): Promise<Workspace> => {
  const [index, sources] = await Promise.all([indexRepo(repoDir, now), parseSources(repoDir)])
  return { index, sources }
}

let cached: { readonly stamp: string; readonly workspace: Workspace } | undefined

export const loadWorkspace = async (repoDir: string): Promise<Workspace> => {
  const stamp = await repoStamp(repoDir)
  if (cached !== undefined && cached.stamp === stamp) return cached.workspace
  const workspace = await buildWorkspace(repoDir, Date.now())
  cached = { stamp, workspace }
  return workspace
}

export const invalidateWorkspace = (): void => {
  cached = undefined
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
  const current = await readFile(path, 'utf8').catch(() => undefined)
  if (expected === undefined || current === undefined) return `${file}: not readable`
  if (current !== expected) return `${file}: changed since it was indexed`
  await writeFile(path, applyEdits(current, edits), 'utf8')
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
  invalidateWorkspace()
  const failures = problems.filter((problem): problem is string => problem !== undefined)
  return failures.length > 0
    ? { ok: false, text: failures.join('\n') }
    : { ok: true, files: grouped.map(([file]) => file) }
}
