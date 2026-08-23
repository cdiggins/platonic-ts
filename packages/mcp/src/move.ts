// Moving code between files. Two transformations that are tedious and
// error-prone by hand: renaming a file, which rewrites every import specifier
// that pointed at it, and moving one declaration, which has to decide what the
// declaration needs in its new home, what its old home no longer needs, and
// whether the move points two files at each other.
//
// Neither creates or deletes a file: a plan can only rewrite the contents of
// files that already exist, so `renameFile` leaves the filesystem move to its
// caller and `moveSymbol` declines when the target is not there yet.
import ts from 'typescript'
import type { SymbolInfo } from '../../core/src/index.ts'
import { formatSettings, toFileEdits, userPreferences, type Compiler } from './compiler.ts'
import { declarationRange } from './declaration.ts'
import type { EditPlan, FileEdit } from './edit.ts'
import { explainLookup } from './query.ts'
import { resolveSymbol, sourceOf, type Workspace } from './workspace.ts'

const declined = (text: string): EditPlan => ({ ok: false, text })

const directoryOf = (file: string): readonly string[] => file.split('/').slice(0, -1)

const normalized = (parts: readonly string[]): readonly string[] =>
  parts.reduce<readonly string[]>(
    (kept, part) =>
      part === '.' || part === '' ? kept : part === '..' ? kept.slice(0, -1) : [...kept, part],
    [],
  )

// Only relative specifiers resolve to a file in the workspace; a bare package
// name is somebody else's module and is never rewritten.
const resolveSpecifier = (fromFile: string, specifier: string): string | undefined =>
  specifier.startsWith('.')
    ? normalized([...directoryOf(fromFile), ...specifier.split('/')]).join('/')
    : undefined

const sharedPrefix = (left: readonly string[], right: readonly string[]): number =>
  left.length === 0 || right.length === 0 || left[0] !== right[0]
    ? 0
    : 1 + sharedPrefix(left.slice(1), right.slice(1))

// The house form: relative, forward slashes, the `.ts` extension kept, and a
// `./` prefix for anything that is not above the importing file.
export const specifierFor = (fromFile: string, toFile: string): string => {
  const shared = sharedPrefix(directoryOf(fromFile), directoryOf(toFile))
  const up = directoryOf(fromFile)
    .slice(shared)
    .map(() => '..')
  const parts = [...up, ...toFile.split('/').slice(shared)]
  return up.length === 0 ? `./${parts.join('/')}` : parts.join('/')
}

type ImportedName = {
  readonly text: string
  readonly name: string
  readonly aliased: boolean
}

type NamedImport = {
  readonly module: string
  readonly typeOnly: boolean
  readonly names: readonly ImportedName[]
  readonly start: number
  readonly end: number
}

const namedImportsIn = (file: string, sourceFile: ts.SourceFile): readonly NamedImport[] =>
  sourceFile.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement)) return []
    const clause = statement.importClause
    const bindings = clause?.namedBindings
    if (clause === undefined || clause.name !== undefined || bindings === undefined) return []
    if (!ts.isNamedImports(bindings) || !ts.isStringLiteral(statement.moduleSpecifier)) return []
    const module = resolveSpecifier(file, statement.moduleSpecifier.text)
    return module === undefined
      ? []
      : [
          {
            module,
            typeOnly: clause.isTypeOnly,
            names: bindings.elements.map((element) => ({
              text: element.getText(sourceFile),
              name: (element.propertyName ?? element.name).text,
              aliased: element.propertyName !== undefined,
            })),
            start: statement.getStart(sourceFile),
            end: statement.end,
          },
        ]
  })

const importStatement = (
  file: string,
  typeOnly: boolean,
  names: readonly string[],
  module: string,
): string =>
  `import ${typeOnly ? 'type ' : ''}{ ${names.join(', ')} } from '${specifierFor(file, module)}'`

// A statement that loses its last name goes entirely, taking the line it sat on
// with it, so the file is not left with a blank line where an import was. The
// first statement in a file takes the blank line under it too, which would
// otherwise become a blank first line.
const removedStatement = (
  file: string,
  sourceFile: ts.SourceFile,
  entry: NamedImport,
): FileEdit => {
  const first = sourceFile.text.slice(0, entry.start).trim() === ''
  const pattern = first ? /^[ \t]*\r?\n(?:[ \t]*\r?\n)*/ : /^[ \t]*\r?\n/
  return {
    file,
    start: first ? 0 : entry.start,
    end: entry.end + (pattern.exec(sourceFile.text.slice(entry.end))?.[0].length ?? 0),
    text: '',
  }
}

// Where a brand new import statement goes: after the last existing import, or
// under the file's header comment, or at the very top.
const importAnchor = (sourceFile: ts.SourceFile): { readonly at: number; readonly text: string } => {
  const imports = sourceFile.statements.filter(ts.isImportDeclaration)
  const last = imports[imports.length - 1]
  if (last !== undefined) return { at: last.end, text: '\n' }
  const first = sourceFile.statements[0]
  const comments =
    first === undefined ? [] : (ts.getLeadingCommentRanges(sourceFile.text, first.getFullStart()) ?? [])
  const header = comments[comments.length - 1]
  return header === undefined ? { at: 0, text: '' } : { at: header.end, text: '\n\n' }
}

type NameInModule = {
  readonly file: string
  readonly module: string
  readonly name: string
}

// One file's import rewrite: names leaving their old clause, names joining an
// existing clause where there is one, and a fresh statement where there is not.
const importEditsFor = (
  file: string,
  sourceFile: ts.SourceFile,
  drops: readonly NameInModule[],
  adds: readonly NameInModule[],
): readonly FileEdit[] => {
  const entries = namedImportsIn(file, sourceFile)
  const hostOf = (module: string): NamedImport | undefined =>
    entries.find((entry) => entry.module === module && !entry.typeOnly)
  const outcomes = entries.flatMap((entry) => {
    const dropped = drops.filter((drop) => drop.module === entry.module).map((drop) => drop.name)
    const added = adds.filter((add) => hostOf(add.module) === entry).map((add) => add.name)
    if (dropped.length === 0 && added.length === 0) return []
    const kept = entry.names.filter((held) => !dropped.includes(held.name))
    return [
      {
        entry,
        names: [
          ...kept.map((held) => held.text),
          ...added.filter((name) => !kept.some((held) => held.name === name)),
        ],
      },
    ]
  })
  const fresh = [...new Set(adds.filter((add) => hostOf(add.module) === undefined).map((add) => add.module))]
    .map((module) =>
      importStatement(
        file,
        false,
        [...new Set(adds.filter((add) => add.module === module).map((add) => add.name))].sort(),
        module,
      ),
    )
  // A statement that empties out is where the new ones go, when there are any:
  // removing it and inserting beside it would be two edits over one range.
  const takeover = fresh.length === 0 ? undefined : outcomes.find((outcome) => outcome.names.length === 0)?.entry
  const rewrites = outcomes.map(({ entry, names }) =>
    names.length === 0
      ? entry === takeover
        ? { file, start: entry.start, end: entry.end, text: fresh.join('\n') }
        : removedStatement(file, sourceFile, entry)
      : {
          file,
          start: entry.start,
          end: entry.end,
          text: importStatement(file, entry.typeOnly, names, entry.module),
        },
  )
  if (fresh.length === 0 || takeover !== undefined) return rewrites
  const anchor = importAnchor(sourceFile)
  const tail = anchor.at === 0 ? '\n\n' : ''
  return [
    ...rewrites,
    { file, start: anchor.at, end: anchor.at, text: `${anchor.text}${fresh.join('\n')}${tail}` },
  ]
}

const importEdits = (
  workspace: Workspace,
  drops: readonly NameInModule[],
  adds: readonly NameInModule[],
): readonly FileEdit[] =>
  [...new Set([...drops, ...adds].map((entry) => entry.file))].flatMap((file) => {
    const sourceFile = sourceOf(workspace, file)
    return sourceFile === undefined
      ? []
      : importEditsFor(
          file,
          sourceFile,
          drops.filter((drop) => drop.file === file),
          adds.filter((add) => add.file === file),
        )
  })

export const renameFile = (compiler: Compiler, file: string, newPath: string): EditPlan => {
  if (compiler.boundSourceFile(file) === undefined) return declined(`${file} is not in the program.`)
  if (sourceOf(compiler.workspace, newPath) !== undefined)
    return declined(`${newPath} already exists; pick a path that is free.`)
  const edits = toFileEdits(
    compiler,
    compiler.language.getEditsForFileRename(
      compiler.pathOf(file),
      compiler.pathOf(newPath),
      formatSettings,
      userPreferences,
    ),
  )
  const files = new Set(edits.map((edit) => edit.file))
  return {
    ok: true,
    edits,
    summary: `rewrote ${edits.length} import specifiers in ${files.size} files; then move ${file} to ${newPath}`,
  }
}

// The declaration and the blank lines that followed it, so the hole left behind
// is not a double blank line. A declaration at the end of its file takes the
// blank line above it instead.
const deletionOf = (
  file: string,
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
): FileEdit => {
  const trailing = /^[ \t]*\r?\n(?:[ \t]*\r?\n)*/.exec(sourceFile.text.slice(end))?.[0] ?? ''
  const rest = sourceFile.text.slice(end + trailing.length)
  return rest.trim() === ''
    ? { file, start: sourceFile.text.slice(0, start).trimEnd().length, end: sourceFile.text.length, text: '\n' }
    : { file, start, end: end + trailing.length, text: '' }
}

const canonicalFile = (workspace: Workspace, file: string): string | undefined =>
  [...workspace.sources.keys()].find((key) => key.toLowerCase() === file.toLowerCase())

const located = (symbol: SymbolInfo): string => `${symbol.file}:${symbol.line}`

type Move = {
  readonly from: string
  readonly to: string
  readonly name: string
  readonly symbol: SymbolInfo
  readonly targetFile: ts.SourceFile
  readonly dependencies: readonly SymbolInfo[]
  readonly stillUsed: boolean
}

const dependenciesOf = (
  workspace: Workspace,
  symbol: SymbolInfo,
  start: number,
  end: number,
): readonly SymbolInfo[] => {
  const inside = workspace.index.references.filter(
    (reference) =>
      reference.file === symbol.file &&
      reference.span.start >= start &&
      reference.span.start < end &&
      reference.symbolId !== symbol.id,
  )
  const wanted = new Set(inside.map((reference) => reference.symbolId))
  return workspace.index.symbols.filter(
    (candidate) => candidate.containerName === undefined && wanted.has(candidate.id),
  )
}

// Both directions of the edge the move would create. Two files that import each
// other are a cycle the caller has to break by hand, by splitting differently.
const cycleBetween = (workspace: Workspace, move: Move): boolean => {
  const importsFrom = (file: string, module: string): boolean =>
    (sourceOf(workspace, file)?.statements ?? []).some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        resolveSpecifier(file, statement.moduleSpecifier.text) === module,
    )
  const targetNeedsSource =
    move.dependencies.some((dependency) => dependency.file === move.from) ||
    namedImportsIn(move.to, move.targetFile).some(
      (entry) =>
        entry.module === move.from && entry.names.some((held) => held.name !== move.name),
    )
  return targetNeedsSource && (move.stillUsed || importsFrom(move.from, move.to))
}

const refusal = (workspace: Workspace, move: Move): string | undefined => {
  const aliased = [...workspace.sources.entries()].flatMap(([file, sourceFile]) =>
    namedImportsIn(file, sourceFile)
      .filter((entry) => entry.module === move.from)
      .flatMap((entry) => entry.names.filter((held) => held.name === move.name && held.aliased).map(() => file)),
  )
  if (aliased.length > 0)
    return `${move.name} is imported under another name in ${aliased.join(', ')}; move it by hand.`
  if (!move.symbol.exported && move.stillUsed)
    return `${move.name} is not exported from ${move.from}, and ${move.from} still uses it after the move. Export it first.`
  const hidden = move.dependencies.filter(
    (dependency) => dependency.file === move.from && !dependency.exported,
  )
  if (hidden.length > 0)
    return [
      `${move.name} uses declarations that are not exported from ${move.from}:`,
      ...hidden.map((dependency) => `${dependency.name} at ${located(dependency)}`),
      'Export them, or move them too. Widening visibility is your call, not mine.',
    ].join('\n')
  const wanted = [move.name, ...move.dependencies.filter((each) => each.file !== move.to).map((each) => each.name)]
  const clashes = workspace.index.symbols.filter(
    (candidate) =>
      candidate.file === move.to && candidate.containerName === undefined && wanted.includes(candidate.name),
  )
  if (clashes.length > 0)
    return `${move.to} already declares ${clashes.map((clash) => `${clash.name} at ${located(clash)}`).join(', ')}.`
  return cycleBetween(workspace, move)
    ? `the move would make ${move.to} import ${move.from} and ${move.from} import ${move.to}. Split them differently.`
    : undefined
}

export const moveSymbol = (
  workspace: Workspace,
  name: string,
  fromFile: string | undefined,
  toFile: string,
): EditPlan => {
  const lookup = resolveSymbol(workspace, name, fromFile)
  if (!lookup.ok) return declined(explainLookup(name, lookup).text)
  const to = canonicalFile(workspace, toFile)
  const target = to === undefined ? undefined : sourceOf(workspace, to)
  if (to === undefined || target === undefined)
    return declined(`${toFile} is not in the workspace; move_symbol does not create files.`)
  const from = lookup.symbol.file
  if (from === to) return declined(`${name} is already declared in ${to}.`)
  const range = declarationRange(lookup.sourceFile, lookup.symbol)
  if (range === undefined) return declined(`${name} has no declaration range.`)
  const outside = workspace.index.references.filter(
    (reference) =>
      reference.symbolId === lookup.symbol.id &&
      !(reference.file === from && reference.span.start >= range.start && reference.span.start < range.end),
  )
  const move: Move = {
    from,
    to,
    name,
    symbol: lookup.symbol,
    targetFile: target,
    dependencies: dependenciesOf(workspace, lookup.symbol, range.start, range.end),
    stillUsed: outside.some((reference) => reference.file === from),
  }
  const refused = refusal(workspace, move)
  if (refused !== undefined) return declined(refused)
  const importers = [...workspace.sources.entries()]
    .filter(([file, sourceFile]) =>
      namedImportsIn(file, sourceFile).some(
        (entry) => entry.module === from && entry.names.some((held) => held.name === name),
      ),
    )
    .map(([file]) => file)
  const drops = importers.map((file) => ({ file, module: from, name }))
  const adds: readonly NameInModule[] = [
    ...importers.filter((file) => file !== to && file !== from).map((file) => ({ file, module: to, name })),
    ...(move.stillUsed ? [{ file: from, module: to, name }] : []),
    ...move.dependencies
      .filter((dependency) => dependency.file !== to)
      .map((dependency) => ({ file: to, module: dependency.file, name: dependency.name })),
  ]
  const body = lookup.sourceFile.text.slice(range.start, range.end).trim()
  const appendFrom = target.text.trimEnd().length
  const edits: readonly FileEdit[] = [
    deletionOf(from, lookup.sourceFile, range.start, range.end),
    { file: to, start: appendFrom, end: target.text.length, text: `\n\n${body}\n` },
    ...importEdits(workspace, drops, adds),
  ]
  const touched = new Set(edits.map((edit) => edit.file))
  return {
    ok: true,
    edits,
    summary: `moved ${name} from ${from} to ${to}; rewrote imports in ${touched.size - 2} other files`,
  }
}
