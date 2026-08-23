import { describe, it, expect } from 'vitest'
import { applyEdits } from '../src/edit.ts'
import { applyRefactor, availableRefactors } from '../src/refactor.ts'
import { compilerOf } from './fixture.ts'

const sources = {
  'a.ts': [
    'type Local = number',
    '',
    'export const twice = (value: number): number => value * 2',
    '',
    'export function named(value: number): number {',
    '  return value + 1',
    '}',
    '',
  ].join('\n'),
}

const compiler = compilerOf(sources)

// A declaration the compiler has nothing to offer for: a private type alias
// with no expression anywhere in its range to extract.
const barren = compilerOf({
  'b.ts': ['type Only = number', '', 'export const one: Only = 1', ''].join('\n'),
})

describe('availableRefactors', () => {
  it('lists the refactorings that apply to a declaration', () => {
    const output = availableRefactors(compiler, 'named', undefined)
    expect(output.ok).toBe(true)
    expect(output.text.split('\n')[0]).toBe('named at a.ts:5 — 2 refactorings:')
    expect(output.text).toContain(
      'Convert export | Convert named export to default export — Convert named export to default export',
    )
    expect(output.text).toContain(
      'Convert parameters to destructured object | Convert parameters to destructured object',
    )
  })

  it('reports a declaration where nothing applies', () => {
    expect(availableRefactors(barren, 'Only', undefined)).toEqual({
      ok: true,
      text: 'Only at b.ts:1 — no refactorings apply.',
    })
  })

  it('declines an unknown declaration', () => {
    const output = availableRefactors(compiler, 'missing', undefined)
    expect(output.ok).toBe(false)
    expect(output.text).toContain('no declaration named missing')
  })
})

describe('applyRefactor', () => {
  it('applies a refactoring and returns its edits', () => {
    const plan = applyRefactor(
      compiler,
      'named',
      undefined,
      'Convert export',
      'Convert named export to default export',
    )
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.edits).toEqual([{ file: 'a.ts', start: 86, end: 86, text: ' default' }])
    expect(plan.summary).toBe(
      'a.ts:5 — applied Convert export | Convert named export to default export: 1 edits in 1 files',
    )
    expect(applyEdits(sources['a.ts'], plan.edits)).toBe(
      [
        'type Local = number',
        '',
        'export const twice = (value: number): number => value * 2',
        '',
        'export default function named(value: number): number {',
        '  return value + 1',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('declines an unknown action and lists the valid ones', () => {
    const plan = applyRefactor(compiler, 'named', undefined, 'Convert export', 'to_default')
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toBe(
      'to_default is not an action of Convert export; its actions are Convert named export to default export.',
    )
  })

  it('declines a refactoring that does not apply there', () => {
    const plan = applyRefactor(barren, 'Only', undefined, 'Convert export', 'anything')
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toBe(
      ['Convert export does not apply to Only at b.ts:1.', 'No refactorings apply there.'].join('\n'),
    )
  })

  it('names the applicable refactorings when the requested one is not among them', () => {
    const plan = applyRefactor(compiler, 'twice', undefined, 'Move to a new file', 'Move to a new file')
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toContain('Applicable: ')
    expect(plan.text).toContain('Convert export')
  })
})
