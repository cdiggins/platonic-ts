import { describe, it, expect } from 'vitest'
import { applyEdits, spliceText, type TextEdit } from '../src/edits.ts'
import { callSource, dedentBy, functionSource, relativeImport } from '../src/rewrite.ts'

describe('spliceText', () => {
  it('applies edits by position, not by the order they were given', () => {
    const result = spliceText('alpha beta gamma', [
      { start: 11, end: 16, text: 'delta' },
      { start: 0, end: 5, text: 'omega' },
    ])
    expect(result).toEqual({ ok: true, text: 'omega beta delta' })
  })

  it('inserts where start and end meet', () => {
    expect(spliceText('ab', [{ start: 1, end: 1, text: '-' }])).toEqual({ ok: true, text: 'a-b' })
  })

  it('refuses edits that would rewrite the same character twice', () => {
    const result = spliceText('alpha beta', [
      { start: 0, end: 6, text: 'x' },
      { start: 3, end: 9, text: 'y' },
    ])
    expect(result).toEqual({ ok: false, reason: 'overlapping' })
  })

  it('refuses edits built against a different text', () => {
    expect(spliceText('short', [{ start: 2, end: 99, text: 'x' }])).toEqual({
      ok: false,
      reason: 'out-of-range',
    })
  })
})

describe('applyEdits', () => {
  const edits: readonly TextEdit[] = [
    { file: 'a.ts', start: 0, end: 0, text: 'const shared = 1\n' },
    { file: 'b.ts', start: 0, end: 3, text: 'shared' },
  ]

  it('applies only the edits belonging to the file it is given', () => {
    expect(applyEdits(edits, 'a.ts', 'const one = 1\n')).toEqual({
      ok: true,
      text: 'const shared = 1\nconst one = 1\n',
    })
    expect(applyEdits(edits, 'b.ts', 'one')).toEqual({ ok: true, text: 'shared' })
  })
})

describe('functionSource', () => {
  it('writes a value form for something already function-valued', () => {
    expect(
      functionSource({
        name: 'refusal',
        form: 'value',
        parameters: [],
        returnType: undefined,
        body: '(text: string) => ({ ok: false })',
        isAsync: false,
        exported: true,
      }),
    ).toBe('export const refusal = (text: string) => ({ ok: false })')
  })

  it('parenthesizes a body that would otherwise read as a block', () => {
    expect(
      functionSource({
        name: 'empty',
        form: 'function',
        parameters: [],
        returnType: 'Row',
        body: '{ ok: false }',
        isAsync: false,
        exported: false,
      }),
    ).toBe('const empty = (): Row => ({ ok: false })')
  })

  it('marks the declaration async and keeps the promise in the return type', () => {
    expect(
      functionSource({
        name: 'readAll',
        form: 'function',
        parameters: [{ name: 'file', type: 'string' }],
        returnType: 'Promise<string>',
        body: 'await read(file)',
        isAsync: true,
        exported: false,
      }),
    ).toBe('const readAll = async (file: string): Promise<string> => await read(file)')
  })
})

describe('callSource', () => {
  const call = { name: 'countActive', arguments: ['rows'], awaited: false, parenthesize: false }

  it('replaces a shared value with its name', () => {
    expect(callSource({ ...call, arguments: [], form: 'value' })).toBe('countActive')
  })

  it('calls a function form, even with no arguments', () => {
    expect(callSource({ ...call, arguments: [], form: 'function' })).toBe('countActive()')
    expect(callSource({ ...call, form: 'function' })).toBe('countActive(rows)')
  })

  it('parenthesizes an awaited call where the surrounding expression binds tighter', () => {
    expect(callSource({ ...call, form: 'function', awaited: true })).toBe('await countActive(rows)')
    expect(callSource({ ...call, form: 'function', awaited: true, parenthesize: true })).toBe(
      '(await countActive(rows))',
    )
  })
})

describe('dedentBy', () => {
  it('removes the column the expression used to start at from its later lines', () => {
    expect(dedentBy('first\n    second\n      third', 4)).toBe('first\nsecond\n  third')
  })

  it('leaves a line indented less than that alone', () => {
    expect(dedentBy('first\n  second', 4)).toBe('first\nsecond')
  })
})

describe('relativeImport', () => {
  it('walks up to the shared directory and back down, keeping the extension', () => {
    expect(relativeImport('packages/b/src/two.ts', 'packages/a/src/one.ts')).toBe(
      '../../a/src/one.ts',
    )
  })

  it('uses an explicit ./ for a sibling', () => {
    expect(relativeImport('packages/a/src/two.ts', 'packages/a/src/one.ts')).toBe('./one.ts')
  })
})
