import { describe, it, expect } from 'vitest'
import { previewPlan, unifiedDiff } from '../src/preview.ts'
import type { EditPlan } from '../src/edit.ts'
import { workspaceOf } from './fixture.ts'

const diff = (before: string, after: string): string => unifiedDiff('f.ts', before, after, 3)

describe('unifiedDiff', () => {
  it('reports nothing when the texts are identical', () => {
    expect(diff('a\nb\nc\n', 'a\nb\nc\n')).toBe('')
  })

  it('renders a pure insertion', () => {
    expect(diff('a\nb\nc\n', 'a\nb\nX\nc\n')).toBe(
      ['--- f.ts', '+++ f.ts', '@@ -1,3 +1,4 @@', ' a', ' b', '+X', ' c'].join('\n'),
    )
  })

  it('renders a pure deletion', () => {
    expect(diff('a\nb\nc\n', 'a\nc\n')).toBe(
      ['--- f.ts', '+++ f.ts', '@@ -1,3 +1,2 @@', ' a', '-b', ' c'].join('\n'),
    )
  })

  it('renders a replacement with the deletion before the insertion', () => {
    expect(diff('a\nb\nc\n', 'a\nB\nc\n')).toBe(
      ['--- f.ts', '+++ f.ts', '@@ -1,3 +1,3 @@', ' a', '-b', '+B', ' c'].join('\n'),
    )
  })

  it('renders an edit at the very start of the file', () => {
    expect(diff('a\nb\nc\n', 'X\nb\nc\n')).toBe(
      ['--- f.ts', '+++ f.ts', '@@ -1,3 +1,3 @@', '-a', '+X', ' b', ' c'].join('\n'),
    )
  })

  it('renders an edit at the very end of the file', () => {
    expect(diff('a\nb\nc\n', 'a\nb\nZ\n')).toBe(
      ['--- f.ts', '+++ f.ts', '@@ -1,3 +1,3 @@', ' a', ' b', '-c', '+Z'].join('\n'),
    )
  })

  it('marks both sides when neither has a trailing newline', () => {
    expect(diff('a\nb', 'a\nB')).toBe(
      [
        '--- f.ts',
        '+++ f.ts',
        '@@ -1,2 +1,2 @@',
        ' a',
        '-b',
        '\\ No newline at end of file',
        '+B',
        '\\ No newline at end of file',
      ].join('\n'),
    )
  })

  it('reports a difference that is only the final newline', () => {
    expect(diff('a\nb', 'a\nb\n')).toBe(
      [
        '--- f.ts',
        '+++ f.ts',
        '@@ -1,2 +1,2 @@',
        ' a',
        '-b',
        '\\ No newline at end of file',
        '+b',
      ].join('\n'),
    )
  })

  it('writes an empty range for a file that had no lines', () => {
    expect(diff('', 'x\n')).toBe(['--- f.ts', '+++ f.ts', '@@ -0,0 +1 @@', '+x'].join('\n'))
  })

  it('keeps only the requested number of context lines', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', ''].join('\n')
    const after = ['1', '2', '3', 'X', '5', '6', '7', ''].join('\n')
    expect(unifiedDiff('f.ts', before, after, 1)).toBe(
      ['--- f.ts', '+++ f.ts', '@@ -3,3 +3,3 @@', ' 3', '-4', '+X', ' 5'].join('\n'),
    )
  })

  it('splits distant changes into separate hunks', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ''].join('\n')
    const after = ['X', '2', '3', '4', '5', '6', '7', '8', 'Y', ''].join('\n')
    expect(unifiedDiff('f.ts', before, after, 1)).toBe(
      [
        '--- f.ts',
        '+++ f.ts',
        '@@ -1,2 +1,2 @@',
        '-1',
        '+X',
        ' 2',
        '@@ -8,2 +8,2 @@',
        ' 8',
        '-9',
        '+Y',
      ].join('\n'),
    )
  })
})

const sources = {
  'a.ts': 'export const first = 1\nexport const second = 2\n',
  'b.ts': 'export const third = 3\n',
}

const workspace = workspaceOf(sources)

const offsetOf = (file: 'a.ts' | 'b.ts', needle: string): number => sources[file].indexOf(needle)

describe('previewPlan', () => {
  it('shows one diff per file of a successful multi-file plan', () => {
    const plan: EditPlan = {
      ok: true,
      summary: 'two files touched',
      edits: [
        { file: 'a.ts', start: offsetOf('a.ts', '1'), end: offsetOf('a.ts', '1') + 1, text: '9' },
        { file: 'b.ts', start: offsetOf('b.ts', '3'), end: offsetOf('b.ts', '3') + 1, text: '7' },
      ],
    }
    const output = previewPlan(workspace, plan)
    expect(output.ok).toBe(true)
    expect(output.text).toBe(
      [
        'two files touched',
        '',
        '--- a.ts',
        '+++ a.ts',
        '@@ -1,2 +1,2 @@',
        '-export const first = 1',
        '+export const first = 9',
        ' export const second = 2',
        '',
        '--- b.ts',
        '+++ b.ts',
        '@@ -1 +1 @@',
        '-export const third = 3',
        '+export const third = 7',
      ].join('\n'),
    )
  })

  it('previews a failed plan as the reason it will not run', () => {
    expect(previewPlan(workspace, { ok: false, text: 'no declaration named nope. Try search.' })).toEqual(
      { ok: false, text: 'no declaration named nope. Try search.' },
    )
  })

  it('declines a plan that edits a file the index does not have', () => {
    const plan: EditPlan = {
      ok: true,
      summary: 'one file touched',
      edits: [{ file: 'gone.ts', start: 0, end: 1, text: 'x' }],
    }
    expect(previewPlan(workspace, plan)).toEqual({ ok: false, text: 'gone.ts is not indexed.' })
  })

  it('says so when the edits change nothing', () => {
    const plan: EditPlan = {
      ok: true,
      summary: 'nothing to do',
      edits: [{ file: 'b.ts', start: 0, end: 6, text: 'export' }],
    }
    expect(previewPlan(workspace, plan)).toEqual({
      ok: true,
      text: 'nothing to do\n\nb.ts — no change',
    })
  })
})
