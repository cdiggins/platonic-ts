import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import type { CodeMetrics, FileEntry, FunctionMetrics } from '../../core/src/index.ts'
import { emptyMetrics } from '../src/metrics.ts'
import {
  functionObservations,
  nodeObservations,
  sizeReport,
  zoneOf,
  type SourceEntry,
} from '../src/stats.ts'

const parse = (name: string, text: string): SourceEntry => ({
  file: name,
  sourceFile: ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true),
})

const fn = (name: string, metrics: Partial<CodeMetrics>): FunctionMetrics => ({
  symbolId: `${name}#0`,
  name,
  line: 1,
  metrics: { ...emptyMetrics, ...metrics },
})

const entry = (file: string, functions: readonly FunctionMetrics[]): FileEntry => ({
  file,
  kind: 'typescript',
  sizeBytes: 0,
  metrics: emptyMetrics,
  functions,
})

describe('zoneOf', () => {
  it('reads the style guide zones off the path', () => {
    expect(zoneOf('packages/codemap/src/stats.ts')).toBe('core')
    expect(zoneOf('packages/codemap/src/main.ts')).toBe('root')
    expect(zoneOf('packages/codeview/src/server.ts')).toBe('root')
    expect(zoneOf('packages/codeview/src/io.ts')).toBe('root')
    expect(zoneOf('packages/codemap/test/stats.test.ts')).toBe('test')
  })

  it('puts a test-directory composition root in the test zone', () => {
    expect(zoneOf('packages/mcp/test/io.ts')).toBe('test')
  })
})

describe('functionObservations', () => {
  it('splits one observation per function into the three size populations', () => {
    const files = [
      entry('packages/a/src/one.ts', [
        fn('first', { lines: 10, nodes: 50, parameters: 2 }),
        fn('second', { lines: 4, nodes: 20, parameters: 1 }),
      ]),
      entry('packages/a/test/one.test.ts', [fn('third', { lines: 6, nodes: 30, parameters: 0 })]),
    ]
    const observations = functionObservations(files)
    expect(observations.lines).toEqual([
      { zone: 'core', value: 10 },
      { zone: 'core', value: 4 },
      { zone: 'test', value: 6 },
    ])
    expect(observations.nodes.map((o) => o.value)).toEqual([50, 20, 30])
    expect(observations.arity.map((o) => o.value)).toEqual([2, 1, 0])
  })

  it('has nothing to say about a file with no functions', () => {
    expect(functionObservations([entry('packages/a/src/empty.ts', [])]).lines).toEqual([])
  })
})

describe('nodeObservations', () => {
  it('measures every statement in nodes and in lines', () => {
    const source = ['const one = 1', 'const two = [', '  1,', '  2,', ']'].join('\n')
    const observations = nodeObservations([parse('packages/a/src/x.ts', source)])
    expect(observations.statementNodes).toHaveLength(2)
    expect(observations.statementLines.map((o) => o.value)).toEqual([1, 4])
    expect(observations.statementNodes.every((o) => o.zone === 'core')).toBe(true)
  })

  it('counts statements nested inside a function body', () => {
    const source = ['const run = () => {', '  const inner = 1', '  return inner', '}'].join('\n')
    const observations = nodeObservations([parse('packages/a/src/x.ts', source)])
    // The outer variable statement and the two inside the body. The body block itself is
    // not a statement, so the statements it holds are not counted twice.
    expect(observations.statementNodes).toHaveLength(3)
  })

  it('ignores single-node expressions, which are names rather than values', () => {
    const observations = nodeObservations([parse('packages/a/src/x.ts', 'const x = 1')])
    expect(observations.expressionNodes).toEqual([])
  })

  it('measures a compound expression once, at its outermost node', () => {
    const observations = nodeObservations([
      parse('packages/a/src/x.ts', 'const total = items.filter(Boolean).length'),
    ])
    expect(observations.expressionNodes).toHaveLength(1)
    expect(observations.expressionNodes[0]?.value).toBeGreaterThan(3)
  })

  it('carries the zone of the file each node came from', () => {
    const observations = nodeObservations([
      parse('packages/a/src/x.ts', 'const a = one + two'),
      parse('packages/a/test/x.test.ts', 'const b = three + four'),
    ])
    expect(observations.expressionNodes.map((o) => o.zone)).toEqual(['core', 'test'])
  })
})

describe('sizeReport', () => {
  it('reports every population against every zone plus the pooled total', () => {
    const report = sizeReport(
      [entry('packages/a/src/x.ts', [fn('first', { lines: 3, nodes: 12, parameters: 1 })])],
      [parse('packages/a/src/x.ts', 'const first = (value) => value + 1')],
    )
    expect(report.fileCount).toBe(1)
    expect(report.populations.map((p) => p.population)).toEqual([
      'function-lines',
      'function-nodes',
      'function-arity',
      'statement-nodes',
      'statement-lines',
      'expression-nodes',
    ])
    expect(report.populations.every((p) => p.zones.map((z) => z.zone).join() === 'all,core,root,test')).toBe(true)
  })

  it('leaves a zone undescribed when nothing in it was measured', () => {
    const report = sizeReport(
      [entry('packages/a/src/x.ts', [fn('first', { lines: 3, nodes: 12, parameters: 1 })])],
      [parse('packages/a/src/x.ts', 'const first = 1')],
    )
    const lines = report.populations.find((p) => p.population === 'function-lines')
    expect(lines?.zones.find((z) => z.zone === 'core')?.summary?.count).toBe(1)
    expect(lines?.zones.find((z) => z.zone === 'test')?.summary).toBeUndefined()
    expect(lines?.zones.find((z) => z.zone === 'all')?.summary?.p50).toBe(3)
  })
})
