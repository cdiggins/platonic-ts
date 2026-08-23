// Composition root / CLI entry for `platonic stats` (BL-0027). Prints the size
// distributions of this repository's own functions, statements, and expressions.
// Run with: npm run stats  (add --json for the same numbers as data)
import { resolve } from 'node:path'
import ts from 'typescript'
import { openSession } from './io.ts'
import { formatSizeReport } from './report.ts'
import { sizeReport, type SourceEntry } from './stats.ts'
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

const main = async (): Promise<void> => {
  const session = await openSession(repoDir, Date.now())
  const sources = byRepoPath(session.program)
  const typescriptFiles = session.index.files.filter((entry) => entry.kind === 'typescript')
  const entries: readonly SourceEntry[] = typescriptFiles.flatMap((entry) => {
    const sourceFile = sources.get(entry.file.toLowerCase())
    return sourceFile === undefined ? [] : [{ file: entry.file, sourceFile }]
  })
  const report = sizeReport(typescriptFiles, entries)
  const missing = typescriptFiles.length - entries.length
  console.log(
    process.argv.includes('--json')
      ? JSON.stringify(report, undefined, 2)
      : formatSizeReport(report),
  )
  if (missing > 0 && !process.argv.includes('--json')) {
    console.log(
      `\nnote: ${missing} indexed file(s) are outside the compiler program and contributed ` +
        'function sizes but no statement or expression sizes',
    )
  }
}

void main()
