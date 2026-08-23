import { describe, it, expect } from 'vitest'
import { membersOf, typeOf } from '../src/types.ts'
import { compilerOf } from './fixture.ts'

const union = Array.from({ length: 30 }, (_, index) => `'alpha${index}'`).join(' | ')

const wide = Array.from({ length: 70 }, (_, index) => `  readonly field${index}: number`).join('\n')

const sources = {
  'a.ts': [
    'export const twice = (value: number): number => value * 2',
    '',
    'export type Point = { readonly x: number; readonly y: number; label?: string }',
    '',
    `export type Wide = ${union}`,
    '',
    'export const loose: any = {}',
    '',
    'export const point: Point = { x: 1, y: 2 }',
    '',
  ].join('\n'),
  'shapes.ts': [
    'export interface Base {',
    '  readonly id: string',
    '  describe(): string',
    '}',
    '',
    'export interface Derived extends Base {',
    '  readonly size: number',
    '  nickname?: string',
    '}',
    '',
    'export type Bag = { readonly [key: string]: number }',
    '',
    'export type Many = {',
    wide,
    '}',
    '',
  ].join('\n'),
  'dup1.ts': ['export const shared = 1', ''].join('\n'),
  'dup2.ts': ['export const shared = 2', ''].join('\n'),
}

const compiler = compilerOf(sources)

const linesOf = (text: string): readonly string[] => text.split('\n')

describe('typeOf', () => {
  it('prints the inferred type and call signature of a function', () => {
    const output = typeOf(compiler, 'twice', undefined)
    expect(output.ok).toBe(true)
    expect(linesOf(output.text)).toEqual([
      'a.ts:1 twice',
      'type (value: number) => number',
      'call (value: number): number',
    ])
  })

  it('expands a type alias rather than printing its own name back', () => {
    const output = typeOf(compiler, 'Point', undefined)
    expect(linesOf(output.text)[0]).toBe('a.ts:3 Point')
    expect(output.text).toContain('readonly x: number')
    expect(output.text).toContain('label?: string')
  })

  it('prints a wide union without truncating it', () => {
    const output = typeOf(compiler, 'Wide', undefined)
    expect(output.ok).toBe(true)
    expect(output.text).toContain('"alpha0"')
    expect(output.text).toContain('"alpha29"')
    expect(output.text).not.toContain('...')
  })

  it('refuses rather than reporting a name it cannot resolve', () => {
    const output = typeOf(compiler, 'nowhere', undefined)
    expect(output.ok).toBe(false)
    expect(output.text).toContain('no declaration named nowhere')
  })

  it('refuses an ambiguous name and names the candidates', () => {
    const output = typeOf(compiler, 'shared', undefined)
    expect(output.ok).toBe(false)
    expect(output.text).toContain('dup1.ts:1')
    expect(output.text).toContain('dup2.ts:1')
  })

  it('answers once the file disambiguates', () => {
    const output = typeOf(compiler, 'shared', 'dup2.ts')
    expect(output.ok).toBe(true)
    expect(linesOf(output.text)).toEqual(['dup2.ts:1 shared', 'type 2'])
  })

  it('refuses when the checker has nothing better than any', () => {
    const output = typeOf(compiler, 'loose', undefined)
    expect(output.ok).toBe(false)
    expect(output.text).toContain('resolves to any')
  })
})

describe('membersOf', () => {
  it('lists the members of a type alias, alphabetically', () => {
    const output = membersOf(compiler, 'Point', undefined)
    expect(linesOf(output.text)).toEqual([
      'a.ts:3 Point — 3 members, 0 inherited',
      'label?: string | undefined',
      'readonly x: number',
      'readonly y: number',
    ])
  })

  it('renders optional and readonly markers on the members of a value', () => {
    const output = membersOf(compiler, 'point', undefined)
    expect(output.text).toContain('label?: ')
    expect(output.text).toContain('readonly x: number')
    expect(output.text).toContain('0 inherited')
  })

  it('shows inherited members after own ones, attributed to the type they come from', () => {
    const output = membersOf(compiler, 'Derived', undefined)
    expect(linesOf(output.text)).toEqual([
      'shapes.ts:6 Derived — 4 members, 2 inherited',
      'nickname?: string | undefined',
      'readonly size: number',
      'describe: () => string (from Base)',
      'readonly id: string (from Base)',
    ])
  })

  it('prints index signatures', () => {
    const output = membersOf(compiler, 'Bag', undefined)
    expect(output.text).toContain('index readonly [key: string]: number')
  })

  it('prints call signatures for a callable value', () => {
    const output = membersOf(compiler, 'twice', undefined)
    expect(output.text).toContain('call (value: number): number')
  })

  it('caps a long member list and says how many were left out', () => {
    const output = membersOf(compiler, 'Many', undefined)
    expect(output.text).toContain('70 members')
    expect(output.text).toContain('… 10 more')
  })

  it('refuses a name that does not resolve', () => {
    const output = membersOf(compiler, 'nowhere', undefined)
    expect(output.ok).toBe(false)
    expect(output.text).toContain('Try search.')
  })

  it('refuses when the checker has nothing better than any', () => {
    const output = membersOf(compiler, 'loose', undefined)
    expect(output.ok).toBe(false)
    expect(output.text).toContain('resolves to any')
  })
})
