// Type-checker-accurate rename. Every occurrence comes from the index's
// resolved references, so a same-named stranger in another file is never
// touched and an aliased import is never missed.
//
// Two source forms cannot be rewritten by replacing an identifier in place:
// a shorthand property (`{ name }`) and a renamed import or export specifier
// (`{ name as other }`). Both are found by name over the syntax tree rather
// than by resolution, because a shorthand's own resolution points at the
// property it declares, not at the value it reads — which is exactly why they
// would otherwise be missed. Finding one declines the rename instead of
// producing a partial one.
import ts from 'typescript'
import { explainLookup } from './query.ts'
import { resolveSymbol, sourceOf, type Workspace } from './workspace.ts'
import type { EditPlan, FileEdit } from './edit.ts'

const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/

const reserved: readonly string[] = [
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import',
  'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
  'typeof', 'var', 'void', 'while', 'with', 'yield',
]

const declined = (text: string): EditPlan => ({ ok: false, text })

type Occurrence = {
  readonly file: string
  readonly line: number
  readonly form: 'shorthand' | 'aliased-specifier'
}

const isAliasedSpecifier = (node: ts.Node, name: string): boolean =>
  (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) &&
  node.propertyName !== undefined &&
  node.propertyName.getText(node.getSourceFile()) === name

const occurrencesIn = (
  file: string,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
): readonly Occurrence[] => {
  const here: readonly Occurrence[] =
    ts.isShorthandPropertyAssignment(node) && node.name.text === name
      ? [{ file, line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1, form: 'shorthand' }]
      : isAliasedSpecifier(node, name)
        ? [{ file, line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1, form: 'aliased-specifier' }]
        : []
  return here.concat(
    node.getChildren(sourceFile).flatMap((child) => occurrencesIn(file, sourceFile, child, name)),
  )
}

export const unrewritableOccurrences = (
  workspace: Workspace,
  name: string,
): readonly Occurrence[] =>
  [...workspace.sources.entries()].flatMap(([file, sourceFile]) =>
    occurrencesIn(file, sourceFile, sourceFile, name),
  )

// A top-level declaration of the new name in a file that has to be rewritten
// would become a duplicate or a shadow. Declining is cheaper than discovering
// it in the typecheck afterwards.
const collisions = (
  workspace: Workspace,
  newName: string,
  files: ReadonlySet<string>,
): readonly string[] =>
  workspace.index.symbols
    .filter(
      (symbol) =>
        symbol.name === newName && symbol.containerName === undefined && files.has(symbol.file),
    )
    .map((symbol) => `${symbol.file}:${symbol.line}`)

export const renameSymbol = (
  workspace: Workspace,
  name: string,
  file: string | undefined,
  newName: string,
): EditPlan => {
  if (!identifierPattern.test(newName) || reserved.includes(newName))
    return declined(`${newName} is not a usable identifier.`)
  const lookup = resolveSymbol(workspace, name, file)
  if (!lookup.ok) return declined(explainLookup(name, lookup).text)
  const references = workspace.index.references.filter(
    (reference) => reference.symbolId === lookup.symbol.id,
  )
  const files = new Set(references.map((reference) => reference.file))
  const clash = collisions(workspace, newName, files)
  if (clash.length > 0)
    return declined(`${newName} is already declared at ${clash.join(', ')}.`)
  const risky = unrewritableOccurrences(workspace, name)
  if (risky.length > 0)
    return declined(
      [`${name} appears in ${risky.length} places this rename cannot rewrite safely:`]
        .concat(risky.map((occurrence) => `${occurrence.file}:${occurrence.line} ${occurrence.form}`))
        .concat('Edit those by hand, or rename with replace_symbol one file at a time.')
        .join('\n'),
    )
  const edits: readonly FileEdit[] = references
    .filter((reference) => sourceOf(workspace, reference.file) !== undefined)
    .map((reference) => ({
      file: reference.file,
      start: reference.span.start,
      end: reference.span.start + reference.span.length,
      text: newName,
    }))
  return edits.length === 0
    ? declined(`${name} has no resolved occurrences to rewrite.`)
    : {
        ok: true,
        edits,
        summary: `renamed ${name} -> ${newName} at ${edits.length} occurrences in ${files.size} files`,
      }
}
