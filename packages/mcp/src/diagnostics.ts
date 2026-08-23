// The compiler's own opinion of the code, scoped to named files: errors, the
// quick fixes it offers for them, and import tidying.
//
// `diagnostics` is a fast inner-loop check, NOT the gate. It binds nothing the
// program has not already bound and asks only about the files it is given, so it
// answers in milliseconds where `check` takes seconds — but it sees only those
// files, it does not run lint or the escape-hatch ratchet, and a repository can
// be clean here and still fail `check`. The one failure mode that matters is an
// agent treating a clean answer as green, so every answer says so out loud.
//
// The language service throws when handed a file the program does not contain,
// so every entry point resolves files against the program first and reports the
// misses rather than calling through with them.
import ts from 'typescript'
import {
  describeDiagnostic,
  formatSettings,
  newFilesIn,
  toFileEdits,
  userPreferences,
  type Compiler,
} from './compiler.ts'
import type { EditPlan } from './edit.ts'
import type { ToolOutput } from './query.ts'

const SCOPE = 'scoped check, not the gate — run check before calling it green'

const declined = (text: string): EditPlan => ({ ok: false, text })

const inProgram = (compiler: Compiler, file: string): boolean =>
  compiler.boundSourceFile(file) !== undefined

const diagnosticsIn = (compiler: Compiler, file: string): readonly ts.Diagnostic[] => {
  const path = compiler.pathOf(file)
  return [
    ...compiler.language.getSyntacticDiagnostics(path),
    ...compiler.language.getSemanticDiagnostics(path),
  ]
}

const lineOf = (diagnostic: ts.Diagnostic): number | undefined =>
  diagnostic.file === undefined || diagnostic.start === undefined
    ? undefined
    : diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1

const at = (file: string, line: number | undefined): string =>
  line === undefined ? file : `${file}:${line}`

type FileReport = { readonly count: number; readonly lines: readonly string[] }

const reportErrors = (
  compiler: Compiler,
  file: string,
  found: readonly ts.Diagnostic[],
): FileReport =>
  found.length === 0
    ? { count: 0, lines: [`${file}: clean`] }
    : {
        count: found.length,
        lines: [`${file}: ${found.length} errors`].concat(
          found.map((diagnostic) => `  ${describeDiagnostic(compiler, diagnostic)}`),
        ),
      }

const reportFile = (compiler: Compiler, file: string): FileReport =>
  inProgram(compiler, file)
    ? reportErrors(compiler, file, diagnosticsIn(compiler, file))
    : { count: 0, lines: [`${file}: not in the program`] }

export const diagnostics = (compiler: Compiler, files: readonly string[]): ToolOutput => {
  const known = files.filter((file) => inProgram(compiler, file))
  const reports = files.map((file) => reportFile(compiler, file))
  const total = reports.reduce((sum, report) => sum + report.count, 0)
  const header =
    total === 0
      ? `no errors in ${known.length} files — ${SCOPE}`
      : `${total} errors in ${known.length} files — ${SCOPE}`
  return {
    ok: known.length > 0,
    text: [header].concat(reports.flatMap((report) => report.lines)).join('\n'),
  }
}

// A diagnostic and one of the fixes the compiler offers for it. Fixes are asked
// for per diagnostic because `getCodeFixesAtPosition` matches on error code as
// well as span, and answers nothing when the two disagree.
type Offer = {
  readonly diagnostic: ts.Diagnostic
  readonly fix: ts.CodeFixAction
}

const offersFor = (
  compiler: Compiler,
  file: string,
  line: number | undefined,
): readonly Offer[] => {
  const path = compiler.pathOf(file)
  return diagnosticsIn(compiler, file)
    .filter((diagnostic) => line === undefined || lineOf(diagnostic) === line)
    .flatMap((diagnostic) =>
      diagnostic.start === undefined
        ? []
        : compiler.language
            .getCodeFixesAtPosition(
              path,
              diagnostic.start,
              diagnostic.start + (diagnostic.length ?? 0),
              [diagnostic.code],
              formatSettings,
              userPreferences,
            )
            .map((fix) => ({ diagnostic, fix })),
    )
}

const touchedBy = (compiler: Compiler, fix: ts.CodeFixAction): readonly string[] => [
  ...new Set(fix.changes.map((change) => compiler.fileOf(change.fileName))),
]

const describeOffer = (compiler: Compiler, offer: Offer): string => {
  const created = newFilesIn(offer.fix.changes)
  const creates = created.length === 0 ? '' : `, creates ${created.join(', ')}`
  return `  ${offer.fix.fixName} — ${offer.fix.description} — touches ${touchedBy(compiler, offer.fix).join(', ')}${creates}`
}

export const codeFixes = (
  compiler: Compiler,
  file: string,
  line: number | undefined,
): ToolOutput => {
  if (!inProgram(compiler, file)) return { ok: false, text: `${file} is not in the program.` }
  const offers = offersFor(compiler, file, line)
  if (offers.length === 0)
    return { ok: true, text: `no code fixes at ${at(file, line)} — ${SCOPE}` }
  const byDiagnostic = [...new Set(offers.map((offer) => offer.diagnostic))]
  return {
    ok: true,
    text: [`${offers.length} fixes at ${at(file, line)}`]
      .concat(
        byDiagnostic.flatMap((diagnostic) =>
          [describeDiagnostic(compiler, diagnostic)].concat(
            offers
              .filter((offer) => offer.diagnostic === diagnostic)
              .map((offer) => describeOffer(compiler, offer)),
          ),
        ),
      )
      .join('\n'),
  }
}

// The wrong quick fix compiles and is still wrong, so an ambiguous choice is
// declined rather than guessed at.
export const applyCodeFix = (
  compiler: Compiler,
  file: string,
  line: number | undefined,
  fixName: string | undefined,
): EditPlan => {
  if (!inProgram(compiler, file)) return declined(`${file} is not in the program.`)
  const offers = offersFor(compiler, file, line)
  if (offers.length === 0) return declined(`no code fixes at ${at(file, line)}.`)
  const candidates =
    fixName === undefined ? offers : offers.filter((offer) => offer.fix.fixName === fixName)
  const listed = (reason: string, shown: readonly Offer[]): EditPlan =>
    declined(
      [reason]
        .concat(shown.map((offer) => describeOffer(compiler, offer)))
        .concat(['pass fixName= to choose one.'])
        .join('\n'),
    )
  if (candidates.length === 0)
    return listed(`no fix named ${fixName ?? ''} at ${at(file, line)}; available:`, offers)
  const chosen = candidates[0]
  if (chosen === undefined || candidates.length > 1)
    return listed(`${candidates.length} fixes match at ${at(file, line)}; refusing to guess:`, candidates)
  const created = newFilesIn(chosen.fix.changes)
  if (created.length > 0)
    return declined(
      `${chosen.fix.fixName} would create ${created.join(', ')}; a plan can only rewrite files that exist.`,
    )
  const edits = toFileEdits(compiler, chosen.fix.changes)
  if (edits.length === 0) return declined(`${chosen.fix.fixName} produces no edits.`)
  return {
    ok: true,
    edits,
    summary: `${describeDiagnostic(compiler, chosen.diagnostic)} — fixed by ${chosen.fix.fixName}, touching ${touchedBy(compiler, chosen.fix).join(', ')}`,
  }
}

export const organizeImports = (compiler: Compiler, files: readonly string[]): EditPlan => {
  const missing = files.filter((file) => !inProgram(compiler, file))
  if (missing.length > 0) return declined(`not in the program: ${missing.join(', ')}`)
  const changes = files.flatMap((file) =>
    compiler.language.organizeImports(
      { type: 'file', fileName: compiler.pathOf(file) },
      formatSettings,
      userPreferences,
    ),
  )
  const edits = toFileEdits(compiler, changes)
  if (edits.length === 0)
    return declined(`imports already organized in ${files.length} files`)
  const changed = [...new Set(edits.map((edit) => edit.file))]
  return {
    ok: true,
    edits,
    summary: `organized imports in ${changed.length} of ${files.length} files: ${changed.join(', ')}`,
  }
}
