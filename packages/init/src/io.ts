// Impure edges of `platonic init`: read the target repository into a snapshot,
// and apply a plan to disk. Everything that decides *what* to do lives in
// index.ts; this file only looks and writes.
//
// The escape-hatch counting reuses `countEscapeHatches` from packages/check
// unchanged — the counter is per-file and pure, so it retrofits onto any
// layout. Only check's own `scanRepo` is platonic-ts-shaped (it assumes
// `packages/*/src`), which is why the walk below is local.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { countEscapeHatches, sumCounts, type RatchetCounts } from '../../check/src/index.ts'
import {
  isJsonObject,
  jsonFileContent,
  probedFiles,
  type ApplyOutcome,
  type ApplyReport,
  type InitPlan,
  type JsonObject,
  type TargetSnapshot,
} from './index.ts'

const skippedDirectories: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
]

const sourceExtensions: readonly string[] = ['.ts', '.tsx', '.mts', '.cts']

const walkSourceFiles = async (dir: string): Promise<readonly string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const found = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        return skippedDirectories.includes(entry.name) ? [] : walkSourceFiles(full)
      }
      const isSource =
        entry.isFile() &&
        sourceExtensions.some((extension) => entry.name.endsWith(extension)) &&
        !entry.name.endsWith('.d.ts')
      return isSource ? [full] : []
    }),
  )
  return found.flat()
}

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

const readJson = async (path: string): Promise<JsonObject | undefined> => {
  const raw = await readFile(path, 'utf8').catch(() => undefined)
  if (raw === undefined) return undefined
  const parsed = ((): unknown => {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  })()
  return isJsonObject(parsed) ? parsed : undefined
}

const countKeys: readonly (keyof RatchetCounts)[] = [
  'explicitAny',
  'asCasts',
  'nonNullAssertions',
  'tsDirectives',
  'eslintDisables',
]

const asCounts = (value: JsonObject | undefined): RatchetCounts | undefined => {
  if (value === undefined) return undefined
  const missing = countKeys.some((key) => typeof value[key] !== 'number')
  if (missing) return undefined
  const read = (key: keyof RatchetCounts): number => {
    const entry = value[key]
    return typeof entry === 'number' ? entry : 0
  }
  return {
    explicitAny: read('explicitAny'),
    asCasts: read('asCasts'),
    nonNullAssertions: read('nonNullAssertions'),
    tsDirectives: read('tsDirectives'),
    eslintDisables: read('eslintDisables'),
    // Absent from baselines written before the count existed; read() maps a
    // missing key to 0, and countKeys keeps such baselines parseable.
    undocumentedExports: read('undocumentedExports'),
  }
}

// Counts files and escape-hatch declarations in the target directory's source code.
export const scanTarget = async (
  targetDir: string,
): Promise<{ readonly counts: RatchetCounts; readonly fileCount: number }> => {
  const files = await walkSourceFiles(targetDir)
  const counts = await Promise.all(
    files.map(async (file) => countEscapeHatches(file, await readFile(file, 'utf8'))),
  )
  return { counts: sumCounts(counts), fileCount: files.length }
}

// Creates a snapshot of the target repository's config files, git status, and escape hatches.
export const snapshotTarget = async (targetDir: string): Promise<TargetSnapshot> => {
  const present = await Promise.all(
    probedFiles.map(async (name) => ((await exists(join(targetDir, name))) ? [name] : [])),
  )
  const existingFiles = present.flat()
  const [hasGit, packageJson, tsconfig, ratchetJson, scan] = await Promise.all([
    exists(join(targetDir, '.git')),
    readJson(join(targetDir, 'package.json')),
    readJson(join(targetDir, 'tsconfig.json')),
    readJson(join(targetDir, 'ratchet.json')),
    scanTarget(targetDir),
  ])
  return {
    hasGit,
    existingFiles,
    packageJson,
    tsconfig,
    ratchetBaseline: asCounts(ratchetJson),
    counts: scan.counts,
    scannedFileCount: scan.fileCount,
  }
}

// Additions only: a key the target already holds is never replaced, so a merge
// can only ever grow the file. Conflicts were reported by `planInit` and are
// deliberately absent from `additions`.
const mergeInto = (existing: JsonObject, additions: JsonObject): JsonObject =>
  Object.entries(additions).reduce<JsonObject>((merged, [key, value]) => {
    const current = merged[key]
    if (isJsonObject(current) && isJsonObject(value)) {
      return { ...merged, [key]: mergeInto(current, value) }
    }
    return current === undefined ? { ...merged, [key]: value } : merged
  }, existing)

const applyAction = async (
  targetDir: string,
  action: InitPlan['actions'][number],
  dryRun: boolean,
): Promise<ApplyOutcome> => {
  if (action.kind === 'skip') {
    return { path: action.path, kind: 'skip', changed: false, detail: action.reason }
  }
  const full = join(targetDir, action.path)
  if (action.kind === 'writeFile') {
    const already = await exists(full)
    if (already) {
      return {
        path: action.path,
        kind: 'writeFile',
        changed: false,
        detail: 'file appeared since the plan was made — refusing to overwrite',
      }
    }
    if (!dryRun) {
      await writeFile(full, action.content, 'utf8')
    }
    return {
      path: action.path,
      kind: 'writeFile',
      changed: !dryRun,
      detail: dryRun ? `would write ${action.content.length} bytes` : action.reason,
    }
  }
  const existing = await readJson(full)
  if (existing === undefined) {
    return {
      path: action.path,
      kind: 'mergeJson',
      changed: false,
      detail: 'target file is missing or unparseable — refusing to merge',
    }
  }
  const merged = mergeInto(existing, action.additions)
  const unresolved =
    action.conflicts.length === 0 ? '' : `; ${action.conflicts.length} conflict(s) left for a human`
  if (!dryRun) {
    await writeFile(full, jsonFileContent(merged), 'utf8')
  }
  const added = Object.keys(action.additions).length
  return {
    path: action.path,
    kind: 'mergeJson',
    changed: !dryRun && added > 0,
    detail: `${dryRun ? 'would merge' : 'merged'} ${added} key group(s)${unresolved}`,
  }
}

// Applies an InitPlan to the target repository, writing files or running in dry-run mode.
export const applyPlan = async (
  targetDir: string,
  plan: InitPlan,
  options: { readonly dryRun: boolean },
): Promise<ApplyReport> => {
  const targetExists = await exists(targetDir)
  if (!targetExists) {
    return {
      dryRun: options.dryRun,
      outcomes: [
        { path: targetDir, kind: 'skip', changed: false, detail: 'target directory does not exist' },
      ],
    }
  }
  let outcomes: readonly ApplyOutcome[] = []
  for (const action of plan.actions) {
    outcomes = [...outcomes, await applyAction(targetDir, action, options.dryRun)]
  }
  return { dryRun: options.dryRun, outcomes }
}
