// The tools that measure and review rather than change: how bad is this
// declaration, where are the escape hatches, is this symbol safe to delete, and
// what actually changed since a known-good snapshot. All pure over `Workspace`.
//
// Nothing here counts anything the rest of the repository already counts:
// metrics come from `packages/codemap/src/metrics.ts` and the escape-hatch
// classification is the one `packages/check/src/ratchet.ts` uses, so the MCP
// server and `platonic check` can never disagree about what a hatch is.
import ts from 'typescript'
import type { CodeMetrics, SymbolInfo } from '../../core/src/index.ts'
import { fileMetrics, functionMetrics } from '../../codemap/src/metrics.ts'
import { extractSymbols } from '../../codemap/src/symbols.ts'
import { compareToBaseline, type RatchetCounts } from '../../check/src/ratchet.ts'
import { declarationRange, declarationText } from './declaration.ts'
import { explainLookup, type ToolOutput } from './query.ts'
import type { EditPlan } from './edit.ts'
import { lineTextAt, resolveSymbol, sourceOf, type Workspace } from './workspace.ts'

const parse = (name: string, text: string): ts.SourceFile =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true)

const tsFilesOf = (workspace: Workspace, folder: string | undefined): readonly string[] =>
  [...workspace.sources.keys()]
    .filter((file) => file.endsWith('.ts'))
    .filter((file) => folder === undefined || file === folder || file.startsWith(`${folder}/`))
    .sort()

const symbolsOfFile = (workspace: Workspace, file: string): readonly SymbolInfo[] =>
  workspace.index.symbols.filter((symbol) => symbol.file.toLowerCase() === file.toLowerCase())

// ---------------------------------------------------------------------------
// symbol_metrics — is this declaration worth refactoring?
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// escape_hatch_index — every `any`, `as`, `!`, and suppression comment
// ---------------------------------------------------------------------------

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
  const verdict = compareToBaseline(counts, baseline)
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

// ---------------------------------------------------------------------------
// delete_symbol — remove a declaration, or explain why that is unsafe
// ---------------------------------------------------------------------------

const moduleBase = (specifier: string): string =>
  specifier.replace(/['"]/g, '').split('/').slice(-1)[0]?.replace(/\.(ts|tsx|js|mjs)$/, '') ?? ''

const reExportsName = (statement: ts.Statement, name: string, from: string): boolean =>
  ts.isExportDeclaration(statement) &&
  statement.moduleSpecifier !== undefined &&
  (statement.exportClause === undefined
    ? moduleBase(statement.moduleSpecifier.getText()) === moduleBase(from)
    : ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some(
        (element) => (element.propertyName ?? element.name).text === name,
      ))

const barrelsFor = (workspace: Workspace, name: string, from: string): readonly string[] =>
  [...workspace.sources]
    .filter(([file]) => file !== from)
    .filter(([, sourceFile]) =>
      sourceFile.statements.some((statement) => reExportsName(statement, name, from)),
    )
    .map(([file]) => file)
    .sort()

const usesOutside = (
  workspace: Workspace,
  symbol: SymbolInfo,
  start: number,
  end: number,
): readonly string[] =>
  workspace.index.references
    .filter((reference) => reference.symbolId === symbol.id)
    .filter(
      (reference) =>
        reference.file !== symbol.file ||
        reference.span.start < start ||
        reference.span.start >= end,
    )
    .slice()
    .sort((left, right) =>
      left.file === right.file ? left.line - right.line : left.file < right.file ? -1 : 1,
    )
    .map((reference) => {
      const source = sourceOf(workspace, reference.file)
      const context = source === undefined ? '' : lineTextAt(source, reference.span.start)
      return `${reference.file}:${reference.line} ${context}`
    })

// The declaration plus the blank line it would otherwise leave behind: at most
// the newline that ends its last line and the empty line after it.
const trailingGap = (text: string, end: number): number =>
  /^(?:[ \t]*\r?\n){1,2}/.exec(text.slice(end))?.[0].length ?? 0

export const deleteSymbol = (
  workspace: Workspace,
  name: string,
  file: string | undefined,
): EditPlan => {
  const lookup = resolveSymbol(workspace, name, file)
  if (!lookup.ok) return { ok: false, text: explainLookup(name, lookup).text }
  const range = declarationRange(lookup.sourceFile, lookup.symbol)
  if (range === undefined) return { ok: false, text: `${name} has no declaration range.` }
  const barrels = barrelsFor(workspace, name, lookup.symbol.file)
  if (barrels.length > 0)
    return {
      ok: false,
      text: `${name} is re-exported from ${barrels.join(', ')}; deleting it would leave a broken re-export. Remove the re-export first.`,
    }
  const uses = usesOutside(workspace, lookup.symbol, range.start, range.end)
  if (uses.length > 0)
    return {
      ok: false,
      text: [`${name} is still used in ${uses.length} places; remove them first:`]
        .concat(uses)
        .join('\n'),
    }
  const end = range.end + trailingGap(lookup.sourceFile.text, range.end)
  const removed = lookup.sourceFile.text.slice(range.start, range.end).split('\n').length
  return {
    ok: true,
    edits: [{ file: lookup.symbol.file, start: range.start, end, text: '' }],
    summary: `${lookup.symbol.file}:${lookup.symbol.line} — deleted ${name} (${removed} lines)`,
  }
}

// ---------------------------------------------------------------------------
// symbol_diff — what changed, by declaration rather than by line
// ---------------------------------------------------------------------------

type Decl = {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly text: string
}

const keyOf = (decl: Decl): string => `${decl.file} ${decl.name}`

const normalize = (text: string): string => text.split('\r\n').join('\n').trim()

const declsOf = (
  file: string,
  sourceFile: ts.SourceFile,
  symbols: readonly SymbolInfo[],
): readonly Decl[] =>
  symbols
    .filter((symbol) => symbol.containerName === undefined)
    .flatMap((symbol) => {
      const text = declarationText(sourceFile, symbol)
      return text === undefined
        ? []
        : [{ file, name: symbol.name, line: symbol.line, text: normalize(text) }]
    })

const afterDeclsOf = (workspace: Workspace): readonly Decl[] =>
  tsFilesOf(workspace, undefined).flatMap((file) => {
    const sourceFile = sourceOf(workspace, file)
    return sourceFile === undefined ? [] : declsOf(file, sourceFile, symbolsOfFile(workspace, file))
  })

const beforeDeclsOf = (workspace: Workspace, before: ReadonlyMap<string, string>): readonly Decl[] =>
  [...before].flatMap(([file, text]) => {
    const sourceFile = parse(`${workspace.index.root}/${file}`, text)
    return declsOf(file, sourceFile, extractSymbols(workspace.index.root, sourceFile))
  })

type Move = {
  readonly added: Decl
  readonly removed: Decl
}

// A move is the same name with byte-identical text in a different file. Matched
// greedily and at most once each, so a declaration copied into two files shows
// as one move and one addition rather than two moves.
const movesOf = (added: readonly Decl[], removed: readonly Decl[]): readonly Move[] =>
  added.reduce<readonly Move[]>((moves, candidate) => {
    const taken = new Set(moves.map((move) => keyOf(move.removed)))
    const match = removed.find(
      (gone) =>
        gone.name === candidate.name &&
        gone.text === candidate.text &&
        gone.file !== candidate.file &&
        !taken.has(keyOf(gone)),
    )
    return match === undefined ? moves : [...moves, { added: candidate, removed: match }]
  }, [])

export const symbolDiff = (
  workspace: Workspace,
  before: ReadonlyMap<string, string>,
): ToolOutput => {
  const beforeDecls = beforeDeclsOf(workspace, before)
  const afterDecls = afterDeclsOf(workspace)
  const beforeByKey = new Map(beforeDecls.map((decl) => [keyOf(decl), decl]))
  const afterByKey = new Map(afterDecls.map((decl) => [keyOf(decl), decl]))
  const addedFiles = [...new Set(afterDecls.map((decl) => decl.file))].filter(
    (file) => !before.has(file),
  )
  const removedFiles = [...before.keys()].filter((file) => !workspace.sources.has(file))
  const added = afterDecls.filter((decl) => !beforeByKey.has(keyOf(decl)))
  const removed = beforeDecls.filter((decl) => !afterByKey.has(keyOf(decl)))
  const changed = afterDecls.filter((decl) => {
    const was = beforeByKey.get(keyOf(decl))
    return was !== undefined && was.text !== decl.text
  })
  const moves = movesOf(added, removed)
  const movedAdded = new Set(moves.map((move) => keyOf(move.added)))
  const movedRemoved = new Set(moves.map((move) => keyOf(move.removed)))
  const plainAdded = added.filter(
    (decl) => !movedAdded.has(keyOf(decl)) && !addedFiles.includes(decl.file),
  )
  const plainRemoved = removed.filter(
    (decl) => !movedRemoved.has(keyOf(decl)) && !removedFiles.includes(decl.file),
  )
  const files = new Set([...before.keys(), ...afterDecls.map((decl) => decl.file)])
  return {
    ok: true,
    text: [
      `${files.size} files compared — ${addedFiles.length} added, ${removedFiles.length} removed; declarations: ${plainAdded.length} added, ${plainRemoved.length} removed, ${changed.length} changed, ${moves.length} moved`,
    ]
      .concat(
        addedFiles.map(
          (file) =>
            `added file: ${file} (${afterDecls.filter((decl) => decl.file === file).length} declarations)`,
        ),
      )
      .concat(
        removedFiles.map(
          (file) =>
            `removed file: ${file} (${beforeDecls.filter((decl) => decl.file === file).length} declarations)`,
        ),
      )
      .concat(
        moves.map(
          (move) =>
            `moved: ${move.added.name} — ${move.removed.file}:${move.removed.line} -> ${move.added.file}:${move.added.line}`,
        ),
      )
      .concat(changed.map((decl) => `changed: ${decl.file}:${decl.line} ${decl.name}`))
      .concat(plainAdded.map((decl) => `added: ${decl.file}:${decl.line} ${decl.name}`))
      .concat(plainRemoved.map((decl) => `removed: ${decl.file}:${decl.line} ${decl.name}`))
      .join('\n'),
  }
}
