import { describe, it, expect } from 'vitest'
import { outline, repoMap, search, symbolSource, usages } from '../src/query.ts'
import { workspaceOf } from './fixture.ts'

const sources = {
  'a.ts': [
    '// File header.',
    '',
    'export type Point = { readonly x: number }',
    '',
    '// Doubles the coordinate.',
    'export const twice = (point: Point): number => point.x * 2',
    '',
    'const local = 1',
    '',
    'export const box = { inner: (value: number): number => value }',
    '',
  ].join('\n'),
  'b.ts': [
    "import { twice, type Point } from './a.ts'",
    '',
    'export const total = (points: readonly Point[]): number =>',
    '  points.reduce((sum, point) => sum + twice(point), 0)',
    '',
  ].join('\n'),
}

const workspace = workspaceOf(sources)

describe('outline', () => {
  it('lists top-level declarations with line numbers and export markers', () => {
    const text = outline(workspace, ['a.ts'], false).text
    expect(text).toContain('a.ts — 11 lines, 4 declarations')
    expect(text).toContain('3 export type Point')
    expect(text).toContain('6 export function twice(point: Point): number')
    expect(text).toContain('8 variable local = 1')
  })

  it('leaves nested declarations out unless asked', () => {
    const shallow = outline(workspace, ['a.ts'], false).text.split('\n')
    const deep = outline(workspace, ['a.ts'], true).text.split('\n')
    expect(shallow).toHaveLength(5)
    expect(deep.length).toBeGreaterThan(shallow.length)
  })

  it('reports an unknown file instead of failing', () => {
    expect(outline(workspace, ['missing.ts'], false).text).toBe('missing.ts: not indexed')
  })
})

describe('symbolSource', () => {
  it('returns the declaration with its leading comment', () => {
    const result = symbolSource(workspace, 'twice', undefined)
    expect(result.ok).toBe(true)
    expect(result.text).toBe(
      ['a.ts:6', '// Doubles the coordinate.', 'export const twice = (point: Point): number => point.x * 2'].join('\n'),
    )
  })

  it('points at search when the name is unknown', () => {
    const result = symbolSource(workspace, 'nothing', undefined)
    expect(result.ok).toBe(false)
    expect(result.text).toContain('no declaration named nothing')
  })
})

describe('usages', () => {
  it('finds uses across files and marks the definition', () => {
    const result = usages(workspace, 'twice', undefined)
    expect(result.text).toContain('twice — 2 uses in 2 files')
    expect(result.text).toContain('a.ts:6 [def]')
    expect(result.text).toContain('b.ts:1')
    expect(result.text).toContain('b.ts:4')
  })
})

describe('search', () => {
  it('matches on a substring of the name, exported only by default', () => {
    expect(search(workspace, 'tot', undefined, false).text).toContain('b.ts:3 function')
    expect(search(workspace, 'local', undefined, false).text).toContain('0 matches')
    expect(search(workspace, 'local', undefined, true).text).toContain('a.ts:8 variable local')
  })

  it('shows the doc line beside the signature when the declaration has one', () => {
    expect(search(workspace, 'twice', undefined, false).text).toContain(
      '— Doubles the coordinate.',
    )
  })

  it('filters by kind and rejects an unknown one', () => {
    expect(search(workspace, 'point', 'type', false).text).toContain('Point')
    expect(search(workspace, 'point', 'widget', false).ok).toBe(false)
  })
})

describe('repoMap', () => {
  it('counts what the index holds', () => {
    expect(repoMap(workspace).text).toContain('declarations')
  })

  it('ranks exported declarations by use, leaving out the unused', () => {
    const text = repoMap(workspace).text
    expect(text).toContain('Most-used exports')
    expect(text).toContain('function twice(point: Point): number — 2 uses — Doubles the coordinate.')
    expect(text).toContain('type Point')
    expect(text).not.toContain('total')
  })

  it('trims the ranked list to the budget', () => {
    const lines = repoMap(workspace, 60).text.split('\n')
    const ranked = lines.filter((line) => line.includes('uses'))
    expect(ranked).toHaveLength(1)
    expect(repoMap(workspace, 60).text).toContain('(1 of 2)')
  })

  it('omits the ranked list at budget zero', () => {
    expect(repoMap(workspace, 0).text).not.toContain('Most-used exports')
  })
})
