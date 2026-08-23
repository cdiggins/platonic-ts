import { describe, it, expect } from 'vitest'
import { applyEdits, editsByFile, insertSymbol, replaceSymbol, type FileEdit } from '../src/edit.ts'
import { declarationText, syntaxErrorIn } from '../src/declaration.ts'
import { sourceOf } from '../src/workspace.ts'
import { workspaceOf } from './fixture.ts'

const header = '// File header, separated by a blank line.'

const sources = {
  'a.ts': [
    header,
    '',
    'export const first = 1',
    '',
    '// Doubles the number.',
    '// Second line of the comment.',
    'export const twice = (value: number): number => value * 2',
    '',
    'export const last = 3',
    '',
  ].join('\n'),
}

const workspace = workspaceOf(sources)

const original = sourceOf(workspace, 'a.ts')?.text ?? ''

const textOf = (edits: readonly FileEdit[]): string => applyEdits(original, edits)

describe('applyEdits', () => {
  it('applies several edits to one text without disturbing later offsets', () => {
    const edits = [
      { file: 'a.ts', start: 0, end: 5, text: 'AAAAA' },
      { file: 'a.ts', start: 10, end: 15, text: 'B' },
    ]
    expect(applyEdits('0123456789abcdefghij', edits)).toBe('AAAAA56789Bfghij')
  })
})

describe('editsByFile', () => {
  it('groups by file', () => {
    const grouped = editsByFile([
      { file: 'a.ts', start: 0, end: 1, text: 'x' },
      { file: 'b.ts', start: 0, end: 1, text: 'y' },
      { file: 'a.ts', start: 2, end: 3, text: 'z' },
    ])
    expect(grouped.get('a.ts')).toHaveLength(2)
    expect(grouped.get('b.ts')).toHaveLength(1)
  })
})

describe('declarationText', () => {
  it('takes the comment written directly above the declaration', () => {
    const symbol = workspace.index.symbols.find((candidate) => candidate.name === 'twice')
    const source = sourceOf(workspace, 'a.ts')
    expect(symbol !== undefined && source !== undefined).toBe(true)
    expect(symbol === undefined || source === undefined ? '' : declarationText(source, symbol)).toBe(
      [
        '// Doubles the number.',
        '// Second line of the comment.',
        'export const twice = (value: number): number => value * 2',
      ].join('\n'),
    )
  })

  it('leaves a file header out of the first declaration', () => {
    const symbol = workspace.index.symbols.find((candidate) => candidate.name === 'first')
    const source = sourceOf(workspace, 'a.ts')
    const text = symbol === undefined || source === undefined ? '' : declarationText(source, symbol)
    expect(text).toBe('export const first = 1')
  })
})

describe('syntaxErrorIn', () => {
  it('passes valid TypeScript and reports invalid', () => {
    expect(syntaxErrorIn('export const x = (a: number): number => a')).toBe(undefined)
    expect(syntaxErrorIn('export const x = (')).not.toBe(undefined)
  })
})

describe('replaceSymbol', () => {
  it('replaces the declaration and its comment, and nothing else', () => {
    const plan = replaceSymbol(workspace, 'twice', undefined, '// New.\nexport const twice = 2\n')
    expect(plan.ok).toBe(true)
    const result = plan.ok ? textOf(plan.edits) : ''
    expect(result).toContain('// New.\nexport const twice = 2')
    expect(result).toContain('export const first = 1')
    expect(result).toContain('export const last = 3')
    expect(result).not.toContain('Doubles')
    expect(result.startsWith(header)).toBe(true)
  })

  it('refuses source that does not parse', () => {
    const plan = replaceSymbol(workspace, 'twice', undefined, 'export const twice = (')
    expect(plan.ok).toBe(false)
    expect(plan.ok ? '' : plan.text).toContain('does not parse')
  })

  it('refuses a name it cannot find', () => {
    expect(replaceSymbol(workspace, 'absent', undefined, 'const absent = 1').ok).toBe(false)
  })
})

describe('insertSymbol', () => {
  it('appends at the end of the file', () => {
    const plan = insertSymbol(workspace, 'a.ts', 'export const added = 4', undefined)
    expect(plan.ok).toBe(true)
    expect(plan.ok ? textOf(plan.edits) : '').toBe(
      `${original.trimEnd()}\n\nexport const added = 4\n`,
    )
  })

  it('inserts after a named declaration', () => {
    const plan = insertSymbol(workspace, 'a.ts', 'export const added = 4', 'first')
    const result = plan.ok ? textOf(plan.edits) : ''
    expect(result.indexOf('added')).toBeGreaterThan(result.indexOf('first'))
    expect(result.indexOf('added')).toBeLessThan(result.indexOf('Doubles'))
  })

  it('refuses an unknown file', () => {
    expect(insertSymbol(workspace, 'nope.ts', 'const x = 1', undefined).ok).toBe(false)
  })
})
