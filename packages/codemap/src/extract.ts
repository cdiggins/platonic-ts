// Turning a group of same-shaped expressions into one declaration and a call at each site.
//
// `holes.ts` decides which names the new declaration receives and which it can go on reading
// directly; `sites.ts` says whether moving the expression is safe at all. This module
// assembles the two into a plan: the declaration's text, where it goes, and the exact range
// each file would have rewritten.
//
// Two forms come out. An expression whose value is a function — the common case for a helper
// copied between modules — becomes a shared declaration, and each site becomes its name.
// Anything else becomes a function of its parameters, even when there are none, so that it
// keeps being evaluated where it was rather than once at module load.
//
// The plan is data: nothing here reads or writes a file, so a preview and an application are
// the same computation, and `edits.ts` applies the result to text the caller supplies.
import ts from 'typescript'
import type { ExpressionOccurrence, ShapeGroup } from './clones.ts'
import type { TextEdit } from './edits.ts'
import { splitHoles, typeText, type ExtractedParameter } from './holes.ts'
import {
  declarationEdit,
  importEdits,
  placementBlockers,
  requirements,
  type ExtractionNote,
} from './placement.ts'
import { callSource, dedentBy, functionSource, type ExtractedForm } from './rewrite.ts'
import { awaitsDirectly, isFunctionValued, siteOf, unsafeReasons, type Site } from './sites.ts'
import type { SourceEntry } from './stats.ts'

export type ExtractOptions = {
  readonly name: string
  // Repo-relative file that receives the declaration. Defaults to the first occurrence's.
  readonly destination: string | undefined
  // Without one, the plan has no type annotations and says so.
  readonly checker: ts.TypeChecker | undefined
}

export const defaultExtractOptions: ExtractOptions = {
  name: 'extracted',
  destination: undefined,
  checker: undefined,
}

export type ExtractionPlan = {
  readonly name: string
  readonly destination: string
  readonly form: ExtractedForm
  readonly declaration: string
  readonly parameters: readonly ExtractedParameter[]
  // Names the body reads and is not passed: imports, module-level helpers, globals.
  readonly kept: readonly string[]
  readonly isAsync: boolean
  // Reasons the rewrite would change meaning. Non-empty means `edits` is empty.
  readonly blockers: readonly ExtractionNote[]
  // What must be true where the declaration lands, and cannot be checked from here.
  readonly requirements: readonly ExtractionNote[]
  readonly edits: readonly TextEdit[]
}

// ---------------------------------------------------------------------------
// The body and the call sites.
// ---------------------------------------------------------------------------

// The first occurrence's own text with every parameterized read spliced over. Working from
// text rather than from a printed syntax tree keeps the original formatting and comments.
// How far the line holding the expression is indented. The body's later lines are indented
// relative to this, not to the column the expression itself starts at.
const statementIndent = (sourceFile: ts.SourceFile, start: number): number => {
  const { line } = sourceFile.getLineAndCharacterOfPosition(start)
  const before = sourceFile.text.slice(sourceFile.getPositionOfLineAndCharacter(line, 0), start)
  return before.length - before.trimStart().length
}

const bodyOf = (template: Site, parameters: readonly ExtractedParameter[]): string => {
  const start = template.occurrence.start
  const column = statementIndent(template.entry.sourceFile, start)
  const parameterized = template.references.flatMap((reference) => {
    const parameter = parameters.find((candidate) => candidate.hole === reference.hole)
    return parameter === undefined ? [] : [{ reference, parameter }]
  })
  // Last first, so replacing one does not move the offsets of the ones still to come.
  const replacements = [...parameterized].sort(
    (left, right) => right.reference.start - left.reference.start,
  )
  const text = replacements.reduce(
    (current, { reference, parameter }) =>
      current.slice(0, reference.start - start) +
      (reference.shorthand ? `${reference.name}: ${parameter.name}` : parameter.name) +
      current.slice(reference.end - start),
    template.occurrence.text,
  )
  return dedentBy(text, column)
}

const bindsTighterThanAwait = (node: ts.Node): boolean => {
  const parent: ts.Node | undefined = node.parent
  if (parent === undefined) return false
  if (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) return true
  if (ts.isTaggedTemplateExpression(parent) || ts.isNonNullExpression(parent)) return true
  return (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node
}

// ---------------------------------------------------------------------------
// The plan.
// ---------------------------------------------------------------------------

const blockedPlan = (
  options: ExtractOptions,
  destination: string,
  blockers: readonly ExtractionNote[],
): ExtractionPlan => ({
  name: options.name,
  destination,
  form: 'function',
  declaration: '',
  parameters: [],
  kept: [],
  isAsync: false,
  blockers,
  requirements: [],
  edits: [],
})

const notFoundNote = (occurrence: ExpressionOccurrence): ExtractionNote => ({
  message: 'this occurrence is not in the sources given, so it cannot be rewritten',
  file: occurrence.file,
  line: occurrence.line,
})

// One declaration, one call per occurrence, and the reasons not to. `entries` must hold the
// files the group came from; a missing one is reported rather than assumed away.
export const extractionPlan = (
  group: ShapeGroup,
  entries: readonly SourceEntry[],
  options: ExtractOptions = defaultExtractOptions,
): ExtractionPlan => {
  const found = group.occurrences.map((occurrence) => ({
    occurrence,
    site: siteOf(occurrence, entries),
  }))
  const sites = found.flatMap(({ site }) => (site === undefined ? [] : [site]))
  const template = sites[0]
  if (template === undefined || sites.length !== found.length)
    return blockedPlan(
      options,
      options.destination ?? group.occurrences[0]?.file ?? '',
      found.filter(({ site }) => site === undefined).map(({ occurrence }) => notFoundNote(occurrence)),
    )

  const destinationFile = options.destination ?? template.entry.file
  const destination = entries.find((entry) => entry.file === destinationFile)
  if (destination === undefined)
    return blockedPlan(options, destinationFile, [
      {
        message: `the destination ${destinationFile} is not among the sources given`,
        file: undefined,
        line: undefined,
      },
    ])

  const unsafe = [
    ...sites.flatMap((site) =>
      unsafeReasons(site).map((message) => ({
        message,
        file: site.occurrence.file,
        line: site.occurrence.line,
      })),
    ),
    ...placementBlockers(options.name, destination, sites),
  ]
  if (unsafe.length > 0) return blockedPlan(options, destinationFile, unsafe)

  const { kept, parameters } = splitHoles(sites, options.checker)
  const form: ExtractedForm =
    parameters.length === 0 && isFunctionValued(template.node) ? 'value' : 'function'
  const isAsync = form === 'function' && awaitsDirectly(template.node)
  const returnType = typeText(options.checker, template.node)
  const declaration = functionSource({
    name: options.name,
    form,
    parameters: parameters.map((parameter) => ({ name: parameter.name, type: parameter.type })),
    returnType:
      returnType === undefined || form === 'value'
        ? undefined
        : isAsync
          ? `Promise<${returnType}>`
          : returnType,
    body: bodyOf(template, parameters),
    isAsync,
    exported: sites.some((site) => site.entry.file !== destinationFile),
  })
  const callEdits = sites.map<TextEdit>((site, index) => ({
    file: site.entry.file,
    start: site.occurrence.start,
    end: site.occurrence.end,
    text: callSource({
      name: options.name,
      arguments: parameters.map((parameter) => parameter.arguments[index] ?? ''),
      form,
      awaited: isAsync,
      parenthesize: bindsTighterThanAwait(site.node),
    }),
  }))
  return {
    name: options.name,
    destination: destinationFile,
    form,
    declaration,
    parameters,
    kept,
    isAsync,
    blockers: [],
    requirements: requirements(kept, template, destination, options.checker !== undefined),
    edits: [
      declarationEdit(destination, sites, declaration),
      ...callEdits,
      ...importEdits(destinationFile, options.name, sites),
    ],
  }
}
