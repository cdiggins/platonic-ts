import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import {
  emptyMetrics,
  sumMetrics,
  scoreMetrics,
  fileMetrics,
  functionMetrics,
  folderMetrics,
} from '../src/metrics.ts'
import type { CodeMetrics, FileEntry } from '../../core/src/index.ts'

const parse = (name: string, text: string): ts.SourceFile =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true)

const metricsOf = (name: string, text: string): CodeMetrics =>
  fileMetrics(parse(name, text), text)

const entry = (file: string, metrics: CodeMetrics | undefined): FileEntry => ({
  file,
  kind: 'typescript',
  sizeBytes: 0,
  metrics,
  functions: [],
})

describe('fileMetrics', () => {
  it('counts lines, statements, imports, and exported symbols', () => {
    const source = [
      "import ts from 'typescript'",
      "import { a, b } from './x.ts'",
      'export const one = 1',
      'export const two = 2, three = 3',
      'export type Four = string',
      'const hidden = 4',
      'export { hidden }',
    ].join('\n')
    const metrics = metricsOf('m.ts', source)
    expect(metrics.lines).toBe(7)
    expect(metrics.imports).toBe(2)
    expect(metrics.exportedSymbols).toBe(5)
    expect(metrics.statements).toBe(7)
  })

  it('counts let and var as mutable bindings but not const', () => {
    const source = ['const a = 1', 'let b = 2, c = 3', 'var d = 4', 'for (const x of []) { void x }'].join('\n')
    expect(metricsOf('m.ts', source).mutableBindings).toBe(3)
  })

  it('counts class declarations and class expressions', () => {
    const source = ['class A {}', 'const B = class {}', 'export class C {}'].join('\n')
    expect(metricsOf('m.ts', source).classes).toBe(3)
  })

  it('counts throw statements', () => {
    const source = [
      'const f = (x: number) => {',
      "  if (x < 0) throw new Error('negative')",
      "  throw new Error('always')",
      '}',
    ].join('\n')
    expect(metricsOf('m.ts', source).throwStatements).toBe(2)
  })

  it('takes explicit any and as-casts from the shared escape-hatch counter', () => {
    const source = ['const a: any = 1', 'const b = a as string', 'const c = 1 as const', 'const d = a!'].join('\n')
    const metrics = metricsOf('m.ts', source)
    expect(metrics.explicitAny).toBe(1)
    // `as const` is not an escape hatch, so only the `as string` counts.
    expect(metrics.asCasts).toBe(1)
    expect(metrics.nonNullAssertions).toBe(1)
  })

  it('counts ts-directive and eslint-disable comments', () => {
    const source = ['// @ts-expect-error', '// eslint-disable-next-line no-console', 'const a = 1'].join('\n')
    const metrics = metricsOf('m.ts', source)
    expect(metrics.tsDirectives).toBe(1)
    expect(metrics.eslintDisables).toBe(1)
  })

  it('counts parameters across every function in the file', () => {
    const source = ['const f = (a: number, b: number) => a + b', 'function g(c: string) { return c }'].join('\n')
    expect(metricsOf('m.ts', source).parameters).toBe(3)
  })

  it('measures nesting depth in braces, deepest wins', () => {
    const flat = 'export const f = (a: number) => a + 1'
    const nested = [
      'const f = (a: number) => {',
      '  if (a > 0) {',
      '    while (a > 1) {',
      '      a = a - 1',
      '    }',
      '  }',
      '  return a',
      '}',
    ].join('\n')
    expect(metricsOf('m.ts', flat).maxNestingDepth).toBe(0)
    expect(metricsOf('m.ts', nested).maxNestingDepth).toBe(3)
  })
})

describe('scoreMetrics', () => {
  it('gives a clean, empty unit a perfect score', () => {
    expect(scoreMetrics(emptyMetrics)).toBe(100)
  })

  it('is clamped to 0..100 and rounded to an integer', () => {
    const filthy: CodeMetrics = {
      ...emptyMetrics,
      lines: 40,
      explicitAny: 50,
      classes: 20,
      maxNestingDepth: 12,
      platonicScore: 100,
    }
    expect(scoreMetrics(filthy)).toBe(0)
    expect(Number.isInteger(scoreMetrics(emptyMetrics))).toBe(true)
  })

  it('scores a file with escape hatches strictly lower than the same file without', () => {
    const clean = ['export const parse = (text: string): number => Number(text)'].join('\n')
    const dirty = [
      'export const parse = (text: any): number => Number(text) as number',
      '// @ts-ignore',
      'const x = 1',
    ].join('\n')
    expect(metricsOf('dirty.ts', dirty).platonicScore).toBeLessThan(
      metricsOf('clean.ts', clean).platonicScore,
    )
  })

  it('penalises classes, throws, and mutable bindings', () => {
    const base: CodeMetrics = { ...emptyMetrics, lines: 100 }
    expect(scoreMetrics({ ...base, classes: 1 })).toBeLessThan(scoreMetrics(base))
    expect(scoreMetrics({ ...base, throwStatements: 1 })).toBeLessThan(scoreMetrics(base))
    expect(scoreMetrics({ ...base, mutableBindings: 1 })).toBeLessThan(scoreMetrics(base))
  })

  it('penalises files over 300 lines and modules exporting more than 15 symbols', () => {
    const base: CodeMetrics = { ...emptyMetrics, lines: 300, exportedSymbols: 15 }
    expect(scoreMetrics(base)).toBe(100)
    expect(scoreMetrics({ ...base, lines: 900 })).toBeLessThan(100)
    expect(scoreMetrics({ ...base, exportedSymbols: 40 })).toBeLessThan(100)
  })

  it('normalises count penalties by size, so a big clean file beats a small dirty one', () => {
    const big: CodeMetrics = { ...emptyMetrics, lines: 250, statements: 40 }
    const small: CodeMetrics = { ...emptyMetrics, lines: 20, statements: 6, asCasts: 3, mutableBindings: 2 }
    expect(scoreMetrics(big)).toBeGreaterThan(scoreMetrics(small))
  })

  it('penalises a high statements-to-lines ratio', () => {
    const sparse: CodeMetrics = { ...emptyMetrics, lines: 200, statements: 20 }
    const dense: CodeMetrics = { ...emptyMetrics, lines: 200, statements: 160 }
    expect(scoreMetrics(dense)).toBeLessThan(scoreMetrics(sparse))
  })
})

describe('sumMetrics', () => {
  it('sums components and takes the deepest nesting', () => {
    const a: CodeMetrics = {
      ...emptyMetrics,
      lines: 10,
      statements: 4,
      maxNestingDepth: 2,
      parameters: 3,
      mutableBindings: 1,
      classes: 1,
      throwStatements: 1,
      explicitAny: 1,
      asCasts: 2,
      nonNullAssertions: 1,
      tsDirectives: 1,
      eslintDisables: 1,
      exportedSymbols: 2,
      imports: 3,
    }
    const b: CodeMetrics = { ...a, maxNestingDepth: 5 }
    const total = sumMetrics([a, b])
    expect(total.lines).toBe(20)
    expect(total.statements).toBe(8)
    expect(total.parameters).toBe(6)
    expect(total.mutableBindings).toBe(2)
    expect(total.classes).toBe(2)
    expect(total.throwStatements).toBe(2)
    expect(total.explicitAny).toBe(2)
    expect(total.asCasts).toBe(4)
    expect(total.nonNullAssertions).toBe(2)
    expect(total.tsDirectives).toBe(2)
    expect(total.eslintDisables).toBe(2)
    expect(total.exportedSymbols).toBe(4)
    expect(total.imports).toBe(6)
    // A maximum, not a sum: summed depths would be uninterpretable.
    expect(total.maxNestingDepth).toBe(5)
  })

  it('recomputes the score from the summed counts instead of averaging inputs', () => {
    const dirty: CodeMetrics = { ...emptyMetrics, lines: 100, asCasts: 4, platonicScore: 100 }
    const total = sumMetrics([dirty, dirty])
    expect(total.platonicScore).toBe(scoreMetrics({ ...total, platonicScore: 100 }))
    expect(total.platonicScore).toBeLessThan(100)
  })

  it('sums nothing to the empty metrics', () => {
    expect(sumMetrics([])).toEqual(emptyMetrics)
  })
})

describe('functionMetrics', () => {
  const root = 'C:/repo'
  const source = [
    'export function declared(a: number): number {',
    '  return a + 1',
    '}',
    'export const arrow = (b: any) => b as string',
    'const holder = {',
    '  method(c: number) { return c },',
    '}',
    'export const notAFunction = 1',
    'void holder',
  ].join('\n')

  it('reports one entry per named function-like declaration', () => {
    const entries = functionMetrics(root, parse(`${root}/packages/x/src/y.ts`, source))
    expect(entries.map((f) => f.name)).toEqual(['declared', 'arrow', 'method'])
  })

  it('builds the symbol id from the repo-relative file and the name span start', () => {
    const file = `${root}/packages/x/src/y.ts`
    const sourceFile = parse(file, source)
    const entries = functionMetrics(root, sourceFile)
    const declared = entries[0]
    expect(declared?.symbolId).toBe(`packages/x/src/y.ts#${source.indexOf('declared')}`)
    expect(declared?.line).toBe(1)
  })

  it('scopes counts to the function subtree, including escape hatches', () => {
    const entries = functionMetrics(root, parse(`${root}/packages/x/src/y.ts`, source))
    const declared = entries.find((f) => f.name === 'declared')
    const arrow = entries.find((f) => f.name === 'arrow')
    expect(declared?.metrics.explicitAny).toBe(0)
    expect(declared?.metrics.asCasts).toBe(0)
    expect(declared?.metrics.lines).toBe(3)
    expect(arrow?.metrics.explicitAny).toBe(1)
    expect(arrow?.metrics.asCasts).toBe(1)
    expect(arrow?.metrics.lines).toBe(1)
    expect(arrow?.metrics.parameters).toBe(1)
    // Export surface belongs to the module, not to a function body.
    expect(arrow?.metrics.exportedSymbols).toBe(0)
  })

  it('returns no entries for a file without functions', () => {
    expect(functionMetrics(root, parse(`${root}/a.ts`, 'export const x = 1'))).toEqual([])
  })
})

describe('folderMetrics', () => {
  const files: readonly FileEntry[] = [
    entry('packages/core/src/index.ts', { ...emptyMetrics, lines: 200, asCasts: 1 }),
    entry('packages/check/src/run.ts', { ...emptyMetrics, lines: 100 }),
    entry('packages/check/test/run.test.ts', undefined),
    entry('README.md', undefined),
  ]

  it('emits the repo root and every ancestor folder', () => {
    expect(folderMetrics(files).map((f) => f.path)).toEqual([
      '',
      'packages',
      'packages/check',
      'packages/check/src',
      'packages/check/test',
      'packages/core',
      'packages/core/src',
    ])
  })

  it('counts every file at or below the folder', () => {
    const byPath = new Map(folderMetrics(files).map((f) => [f.path, f]))
    expect(byPath.get('')?.fileCount).toBe(4)
    expect(byPath.get('packages')?.fileCount).toBe(3)
    expect(byPath.get('packages/check')?.fileCount).toBe(2)
    expect(byPath.get('packages/core/src')?.fileCount).toBe(1)
  })

  it('sums the metrics of the files below it, skipping files with none', () => {
    const byPath = new Map(folderMetrics(files).map((f) => [f.path, f]))
    expect(byPath.get('')?.metrics.lines).toBe(300)
    expect(byPath.get('')?.metrics.asCasts).toBe(1)
    expect(byPath.get('packages/check')?.metrics).toEqual({ ...emptyMetrics, lines: 100 })
  })

  it('returns nothing for an empty file list', () => {
    expect(folderMetrics([])).toEqual([])
  })
})

describe('the score over this repository', () => {
  it('ranks a clean type-heavy module above one carrying escape hatches', () => {
    const clean = [
      'export type Point = { readonly x: number; readonly y: number }',
      'export const move = (point: Point, dx: number): Point => ({ ...point, x: point.x + dx })',
    ].join('\n')
    const messy = [
      'export class Mover {',
      '  move(point: any) {',
      '    let next = point as { x: number }',
      '    if (next.x < 0) {',
      "      throw new Error('bad')",
      '    }',
      '    return next!',
      '  }',
      '}',
    ].join('\n')
    const cleanScore = metricsOf('clean.ts', clean).platonicScore
    const messyScore = metricsOf('messy.ts', messy).platonicScore
    expect(cleanScore).toBe(100)
    expect(messyScore).toBe(0)
  })
})
