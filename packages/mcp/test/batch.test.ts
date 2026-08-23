import { describe, it, expect } from 'vitest'
import { combinePlans } from '../src/batch.ts'
import { overlapping } from '../src/edit.ts'
import type { EditPlan, FileEdit } from '../src/edit.ts'

const edit = (file: string, start: number, end: number, text: string): FileEdit => ({
  file,
  start,
  end,
  text,
})

const planOf = (summary: string, edits: readonly FileEdit[]): EditPlan => ({
  ok: true,
  edits,
  summary,
})

describe('overlapping', () => {
  it('finds nothing in an empty list', () => {
    expect(overlapping([])).toEqual([])
  })

  it('reports edits in one file whose ranges intersect', () => {
    expect(overlapping([edit('a.ts', 12, 40, 'x'), edit('a.ts', 30, 55, 'y')])).toEqual([
      'a.ts: 12-40 overlaps 30-55',
    ])
  })

  it('accepts edits that only touch at a point', () => {
    expect(overlapping([edit('a.ts', 10, 20, 'x'), edit('a.ts', 20, 30, 'y')])).toEqual([])
  })

  it('rejects two insertions at the same offset, whose order is undefined', () => {
    expect(overlapping([edit('a.ts', 10, 10, 'x'), edit('a.ts', 10, 10, 'y')])).toEqual([
      'a.ts: 10-10 overlaps 10-10',
    ])
  })

  it('accepts identical ranges in different files', () => {
    expect(overlapping([edit('a.ts', 10, 20, 'x'), edit('b.ts', 10, 20, 'y')])).toEqual([])
  })

  it('reports every colliding pair, ordered by position', () => {
    expect(
      overlapping([
        edit('a.ts', 50, 60, 'z'),
        edit('a.ts', 0, 100, 'x'),
        edit('a.ts', 10, 20, 'y'),
      ]),
    ).toEqual(['a.ts: 0-100 overlaps 10-20', 'a.ts: 0-100 overlaps 50-60'])
  })
})

describe('combinePlans', () => {
  it('refuses an empty list rather than returning an empty success', () => {
    expect(combinePlans([])).toEqual({ ok: false, text: 'no plans to combine.' })
  })

  it('concatenates the edits and stacks the summaries under a count header', () => {
    const combined = combinePlans([
      planOf('a.ts:1 — replaced first', [edit('a.ts', 0, 5, 'one')]),
      planOf('b.ts:2 — replaced third', [edit('b.ts', 0, 5, 'two'), edit('b.ts', 10, 15, 'three')]),
    ])
    expect(combined).toEqual({
      ok: true,
      edits: [
        edit('a.ts', 0, 5, 'one'),
        edit('b.ts', 0, 5, 'two'),
        edit('b.ts', 10, 15, 'three'),
      ],
      summary: [
        '2 plans combined, 3 edits:',
        'a.ts:1 — replaced first',
        'b.ts:2 — replaced third',
      ].join('\n'),
    })
  })

  it('reports every failure, not only the first', () => {
    expect(
      combinePlans([
        { ok: false, text: 'no declaration named alpha. Try search.' },
        planOf('a.ts:1 — replaced first', [edit('a.ts', 0, 5, 'one')]),
        { ok: false, text: 'new source does not parse: missing )' },
      ]),
    ).toEqual({
      ok: false,
      text: [
        '2 of 3 plans failed:',
        'no declaration named alpha. Try search.',
        'new source does not parse: missing )',
      ].join('\n'),
    })
  })

  it('refuses plans whose edits collide, naming the collisions', () => {
    expect(
      combinePlans([
        planOf('first', [edit('a.ts', 12, 40, 'one')]),
        planOf('second', [edit('a.ts', 30, 55, 'two')]),
      ]),
    ).toEqual({
      ok: false,
      text: ['1 overlapping edits:', 'a.ts: 12-40 overlaps 30-55'].join('\n'),
    })
  })

  it('accepts plans whose edits meet end to end', () => {
    const combined = combinePlans([
      planOf('first', [edit('a.ts', 0, 10, 'one')]),
      planOf('second', [edit('a.ts', 10, 20, 'two')]),
    ])
    expect(combined.ok).toBe(true)
  })

  it('passes a single plan through with its summary under the header', () => {
    expect(combinePlans([planOf('only', [edit('a.ts', 0, 1, 'x')])])).toEqual({
      ok: true,
      edits: [edit('a.ts', 0, 1, 'x')],
      summary: '1 plans combined, 1 edits:\nonly',
    })
  })
})
