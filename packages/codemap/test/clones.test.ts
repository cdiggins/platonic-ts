import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import {
  defaultCloneOptions,
  repeatedExpressions,
  shapedExpressions,
  type CloneOptions,
} from '../src/clones.ts'
import type { SourceEntry } from '../src/stats.ts'

const parse = (file: string, text: string): SourceEntry => ({
  file,
  sourceFile: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true),
})

const options = (overrides: Partial<CloneOptions>): CloneOptions => ({
  ...defaultCloneOptions,
  ...overrides,
})

// The same 13-node expression twice, under different variable names.
const entries: readonly SourceEntry[] = [
  parse('packages/a/src/one.ts', 'const open = orders.filter((order) => order.active).length\n'),
  parse('packages/b/src/two.ts', 'const live = users.filter((user) => user.active).length\n'),
]

describe('repeatedExpressions', () => {
  it('groups expressions that differ only by name, and keeps their own names', () => {
    const groups = repeatedExpressions(entries)
    expect(groups).toHaveLength(1)
    const group = groups[0]
    expect(group?.occurrences.map((occurrence) => occurrence.file)).toEqual([
      'packages/a/src/one.ts',
      'packages/b/src/two.ts',
    ])
    expect(group?.occurrences.map((occurrence) => occurrence.parameters)).toEqual([
      ['orders'],
      ['users'],
    ])
    expect(group?.parameterCount).toBe(1)
    expect(group?.nodes).toBe(13)
    expect(group?.occurrences.map((occurrence) => occurrence.line)).toEqual([1, 1])
  })

  it('drops a group whose occurrences all sit inside a larger group', () => {
    const withSubsumed = repeatedExpressions(entries, options({ dropSubsumed: false }))
    // `orders.filter(...)` repeats too, inside the `.length` expression that already covers it.
    expect(withSubsumed.map((group) => group.nodes)).toEqual([13, 11])
    expect(repeatedExpressions(entries).map((group) => group.nodes)).toEqual([13])
  })

  it('reports nothing when the shapes differ', () => {
    const different: readonly SourceEntry[] = [
      parse('packages/a/src/one.ts', 'const open = orders.filter((order) => order.active).length\n'),
      parse('packages/b/src/two.ts', 'const live = users.map((user) => user.name).size\n'),
    ]
    expect(repeatedExpressions(different)).toEqual([])
  })

  it('ranks by the nodes an extraction would remove', () => {
    const groups = repeatedExpressions(entries)
    // Two 13-node copies become two 2-node calls plus one 13-node body.
    expect(groups[0]?.savedNodes).toBe(13 - 2 * 2)
  })
})

describe('shapedExpressions', () => {
  it('ignores expressions below the size floor', () => {
    expect(shapedExpressions(entries, options({ minNodes: 100 }))).toEqual([])
    expect(shapedExpressions(entries, options({ minNodes: 12 }))).toHaveLength(2)
    expect(shapedExpressions(entries, options({ minNodes: 11 }))).toHaveLength(4)
  })

  it('records where each expression was, so a caller can rewrite it', () => {
    const found = shapedExpressions(entries, options({ minNodes: 13 }))
    const first = found[0]
    expect(first?.occurrence.file).toBe('packages/a/src/one.ts')
    expect(first?.occurrence.text).toBe('orders.filter((order) => order.active).length')
    expect(first?.occurrence.start).toBe('const open = '.length)
  })
})
