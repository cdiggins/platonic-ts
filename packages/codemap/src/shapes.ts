// The shape of an expression: what is left of it once every name has been replaced by a
// position. Two expressions have the same shape when one can be turned into the other by
// renaming, which is the precondition for replacing both with one call to one function.
//
// The normal form is a fully parenthesized prefix serialization of the syntax tree, and the
// serialization is the comparison key: same string, same shape. Nothing here compares trees
// to each other, so callers can group thousands of expressions by sorting strings.
//
// Names are erased in two different ways, because they play two different roles.
//
//   * A name the expression binds itself — an arrow parameter, a `const` in a block body,
//     a destructured element — becomes its de Bruijn index: the number of enclosing binders
//     between the use and the binder that introduced it. `(a) => (b) => a` and
//     `(x) => (y) => x` therefore agree, and both differ from `(a) => (b) => b`.
//   * A name the expression only uses — a free variable — becomes its position in the order
//     the free names are first seen. This is what makes `total(a, a)` differ from
//     `total(a, b)`: two occurrences of one variable are not the same shape as two
//     variables, and extracting the second into a function needs one more parameter than
//     extracting the first.
//
// The free names, in that same order, are returned alongside the key. They are the argument
// list an "extract this expression into a function" step would pass, which is why this
// module reports them rather than just counting them.
//
// Free means free of this expression, not free of the program: an import, a module-level
// helper, and a global all count, because nothing inside the expression binds them. That is
// the right answer for matching — `Array.isArray(v)` and `Array.isArray(value)` are the same
// shape only if `v` and `value` are holes — and it is one step short of the answer an
// extraction needs, which must first drop the names that are already in scope where the new
// function would be defined. Deciding that needs the enclosing module, which this module
// does not see.
//
// Names that are not variables are kept verbatim: property names (`point.x`), object keys,
// and the text of type annotations. Renaming those changes what the code does, so two
// expressions that differ there are not candidates for sharing one function. Abstracting
// them too would be a different question ("which expressions differ only in the field they
// read?"), and would want its own hole namespace rather than reusing this one.
import ts from 'typescript'
import { childrenOf } from './walk.ts'

// What a numeric or string literal contributes to the key. `keep` distinguishes `at(0)`
// from `at(1)`; `abstract` collapses them, at the cost of no longer tracking which
// constants would have to become parameters.
export type LiteralMode = 'keep' | 'abstract'

export type ShapeOptions = {
  readonly literals: LiteralMode
}

export const defaultShapeOptions: ShapeOptions = { literals: 'keep' }

// One place a free name is read, and the hole it filled. Positions are absolute offsets in
// the file the node came from, so a rewrite can splice over them.
export type FreeReference = {
  readonly name: string
  // Index into `Shape.parameters`; repeated reads of one name share a hole.
  readonly hole: number
  readonly start: number
  readonly end: number
  // A shorthand property (`{ total }`) reads the name and names the field. Replacing the
  // read has to keep the field, as `{ total: renamed }`.
  readonly shorthand: boolean
}

export type Shape = {
  // Equal keys mean equal shapes. The string itself is an implementation detail: it is
  // stable within one run and readable when printed, but nothing should parse it.
  readonly key: string
  // Free names in first-use order. Index `n` in the key's `f<n>` holes is this name.
  readonly parameters: readonly string[]
  // Every read of every free name, in source order. What a rewrite replaces.
  readonly references: readonly FreeReference[]
}

// ---------------------------------------------------------------------------
// Encoding state.
// ---------------------------------------------------------------------------

// Names bound by enclosing binders, innermost first, so a lookup finds the shadowing
// binder before the shadowed one.
type Scope = readonly string[]

type Context = {
  readonly scope: Scope
  readonly options: ShapeOptions
  // Only for turning a node into an offset; the walk never reads the file's text.
  readonly sourceFile: ts.SourceFile
}

// Free names discovered so far are threaded left-to-right through the walk instead of being
// accumulated in a mutable set, so the numbering is a function of the tree alone.
type State = {
  readonly free: readonly string[]
  readonly sites: readonly FreeReference[]
}

type Encoding = State & { readonly text: string }

const kindName = (node: ts.Node): string => ts.SyntaxKind[node.kind] ?? String(node.kind)

const encodeName = (
  node: ts.Node,
  name: string,
  shorthand: boolean,
  context: Context,
  state: State,
): Encoding => {
  const bound = context.scope.indexOf(name)
  if (bound >= 0) return { ...state, text: `b${bound}` }
  const seen = state.free.indexOf(name)
  const hole = seen >= 0 ? seen : state.free.length
  const site: FreeReference = {
    name,
    hole,
    shorthand,
    start: node.getStart(context.sourceFile),
    end: node.getEnd(),
  }
  return {
    text: `f${hole}`,
    free: seen >= 0 ? state.free : [...state.free, name],
    sites: [...state.sites, site],
  }
}

// ---------------------------------------------------------------------------
// Binders.
// ---------------------------------------------------------------------------

const bindingNames = (name: ts.BindingName): readonly string[] =>
  ts.isIdentifier(name)
    ? [name.text]
    : name.elements.flatMap((element) =>
        ts.isBindingElement(element) ? bindingNames(element.name) : [],
      )

const declaredNames = (list: ts.VariableDeclarationList): readonly string[] =>
  list.declarations.flatMap((declaration) => bindingNames(declaration.name))

// Names a node introduces for the whole of its own subtree, its own declaration site
// included: `const total = ...` encodes `total` as the binder it is rather than as another
// free name. Declaration, loop, and catch bindings therefore cover the whole statement
// rather than only what follows them, which is one position off for the pathological
// `const x = x` and right everywhere else.
const boundBy = (node: ts.Node): readonly string[] => {
  if (ts.isFunctionLike(node))
    return node.parameters.flatMap((parameter) => bindingNames(parameter.name))
  if (ts.isVariableStatement(node)) return declaredNames(node.declarationList)
  if (ts.isCatchClause(node))
    return node.variableDeclaration === undefined ? [] : bindingNames(node.variableDeclaration.name)
  if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node))
    return node.initializer !== undefined && ts.isVariableDeclarationList(node.initializer)
      ? declaredNames(node.initializer)
      : []
  return []
}

// Statements inside a block bind in order: an initializer is encoded before the name it
// declares is in scope. Function and class declarations are hoisted instead, because a
// statement above them may call them.
const hoistedNames = (statements: readonly ts.Statement[]): readonly string[] =>
  statements.flatMap((statement) =>
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
    statement.name !== undefined
      ? [statement.name.text]
      : [],
  )

const statementNames = (statement: ts.Statement): readonly string[] =>
  ts.isVariableStatement(statement) ? declaredNames(statement.declarationList) : []

// ---------------------------------------------------------------------------
// The walk.
// ---------------------------------------------------------------------------

const literalText = (node: ts.LiteralExpression, options: ShapeOptions): string =>
  options.literals === 'abstract' ? kindName(node) : `${kindName(node)}:${JSON.stringify(node.text)}`

// A type annotation is encoded with its names left in place. Abstracting them as if they
// were variables would make `count as Meters` and `count as Seconds` the same shape, and
// would count `Meters` as a parameter of the extracted function.
const verbatim = (node: ts.Node): string => {
  if (ts.isIdentifier(node)) return `.${node.text}`
  if (ts.isLiteralExpression(node)) return `${kindName(node)}:${JSON.stringify(node.text)}`
  const children = childrenOf(node).map(verbatim)
  return children.length === 0 ? kindName(node) : `(${kindName(node)} ${children.join(' ')})`
}

type Sequence = State & { readonly texts: readonly string[] }

const encodeChildren = (nodes: readonly ts.Node[], context: Context, state: State): Sequence =>
  nodes.reduce<Sequence>(
    (current, node) => {
      const encoded = encodeNode(node, context, current)
      return { ...encoded, texts: [...current.texts, encoded.text] }
    },
    { ...state, texts: [] },
  )

type BlockState = Sequence & { readonly scope: Scope }

const encodeBlock = (node: ts.Block, context: Context, state: State): Encoding => {
  const encoded = node.statements.reduce<BlockState>(
    (current, statement) => {
      const next = encodeNode(statement, { ...context, scope: current.scope }, current)
      return {
        ...next,
        texts: [...current.texts, next.text],
        scope: [...statementNames(statement), ...current.scope],
      }
    },
    { ...state, texts: [], scope: [...hoistedNames(node.statements), ...context.scope] },
  )
  return { ...encoded, text: `(Block ${encoded.texts.join(' ')})` }
}

const encodeNode = (node: ts.Node, context: Context, state: State): Encoding => {
  // Parentheses carry no information the tree does not already carry, so `(a + b) * c` and
  // its unparenthesized spelling of the same tree agree.
  if (ts.isParenthesizedExpression(node)) return encodeNode(node.expression, context, state)
  if (ts.isTypeNode(node)) return { ...state, text: `type${verbatim(node)}` }
  if (ts.isIdentifier(node)) return encodeName(node, node.text, false, context, state)
  if (ts.isPrivateIdentifier(node)) return { ...state, text: `.${node.text}` }
  if (ts.isLiteralExpression(node))
    return { ...state, text: literalText(node, context.options) }
  if (ts.isPropertyAccessExpression(node)) {
    const target = encodeNode(node.expression, context, state)
    const optional = node.questionDotToken === undefined ? '' : '?'
    return { ...target, text: `(Access${optional} ${target.text} .${node.name.text})` }
  }
  // `{ total }` reads the variable `total` and names the field `total`; the key records both,
  // since renaming the variable is free and renaming the field is not.
  if (ts.isShorthandPropertyAssignment(node)) {
    const value = encodeName(node.name, node.name.text, true, context, state)
    return { ...value, text: `(Shorthand .${node.name.text} ${value.text})` }
  }
  if (ts.isPropertyAssignment(node) && !ts.isComputedPropertyName(node.name)) {
    const value = encodeNode(node.initializer, context, state)
    return { ...value, text: `(Property .${node.name.text} ${value.text})` }
  }
  if (ts.isBlock(node)) return encodeBlock(node, context, state)
  const bound = boundBy(node)
  const inner = bound.length === 0 ? context : { ...context, scope: [...bound, ...context.scope] }
  const children = encodeChildren(childrenOf(node), inner, state)
  return {
    ...children,
    text:
      children.texts.length === 0
        ? kindName(node)
        : `(${kindName(node)} ${children.texts.join(' ')})`,
  }
}

// ---------------------------------------------------------------------------
// The one function everything else here exists for.
// ---------------------------------------------------------------------------

// The shape of `node` and the free names it would take as parameters. Any node is accepted,
// not only expressions: the same normal form describes a statement or a whole function body,
// which is what a later "extract these statements" step would need.
export const expressionShape = (
  node: ts.Node,
  options: ShapeOptions = defaultShapeOptions,
): Shape => {
  const context: Context = { scope: [], options, sourceFile: node.getSourceFile() }
  const encoded = encodeNode(node, context, { free: [], sites: [] })
  return { key: encoded.text, parameters: encoded.free, references: encoded.sites }
}

// The names a node introduces for its own subtree: parameters, declarations, loop and catch
// variables. Exported because deciding what an extracted expression must be passed means
// asking the same question of every scope between it and the top of its file.
export const boundNames = (node: ts.Node): readonly string[] => boundBy(node)

// True when two nodes differ only by the names of their free and bound variables.
export const sameShape = (
  left: ts.Node,
  right: ts.Node,
  options: ShapeOptions = defaultShapeOptions,
): boolean => expressionShape(left, options).key === expressionShape(right, options).key
