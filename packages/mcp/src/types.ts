// What the checker knows, printed for a reader. An outline shows what a file
// declares; these two answer what a declaration *is* — the inferred type, the
// call signatures behind it, and the whole member surface including the parts
// that arrive by extension. Nothing here truncates: a type printed as `...` is
// the one case where the answer is worse than no answer.
import ts from 'typescript'
import type { Compiler } from './compiler.ts'
import { explainLookup, type ToolOutput } from './query.ts'
import { ancestorsAtPosition, resolveSymbol } from './workspace.ts'

const MEMBER_LIMIT = 60

const FORMAT = ts.TypeFormatFlags.NoTruncation

const DECLARES_TYPE = ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class

const failed = (text: string): ToolOutput => ({ ok: false, text })

// The index records a declaration by the span of its name, so the same offset
// in the bound copy of the file lands on the identifier the checker knows.
const nameNodeAt = (sourceFile: ts.SourceFile, position: number): ts.Node | undefined => {
  const chain = ancestorsAtPosition(sourceFile, sourceFile, position)
  const identifiers = chain.filter(
    (node) => ts.isIdentifier(node) && node.getStart(sourceFile) === position,
  )
  const innermost = chain[chain.length - 1]
  return identifiers[identifiers.length - 1] ?? (innermost === sourceFile ? undefined : innermost)
}

type NodeLookup =
  | { readonly ok: true; readonly node: ts.Node; readonly header: string; readonly name: string }
  | { readonly ok: false; readonly output: ToolOutput }

const locate = (compiler: Compiler, name: string, file: string | undefined): NodeLookup => {
  const lookup = resolveSymbol(compiler.workspace, name, file)
  if (!lookup.ok) return { ok: false, output: explainLookup(name, lookup) }
  const where = `${lookup.symbol.file}:${lookup.symbol.line}`
  const bound = compiler.boundSourceFile(lookup.symbol.file)
  if (bound === undefined)
    return { ok: false, output: failed(`${lookup.symbol.file} is not in the compiler's program.`) }
  const node = nameNodeAt(bound, lookup.symbol.span.start)
  return node === undefined
    ? { ok: false, output: failed(`${name} is indexed at ${where} but not present in the bound file.`) }
    : { ok: true, node, header: `${where} ${name}`, name }
}

// `any` and the checker's error type share a flag and both print as "any", so
// neither can be reported as a real answer.
const unresolved = (type: ts.Type): boolean => (type.flags & ts.TypeFlags.Any) !== 0

const refuseUnresolved = (header: string, name: string): ToolOutput =>
  failed(`${header}\n${name} resolves to any — an error type or missing type information, not an answer.`)

const signatureLines = (
  compiler: Compiler,
  node: ts.Node,
  type: ts.Type,
  kind: ts.SignatureKind,
  label: string,
): readonly string[] =>
  compiler.checker
    .getSignaturesOfType(type, kind)
    .map((signature) => `${label} ${compiler.checker.signatureToString(signature, node, FORMAT, kind)}`)

const indexLines = (compiler: Compiler, node: ts.Node, type: ts.Type): readonly string[] =>
  compiler.checker
    .getIndexInfosOfType(type)
    .map(
      (info) =>
        `index ${info.isReadonly ? 'readonly ' : ''}[key: ${compiler.checker.typeToString(info.keyType, node, FORMAT)}]: ${compiler.checker.typeToString(info.type, node, FORMAT)}`,
    )

// Asked about `Point`, the printer answers "Point" unless it is told it is
// printing the alias's own definition, which is the one answer that carries no
// information.
const formatFor = (node: ts.Node): ts.TypeFormatFlags =>
  ts.isTypeAliasDeclaration(node.parent) ? FORMAT | ts.TypeFormatFlags.InTypeAlias : FORMAT

export const typeOf = (compiler: Compiler, name: string, file: string | undefined): ToolOutput => {
  const located = locate(compiler, name, file)
  if (!located.ok) return located.output
  const type = compiler.checker.getTypeAtLocation(located.node)
  if (unresolved(type)) return refuseUnresolved(located.header, name)
  return {
    ok: true,
    text: [
      located.header,
      `type ${compiler.checker.typeToString(type, located.node, formatFor(located.node))}`,
    ]
      .concat(signatureLines(compiler, located.node, type, ts.SignatureKind.Call, 'call'))
      .concat(signatureLines(compiler, located.node, type, ts.SignatureKind.Construct, 'new'))
      .join('\n'),
  }
}

// The nearest enclosing declaration that has a name is the type a member was
// written on, which is what makes an inherited member attributable.
const ownerNameOf = (node: ts.Node | undefined): string | undefined => {
  if (node === undefined) return undefined
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return node.name.text
  if (ts.isClassDeclaration(node)) return node.name?.text
  return ownerNameOf(node.parent)
}

const hasSurface = (compiler: Compiler, type: ts.Type): boolean =>
  compiler.checker.getPropertiesOfType(type).length > 0 ||
  compiler.checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0 ||
  compiler.checker.getIndexInfosOfType(type).length > 0

// A name can carry both a type and a value (an enum, a class, a merged
// declaration). The side with members is the one a caller asked about.
const surfaceType = (compiler: Compiler, symbol: ts.Symbol, node: ts.Node): ts.Type => {
  const declared =
    (symbol.flags & DECLARES_TYPE) === 0
      ? undefined
      : compiler.checker.getDeclaredTypeOfSymbol(symbol)
  if (declared !== undefined && hasSurface(compiler, declared)) return declared
  const value =
    (symbol.flags & ts.SymbolFlags.Value) === 0
      ? undefined
      : compiler.checker.getTypeOfSymbolAtLocation(symbol, node)
  if (value !== undefined && hasSurface(compiler, value)) return value
  return declared ?? value ?? compiler.checker.getTypeAtLocation(node)
}

type Member = {
  readonly own: boolean
  readonly name: string
  readonly text: string
}

const memberOf = (compiler: Compiler, node: ts.Node, owner: string, property: ts.Symbol): Member => {
  const declaration = property.declarations?.[0]
  const readonly =
    declaration !== undefined &&
    (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly) !== 0
  const optional = (property.flags & ts.SymbolFlags.Optional) !== 0
  const type = compiler.checker.typeToString(
    compiler.checker.getTypeOfSymbolAtLocation(property, node),
    node,
    FORMAT,
  )
  const from = ownerNameOf(declaration)
  const own = from === undefined || from === owner
  return {
    own,
    name: property.name,
    text: `${readonly ? 'readonly ' : ''}${property.name}${optional ? '?' : ''}: ${type}${own ? '' : ` (from ${from})`}`,
  }
}

const byOwnThenName = (left: Member, right: Member): number =>
  left.own === right.own ? (left.name < right.name ? -1 : 1) : left.own ? -1 : 1

export const membersOf = (compiler: Compiler, name: string, file: string | undefined): ToolOutput => {
  const located = locate(compiler, name, file)
  if (!located.ok) return located.output
  const symbol = compiler.checker.getSymbolAtLocation(located.node)
  if (symbol === undefined) return failed(`${located.header}\nthe checker has no symbol for ${name}.`)
  const type = surfaceType(compiler, symbol, located.node)
  if (unresolved(type)) return refuseUnresolved(located.header, name)
  // Members belong to the type being shown, not to the name it was reached by:
  // asked about a value, everything its own type declares is still own.
  const owner = type.aliasSymbol?.name ?? type.symbol?.name ?? name
  const members = compiler.checker
    .getPropertiesOfType(type)
    .map((property) => memberOf(compiler, located.node, owner, property))
    .sort(byOwnThenName)
  const inherited = members.filter((member) => !member.own).length
  const shown = members.slice(0, MEMBER_LIMIT)
  const more = members.length > shown.length ? [`… ${members.length - shown.length} more`] : []
  return {
    ok: true,
    text: [`${located.header} — ${members.length} members, ${inherited} inherited`]
      .concat(shown.map((member) => member.text))
      .concat(more)
      .concat(signatureLines(compiler, located.node, type, ts.SignatureKind.Call, 'call'))
      .concat(signatureLines(compiler, located.node, type, ts.SignatureKind.Construct, 'new'))
      .concat(indexLines(compiler, located.node, type))
      .join('\n'),
  }
}
