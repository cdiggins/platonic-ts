// Where a name would come from, seen from one position in one file.
//
// `shapes.ts` reports the names an expression reads without binding them itself. That set is
// the right one for matching two expressions, and the wrong one for extracting them: it
// includes `Array`, the module's own imports, and helpers declared at the top of the file,
// none of which a new function needs passed to it. Sorting those out is a scope question,
// and this module answers the one part of it that can be answered from syntax alone —
// whether the name is bound between the expression and the top of its file, declared at the
// top of its file, or neither.
//
// Neither is reported as `unknown` rather than guessed. The list of globals below is a
// list, not a lookup of the real global scope, so a name from a library's ambient types or
// from an environment this list does not know lands there. A caller should treat `unknown`
// as "check this one" — the honest answer at this level, and the reason the type checker is
// the better tool once one is available.
import ts from 'typescript'
import { resolveImport } from './rewrite.ts'
import { boundNames } from './shapes.ts'

export type Resolution =
  // Bound by a function, block, loop, or catch between the expression and the file top.
  | 'local'
  // Declared or imported at the top level of the file.
  | 'module'
  // A name from the list of globals below.
  | 'global'
  // Not found by any of the three, so not classifiable from syntax alone.
  | 'unknown'

// Names available everywhere in this repository's runtime, kept short on purpose: the cost
// of a missing entry is an `unknown` a caller checks, and the cost of a wrong entry is a
// rewrite that does not compile.
export const globalNames: ReadonlySet<string> = new Set([
  'AbortController', 'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'Buffer', 'Date', 'Error',
  'Function', 'Infinity', 'Intl', 'JSON', 'Map', 'Math', 'NaN', 'Number', 'Object', 'Promise',
  'Proxy', 'RangeError', 'Reflect', 'RegExp', 'Set', 'String', 'Symbol', 'TextDecoder',
  'TextEncoder', 'TypeError', 'URL', 'URLSearchParams', 'Uint8Array', 'WeakMap', 'WeakSet',
  'clearInterval', 'clearTimeout', 'console', 'decodeURIComponent', 'encodeURIComponent',
  'fetch', 'globalThis', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'process',
  'queueMicrotask', 'setInterval', 'setTimeout', 'structuredClone', 'undefined',
])

// Type names that need no import, on the same terms as the value list above.
export const globalTypeNames: ReadonlySet<string> = new Set([
  'Array', 'ArrayBuffer', 'Awaited', 'Buffer', 'Date', 'Error', 'Exclude', 'Extract',
  'Function', 'Iterable', 'AsyncIterable', 'Map', 'NonNullable', 'Omit', 'Parameters',
  'Partial', 'Pick', 'Promise', 'Readonly', 'ReadonlyArray', 'ReadonlyMap', 'ReadonlySet',
  'Record', 'RegExp', 'Required', 'ReturnType', 'Set', 'Uint8Array', 'URL', 'WeakMap',
  'WeakSet',
])

const importedNames = (declaration: ts.ImportDeclaration): readonly string[] => {
  const clause = declaration.importClause
  if (clause === undefined) return []
  const direct = clause.name === undefined ? [] : [clause.name.text]
  const bindings = clause.namedBindings
  if (bindings === undefined) return direct
  return ts.isNamespaceImport(bindings)
    ? [...direct, bindings.name.text]
    : [...direct, ...bindings.elements.map((element) => element.name.text)]
}

// Names a statement declares in the scope that contains it, imports included.
const declaresNames = (statement: ts.Statement): readonly string[] => {
  if (ts.isImportDeclaration(statement)) return importedNames(statement)
  if (ts.isVariableStatement(statement)) return boundNames(statement)
  return (ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement)) &&
    statement.name !== undefined
    ? [statement.name.text]
    : []
}

// A file's top-level names, computed once and asked many times.
export type FileScope = {
  readonly file: string
  readonly names: ReadonlySet<string>
}

export const fileScope = (file: string, sourceFile: ts.SourceFile): FileScope => ({
  file,
  names: new Set(sourceFile.statements.flatMap(declaresNames)),
})

// The repository files this one imports. Used to keep a new import from closing a cycle.
export const importedFiles = (file: string, sourceFile: ts.SourceFile): readonly string[] =>
  sourceFile.statements.flatMap((statement) =>
    ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
      ? [resolveImport(file, statement.moduleSpecifier.text) ?? []].flat()
      : [],
  )

const ancestorsOf = (node: ts.Node): readonly ts.Node[] => {
  const parent: ts.Node | undefined = node.parent
  return parent === undefined || ts.isSourceFile(parent) ? [] : [parent, ...ancestorsOf(parent)]
}

// Declarations that are siblings of the path out, rather than on it: a `const` earlier in
// the same block binds the expression's name without being one of its ancestors.
const siblingNames = (node: ts.Node): readonly string[] =>
  ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)
    ? node.statements.flatMap(declaresNames)
    : []

// Where `name`, read at `from`, comes from. `from` is the expression being extracted, not
// the identifier inside it: the question is what the expression needs handed to it.
export const resolutionOf = (name: string, from: ts.Node, scope: FileScope): Resolution => {
  const enclosing = ancestorsOf(from)
  const bound = enclosing.some(
    (ancestor) =>
      boundNames(ancestor).includes(name) || siblingNames(ancestor).includes(name),
  )
  if (bound) return 'local'
  if (scope.names.has(name)) return 'module'
  return globalNames.has(name) ? 'global' : 'unknown'
}
