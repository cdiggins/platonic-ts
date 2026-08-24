// Composition root / CLI entry for this package's two reports over the repository's own
// code: `npm run stats` and `npm run clones`.
//
//   npm run stats            size distributions of functions, statements, expressions (BL-0027)
//   npm run clones           expressions that repeat under different names (shapes.ts, clones.ts)
//
// Both take --json for the same numbers as data. `clones` also takes --min-nodes N,
// --min-count N, --abstract-literals, --keep-subsumed, and --zone core|root|test|all.
//
//   npm run clones -- --extract 3 --name countActive
//
// prints what extracting the third group would do: the declaration, every call site, and
// anything that would stop it compiling. --into <file> chooses where the declaration lands,
// and --write applies the plan, all files or none.
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { defaultCloneOptions, repeatedExpressions, type CloneOptions } from './clones.ts'
import { applyEdits, editedFiles } from './edits.ts'
import { defaultExtractOptions, extractionPlan, type ExtractionPlan } from './extract.ts'
import { openSession } from './io.ts'
import { formatCloneReport, formatExtractionPlan, formatSizeReport } from './report.ts'
import { sizeReport, zoneOf, type SourceEntry, type Zone } from './stats.ts'
import { toRepoRelative } from './symbols.ts'

const repoDir = resolve(import.meta.dirname, '..', '..', '..')

const byRepoPath = (
  program: ts.Program,
): ReadonlyMap<string, ts.SourceFile> =>
  new Map(
    program
      .getSourceFiles()
      .map((sourceFile) => [toRepoRelative(repoDir, sourceFile.fileName).toLowerCase(), sourceFile]),
  )

const hasFlag = (name: string): boolean => process.argv.includes(name)

const numberFlag = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(name)
  const raw = index < 0 ? undefined : process.argv[index + 1]
  const value = raw === undefined ? Number.NaN : Number(raw)
  return Number.isFinite(value) ? value : fallback
}

const zoneFlag = (): Zone | 'all' => {
  const index = process.argv.indexOf('--zone')
  const raw = index < 0 ? undefined : process.argv[index + 1]
  return raw === 'core' || raw === 'root' || raw === 'test' ? raw : 'all'
}

const textFlag = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(name)
  const raw = index < 0 ? undefined : process.argv[index + 1]
  return raw === undefined || raw.startsWith('--') ? fallback : raw
}

// All files or none: a half-applied plan leaves the repository in a state neither the old
// code nor the new one, and the edits were computed against the text the program parsed.
const writePlan = async (
  repo: string,
  plan: ExtractionPlan,
  entries: readonly SourceEntry[],
): Promise<readonly string[]> => {
  const rewritten = editedFiles(plan.edits).map((file) => {
    const entry = entries.find((candidate) => candidate.file === file)
    const applied =
      entry === undefined
        ? { ok: false as const, reason: 'out-of-range' as const }
        : applyEdits(plan.edits, file, entry.sourceFile.text)
    return { file, applied }
  })
  const failed = rewritten.filter(({ applied }) => !applied.ok).map(({ file }) => file)
  if (failed.length > 0) return failed
  await Promise.all(
    rewritten.map(({ file, applied }) =>
      applied.ok ? writeFile(join(repo, file), applied.text, 'utf8') : Promise.resolve(),
    ),
  )
  return []
}

const cloneOptions = (): CloneOptions => ({
  minNodes: numberFlag('--min-nodes', defaultCloneOptions.minNodes),
  minOccurrences: numberFlag('--min-count', defaultCloneOptions.minOccurrences),
  literals: hasFlag('--abstract-literals') ? 'abstract' : 'keep',
  dropSubsumed: !hasFlag('--keep-subsumed'),
})

const main = async (): Promise<void> => {
  const session = await openSession(repoDir, Date.now())
  const sources = byRepoPath(session.program)
  const typescriptFiles = session.index.files.filter((entry) => entry.kind === 'typescript')
  const entries: readonly SourceEntry[] = typescriptFiles.flatMap((entry) => {
    const sourceFile = sources.get(entry.file.toLowerCase())
    return sourceFile === undefined ? [] : [{ file: entry.file, sourceFile }]
  })
  const asJson = hasFlag('--json')
  if (process.argv.includes('clones')) {
    const zone = zoneFlag()
    const inZone = entries.filter((entry) => zone === 'all' || zoneOf(entry.file) === zone)
    const groups = repeatedExpressions(inZone, cloneOptions())
    const rank = numberFlag('--extract', 0)
    if (rank < 1) {
      console.log(asJson ? JSON.stringify(groups, undefined, 2) : formatCloneReport(groups))
      return
    }
    const group = groups[rank - 1]
    if (group === undefined) {
      console.log(`no group #${rank}: ${groups.length} shape(s) repeat under these settings`)
      return
    }
    const plan = extractionPlan(group, inZone, {
      ...defaultExtractOptions,
      name: textFlag('--name', 'extracted'),
      destination: hasFlag('--into') ? textFlag('--into', '') : undefined,
      checker: session.program.getTypeChecker(),
    })
    console.log(asJson ? JSON.stringify(plan, undefined, 2) : formatExtractionPlan(plan))
    if (hasFlag('--write') && plan.blockers.length === 0) {
      const failed = await writePlan(repoDir, plan, inZone)
      console.log(
        failed.length === 0
          ? `\nwrote ${editedFiles(plan.edits).length} file(s)`
          : `\nwrote nothing: the edits no longer fit ${failed.join(', ')}`,
      )
    }
    return
  }
  const report = sizeReport(typescriptFiles, entries)
  const missing = typescriptFiles.length - entries.length
  console.log(asJson ? JSON.stringify(report, undefined, 2) : formatSizeReport(report))
  if (missing > 0 && !asJson) {
    console.log(
      `\nnote: ${missing} indexed file(s) are outside the compiler program and contributed ` +
        'function sizes but no statement or expression sizes',
    )
  }
}

void main()
