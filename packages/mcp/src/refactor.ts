// The escape hatch. The specific tools cover the transformations worth naming;
// the compiler ships dozens more, and this exposes them addressed by
// declaration name rather than by character offset. Two calls, not one: the
// caller lists what applies to a declaration, then applies one by name.
import ts from 'typescript'
import {
  formatSettings,
  newFilesIn,
  toFileEdits,
  userPreferences,
  type Compiler,
} from './compiler.ts'
import { declarationRange } from './declaration.ts'
import type { EditPlan } from './edit.ts'
import { explainLookup, type ToolOutput } from './query.ts'
import { resolveSymbol } from './workspace.ts'

const failed = (text: string): ToolOutput => ({ ok: false, text })

const declined = (text: string): EditPlan => ({ ok: false, text })

type Target = {
  readonly file: string
  readonly path: string
  readonly line: number
  readonly range: ts.TextRange
}

type Resolved =
  | { readonly ok: true; readonly target: Target }
  | { readonly ok: false; readonly text: string }

// The declaration's range, including its leading comment, is what the language
// service is asked about: a refactoring that applies to a whole declaration is
// the only kind worth addressing by name.
const resolveTarget = (compiler: Compiler, name: string, file: string | undefined): Resolved => {
  const lookup = resolveSymbol(compiler.workspace, name, file)
  if (!lookup.ok) return { ok: false, text: explainLookup(name, lookup).text }
  const range = declarationRange(lookup.sourceFile, lookup.symbol)
  if (range === undefined) return { ok: false, text: `${name} has no declaration range.` }
  // The language service raises rather than returning a failure when it is
  // asked about a file the program does not contain, so the file is checked
  // before any call is made.
  if (compiler.boundSourceFile(lookup.symbol.file) === undefined)
    return {
      ok: false,
      text: `${lookup.symbol.file} is indexed but not in the compiler's program; no refactorings can be computed for ${name}.`,
    }
  return {
    ok: true,
    target: {
      file: lookup.symbol.file,
      path: compiler.pathOf(lookup.symbol.file),
      line: lookup.symbol.line,
      range: { pos: range.start, end: range.end },
    },
  }
}

const applicableAt = (
  compiler: Compiler,
  target: Target,
): readonly ts.ApplicableRefactorInfo[] =>
  compiler.language.getApplicableRefactors(target.path, target.range, userPreferences)

const located = (target: Target): string => `${target.file}:${target.line}`

export const availableRefactors = (
  compiler: Compiler,
  name: string,
  file: string | undefined,
): ToolOutput => {
  const resolved = resolveTarget(compiler, name, file)
  if (!resolved.ok) return failed(resolved.text)
  const target = resolved.target
  // Both names are printed because `applyRefactor` takes both; the description
  // is for the reader and is never matched against.
  const lines = applicableAt(compiler, target).flatMap((refactor) =>
    refactor.actions.map((action) => `${refactor.name} | ${action.name} — ${action.description}`),
  )
  return lines.length === 0
    ? { ok: true, text: `${name} at ${located(target)} — no refactorings apply.` }
    : {
        ok: true,
        text: [`${name} at ${located(target)} — ${lines.length} refactorings:`]
          .concat(lines)
          .join('\n'),
      }
}

export const applyRefactor = (
  compiler: Compiler,
  name: string,
  file: string | undefined,
  refactor: string,
  action: string,
): EditPlan => {
  const resolved = resolveTarget(compiler, name, file)
  if (!resolved.ok) return declined(resolved.text)
  const target = resolved.target
  const refactors = applicableAt(compiler, target)
  const chosen = refactors.find((candidate) => candidate.name === refactor)
  if (chosen === undefined)
    return declined(
      [`${refactor} does not apply to ${name} at ${located(target)}.`]
        .concat(
          refactors.length === 0
            ? ['No refactorings apply there.']
            : [`Applicable: ${refactors.map((candidate) => candidate.name).join(', ')}`],
        )
        .join('\n'),
    )
  const step = chosen.actions.find((candidate) => candidate.name === action)
  if (step === undefined)
    return declined(
      `${action} is not an action of ${refactor}; its actions are ${chosen.actions
        .map((candidate) => candidate.name)
        .join(', ')}.`,
    )
  const result = compiler.language.getEditsForRefactor(
    target.path,
    formatSettings,
    target.range,
    refactor,
    action,
    userPreferences,
  )
  if (result === undefined)
    return declined(`${refactor} | ${action} computed nothing for ${name} at ${located(target)}.`)
  const created = newFilesIn(result.edits)
  if (created.length > 0)
    return declined(
      `${refactor} | ${action} wants to create ${created.join(', ')}; a plan can only rewrite files that exist.`,
    )
  const edits = toFileEdits(compiler, result.edits)
  if (edits.length === 0)
    return declined(`${refactor} | ${action} produced no edits for ${name} at ${located(target)}.`)
  const files = new Set(edits.map((edit) => edit.file))
  return {
    ok: true,
    edits,
    summary: `${located(target)} — applied ${refactor} | ${action}: ${edits.length} edits in ${files.size} files`,
  }
}
