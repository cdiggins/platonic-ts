// Pure escape-hatch counting via the TypeScript compiler API.
//
// tsDirectives / eslintDisables are matched against comment trivia only,
// collected with the TS scanner (all SingleLineCommentTrivia /
// MultiLineCommentTrivia tokens across the file). This keeps directive
// strings that appear inside string literals or fixture data — e.g. a test
// fixture asserting on the literal text "@ts-ignore" — from inflating the
// count, while still catching every real directive comment regardless of
// which AST node it attaches to.
import ts from 'typescript'

// Tallies of code quality escape hatches in a file.
export type RatchetCounts = {
  readonly explicitAny: number
  readonly asCasts: number
  readonly nonNullAssertions: number
  readonly tsDirectives: number
  readonly eslintDisables: number
  readonly undocumentedExports: number
}

const zero: RatchetCounts = {
  explicitAny: 0,
  asCasts: 0,
  nonNullAssertions: 0,
  tsDirectives: 0,
  eslintDisables: 0,
  undocumentedExports: 0,
}

const countKeys: readonly (keyof RatchetCounts)[] = [
  'explicitAny',
  'asCasts',
  'nonNullAssertions',
  'tsDirectives',
  'eslintDisables',
  'undocumentedExports',
]

// Sums counts across multiple files.
export const sumCounts = (counts: readonly RatchetCounts[]): RatchetCounts =>
  counts.reduce<RatchetCounts>(
    (acc, c) => ({
      explicitAny: acc.explicitAny + c.explicitAny,
      asCasts: acc.asCasts + c.asCasts,
      nonNullAssertions: acc.nonNullAssertions + c.nonNullAssertions,
      tsDirectives: acc.tsDirectives + c.tsDirectives,
      eslintDisables: acc.eslintDisables + c.eslintDisables,
      undocumentedExports: acc.undocumentedExports + c.undocumentedExports,
    }),
    zero,
  )

// Compares current counts to baseline and identifies regressions.
export const compareToBaseline = (
  current: RatchetCounts,
  baseline: RatchetCounts,
): { readonly verdict: 'ok' | 'improved' | 'regressed'; readonly regressions: readonly string[] } => {
  const regressions = countKeys.filter((k) => current[k] > baseline[k])
  const improvements = countKeys.filter((k) => current[k] < baseline[k])
  const verdict: 'ok' | 'improved' | 'regressed' =
    regressions.length > 0 ? 'regressed' : improvements.length > 0 ? 'improved' : 'ok'
  return { verdict, regressions }
}

// `x as const` is a widening-suppression idiom, not an escape hatch — excluded.
const isAsConst = (node: ts.AsExpression): boolean =>
  ts.isTypeReferenceNode(node.type) &&
  ts.isIdentifier(node.type.typeName) &&
  node.type.typeName.text === 'const'

const classify = (node: ts.Node): RatchetCounts => {
  if (node.kind === ts.SyntaxKind.AnyKeyword) return { ...zero, explicitAny: 1 }
  if (ts.isAsExpression(node) && !isAsConst(node)) return { ...zero, asCasts: 1 }
  if (ts.isNonNullExpression(node)) return { ...zero, nonNullAssertions: 1 }
  return zero
}

const countNode = (node: ts.Node): RatchetCounts => {
  let total = classify(node)
  node.forEachChild((child) => {
    total = sumCounts([total, countNode(child)])
  })
  return total
}

const TS_DIRECTIVE_RE = /@ts-(?:ignore|expect-error|nocheck)\b/g
const ESLINT_DISABLE_RE = /eslint-disable(?:-next-line|-line)?\b/g

const countMatches = (re: RegExp, text: string): number => {
  const matches = text.match(re)
  return matches ? matches.length : 0
}

const isCommentTrivia = (kind: ts.SyntaxKind): boolean =>
  kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia

// Scans the full token stream (trivia included) and collects the text of
// every comment in the file, independent of which AST node it attaches to.
//
// PS-056: `let` in Core, deliberately. The recursive version
// of this walk recursed once per token and overflowed the stack at roughly 26 KB
// of source (`packages/dashboard/src/ui.ts`) — and it did so depending on how
// deep the caller's own stack already was, so `platonic check` passed while the
// same function called from `packages/codemap` threw. A cursor is the honest
// shape for an unbounded token stream; a fold would need the tokens materialized
// first, which is the thing that does not fit.
const collectCommentText = (sourceText: string): string => {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, sourceText)
  let collected = ''
  let kind = scanner.scan()
  while (kind !== ts.SyntaxKind.EndOfFileToken) {
    collected = isCommentTrivia(kind) ? `${collected}\n${scanner.getTokenText()}` : collected
    kind = scanner.scan()
  }
  return collected
}

const isDeclarationStatement = (statement: ts.Statement): boolean =>
  ts.isFunctionDeclaration(statement) ||
  ts.isVariableStatement(statement) ||
  ts.isTypeAliasDeclaration(statement) ||
  ts.isInterfaceDeclaration(statement) ||
  ts.isClassDeclaration(statement) ||
  ts.isEnumDeclaration(statement) ||
  ts.isModuleDeclaration(statement)

const isExported = (statement: ts.Statement): boolean =>
  ts.canHaveModifiers(statement) &&
  (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

// A comment counts as the declaration's doc only when no blank line separates
// them — the attachment rule the symbol index uses (codemap/src/symbols.ts),
// which cannot be imported here without a package cycle.
const hasLeadingDoc = (sourceFile: ts.SourceFile, statement: ts.Statement): boolean => {
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, statement.getFullStart()) ?? []
  const last = ranges[ranges.length - 1]
  return (
    last !== undefined &&
    !/\n[ \t]*\r?\n/.test(sourceFile.text.slice(last.end, statement.getStart(sourceFile)))
  )
}

// Exported top-level declarations with no comment directly above them, per
// AGENTS.md "Documenting exports". Re-export lists are not declarations and
// are not counted.
const countUndocumentedExports = (sourceFile: ts.SourceFile): number =>
  sourceFile.statements.filter(
    (statement) =>
      isDeclarationStatement(statement) &&
      isExported(statement) &&
      !hasLeadingDoc(sourceFile, statement),
  ).length

// Counts all code quality escape hatches in a source file.
export const countEscapeHatches = (fileName: string, sourceText: string): RatchetCounts => {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true)
  const astCounts = countNode(sourceFile)
  const commentText = collectCommentText(sourceText)
  return {
    ...astCounts,
    tsDirectives: countMatches(TS_DIRECTIVE_RE, commentText),
    eslintDisables: countMatches(ESLINT_DISABLE_RE, commentText),
    undocumentedExports: countUndocumentedExports(sourceFile),
  }
}
