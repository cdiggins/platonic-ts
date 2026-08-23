// Changing a function's parameter list and every call site with it. The
// mapping from old arguments to new ones is not derivable in general, so the
// caller states it: an entry of the form `$0`, `$1`, … copies the existing
// argument at that index verbatim, and anything else is literal source text
// inserted at that position. Adding a parameter with a default is
// `arguments: ['$0', '1']`; removing the second is `['$0']`; swapping two is
// `['$1', '$0']`.
//
// The failure this tool must not have is partial application: a signature
// changed at the declaration and at nine of ten call sites compiles at none of
// them and hides which one was missed. So every call site is checked before
// any edit is emitted, and one unrewritable site declines the whole change.
import ts from 'typescript'
import type { SymbolReference } from '../../core/src/index.ts'
import type { EditPlan, FileEdit } from './edit.ts'
import { explainLookup } from './query.ts'
import { ancestorsAtPosition, lineAt, resolveSymbol, sourceOf, type Workspace } from './workspace.ts'

export type SignatureChange = {
  // The new parameter list, as source text: one entry per parameter.
  readonly parameters: readonly string[]
  // The new argument list for every call site.
  readonly arguments: readonly string[]
}

type SourceRange = { readonly start: number; readonly end: number }

type Problem = { readonly file: string; readonly line: number; readonly reason: string }

type SiteEdit =
  | { readonly kind: 'edit'; readonly edit: FileEdit; readonly file: string; readonly line: number }
  // An import specifier names the function without calling it; it is how a
  // call site gets the name, so it is passed over rather than refused.
  | { readonly kind: 'import' }
  | { readonly kind: 'problem'; readonly problem: Problem }

const declined = (text: string): EditPlan => ({ ok: false, text })

const placeholder = /^\$(\d+)$/

// `export const f = (…) => …` carries the name on the variable declaration and
// the parameters on its initializer, so the two are found separately.
const signatureAt = (
  sourceFile: ts.SourceFile,
  position: number,
): ts.SignatureDeclaration | undefined => {
  const chain = ancestorsAtPosition(sourceFile, sourceFile, position).filter(
    (node) => ts.isVariableDeclaration(node) || ts.isFunctionLike(node),
  )
  const innermost = chain[chain.length - 1]
  if (innermost === undefined) return undefined
  if (!ts.isVariableDeclaration(innermost))
    return ts.isFunctionLike(innermost) ? innermost : undefined
  const initializer = innermost.initializer
  return initializer !== undefined &&
    (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
    ? initializer
    : undefined
}

// The text between the parentheses, and nothing else: the body, the return
// type, and the comment above the declaration are left byte-identical. An
// arrow written `value => value` has no parentheses to write into.
const parameterRange = (
  sourceFile: ts.SourceFile,
  signature: ts.SignatureDeclaration,
): SourceRange | undefined => {
  const children = signature.getChildren(sourceFile)
  const open = children.find((child) => child.kind === ts.SyntaxKind.OpenParenToken)
  const close = children.find((child) => child.kind === ts.SyntaxKind.CloseParenToken)
  return open === undefined || close === undefined
    ? undefined
    : { start: open.end, end: close.getStart(sourceFile) }
}

// The innermost call whose callee ends where this identifier ends — which is
// what distinguishes `twice(1)` from `map(twice)` and from `typeof twice`.
const callAtCallee = (
  sourceFile: ts.SourceFile,
  position: number,
  length: number,
): ts.CallExpression | undefined => {
  const chain = ancestorsAtPosition(sourceFile, sourceFile, position)
  const calls = chain.filter(
    (node): node is ts.CallExpression =>
      ts.isCallExpression(node) &&
      node.expression.end === position + length &&
      node.expression.getStart(sourceFile) <= position,
  )
  return calls[calls.length - 1]
}

const argumentsFor = (
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
  wanted: readonly string[],
): readonly string[] | string =>
  wanted.reduce<readonly string[] | string>((soFar, entry) => {
    if (typeof soFar === 'string') return soFar
    const match = placeholder.exec(entry)
    if (match === null) return soFar.concat(entry)
    const index = Number(match[1])
    const existing = call.arguments[index]
    return existing === undefined
      ? `$${index} has no argument here (${call.arguments.length} given)`
      : soFar.concat(sourceFile.text.slice(existing.getStart(sourceFile), existing.end))
  }, [])

const inImport = (sourceFile: ts.SourceFile, position: number): boolean =>
  ancestorsAtPosition(sourceFile, sourceFile, position).some(
    (node) => ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node),
  )

const rewriteSite = (
  workspace: Workspace,
  reference: SymbolReference,
  change: SignatureChange,
): SiteEdit => {
  const sourceFile = sourceOf(workspace, reference.file)
  const at = { file: reference.file, line: reference.line }
  if (sourceFile === undefined)
    return { kind: 'problem', problem: { ...at, reason: 'file is not indexed' } }
  if (inImport(sourceFile, reference.span.start)) return { kind: 'import' }
  const call = callAtCallee(sourceFile, reference.span.start, reference.span.length)
  if (call === undefined)
    return {
      kind: 'problem',
      problem: { ...at, reason: 'not a call — used as a value, a type, or a re-export' },
    }
  if (call.arguments.some((argument) => ts.isSpreadElement(argument)))
    return {
      kind: 'problem',
      problem: { ...at, reason: 'spread argument — the mapping is not computable' },
    }
  const rewritten = argumentsFor(sourceFile, call, change.arguments)
  if (typeof rewritten === 'string')
    return { kind: 'problem', problem: { ...at, reason: rewritten } }
  return {
    kind: 'edit',
    file: reference.file,
    line: reference.line,
    edit: {
      file: reference.file,
      start: call.arguments.pos,
      end: call.arguments.end,
      text: rewritten.join(', '),
    },
  }
}

type Rewritten = Extract<SiteEdit, { readonly kind: 'edit' }>

// `twice(twice(1))` gives two sites whose replacement ranges nest, and the
// outer replacement is built from the argument text as it reads now — so
// applying both would drop the inner one. Rewriting the inner call first and
// re-reading is possible; declining is honest and this case is rare.
const nestedSites = (sites: readonly Rewritten[]): readonly Problem[] =>
  sites
    .filter((site) =>
      sites.some(
        (other) =>
          other !== site &&
          other.edit.file === site.edit.file &&
          other.edit.start <= site.edit.start &&
          site.edit.end <= other.edit.end,
      ),
    )
    .map((site) => ({
      file: site.file,
      line: site.line,
      reason: 'nested call — an enclosing call is also a site',
    }))

const refuse = (name: string, problems: readonly Problem[]): EditPlan =>
  declined(
    [`${name} has ${problems.length} sites this signature change cannot rewrite:`]
      .concat(problems.map((problem) => `${problem.file}:${problem.line} ${problem.reason}`))
      .concat('Nothing was changed. Fix those sites first, or edit them by hand.')
      .join('\n'),
  )

export const changeSignature = (
  workspace: Workspace,
  name: string,
  file: string | undefined,
  change: SignatureChange,
): EditPlan => {
  const lookup = resolveSymbol(workspace, name, file)
  if (!lookup.ok) return declined(explainLookup(name, lookup).text)
  const signature = signatureAt(lookup.sourceFile, lookup.symbol.span.start)
  if (signature === undefined)
    return declined(
      `${name} at ${lookup.symbol.file}:${lookup.symbol.line} is not a function whose parameters can be located.`,
    )
  const range = parameterRange(lookup.sourceFile, signature)
  if (range === undefined)
    return declined(
      `${name} at ${lookup.symbol.file}:${lookup.symbol.line} has no parenthesized parameter list.`,
    )
  const sites = workspace.index.references
    .filter((reference) => reference.symbolId === lookup.symbol.id && !reference.isDefinition)
    .map((reference) => rewriteSite(workspace, reference, change))
  const problems = sites.flatMap((site) => (site.kind === 'problem' ? [site.problem] : []))
  if (problems.length > 0) return refuse(name, problems)
  const rewritten = sites.flatMap((site) => (site.kind === 'edit' ? [site] : []))
  const nested = nestedSites(rewritten)
  if (nested.length > 0) return refuse(name, nested)
  const parameters = change.parameters.join(', ')
  const declaration: FileEdit = {
    file: lookup.symbol.file,
    start: range.start,
    end: range.end,
    text: parameters,
  }
  return {
    ok: true,
    edits: [declaration].concat(rewritten.map((site) => site.edit)),
    summary: [
      `${lookup.symbol.file}:${lineAt(lookup.sourceFile, range.start)} — ${name}(${parameters}); rewrote ${rewritten.length} call sites`,
    ]
      .concat(rewritten.map((site) => `${site.file}:${site.line}`))
      .join('\n'),
  }
}
