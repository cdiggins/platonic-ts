// Walking the TypeScript AST. Every other module in this package that needs to see nodes
// rather than types goes through here, so there is one definition of "the children of a
// node" and one definition of "the subtree under a node".
import ts from 'typescript'

// forEachChild is the only child enumeration the compiler exposes; the array is rebuilt
// rather than mutated (PS-004).
export const childrenOf = (node: ts.Node): readonly ts.Node[] => {
  let collected: readonly ts.Node[] = []
  node.forEachChild((child) => {
    collected = [...collected, child]
  })
  return collected
}

export const subtreeNodes = (node: ts.Node): readonly ts.Node[] => [
  node,
  ...childrenOf(node).flatMap(subtreeNodes),
]

// A node together with the number of nodes in its own subtree, itself included.
export type SizedNode = {
  readonly node: ts.Node
  readonly size: number
}

type SizedSubtree = {
  readonly size: number
  readonly all: readonly SizedNode[]
}

// Sizes are accumulated bottom-up on the way back out of the recursion. Calling
// `subtreeNodes(node).length` at every node instead would re-walk each subtree once per
// ancestor, which on a file of any size is the difference between one pass and thousands.
const sizedSubtree = (node: ts.Node): SizedSubtree => {
  const children = childrenOf(node).map(sizedSubtree)
  const size = children.reduce((sum, child) => sum + child.size, 1)
  return { size, all: [{ node, size }, ...children.flatMap((child) => child.all)] }
}

export const sizedNodes = (node: ts.Node): readonly SizedNode[] => sizedSubtree(node).all
