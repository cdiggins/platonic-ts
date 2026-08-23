import { describe, it, expect } from 'vitest'
import { blastRadius, callers, testsForSymbol } from '../src/reach.ts'
import { workspaceOf } from './fixture.ts'

// leaf <- middle <- top, in three files, so depth is visible as file changes.
const chain = workspaceOf({
  'leaf.ts': 'export const leaf = (value: number): number => value + 1\n',
  'middle.ts': [
    "import { leaf } from './leaf.ts'",
    '',
    'export const middle = (value: number): number => leaf(value) * 2',
    '',
  ].join('\n'),
  'top.ts': [
    "import { middle } from './middle.ts'",
    '',
    'export const top = (value: number): number => middle(value) - 1',
    '',
  ].join('\n'),
})

describe('callers', () => {
  it('lists direct callers at depth 1', () => {
    const text = callers(chain, 'leaf', undefined, 1).text
    expect(text.split('\n')[0]).toBe('callers of leaf (leaf.ts:1) — 1 callers, depth 1')
    expect(text).toContain('  middle.ts:3 middle')
    expect(text).not.toContain('top')
  })

  it('walks one level further at depth 2 and indents the tree', () => {
    const text = callers(chain, 'leaf', undefined, 2).text
    expect(text.split('\n')[0]).toBe('callers of leaf (leaf.ts:1) — 2 callers, depth 2')
    expect(text.split('\n').slice(1)).toEqual(['  middle.ts:3 middle', '    top.ts:3 top'])
  })

  it('says so plainly when nothing calls the symbol', () => {
    expect(callers(chain, 'top', undefined, 3).text).toBe(
      'callers of top (top.ts:3) — 0 callers, depth 3\nno callers',
    )
  })

  it('marks a closed cycle instead of looping on mutual recursion', () => {
    const workspace = workspaceOf({
      'r.ts': [
        'export const ping = (value: number): number => (value <= 0 ? 0 : pong(value - 1))',
        'export const pong = (value: number): number => ping(value - 1)',
        '',
      ].join('\n'),
    })
    const text = callers(workspace, 'ping', undefined, 5).text
    expect(text).toContain('  r.ts:2 pong')
    expect(text).toContain('    r.ts:1 ping [recursive]')
    expect(text.split('\n')).toHaveLength(3)
  })

  it('explains an unknown name rather than returning an empty tree', () => {
    const result = callers(chain, 'nope', undefined, 1)
    expect(result.ok).toBe(false)
    expect(result.text).toContain('no declaration named nope')
  })
})

// `covered` is exercised straight from a test file; `helper` is only reached
// from tests, so what it calls counts as covered too.
const tested = workspaceOf({
  'lib.ts': [
    'export const covered = (value: number): number => value + 1',
    'export const lonely = (value: number): number => value - 1',
    'export const deep = (value: number): number => value * 3',
    '',
  ].join('\n'),
  'helper.ts': [
    "import { deep } from './lib.ts'",
    '',
    'export const helper = (value: number): number => deep(value)',
    '',
  ].join('\n'),
  'lib.test.ts': [
    "import { covered } from './lib.ts'",
    "import { helper } from './helper.ts'",
    '',
    'export const run = (): number => covered(1) + helper(2)',
    '',
  ].join('\n'),
})

describe('testsForSymbol', () => {
  it('reports a reference from a .test.ts file as a direct test', () => {
    const text = testsForSymbol(tested, 'covered', undefined).text
    expect(text.split('\n')[0]).toBe('tests for covered (lib.ts:1) — 2 tests')
    expect(text).toContain('lib.test.ts:1 direct')
    expect(text).toContain('lib.test.ts:4 direct')
  })

  it('credits a test-only helper to the symbol it calls', () => {
    const text = testsForSymbol(tested, 'deep', undefined).text
    expect(text).toContain('lib.test.ts:2 via helper')
    expect(text).toContain('lib.test.ts:4 via helper')
  })

  it('states that nothing exercises an untested symbol', () => {
    expect(testsForSymbol(tested, 'lonely', undefined).text).toBe(
      'tests for lonely (lib.ts:2) — 0 tests\nno test reaches lonely',
    )
  })
})

describe('blastRadius', () => {
  it('headlines uses, files, callers, and tests in one line', () => {
    const headline = blastRadius(chain, 'leaf', undefined).text.split('\n')[0]
    expect(headline).toBe('leaf (leaf.ts:1) — 2 uses in 2 files, 2 callers, 0 tests')
  })

  it('carries the three sections beneath the headline', () => {
    const lines = blastRadius(chain, 'leaf', undefined).text.split('\n')
    expect(lines).toContain('uses:')
    expect(lines).toContain('callers:')
    expect(lines).toContain('tests:')
    expect(lines).toContain('    top.ts:3 top')
  })

  it('counts covering tests in the headline', () => {
    const headline = blastRadius(tested, 'covered', undefined).text.split('\n')[0]
    expect(headline).toBe('covered (lib.ts:1) — 2 uses in 2 files, 1 callers, 2 tests')
  })
})
