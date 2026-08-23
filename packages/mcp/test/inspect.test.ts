import { describe, it, expect } from 'vitest'
import { deleteSymbol, escapeHatchIndex, symbolDiff, symbolMetrics } from '../src/inspect.ts'
import { applyEdits } from '../src/edit.ts'
import { sourceOf } from '../src/workspace.ts'
import { workspaceOf } from './fixture.ts'

const lineStartingWith = (text: string, prefix: string): string =>
  text.split('\n').find((line) => line.startsWith(prefix)) ?? ''

const scoreIn = (line: string): number => Number(/score (\d+)/.exec(line)?.[1] ?? '-1')

// ---------------------------------------------------------------------------
// symbolMetrics
// ---------------------------------------------------------------------------

const metricSources = {
  'm.ts': [
    'export const twice = (value: number): number => value * 2',
    '',
    'export const tangle = (values: readonly number[]): number => {',
    '  if (values.length > 0) {',
    '    for (const value of values) {',
    '      if (value > 0) {',
    '        return value',
    '      }',
    '    }',
    '  }',
    '  return 0',
    '}',
    '',
    'export type Pair = { readonly left: number; readonly right: number }',
    '',
  ].join('\n'),
}

const metricWorkspace = workspaceOf(metricSources)

describe('symbolMetrics', () => {
  it('separates a one-line function from a deeply nested one', () => {
    const short = symbolMetrics(metricWorkspace, 'twice', undefined)
    const deep = symbolMetrics(metricWorkspace, 'tangle', undefined)
    expect(short.ok).toBe(true)
    expect(deep.ok).toBe(true)
    const shortLine = lineStartingWith(short.text, 'declaration —')
    const deepLine = lineStartingWith(deep.text, 'declaration —')
    expect(shortLine).toContain('lines 1')
    expect(shortLine).toContain('nesting 0')
    expect(shortLine).toContain('parameters 1')
    expect(deepLine).toContain('lines 10')
    expect(deepLine).toContain('nesting 4')
    expect(scoreIn(deepLine)).toBeLessThan(scoreIn(shortLine))
  })

  it('puts the file its own numbers beside the declaration', () => {
    const result = symbolMetrics(metricWorkspace, 'twice', undefined)
    expect(result.text.split('\n')[0]).toBe('twice — m.ts:1 function')
    const fileLine = lineStartingWith(result.text, 'file m.ts —')
    expect(fileLine).toContain('lines 14')
    expect(scoreIn(fileLine)).toBeGreaterThan(0)
    expect(result.text).toMatch(/% of the file's lines; score [+-]\d+ against the file/)
  })

  it('measures a declaration that is not a function at all', () => {
    const result = symbolMetrics(metricWorkspace, 'Pair', undefined)
    expect(result.ok).toBe(true)
    expect(result.text.split('\n')[0]).toBe('Pair — m.ts:14 type')
    expect(lineStartingWith(result.text, 'declaration —')).toContain('lines 1')
  })

  it('explains an unknown name rather than reporting zeroes', () => {
    const result = symbolMetrics(metricWorkspace, 'missing', undefined)
    expect(result.ok).toBe(false)
    expect(result.text).toContain('no declaration named missing')
  })
})

// ---------------------------------------------------------------------------
// escapeHatchIndex
// ---------------------------------------------------------------------------

const hatchSources = {
  'pkg/e1.ts': [
    'export const parse = (input: any): string => String(input)',
    '',
    'export const cast = (value: unknown): string => value as string',
    '',
  ].join('\n'),
  'pkg/e2.ts': [
    '// @ts-expect-error deliberate',
    'export const risky = (value: string | undefined): number => value!.length',
    '',
  ].join('\n'),
}

const hatchWorkspace = workspaceOf(hatchSources)

describe('escapeHatchIndex', () => {
  it('lists every hatch across two files with its line and its text', () => {
    const result = escapeHatchIndex(hatchWorkspace, undefined)
    expect(result.ok).toBe(true)
    expect(result.text.split('\n')[0]).toBe(
      'escape hatches — 4 in 2 files: any 1, as 1, non-null 1, ts-directive 1, eslint-disable 0',
    )
    expect(result.text).toContain('pkg/e1.ts — 2')
    expect(result.text).toContain('  pkg/e1.ts:1 any export const parse = (input: any): string')
    expect(result.text).toContain('  pkg/e1.ts:3 as export const cast')
    expect(result.text).toContain('pkg/e2.ts — 2')
    expect(result.text).toContain('  pkg/e2.ts:1 ts-directive // @ts-expect-error deliberate')
    expect(result.text).toContain('  pkg/e2.ts:2 non-null export const risky')
  })

  it('restricts the listing to a folder', () => {
    const result = escapeHatchIndex(workspaceOf({ ...hatchSources, 'clean.ts': 'export const one = 1\n' }), 'pkg')
    expect(result.text.split('\n')[0]).toContain('4 in 2 files')
    expect(result.text).not.toContain('clean.ts')
  })

  it('reports a clean workspace as zero rather than as an empty answer', () => {
    const result = escapeHatchIndex(workspaceOf({ 'clean.ts': 'export const one = 1\n' }), undefined)
    expect(result.ok).toBe(true)
    expect(result.text.split('\n')[0]).toBe(
      'escape hatches — 0 in 0 files: any 0, as 0, non-null 0, ts-directive 0, eslint-disable 0',
    )
  })

  it('says so when ratchet.json is not in the index', () => {
    expect(escapeHatchIndex(hatchWorkspace, undefined).text).toContain(
      'ratchet.json is not indexed — no baseline to compare against.',
    )
  })

  it('compares the total against the recorded baseline when ratchet.json is indexed', () => {
    const baseline = JSON.stringify({
      explicitAny: 0,
      asCasts: 1,
      nonNullAssertions: 1,
      tsDirectives: 1,
      eslintDisables: 0,
    })
    const withBaseline = workspaceOf({ ...hatchSources, 'ratchet.json': baseline })
    const result = escapeHatchIndex(withBaseline, undefined)
    expect(result.text.split('\n')[1]).toBe(
      'baseline 3 in ratchet.json, counted 4 — regressed: explicitAny',
    )
  })

  it('does not count the ratchet file itself', () => {
    const withBaseline = workspaceOf({ ...hatchSources, 'ratchet.json': '{ "explicitAny": 0 }' })
    expect(escapeHatchIndex(withBaseline, undefined).text).not.toContain('ratchet.json:')
  })
})

// ---------------------------------------------------------------------------
// deleteSymbol
// ---------------------------------------------------------------------------

const deletable = [
  '// File header.',
  '',
  'export const first = 1',
  '',
  '// Doubles the number.',
  'export const twice = (value: number): number => value * 2',
  '',
  'export const last = 3',
  '',
].join('\n')

describe('deleteSymbol', () => {
  it('removes the declaration, its comment, and the blank line it leaves behind', () => {
    const workspace = workspaceOf({ 'a.ts': deletable })
    const plan = deleteSymbol(workspace, 'twice', undefined)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.summary).toBe('a.ts:6 — deleted twice (2 lines)')
    expect(applyEdits(sourceOf(workspace, 'a.ts')?.text ?? '', plan.edits)).toBe(
      ['// File header.', '', 'export const first = 1', '', 'export const last = 3', ''].join('\n'),
    )
  })

  it('declines while a use remains, naming every site', () => {
    const workspace = workspaceOf({
      'a.ts': deletable,
      'b.ts': ["import { twice } from './a.ts'", '', 'export const four = twice(2)', ''].join('\n'),
    })
    const plan = deleteSymbol(workspace, 'twice', undefined)
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toContain('twice is still used in 2 places; remove them first:')
    expect(plan.text).toContain("b.ts:1 import { twice } from './a.ts'")
    expect(plan.text).toContain('b.ts:3 export const four = twice(2)')
  })

  it('declines while a barrel re-exports it, naming the barrel', () => {
    const workspace = workspaceOf({
      'a.ts': deletable,
      'index.ts': ["export { twice } from './a.ts'", ''].join('\n'),
    })
    const plan = deleteSymbol(workspace, 'twice', undefined)
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toBe(
      'twice is re-exported from index.ts; deleting it would leave a broken re-export. Remove the re-export first.',
    )
  })

  it('explains an unknown name rather than planning nothing', () => {
    const plan = deleteSymbol(workspaceOf({ 'a.ts': deletable }), 'missing', undefined)
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toContain('no declaration named missing')
  })
})

// ---------------------------------------------------------------------------
// symbolDiff
// ---------------------------------------------------------------------------

const movedText = 'export const twice = (value: number): number => value * 2'

describe('symbolDiff', () => {
  it('reports a change, an addition, a removal, and a move as four facts', () => {
    const before = new Map([
      [
        'a.ts',
        [
          'export type Point = { readonly x: number }',
          '',
          movedText,
          '',
          'export const gone = 1',
          '',
        ].join('\n'),
      ],
      ['b.ts', ['export const kept = 2', ''].join('\n')],
    ])
    const workspace = workspaceOf({
      'a.ts': [
        'export type Point = { readonly x: number; readonly y: number }',
        '',
        'export const fresh = 3',
        '',
      ].join('\n'),
      'b.ts': ['export const kept = 2', '', movedText, ''].join('\n'),
    })
    const result = symbolDiff(workspace, before)
    expect(result.ok).toBe(true)
    expect(result.text.split('\n')[0]).toBe(
      '2 files compared — 0 added, 0 removed; declarations: 1 added, 1 removed, 1 changed, 1 moved',
    )
    expect(result.text).toContain('moved: twice — a.ts:3 -> b.ts:3')
    expect(result.text).toContain('changed: a.ts:1 Point')
    expect(result.text).toContain('added: a.ts:3 fresh')
    expect(result.text).toContain('removed: a.ts:5 gone')
    expect(result.text).not.toContain('added: b.ts:3 twice')
    expect(result.text).not.toContain('removed: a.ts:3 twice')
  })

  it('reports a file present on one side only as a whole file, and still spots the move out of it', () => {
    const before = new Map([
      ['old.ts', ['export const shared = 1', 'export const dropped = 2', ''].join('\n')],
    ])
    const workspace = workspaceOf({ 'new.ts': ['export const shared = 1', ''].join('\n') })
    const result = symbolDiff(workspace, before)
    expect(result.text).toContain('removed file: old.ts (2 declarations)')
    expect(result.text).toContain('added file: new.ts (1 declarations)')
    expect(result.text).toContain('moved: shared — old.ts:1 -> new.ts:1')
    expect(result.text).not.toContain('added: new.ts')
    expect(result.text).not.toContain('removed: old.ts')
  })

  it('says nothing beyond the header when nothing changed', () => {
    const text = ['export const one = 1', ''].join('\n')
    const result = symbolDiff(workspaceOf({ 'a.ts': text }), new Map([['a.ts', text]]))
    expect(result.text).toBe(
      '1 files compared — 0 added, 0 removed; declarations: 0 added, 0 removed, 0 changed, 0 moved',
    )
  })
})
