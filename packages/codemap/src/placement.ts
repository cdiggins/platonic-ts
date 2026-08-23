// Where an extracted declaration goes, and what has to be true once it is there.
//
// Everything in this module is about the files rather than the expression, which is why it
// is not in `sites.ts`: an expression that is perfectly safe to move can still fail to
// compile at its destination, because the name is taken there, because the import would
// close a cycle, or because the body mentions a type that file has never heard of.
import ts from 'typescript'
import type { TextEdit } from './edits.ts'
import { importSource, relativeImport } from './rewrite.ts'
import { fileScope, globalTypeNames, importedFiles, resolutionOf } from './scope.ts'
import { typeNames, type Site } from './sites.ts'
import type { SourceEntry } from './stats.ts'

// A blocker is a reason the rewrite would be wrong; a requirement is something the caller
// has to supply for it to be right. Both carry a location when they have one.
export type ExtractionNote = {
  readonly message: string
  readonly file: string | undefined
  readonly line: number | undefined
}

// ---------------------------------------------------------------------------
// Offsets.
// ---------------------------------------------------------------------------

// Before the top-level statement that contains the first occurrence, so a value declared
// here is initialized before anything reads it.
const insertionOffset = (sourceFile: ts.SourceFile, before: number): number => {
  const statement = sourceFile.statements.find((candidate) => candidate.getEnd() > before)
  return statement === undefined ? sourceFile.getEnd() : statement.pos
}

const importOffset = (sourceFile: ts.SourceFile): number => {
  const imports = sourceFile.statements.filter(ts.isImportDeclaration)
  const last = imports[imports.length - 1]
  return last === undefined ? (sourceFile.statements[0]?.pos ?? 0) : last.getEnd()
}

export const declarationEdit = (
  destination: SourceEntry,
  sites: readonly Site[],
  declaration: string,
): TextEdit => {
  const here = sites.filter((site) => site.entry.file === destination.file)
  const earliest = Math.min(
    ...here.map((site) => site.occurrence.start),
    destination.sourceFile.getEnd(),
  )
  const offset = insertionOffset(destination.sourceFile, earliest)
  return {
    file: destination.file,
    start: offset,
    end: offset,
    text: offset === 0 ? `${declaration}\n\n` : `\n\n${declaration}`,
  }
}

// One import per other file that holds an occurrence, after that file's last import.
export const importEdits = (
  destination: string,
  name: string,
  sites: readonly Site[],
): readonly TextEdit[] => {
  const elsewhere = sites.filter((site) => site.entry.file !== destination)
  const files = [...new Set(elsewhere.map((site) => site.entry.file))]
  return files.flatMap((file) => {
    const entry = elsewhere.find((site) => site.entry.file === file)?.entry
    if (entry === undefined) return []
    const offset = importOffset(entry.sourceFile)
    return [
      {
        file,
        start: offset,
        end: offset,
        text: `\n${importSource(name, relativeImport(file, destination))}`,
      },
    ]
  })
}

// ---------------------------------------------------------------------------
// Whether it can land.
// ---------------------------------------------------------------------------

// Two ways a plan that is safe in isolation still fails to compile once it lands: a name the
// receiving file already declares, and an import that closes a cycle. Neither can be seen
// before the destination is known, and both were real on this repository's own code.
export const placementBlockers = (
  name: string,
  destination: SourceEntry,
  sites: readonly Site[],
): readonly ExtractionNote[] => {
  const receiving = [...new Set(sites.map((site) => site.entry))].filter(
    (entry) => entry.file !== destination.file,
  )
  const imported = importedFiles(destination.file, destination.sourceFile)
  const taken = [destination, ...receiving].filter((entry) =>
    fileScope(entry.file, entry.sourceFile).names.has(name),
  )
  return [
    ...taken.map((entry) => ({
      message: `\`${name}\` is already declared in ${entry.file}`,
      file: entry.file,
      line: undefined,
    })),
    ...receiving
      .filter((entry) => imported.includes(entry.file))
      .map((entry) => ({
        message: `${destination.file} imports ${entry.file}, so importing back would close a cycle`,
        file: entry.file,
        line: undefined,
      })),
  ]
}

// What the caller still has to do. A type name is the usual one: it travels with the body's
// text, is never a hole, and needs an import the destination may not have.
export const requirements = (
  kept: readonly string[],
  template: Site,
  destination: SourceEntry,
  typed: boolean,
): readonly ExtractionNote[] => {
  const scope = fileScope(destination.file, destination.sourceFile)
  const missing = kept.filter((name) => resolutionOf(name, template.node, scope) === 'unknown')
  const missingTypes = typeNames(template.node).filter(
    (name) => !scope.names.has(name) && !globalTypeNames.has(name),
  )
  return [
    ...(typed
      ? []
      : [
          {
            message: 'no type checker was given, so the declaration has no type annotations',
            file: undefined,
            line: undefined,
          },
        ]),
    ...missing.map((name) => ({
      message: `the body reads \`${name}\`, which ${destination.file} does not declare or import`,
      file: destination.file,
      line: undefined,
    })),
    ...missingTypes.map((name) => ({
      message: `the body names the type \`${name}\`, which ${destination.file} does not declare or import`,
      file: destination.file,
      line: undefined,
    })),
  ]
}
