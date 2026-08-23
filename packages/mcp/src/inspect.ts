// The tools that measure rather than change: how bad is this declaration, and
// where are the escape hatches. Both pure over `Workspace`.
//
// Nothing here counts anything the rest of the repository already counts:
// metrics come from `packages/codemap/src/metrics.ts` and the escape-hatch
// classification is the one `packages/check/src/ratchet.ts` uses, so the MCP
// server and `platonic check` can never disagree about what a hatch is.
//
import ts from 'typescript'
import type { CodeMetrics, SymbolInfo } from '../../core/src/index.ts'
import { fileMetrics, functionMetrics } from '../../codemap/src/metrics.ts'
import { compareToBaseline, type RatchetCounts } from '../../check/src/ratchet.ts'
import { declarationText } from './declaration.ts'
import { explainLookup, type ToolOutput } from './query.ts'
import { lineTextAt, resolveSymbol, sourceOf, type Workspace } from './workspace.ts'

const parse = (name: string, text: string): ts.SourceFile =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true)

const tsFilesOf = (workspace: Workspace, folder: string | undefined): readonly string[] =>
  [...workspace.sources.keys()]
    .filter((file) => file.endsWith('.ts'))
    .filter((file) => folder === undefined || file === folder || file.startsWith(`${folder}/`))
    .sort()

// --- symbol_metrics: is this declaration worth refactoring? ---------------

// `statements` stands in for a branch count: `CodeMetrics` has no branch field,
// and inventing one here would put a second counter beside the one the code
// browser and the score already use.
const summarize = (label: string, metrics: CodeMetrics): string =>
  `${label} — lines ${metrics.lines}, statements ${metrics.statements}, nesting ${metrics.maxNestingDepth}, parameters ${metrics.parameters}, score ${metrics.platonicScore}`

// A function, method, or arrow initialiser already has an entry in
// `functionMetrics`; anything else (a type, an interface, a plain value) is
// measured by re-parsing its own declaration text as if it were a small file.
const metricsOfDeclaration = (
  workspace: Workspace,
  sourceFile: ts.SourceFile,
  symbol: SymbolInfo,
): CodeMetrics | undefined => {
  const entry = functionMetrics(workspace.index.root, sourceFile).find((candidate) =>
    candidate.symbolId.endsWith(`#${symbol.span.start}`),
  )
  const text = declarationText(sourceFile, symbol)
  return entry !== undefined
    ? entry.metrics
    : text === undefined
      ? undefined
      : fileMetrics(parse(sourceFile.fileName, text), text)
}

export const symbolMetrics = (
  workspace: Workspace,
  name: string,
  file: string | undefined,
): ToolOutput => {
  const lookup = resolveSymbol(workspace, name, file)
  if (!lookup.ok) return explainLookup(name, lookup)
  const declaration = metricsOfDeclaration(workspace, lookup.sourceFile, lookup.symbol)
  if (declaration === undefined)
    return { ok: false, text: `${name} is indexed but has no declaration range.` }
  const whole = fileMetrics(lookup.sourceFile, lookup.sourceFile.text)
  const share = whole.lines === 0 ? 0 : Math.round((declaration.lines * 100) / whole.lines)
  const delta = declaration.platonicScore - whole.platonicScore
  return {
    ok: true,
    text: [
      `${name} — ${lookup.symbol.file}:${lookup.symbol.line} ${lookup.symbol.kind}`,
      summarize('declaration', declaration),
      summarize(`file ${lookup.symbol.file}`, whole),
      `${share}% of the file's lines; score ${delta >= 0 ? '+' : ''}${delta} against the file`,
    ].join('\n'),
  }
}

// --- escape_hatch_index: every `any`, `as`, `!`, and suppression comment ---

type Hatch = {
  readonly file: string
  readonly line: number
  readonly kind: string
  readonly text: string
}

const HATCH_KINDS: readonly string[] = ['any', 'as', 'non-null', 'ts-directive', 'eslint-disable']

const TS_DIRECTIVE = /@ts-(?:ignore|expect-error|nocheck)\b/
const ESLINT_DISABLE = /eslint-disable(?:-next-line|-line)?\b/

// Same traversal `symbols.ts` uses, and for the same reason: `getChildren`
// returns an array a flatMap can fold, and it includes the tokens whose leading
// trivia carries the suppression comments.
const nodesOf = (sourceFile: ts.SourceFile, node: ts.Node): readonly ts.Node[] => [
  node,
  ...node.getChildren(sourceFile).flatMap((child) => nodesOf(sourceFile, child)),
]

// `x as const` is a widening-suppression idiom, not an escape hatch — the same
// exclusion `countEscapeHatches` makes.
const isAsConst = (node: ts.AsExpression): boolean =>
  ts.isTypeReferenceNode(node.type) &&
  ts.isIdentifier(node.type.typeName) &&
  node.type.typeName.text === 'const'

const hatchKindOf = (node: ts.Node): string | undefined =>
  node.kind === ts.SyntaxKind.AnyKeyword
    ? 'any'
    : ts.isAsExpression(node) && !isAsConst(node)
      ? 'as'
      : ts.isNonNullExpression(node)
        ? 'non-null'
        : undefined

const hatchAt = (file: string, sourceFile: ts.SourceFile, position: number, kind: string): Hatch => ({
  file,
  line: sourceFile.getLineAndCharacterOfPosition(position).line + 1,
  kind,
  text: lineTextAt(sourceFile, position),
})

const commentKindOf = (text: string): string | undefined =>
  TS_DIRECTIVE.test(text) ? 'ts-directive' : ESLINT_DISABLE.test(text) ? 'eslint-disable' : undefined

// Comments are read from trivia rather than from the raw text so that a
// directive quoted inside a string literal is not counted — the bug the ratchet
// already fixed once.
const commentHatches = (
  file: string,
  sourceFile: ts.SourceFile,
  nodes: readonly ts.Node[],
): readonly Hatch[] =>
  [
    ...new Map(
      nodes
        .flatMap((node) => ts.getLeadingCommentRanges(sourceFile.text, node.getFullStart()) ?? [])
        .map((range) => [range.pos, range] as const),
    ).values(),
  ].flatMap((range) => {
    const kind = commentKindOf(sourceFile.text.slice(range.pos, range.end))
    return kind === undefined ? [] : [hatchAt(file, sourceFile, range.pos, kind)]
  })

const hatchesOfFile = (file: string, sourceFile: ts.SourceFile): readonly Hatch[] => {
  const nodes = nodesOf(sourceFile, sourceFile)
  return nodes
    .flatMap((node) => {
      const kind = hatchKindOf(node)
      return kind === undefined ? [] : [hatchAt(file, sourceFile, node.getStart(sourceFile), kind)]
    })
    .concat(commentHatches(file, sourceFile, nodes))
    .slice()
    .sort((left, right) => left.line - right.line)
}

const tallyOf = (hatches: readonly Hatch[]): RatchetCounts => {
  const count = (kind: string): number => hatches.filter((hatch) => hatch.kind === kind).length
  return {
    explicitAny: count('any'),
    asCasts: count('as'),
    nonNullAssertions: count('non-null'),
    tsDirectives: count('ts-directive'),
    eslintDisables: count('eslint-disable'),
    // Not a hatch this tool scans; the baseline comparison copies the
    // baseline's own value so the axis never affects the verdict here.
    undocumentedExports: 0,
  }
}

const RATCHET_KEYS: readonly (keyof RatchetCounts)[] = [
  'explicitAny',
  'asCasts',
  'nonNullAssertions',
  'tsDirectives',
  'eslintDisables',
]

const totalOf = (counts: RatchetCounts): number =>
  RATCHET_KEYS.reduce((sum, key) => sum + counts[key], 0)

// Read without JSON.parse so that a malformed file reports as unreadable rather
// than throwing out of a pure function (PS-003).
const readBaseline = (text: string): RatchetCounts | undefined => {
  const values = RATCHET_KEYS.map((key) => new RegExp(`"${key}"\\s*:\\s*(\\d+)`).exec(text)?.[1])
  return values.some((value) => value === undefined)
    ? undefined
    : {
        explicitAny: Number(values[0]),
        asCasts: Number(values[1]),
        nonNullAssertions: Number(values[2]),
        tsDirectives: Number(values[3]),
        eslintDisables: Number(values[4]),
        undocumentedExports: Number(
          /"undocumentedExports"\s*:\s*(\d+)/.exec(text)?.[1] ?? '0',
        ),
      }
}

const baselineLine = (
  workspace: Workspace,
  folder: string | undefined,
  counts: RatchetCounts,
): string => {
  const text = sourceOf(workspace, 'ratchet.json')?.text
  if (text === undefined) return 'ratchet.json is not indexed — no baseline to compare against.'
  const baseline = readBaseline(text)
  if (baseline === undefined)
    return 'ratchet.json is indexed but its counts are unreadable — no baseline to compare against.'
  const verdict = compareToBaseline(
    { ...counts, undocumentedExports: baseline.undocumentedExports },
    baseline,
  )
  const named = verdict.regressions.length === 0 ? '' : `: ${verdict.regressions.join(', ')}`
  const scope = folder === undefined ? '' : ` (baseline covers the whole repository, not ${folder})`
  return `baseline ${totalOf(baseline)} in ratchet.json, counted ${totalOf(counts)} — ${verdict.verdict}${named}${scope}`
}

export const escapeHatchIndex = (workspace: Workspace, folder: string | undefined): ToolOutput => {
  const files = tsFilesOf(workspace, folder)
  const perFile = files.map((file) => ({
    file,
    hatches: hatchesOfFile(file, sourceOf(workspace, file) ?? parse(file, '')),
  }))
  const withHatches = perFile.filter((entry) => entry.hatches.length > 0)
  const all = withHatches.flatMap((entry) => entry.hatches)
  const counts = tallyOf(all)
  const breakdown = HATCH_KINDS.map(
    (kind) => `${kind} ${all.filter((hatch) => hatch.kind === kind).length}`,
  ).join(', ')
  return {
    ok: true,
    text: [
      `escape hatches — ${all.length} in ${withHatches.length} files: ${breakdown}`,
      baselineLine(workspace, folder, counts),
    ]
      .concat(
        withHatches.flatMap((entry) =>
          [`${entry.file} — ${entry.hatches.length}`].concat(
            entry.hatches.map(
              (hatch) => `  ${hatch.file}:${hatch.line} ${hatch.kind} ${hatch.text}`,
            ),
          ),
        ),
      )
      .join('\n'),
  }
}
