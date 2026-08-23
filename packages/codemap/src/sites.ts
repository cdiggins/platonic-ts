// One occurrence of a shape, found again in its own file.
//
// `clones.ts` reports occurrences as offsets and text, which is what a reader needs and not
// enough for a rewrite: replacing an expression means knowing its syntax tree, the scope it
// sits in, and where inside it each name is read. This module turns an occurrence back into
// those, and answers the one question that has to be asked before any rewrite — whether
// moving this expression somewhere else would change what it means.
import ts from 'typescript'
import type { ExpressionOccurrence } from './clones.ts'
import { fileScope, type FileScope } from './scope.ts'
import { expressionShape, type FreeReference } from './shapes.ts'
import type { SourceEntry } from './stats.ts'
import { childrenOf, subtreeNodes } from './walk.ts'

export type Site = {
  readonly occurrence: ExpressionOccurrence
  readonly entry: SourceEntry
  readonly scope: FileScope
  readonly node: ts.Node
  // Every read of a free name inside this occurrence, with its offsets.
  readonly references: readonly FreeReference[]
  // Free names in hole order: `names[h]` is what this occurrence puts in hole `h`.
  readonly names: readonly string[]
}

// The expression that spans exactly this range. Parenthesized nodes are skipped for the same
// reason `clones.ts` does not collect them: they share their range with what they wrap.
const nodeAt = (sourceFile: ts.SourceFile, start: number, end: number): ts.Node | undefined => {
  const search = (node: ts.Node): ts.Node | undefined => {
    if (node.getStart(sourceFile) > start || node.getEnd() < end) return undefined
    const matches =
      node.getStart(sourceFile) === start &&
      node.getEnd() === end &&
      ts.isExpression(node) &&
      !ts.isParenthesizedExpression(node)
    return matches
      ? node
      : childrenOf(node).reduce<ts.Node | undefined>(
          (found, child) => found ?? search(child),
          undefined,
        )
  }
  return search(sourceFile)
}

// Undefined when the occurrence's file is not among `entries`, or when its range no longer
// holds an expression — both of which mean the sources moved since the group was found.
export const siteOf = (
  occurrence: ExpressionOccurrence,
  entries: readonly SourceEntry[],
): Site | undefined => {
  const entry = entries.find((candidate) => candidate.file === occurrence.file)
  if (entry === undefined) return undefined
  const node = nodeAt(entry.sourceFile, occurrence.start, occurrence.end)
  if (node === undefined) return undefined
  const shape = expressionShape(node)
  return {
    occurrence,
    entry,
    scope: fileScope(entry.file, entry.sourceFile),
    node,
    references: shape.references,
    names: shape.parameters,
  }
}

// ---------------------------------------------------------------------------
// Safety.
// ---------------------------------------------------------------------------

const isAssignment = (kind: ts.SyntaxKind): boolean =>
  kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment

// Assigning to a free name writes to a binding the extracted function would only receive a
// copy of. Assigning to a property of one (`total.count = 1`) is not this case: the object
// travels by reference and the write lands where it always did.
const assignsToFreeName = (node: ts.Node, names: readonly string[]): boolean =>
  subtreeNodes(node).some((inner) => {
    if (ts.isBinaryExpression(inner))
      return (
        isAssignment(inner.operatorToken.kind) &&
        ts.isIdentifier(inner.left) &&
        names.includes(inner.left.text)
      )
    const target =
      ts.isPrefixUnaryExpression(inner) || ts.isPostfixUnaryExpression(inner)
        ? inner.operand
        : undefined
    return target !== undefined && ts.isIdentifier(target) && names.includes(target.text)
  })

// `await` in the expression itself makes the extracted function async. `await` inside a
// function the expression contains belongs to that function and changes nothing here.
export const awaitsDirectly = (node: ts.Node): boolean => {
  const walk = (current: ts.Node): boolean =>
    ts.isAwaitExpression(current) ||
    childrenOf(current).some((child) => (ts.isFunctionLike(child) ? false : walk(child)))
  return ts.isFunctionLike(node) ? false : walk(node)
}

// An expression whose value is a function can be shared as a single declaration. Anything
// else has to keep being evaluated at each site, because a `Date`, a `filter`, or a read of
// a mutable object gives a different answer at module load than it does in place.
export const isFunctionValued = (node: ts.Node): boolean =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node)

const entityRoot = (name: ts.EntityName): ts.Identifier =>
  ts.isIdentifier(name) ? name : entityRoot(name.left)

// Type names the expression mentions. They travel with its text, so they have to resolve
// wherever the declaration lands, and nothing else in this package tracks them: a type name
// is never a hole, because renaming one changes what the code means.
export const typeNames = (node: ts.Node): readonly string[] => [
  ...new Set(
    subtreeNodes(node).flatMap((inner) => {
      if (ts.isTypeReferenceNode(inner)) return [entityRoot(inner.typeName).text]
      return ts.isTypeQueryNode(inner) ? [entityRoot(inner.exprName).text] : []
    }),
  ),
]

// Reasons moving this expression would change what it means. Empty is the good case.
export const unsafeReasons = (site: Site): readonly string[] => {
  const nodes = subtreeNodes(site.node)
  const uses = (kind: ts.SyntaxKind): boolean => nodes.some((node) => node.kind === kind)
  return [
    ...(uses(ts.SyntaxKind.ThisKeyword) ? ['reads `this`'] : []),
    ...(uses(ts.SyntaxKind.SuperKeyword) ? ['reads `super`'] : []),
    ...(nodes.some(ts.isYieldExpression) ? ['yields'] : []),
    ...(site.names.includes('arguments') ? ['reads `arguments`'] : []),
    ...(assignsToFreeName(site.node, site.names)
      ? ['assigns to a name it does not declare']
      : []),
  ]
}
