// Composition root / CLI entry for this package's two reports over the repository's own code:
//
//   npm run stats            size distributions of functions, statements, expressions (BL-0027)
//   npm run clones           expressions that repeat under different names (shapes.ts, clones.ts)
//
// Both take --json for the same numbers as data. `clones` also takes --min-nodes N,
// --min-count N, --abstract-literals, --keep-subsumed, and --zone core|root|test|all.
import { resolve } from 'node:path'
import ts from 'typescript'
import { defaultCloneOptions, repeatedExpressions, type CloneOptions } from './clones.ts'
import { openSession } from './io.ts'
import { formatCloneReport, formatSizeReport } from './report.ts'
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
    console.log(asJson ? JSON.stringify(groups, undefined, 2) : formatCloneReport(groups))
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
