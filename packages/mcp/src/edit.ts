// Editing by name rather than by matching surrounding text. A plan is a list of
// byte ranges and their replacements; computing it is pure, applying it is not,
// which is what makes the interesting part testable.
import { declarationRange, syntaxErrorIn } from './declaration.ts'
import { explainLookup } from './query.ts'
import { resolveSymbol, sourceOf, type Workspace } from './workspace.ts'

export type FileEdit = {
  readonly file: string
  readonly start: number
  readonly end: number
  readonly text: string
}

export type EditPlan =
  | { readonly ok: true; readonly edits: readonly FileEdit[]; readonly summary: string }
  | { readonly ok: false; readonly text: string }

const declined = (text: string): EditPlan => ({ ok: false, text })

// Applied back to front so that earlier offsets stay valid.
export const applyEdits = (text: string, edits: readonly FileEdit[]): string =>
  edits
    .slice()
    .sort((left, right) => right.start - left.start)
    .reduce((current, edit) => current.slice(0, edit.start) + edit.text + current.slice(edit.end), text)

export const editsByFile = (
  edits: readonly FileEdit[],
): ReadonlyMap<string, readonly FileEdit[]> =>
  new Map(
    [...new Set(edits.map((edit) => edit.file))].map((file) => [
      file,
      edits.filter((edit) => edit.file === file),
    ]),
  )

export const replaceSymbol = (
  workspace: Workspace,
  name: string,
  file: string | undefined,
  source: string,
): EditPlan => {
  const lookup = resolveSymbol(workspace, name, file)
  if (!lookup.ok) return declined(explainLookup(name, lookup).text)
  const syntaxError = syntaxErrorIn(source)
  if (syntaxError !== undefined) return declined(`new source does not parse: ${syntaxError}`)
  const range = declarationRange(lookup.sourceFile, lookup.symbol)
  if (range === undefined) return declined(`${name} has no declaration range.`)
  const replaced = lookup.sourceFile.text.slice(range.start, range.end).split('\n').length
  const written = source.trim().split('\n').length
  return {
    ok: true,
    edits: [{ file: lookup.symbol.file, start: range.start, end: range.end, text: source.trim() }],
    summary: `${lookup.symbol.file}:${lookup.symbol.line} — replaced ${name} (${replaced} lines -> ${written})`,
  }
}

export const insertSymbol = (
  workspace: Workspace,
  file: string,
  source: string,
  after: string | undefined,
): EditPlan => {
  const sourceFile = sourceOf(workspace, file)
  if (sourceFile === undefined) return declined(`${file} is not indexed.`)
  const syntaxError = syntaxErrorIn(source)
  if (syntaxError !== undefined) return declined(`new source does not parse: ${syntaxError}`)
  const body = source.trim()
  if (after === undefined) {
    const end = sourceFile.text.trimEnd().length
    return {
      ok: true,
      edits: [{ file, start: end, end: sourceFile.text.length, text: `\n\n${body}\n` }],
      summary: `${file} — appended ${body.split('\n').length} lines`,
    }
  }
  const lookup = resolveSymbol(workspace, after, file)
  if (!lookup.ok) return declined(explainLookup(after, lookup).text)
  const range = declarationRange(lookup.sourceFile, lookup.symbol)
  if (range === undefined) return declined(`${after} has no declaration range.`)
  return {
    ok: true,
    edits: [{ file, start: range.end, end: range.end, text: `\n\n${body}` }],
    summary: `${file} — inserted ${body.split('\n').length} lines after ${after}`,
  }
}
