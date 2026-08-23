// Moving code between files. Renaming a file rewrites every import specifier
// that pointed at it; moving one declaration decides what that declaration
// needs in its new home, what its old home no longer needs, and whether the two
// files end up importing each other. Neither creates or deletes a file, because
// a plan can only rewrite contents: `renameFile` leaves the filesystem move to
// its caller, and `moveSymbol` declines when the target file is not there yet.
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
    (kept, part) => (part === '.' || part === '' ? kept : part === '..' ? kept.slice(0, -1) : [...kept, part]),
    [],
  )

// Only a relative specifier names a file in the workspace; a bare package name
// is somebody else's module and is never rewritten.
const resolveSpecifier = (fromFile: string, specifier: string): string | undefined =>
  specifier.startsWith('.') ? normalized([...directoryOf(fromFile), ...specifier.split('/')]).join('/') : undefined

const sharedPrefix = (left: readonly string[], right: readonly string[]): number =>
  left.length === 0 || right.length === 0 || left[0] !== right[0] ? 0 : 1 + sharedPrefix(left.slice(1), right.slice(1))

// The house form: relative, forward slashes, the `.ts` extension kept, and a
// `./` prefix for anything that is not above the importing file.
export const specifierFor = (fromFile: string, toFile: string): string => {
  const shared = sharedPrefix(directoryOf(fromFile), directoryOf(toFile))
  const up = directoryOf(fromFile).slice(shared).map(() => '..')
  const parts = [...up, ...toFile.split('/').slice(shared)]
  return up.length === 0 ? `./${parts.join('/')}` : parts.join('/')
}

type ImportedName = { readonly text: string; readonly name: string; readonly aliased: boolean }

type NamedImport = {
  readonly module: string; readonly typeOnly: boolean; readonly names: readonly ImportedName[]
  readonly start: number; readonly end: number
}

// Only plain named imports, which is what this repository writes; a default or
// namespace import is left alone, and a file with one is simply not rewritten.
const namedImportsIn = (file: string, sourceFile: ts.SourceFile): readonly NamedImport[] =>
  sourceFile.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return []
    const clause = statement.importClause
    const bindings = clause?.namedBindings
    const module = resolveSpecifier(file, statement.moduleSpecifier.text)
    if (clause === undefined || clause.name !== undefined || bindings === undefined) return []
    if (!ts.isNamedImports(bindings) || module === undefined) return []
    const names = bindings.elements.map((element) => ({
      text: element.getText(sourceFile),
      name: (element.propertyName ?? element.name).text, aliased: element.propertyName !== undefined,
    }))
    const start = statement.getStart(sourceFile)
    return [{ module, typeOnly: clause.isTypeOnly, names, start, end: statement.end }]
  })

const importStatement = (file: string, typeOnly: boolean, names: readonly string[], module: string): string =>
  `import ${typeOnly ? 'type ' : ''}{ ${names.join(', ')} } from '${specifierFor(file, module)}'`

// A statement that loses its last name goes entirely, taking the line it sat on with
// it; the first statement in a file takes the blank line under it too.
const removedStatement = (file: string, sourceFile: ts.SourceFile, entry: NamedImport): FileEdit => {
  const first = sourceFile.text.slice(0, entry.start).trim() === ''
  const pattern = first ? /^[ \t]*\r?\n(?:[ \t]*\r?\n)*/ : /^[ \t]*\r?\n/
  const trailing = pattern.exec(sourceFile.text.slice(entry.end))?.[0].length ?? 0
  return { file, start: first ? 0 : entry.start, end: entry.end + trailing, text: '' }
}

// Where a brand new import statement goes: after the last existing import, or
// under the file's header comment, or at the very top.
const importAnchor = (sourceFile: ts.SourceFile): { readonly at: number; readonly text: string } => {
  const imports = sourceFile.statements.filter(ts.isImportDeclaration)
  const last = imports[imports.length - 1]
  const first = sourceFile.statements[0]
  const comments = first === undefined ? [] : ts.getLeadingCommentRanges(sourceFile.text, first.getFullStart())
  const header = (comments ?? [])[(comments ?? []).length - 1]
  if (last !== undefined) return { at: last.end, text: '\n' }
  return header === undefined ? { at: 0, text: '' } : { at: header.end, text: '\n\n' }
}

type NameInModule = { readonly file: string; readonly module: string; readonly name: string }

// One file's import rewrite: names leaving their old clause, names joining an
// existing clause where there is one, and a fresh statement where there is not.
// Every edit is one import statement wide, so edits stay disjoint.
const importEditsFor = (
  file: string, sourceFile: ts.SourceFile, drops: readonly NameInModule[], adds: readonly NameInModule[],
): readonly FileEdit[] => {
  const entries = namedImportsIn(file, sourceFile)
  // A value name merged into an `import type` clause would be a type import, so
  // only a plain clause hosts additions; the rest get a statement of their own.
  const hostOf = (module: string): NamedImport | undefined =>
    entries.find((entry) => entry.module === module && !entry.typeOnly)
  const outcomes = entries.flatMap((entry) => {
    const dropped = drops.filter((drop) => drop.module === entry.module).map((drop) => drop.name)
    const added = adds.filter((add) => hostOf(add.module) === entry).map((add) => add.name)
    const kept = entry.names.filter((held) => !dropped.includes(held.name))
    const fresh = added.filter((name) => !kept.some((held) => held.name === name))
    const names = [...kept.map((held) => held.text), ...fresh]
    return dropped.length === 0 && added.length === 0 ? [] : [{ entry, names }]
  })
  const homeless = adds.filter((add) => hostOf(add.module) === undefined)
  const fresh = [...new Set(homeless.map((add) => add.module))].map((module) =>
    importStatement(file, false, [...new Set(homeless.filter((add) => add.module === module).map((add) => add.name))].sort(), module),
  )
  // A statement that empties out is where the new ones go, when there are any:
  // removing it and inserting beside it would be two edits over one range.
  const takeover = fresh.length === 0 ? undefined : outcomes.find((outcome) => outcome.names.length === 0)?.entry
  const rewrites = outcomes.map(({ entry, names }) =>
    names.length === 0
      ? entry === takeover
        ? { file, start: entry.start, end: entry.end, text: fresh.join('\n') }
        : removedStatement(file, sourceFile, entry)
      : { file, start: entry.start, end: entry.end, text: importStatement(file, entry.typeOnly, names, entry.module) },
  )
  if (fresh.length === 0 || takeover !== undefined) return rewrites
  const anchor = importAnchor(sourceFile)
  const tail = anchor.at === 0 ? '\n\n' : ''
  return [...rewrites, { file, start: anchor.at, end: anchor.at, text: `${anchor.text}${fresh.join('\n')}${tail}` }]
}

const importEdits = (
  workspace: Workspace, drops: readonly NameInModule[], adds: readonly NameInModule[],
): readonly FileEdit[] =>
  [...new Set([...drops, ...adds].map((entry) => entry.file))].flatMap((file) => {
    const sourceFile = sourceOf(workspace, file)
    const here = (entry: NameInModule): boolean => entry.file === file
    return sourceFile === undefined ? [] : importEditsFor(file, sourceFile, drops.filter(here), adds.filter(here))
  })

export const renameFile = (compiler: Compiler, file: string, newPath: string): EditPlan => {
  // The language service throws on a file the program does not contain, so the
  // guard has to come before the call, not around it.
  if (compiler.boundSourceFile(file) === undefined) return declined(`${file} is not in the program.`)
  if (sourceOf(compiler.workspace, newPath) !== undefined)
    return declined(`${newPath} already exists; pick a path that is free.`)
  const changes = compiler.language.getEditsForFileRename(
    compiler.pathOf(file), compiler.pathOf(newPath), formatSettings, userPreferences,
  )
  const edits = toFileEdits(compiler, changes)
  const files = new Set(edits.map((edit) => edit.file))
  const summary = `rewrote ${edits.length} import specifiers in ${files.size} files; then move ${file} to ${newPath}`
  return { ok: true, edits, summary }
}

// The declaration and the blank lines that followed it, so the hole left behind
// is not a double blank line; the last declaration in a file takes the one above.
const deletionOf = (file: string, sourceFile: ts.SourceFile, start: number, end: number): FileEdit => {
  const trailing = /^[ \t]*\r?\n(?:[ \t]*\r?\n)*/.exec(sourceFile.text.slice(end))?.[0] ?? ''
  const rest = sourceFile.text.slice(end + trailing.length)
  const above = sourceFile.text.slice(0, start).trimEnd().length
  return rest.trim() === ''
    ? { file, start: above, end: sourceFile.text.length, text: '\n' }
    : { file, start, end: end + trailing.length, text: '' }
}

const canonicalFile = (workspace: Workspace, file: string): string | undefined =>
  [...workspace.sources.keys()].find((key) => key.toLowerCase() === file.toLowerCase())

const located = (symbol: SymbolInfo): string => `${symbol.file}:${symbol.line}`

type Move = {
  readonly from: string; readonly to: string; readonly name: string; readonly symbol: SymbolInfo
  readonly sourceFile: ts.SourceFile; readonly targetFile: ts.SourceFile
  readonly dependencies: readonly SymbolInfo[]; readonly stillUsed: boolean
}

// What the declaration reaches for: every top-level symbol referred to inside its
// own bytes. The index has these resolved already, which is why no compiler is needed.
const dependenciesOf = (workspace: Workspace, symbol: SymbolInfo, start: number, end: number): readonly SymbolInfo[] => {
  const inside = workspace.index.references.filter(
    (each) =>
      each.file === symbol.file && each.span.start >= start && each.span.start < end && each.symbolId !== symbol.id,
  )
  const wanted = new Set(inside.map((reference) => reference.symbolId))
  return workspace.index.symbols.filter((each) => each.containerName === undefined && wanted.has(each.id))
}

// Both directions of the edge the move would create: two files that import each
// other are a cycle the caller has to break by splitting them differently.
const cycleBetween = (move: Move): boolean =>
  (move.dependencies.some((dependency) => dependency.file === move.from) ||
    namedImportsIn(move.to, move.targetFile).some(
      (entry) => entry.module === move.from && entry.names.some((held) => held.name !== move.name),
    )) &&
  (move.stillUsed ||
    namedImportsIn(move.from, move.sourceFile).some((entry) => entry.module === move.to))

// `export { name }` and `export { name } from './x.ts'` are not rewritten here,
// so a symbol that is re-exported anywhere declines rather than moving half way.
const reexportsName = (sourceFile: ts.SourceFile, name: string): boolean =>
  sourceFile.statements.some(
    (statement) =>
      ts.isExportDeclaration(statement) &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause) &&
      statement.exportClause.elements.some((each) => (each.propertyName ?? each.name).text === name),
  )

const refusal = (workspace: Workspace, move: Move): string | undefined => {
  const reexported = [...workspace.sources.entries()].filter(([, file]) => reexportsName(file, move.name))
  if (reexported.length > 0)
    return `${move.name} is re-exported by ${reexported.map(([file]) => file).join(', ')}; move it by hand.`
  const aliased = [...workspace.sources.entries()]
    .filter(([file, sourceFile]) =>
      namedImportsIn(file, sourceFile).some(
        (entry) => entry.module === move.from && entry.names.some((h) => h.name === move.name && h.aliased),
      ),
    )
    .map(([file]) => file)
  if (aliased.length > 0)
    return `${move.name} is imported under another name in ${aliased.join(', ')}; move it by hand.`
  if (!move.symbol.exported && move.stillUsed)
    return `${move.name} is not exported from ${move.from}, which still uses it after the move. Export it first.`
  const hidden = move.dependencies.filter((each) => each.file === move.from && !each.exported)
  if (hidden.length > 0)
    return [
      `${move.name} uses declarations that are not exported from ${move.from}:`,
      ...hidden.map((dependency) => `${dependency.name} at ${located(dependency)}`),
      'Export them, or move them too. Widening visibility is your call, not mine.',
    ].join('\n')
  const wanted = [move.name, ...move.dependencies.filter((each) => each.file !== move.to).map((each) => each.name)]
  const clashes = workspace.index.symbols.filter(
    (each) => each.file === move.to && each.containerName === undefined && wanted.includes(each.name),
  )
  if (clashes.length > 0)
    return `${move.to} already declares ${clashes.map((clash) => `${clash.name} at ${located(clash)}`).join(', ')}.`
  return cycleBetween(move)
    ? `the move would make ${move.to} import ${move.from} and ${move.from} import ${move.to}. Split them differently.`
    : undefined
}

export const moveSymbol = (
  workspace: Workspace, name: string, fromFile: string | undefined, toFile: string,
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
  // An import or export specifier is a reference too, so a file that only names
  // the symbol in its module statements does not count as still using it.
  const specifiers = lookup.sourceFile.statements.filter(
    (statement) => ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement),
  )
  const uses = (at: number): boolean =>
    !(at >= range.start && at < range.end) &&
    !specifiers.some((each) => at >= each.getStart(lookup.sourceFile) && at < each.end)
  const move: Move = {
    from, to, name,
    symbol: lookup.symbol, sourceFile: lookup.sourceFile, targetFile: target,
    dependencies: dependenciesOf(workspace, lookup.symbol, range.start, range.end),
    stillUsed: workspace.index.references.some(
      (each) => each.symbolId === lookup.symbol.id && each.file === from && uses(each.span.start),
    ),
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
  const adds: readonly NameInModule[] = [
    ...importers.filter((file) => file !== to && file !== from).map((file) => ({ file, module: to, name })),
    ...(move.stillUsed ? [{ file: from, module: to, name }] : []),
    ...move.dependencies
      .filter((dependency) => dependency.file !== to)
      .map((dependency) => ({ file: to, module: dependency.file, name: dependency.name })),
  ]
  const body = lookup.sourceFile.text.slice(range.start, range.end).trim()
  const edits: readonly FileEdit[] = [
    deletionOf(from, lookup.sourceFile, range.start, range.end),
    { file: to, start: target.text.trimEnd().length, end: target.text.length, text: `\n\n${body}\n` },
    ...importEdits(workspace, importers.map((file) => ({ file, module: from, name })), adds),
  ]
  const touched = new Set(edits.map((edit) => edit.file))
  const summary = `moved ${name} from ${from} to ${to}; rewrote imports in ${touched.size - 2} other files`
  return { ok: true, edits, summary }
}
