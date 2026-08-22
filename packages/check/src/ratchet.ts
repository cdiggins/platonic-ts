// Pure escape-hatch counting via the TypeScript compiler API.
//
// Approximation for tsDirectives / eslintDisables: matched by regex over the
// raw source text rather than full comment-trivia parsing. These are fixed
// magic tokens (@ts-ignore, eslint-disable-line, ...) that essentially never
// appear outside real directive comments, so a whole-text regex is robust and
// far simpler than walking leading/trailing comment ranges per node. Trade-off:
// a string literal that happens to contain e.g. "eslint-disable-line" would be
// miscounted as a hit — judged an acceptable, rare edge case for a ratchet
// counter (it only needs to move monotonically with real usage, not be exact).
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

export const countEscapeHatches = (fileName: string, sourceText: string): RatchetCounts => {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true)
  const astCounts = countNode(sourceFile)
  return {
    ...astCounts,
    tsDirectives: countMatches(TS_DIRECTIVE_RE, sourceText),
    eslintDisables: countMatches(ESLINT_DISABLE_RE, sourceText),
  }
}
