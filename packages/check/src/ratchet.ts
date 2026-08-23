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

export type RatchetCounts = {
  readonly explicitAny: number
  readonly asCasts: number
  readonly nonNullAssertions: number
  readonly tsDirectives: number
  readonly eslintDisables: number
}

const zero: RatchetCounts = {
  explicitAny: 0,
  asCasts: 0,
  nonNullAssertions: 0,
  tsDirectives: 0,
  eslintDisables: 0,
}

const countKeys: readonly (keyof RatchetCounts)[] = [
  'explicitAny',
  'asCasts',
  'nonNullAssertions',
  'tsDirectives',
  'eslintDisables',
]

export const sumCounts = (counts: readonly RatchetCounts[]): RatchetCounts =>
  counts.reduce<RatchetCounts>(
    (acc, c) => ({
      explicitAny: acc.explicitAny + c.explicitAny,
      asCasts: acc.asCasts + c.asCasts,
      nonNullAssertions: acc.nonNullAssertions + c.nonNullAssertions,
      tsDirectives: acc.tsDirectives + c.tsDirectives,
      eslintDisables: acc.eslintDisables + c.eslintDisables,
    }),
    zero,
  )

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
const collectCommentText = (sourceText: string): string => {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, sourceText)
  const scanRest = (): readonly string[] => {
    const kind = scanner.scan()
    if (kind === ts.SyntaxKind.EndOfFileToken) return []
    const text = isCommentTrivia(kind) ? scanner.getTokenText() : undefined
    const rest = scanRest()
    return text === undefined ? rest : [text, ...rest]
  }
  return scanRest().join('\n')
}

export const countEscapeHatches = (fileName: string, sourceText: string): RatchetCounts => {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true)
  const astCounts = countNode(sourceFile)
  const commentText = collectCommentText(sourceText)
  return {
    ...astCounts,
    tsDirectives: countMatches(TS_DIRECTIVE_RE, commentText),
    eslintDisables: countMatches(ESLINT_DISABLE_RE, commentText),
  }
}
