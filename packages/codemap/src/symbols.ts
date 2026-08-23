// Pure symbol extraction and reference resolution over a TypeScript program.
//
// Traversal uses `node.getChildren(sourceFile)` rather than `ts.forEachChild`:
// forEachChild only reports results through a callback, which forces a mutable
// accumulator, while getChildren returns an array that flatMap can fold. The
// trade-off is that getChildren also materializes tokens (it re-scans each
// node's text), which is a few hundred thousand throwaway token objects on a
// repo this size — measured well under a second, and worth it for a pure walk.
import ts from 'typescript'
import { truncate } from '../../core/src/index.ts'
import type {
  SourceSpan,
  SymbolId,
  SymbolInfo,
  SymbolKind,
  SymbolReference,
} from '../../core/src/index.ts'

const SIGNATURE_MAX_LENGTH = 120

const toForwardSlashes = (path: string): string => path.split('\\').join('/')

// Absolute path -> repo-relative path with forward slashes. Tolerates either
// separator on either argument, a root with or without a trailing separator,
// and the drive-letter case drift the compiler API introduces on Windows.
export const toRepoRelative = (root: string, absolutePath: string): string => {
  const normalizedRoot = toForwardSlashes(root).replace(/\/+$/, '')
  const normalizedPath = toForwardSlashes(absolutePath)
  const prefix = `${normalizedRoot}/`
  return normalizedRoot.length > 0 &&
    normalizedPath.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()
    ? normalizedPath.slice(prefix.length)
    : normalizedPath
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

type DeclarationFacts = {
  readonly kind: SymbolKind
  readonly nameNode: ts.Node
  readonly name: string
  readonly exported: boolean
  readonly signature: string
}

// `inExportedStatement` exists because `export` sits on the VariableStatement,
// two levels above the VariableDeclaration that carries the name — and program
// source files have no parent pointers until the checker binds them, so the
// flag has to travel down the walk rather than be read from a parent.
type Container = {
  readonly name: string | undefined
  readonly exported: boolean
  readonly inExportedStatement: boolean
}

// Members inherit their container's visibility; locals inside an exported
// function do not.
const memberKinds: readonly SymbolKind[] = ['method', 'property']

const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim()

const textOf = (sourceFile: ts.SourceFile, node: ts.Node): string =>
  sourceFile.text.slice(node.getStart(sourceFile), node.end)

const rangeText = (sourceFile: ts.SourceFile, start: number, end: number): string =>
  sourceFile.text.slice(start, end)

const nameTextOf = (sourceFile: ts.SourceFile, nameNode: ts.Node): string =>
  ts.isIdentifier(nameNode) || ts.isPrivateIdentifier(nameNode) || ts.isStringLiteralLike(nameNode)
    ? nameNode.text
    : collapseWhitespace(textOf(sourceFile, nameNode))

// Syntactic modifiers only: `ts.getCombinedModifierFlags` walks parent pointers
// and caches its answer on the node, which silently returns 0 on an unbound
// program file and then stays wrong after binding.
const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)

// `(params): ReturnType` written the way the source writes it. NodeArray `pos`
// sits just inside the delimiter, so the parentheses are supplied here and a
// parenless arrow parameter still renders as a parameter list.
const signatureOfFunction = (
  sourceFile: ts.SourceFile,
  name: string,
  node: ts.SignatureDeclaration,
): string => {
  const typeParameters =
    node.typeParameters === undefined
      ? ''
      : `<${rangeText(sourceFile, node.typeParameters.pos, node.typeParameters.end)}>`
  const parameters = rangeText(sourceFile, node.parameters.pos, node.parameters.end)
  const returnType = node.type === undefined ? '' : `: ${textOf(sourceFile, node.type)}`
  const asyncPrefix = hasModifier(node, ts.SyntaxKind.AsyncKeyword) ? 'async ' : ''
  return `${asyncPrefix}${name}${typeParameters}(${parameters})${returnType}`
}

const signatureOfValue = (
  sourceFile: ts.SourceFile,
  name: string,
  type: ts.TypeNode | undefined,
  initializer: ts.Expression | undefined,
): string =>
  type !== undefined
    ? `${name}: ${textOf(sourceFile, type)}`
    : initializer !== undefined
      ? `${name} = ${textOf(sourceFile, initializer)}`
      : name

const functionInitializerOf = (
  node: ts.VariableDeclaration | ts.PropertyAssignment,
): ts.ArrowFunction | ts.FunctionExpression | undefined =>
  node.initializer !== undefined &&
  (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ? node.initializer
    : undefined

const declared = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
  nameNode: ts.Node,
  kind: SymbolKind,
  signature: string,
): DeclarationFacts => ({
  kind,
  nameNode,
  name: nameTextOf(sourceFile, nameNode),
  exported: hasModifier(node, ts.SyntaxKind.ExportKeyword),
  signature: truncate(collapseWhitespace(signature), SIGNATURE_MAX_LENGTH),
})

// Dispatch over the declaration forms this repo writes. Anything else — imports,
// parameters, binding patterns — is deliberately not a browsable symbol.
const describeDeclaration = (
  sourceFile: ts.SourceFile,
  node: ts.Node,
): DeclarationFacts | undefined => {
  if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
    const name = nameTextOf(sourceFile, node.name)
    return declared(sourceFile, node, node.name, 'function', signatureOfFunction(sourceFile, name, node))
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    const initializer = functionInitializerOf(node)
    return initializer === undefined
      ? declared(
          sourceFile,
          node,
          node.name,
          'variable',
          signatureOfValue(sourceFile, node.name.text, node.type, node.initializer),
        )
      : declared(
          sourceFile,
          node,
          node.name,
          'function',
          signatureOfFunction(sourceFile, node.name.text, initializer),
        )
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return declared(
      sourceFile,
      node,
      node.name,
      'type',
      `type ${node.name.text} = ${textOf(sourceFile, node.type)}`,
    )
  }
  if (ts.isInterfaceDeclaration(node)) {
    return declared(sourceFile, node, node.name, 'interface', `interface ${node.name.text}`)
  }
  if (ts.isClassDeclaration(node) && node.name !== undefined) {
    return declared(sourceFile, node, node.name, 'class', `class ${node.name.text}`)
  }
  if (ts.isEnumDeclaration(node)) {
    return declared(sourceFile, node, node.name, 'enum', `enum ${node.name.text}`)
  }
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
    const name = nameTextOf(sourceFile, node.name)
    return declared(sourceFile, node, node.name, 'method', signatureOfFunction(sourceFile, name, node))
  }
  if (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) {
    const name = nameTextOf(sourceFile, node.name)
    return declared(
      sourceFile,
      node,
      node.name,
      'property',
      signatureOfValue(sourceFile, name, node.type, undefined),
    )
  }
  if (ts.isPropertyAssignment(node)) {
    const name = nameTextOf(sourceFile, node.name)
    const initializer = functionInitializerOf(node)
    return initializer === undefined
      ? declared(
          sourceFile,
          node,
          node.name,
          'property',
          signatureOfValue(sourceFile, name, undefined, node.initializer),
        )
      : declared(sourceFile, node, node.name, 'function', signatureOfFunction(sourceFile, name, initializer))
  }
  if (ts.isEnumMember(node)) {
    return declared(sourceFile, node, node.name, 'property', nameTextOf(sourceFile, node.name))
  }
  if (ts.isModuleDeclaration(node)) {
    return declared(
      sourceFile,
      node,
      node.name,
      'module',
      `module ${nameTextOf(sourceFile, node.name)}`,
    )
  }
  return undefined
}

const spanOf = (sourceFile: ts.SourceFile, node: ts.Node): SourceSpan => {
  const start = node.getStart(sourceFile)
  return { start, length: node.end - start }
}

const lineOf = (sourceFile: ts.SourceFile, position: number): number =>
  sourceFile.getLineAndCharacterOfPosition(position).line + 1

const toSymbolInfo = (
  sourceFile: ts.SourceFile,
  file: string,
  facts: DeclarationFacts,
  container: Container,
): SymbolInfo => {
  const span = spanOf(sourceFile, facts.nameNode)
  return {
    id: `${file}#${span.start}`,
    name: facts.name,
    kind: facts.kind,
    file,
    span,
    line: lineOf(sourceFile, span.start),
    exported:
      facts.exported ||
      container.inExportedStatement ||
      (memberKinds.includes(facts.kind) && container.exported),
    containerName: container.name,
    signature: facts.signature,
  }
}

// Only the VariableStatement -> VariableDeclarationList -> VariableDeclaration
// chain carries the statement's `export`; anything else (a `for (const …)`
// head, a nested statement inside an exported function) starts over at false.
const carriesExportContext = (node: ts.Node, container: Container): boolean =>
  ts.isVariableStatement(node)
    ? hasModifier(node, ts.SyntaxKind.ExportKeyword)
    : node.kind === ts.SyntaxKind.SyntaxList || ts.isVariableDeclarationList(node)
      ? container.inExportedStatement
      : false

const walkDeclarations = (
  sourceFile: ts.SourceFile,
  file: string,
  node: ts.Node,
  container: Container,
): readonly SymbolInfo[] => {
  const facts = describeDeclaration(sourceFile, node)
  const symbol = facts === undefined ? undefined : toSymbolInfo(sourceFile, file, facts, container)
  const inner: Container = {
    name: symbol?.name ?? container.name,
    exported: symbol?.exported ?? container.exported,
    inExportedStatement: carriesExportContext(node, container),
  }
  const nested = node
    .getChildren(sourceFile)
    .flatMap((child) => walkDeclarations(sourceFile, file, child, inner))
  return symbol === undefined ? nested : [symbol, ...nested]
}

// Every declaration in one file, in source order.
export const extractSymbols = (root: string, sourceFile: ts.SourceFile): readonly SymbolInfo[] =>
  walkDeclarations(sourceFile, toRepoRelative(root, sourceFile.fileName), sourceFile, {
    name: undefined,
    exported: false,
    inExportedStatement: false,
  })

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

const identifiersIn = (sourceFile: ts.SourceFile, node: ts.Node): readonly ts.Identifier[] =>
  ts.isIdentifier(node)
    ? [node]
    : node.getChildren(sourceFile).flatMap((child) => identifiersIn(sourceFile, child))

// The declaration an identifier resolves to, as a SymbolId. Aliases are followed
// so an imported or re-exported name lands on the original declaration.
const resolvedSymbolId = (
  root: string,
  checker: ts.TypeChecker,
  identifier: ts.Identifier,
): SymbolId | undefined => {
  const symbol = checker.getSymbolAtLocation(identifier)
  if (symbol === undefined) return undefined
  const target = (symbol.flags & ts.SymbolFlags.Alias) === 0 ? symbol : checker.getAliasedSymbol(symbol)
  const declaration = target.valueDeclaration ?? target.declarations?.[0]
  if (declaration === undefined) return undefined
  const nameNode = ts.getNameOfDeclaration(declaration)
  if (nameNode === undefined) return undefined
  const declarationFile = declaration.getSourceFile()
  const start = nameNode.getStart(declarationFile)
  return `${toRepoRelative(root, declarationFile.fileName)}#${start}`
}

const referencesInFile = (
  root: string,
  checker: ts.TypeChecker,
  known: ReadonlySet<SymbolId>,
  sourceFile: ts.SourceFile,
): readonly SymbolReference[] => {
  const file = toRepoRelative(root, sourceFile.fileName)
  return identifiersIn(sourceFile, sourceFile).flatMap((identifier) => {
    const symbolId = resolvedSymbolId(root, checker, identifier)
    if (symbolId === undefined || !known.has(symbolId)) return []
    const span = spanOf(sourceFile, identifier)
    return [
      {
        symbolId,
        file,
        span,
        line: lineOf(sourceFile, span.start),
        isDefinition: symbolId === `${file}#${span.start}`,
      },
    ]
  })
}

// A path that survived toRepoRelative unchanged is still absolute, which means
// the file sits outside the repo — nothing there can be one of our symbols.
const isRepoRelative = (file: string): boolean => !file.startsWith('/') && !/^[A-Za-z]:/.test(file)

const isIndexedFile = (root: string, sourceFile: ts.SourceFile): boolean => {
  const file = toRepoRelative(root, sourceFile.fileName)
  return !sourceFile.isDeclarationFile && !file.includes('node_modules') && isRepoRelative(file)
}

// Every identifier occurrence that resolves to one of `symbols`, definitions included.
export const collectReferences = (
  root: string,
  program: ts.Program,
  symbols: readonly SymbolInfo[],
): readonly SymbolReference[] => {
  const checker = program.getTypeChecker()
  const known = new Set(symbols.map((symbol) => symbol.id))
  return program
    .getSourceFiles()
    .filter((sourceFile) => isIndexedFile(root, sourceFile))
    .flatMap((sourceFile) => referencesInFile(root, checker, known, sourceFile))
}
