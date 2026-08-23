import { describe, it, expect } from 'vitest'
import { implementations, moduleGraph, unusedExports } from '../src/graph.ts'
import { workspaceOf } from './fixture.ts'

const shapes = workspaceOf({
  'shape.ts': ['export interface Shape {', '  size(): number', '}', ''].join('\n'),
  'base.ts': [
    'export class Base {',
    '  area(): number {',
    '    return 0',
    '  }',
    '}',
    '',
  ].join('\n'),
  'circle.ts': [
    "import { Base } from './base.ts'",
    "import type { Shape } from './shape.ts'",
    '',
    'export class Circle extends Base implements Shape {',
    '  area(): number {',
    '    return 3',
    '  }',
    '}',
    '',
    'export const measure = (shape: Shape): number => shape.area()',
    '',
  ].join('\n'),
})

describe('implementations', () => {
  it('finds a class that implements an interface', () => {
    const text = implementations(shapes, 'Shape', undefined).text
    expect(text).toContain('circle.ts:4 class Circle implements Shape')
  })

  it('ignores a mention in a type annotation', () => {
    const text = implementations(shapes, 'Shape', undefined).text
    expect(text).not.toContain('measure')
  })

  it('finds a class that extends a class', () => {
    const text = implementations(shapes, 'Base', undefined).text
    expect(text.split('\n')[0]).toBe('implementations of Base (base.ts:1) — 1 found')
    expect(text).toContain('circle.ts:4 class Circle extends Base')
  })

  it('finds a method that overrides another', () => {
    const text = implementations(shapes, 'area', 'base.ts').text
    expect(text).toContain('circle.ts:5 Circle.area overrides Base.area')
  })

  it('says plainly when nothing implements the symbol', () => {
    const text = implementations(shapes, 'measure', undefined).text
    expect(text).toBe(
      [
        'implementations of measure (circle.ts:10) — 0 found',
        'nothing extends, implements, or overrides measure',
      ].join('\n'),
    )
  })

  it('explains an unknown name', () => {
    const result = implementations(shapes, 'Missing', undefined)
    expect(result.ok).toBe(false)
    expect(result.text).toContain('no declaration named Missing')
  })
})

describe('moduleGraph', () => {
  it('lists resolved import edges and reports no cycle for a tree', () => {
    const workspace = workspaceOf({
      'pkg/a.ts': 'export const a = 1\n',
      'pkg/b.ts': "import { a } from './a.ts'\nexport const b = a + 1\n",
    })
    const text = moduleGraph(workspace, undefined).text
    expect(text.split('\n')[0]).toBe('repo — 2 files, 1 import edges; 0 cycles repo-wide')
    expect(text).toContain('pkg/b.ts -> pkg/a.ts')
  })

  it('detects a two-file cycle', () => {
    const workspace = workspaceOf({
      'a.ts': "import { b } from './b.ts'\nexport const a = (): number => b()\n",
      'b.ts': "import { a } from './a.ts'\nexport const b = (): number => (a === undefined ? 1 : 2)\n",
    })
    const text = moduleGraph(workspace, undefined).text
    expect(text.split('\n')[0]).toBe('repo — 2 files, 2 import edges; 1 cycles repo-wide')
    expect(text).toContain('cycle: a.ts -> b.ts -> a.ts')
  })

  it('detects a three-file cycle exactly once', () => {
    const workspace = workspaceOf({
      'x.ts': "import { y } from './y.ts'\nexport const x = (): number => y\n",
      'y.ts': "import { z } from './z.ts'\nexport const y = z\n",
      'z.ts': "import { x } from './x.ts'\nexport const z = (): number => x()\n",
    })
    const lines = moduleGraph(workspace, undefined).text.split('\n')
    expect(lines[0]).toBe('repo — 3 files, 3 import edges; 1 cycles repo-wide')
    expect(lines.filter((line) => line.startsWith('cycle:'))).toEqual([
      'cycle: x.ts -> y.ts -> z.ts -> x.ts',
    ])
  })

  it('lists edges only for the folder asked about but counts every cycle', () => {
    const workspace = workspaceOf({
      'one/a.ts': "import { b } from '../two/b.ts'\nexport const a = (): number => b()\n",
      'two/b.ts': "import { a } from '../one/a.ts'\nexport const b = (): number => (a === undefined ? 1 : 2)\n",
    })
    const text = moduleGraph(workspace, 'one').text
    expect(text.split('\n')[0]).toBe('one — 1 files, 1 import edges; 1 cycles repo-wide')
    const edges = text.split('\n').filter((line) => !line.startsWith('cycle:') && line.includes('->'))
    expect(edges).toEqual(['one/a.ts -> two/b.ts'])
  })

  it('leaves a bare package specifier out of the graph', () => {
    const workspace = workspaceOf({ 'solo.ts': "import ts from 'typescript'\nexport const kinds = ts.SyntaxKind\n" })
    expect(moduleGraph(workspace, undefined).text).toBe('repo — 1 files, 0 import edges; 0 cycles repo-wide')
  })
})

describe('unusedExports', () => {
  it('reports an export referenced only in its own file', () => {
    const workspace = workspaceOf({
      'lib.ts': [
        'export const used = (value: number): number => value + 1',
        'export const dead = (value: number): number => value - 1',
        'export const alsoDead = dead(2)',
        '',
      ].join('\n'),
      'app.ts': "import { used } from './lib.ts'\nexport const run = (): number => used(1)\n",
    })
    const text = unusedExports(workspace, undefined).text
    expect(text).toContain('lib.ts:2 function dead')
    expect(text).not.toContain('used')
  })

  it('does not report an export consumed through a barrel', () => {
    const workspace = workspaceOf({
      'pkg/thing.ts': 'export const thing = 1\n',
      'pkg/index.ts': "export { thing } from './thing.ts'\n",
    })
    const text = unusedExports(workspace, undefined).text
    expect(text).not.toContain('thing.ts:1')
  })

  it('orders by file and line and scopes to a folder', () => {
    const workspace = workspaceOf({
      'pkg/b.ts': 'export const second = 2\nexport const third = 3\n',
      'pkg/a.ts': 'export const first = 1\n',
      'other/c.ts': 'export const outside = 4\n',
    })
    const lines = unusedExports(workspace, 'pkg').text.split('\n')
    expect(lines[0]).toBe('pkg — 3 exports referenced only in their own file, in 2 files')
    expect(lines.slice(1)).toEqual([
      'pkg/a.ts:1 variable first',
      'pkg/b.ts:1 variable second',
      'pkg/b.ts:2 variable third',
    ])
  })
})
