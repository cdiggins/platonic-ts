import { describe, it, expect } from 'vitest'
import {
  changedSince,
  describeSnapshot,
  restorePlan,
  snapshotOfWorkspace,
  takeSnapshot,
  type FileReader,
  type Snapshot,
} from '../src/checkpoint.ts'
import { applyEdits } from '../src/edit.ts'
import { workspaceOf } from './fixture.ts'

const TAKEN_AT = Date.UTC(2026, 7, 23, 12, 0, 0)

const readerOf = (files: Readonly<Record<string, string>>): FileReader => ({
  read: (file) => Promise.resolve(files[file]),
})

const mapOf = (files: Readonly<Record<string, string>>): ReadonlyMap<string, string> =>
  new Map(Object.entries(files))

const snapshotOf = (files: Readonly<Record<string, string>>): Snapshot => ({
  label: 'before-rename',
  takenAt: TAKEN_AT,
  files: mapOf(files),
})

const original = {
  'a.ts': 'export const first = 1\n',
  'b.ts': 'export const second = 2\n',
}

describe('takeSnapshot', () => {
  it('records the text of every file the reader can read', async () => {
    const snapshot = await takeSnapshot(readerOf(original), 'before-rename', TAKEN_AT, [
      'a.ts',
      'b.ts',
    ])
    expect(snapshot.label).toBe('before-rename')
    expect(snapshot.takenAt).toBe(TAKEN_AT)
    expect([...snapshot.files.keys()].sort()).toEqual(['a.ts', 'b.ts'])
    expect(snapshot.files.get('a.ts')).toBe(original['a.ts'])
  })

  it('leaves out a file the reader cannot read, which records that it did not exist', async () => {
    const snapshot = await takeSnapshot(readerOf(original), 'before-rename', TAKEN_AT, [
      'a.ts',
      'gone.ts',
    ])
    expect(snapshot.files.has('gone.ts')).toBe(false)
    expect([...snapshot.files.keys()]).toEqual(['a.ts'])
  })

  it('distinguishes an unreadable file from an empty one', async () => {
    const snapshot = await takeSnapshot(
      readerOf({ 'empty.ts': '', 'a.ts': original['a.ts'] }),
      'before-rename',
      TAKEN_AT,
      ['empty.ts', 'missing.ts'],
    )
    expect(snapshot.files.get('empty.ts')).toBe('')
    expect(snapshot.files.has('empty.ts')).toBe(true)
    expect(snapshot.files.has('missing.ts')).toBe(false)
  })
})

describe('snapshotOfWorkspace', () => {
  it('takes the texts straight from the workspace sources', () => {
    const workspace = workspaceOf(original)
    const snapshot = snapshotOfWorkspace(workspace, 'wave-start', TAKEN_AT)
    expect(snapshot.label).toBe('wave-start')
    expect([...snapshot.files.keys()].sort()).toEqual(['a.ts', 'b.ts'])
    expect(snapshot.files.get('a.ts')).toBe(original['a.ts'])
    expect(snapshot.files.get('b.ts')).toBe(original['b.ts'])
  })

  it('produces a snapshot that reports no change against the workspace it came from', () => {
    const workspace = workspaceOf(original)
    const snapshot = snapshotOfWorkspace(workspace, 'wave-start', TAKEN_AT)
    const current = new Map(
      [...workspace.sources].map(([file, source]) => [file, source.text] as const),
    )
    expect(changedSince(snapshot, current)).toEqual([])
  })
})

describe('changedSince', () => {
  it('returns nothing when the current texts match the snapshot', () => {
    expect(changedSince(snapshotOf(original), mapOf(original))).toEqual([])
  })

  it('names every differing file, sorted', () => {
    const current = mapOf({
      'a.ts': 'export const first = 111\n',
      'b.ts': 'export const second = 222\n',
    })
    expect(changedSince(snapshotOf(original), current)).toEqual(['a.ts', 'b.ts'])
  })

  it('counts a file present in only one of the two as changed', () => {
    const current = mapOf({ 'a.ts': original['a.ts'], 'new.ts': 'export const third = 3\n' })
    expect(changedSince(snapshotOf(original), current)).toEqual(['b.ts', 'new.ts'])
  })
})

describe('restorePlan', () => {
  it('declines when nothing changed, naming the label', () => {
    const plan = restorePlan(snapshotOf(original), mapOf(original))
    expect(plan.ok).toBe(false)
    expect(plan.ok === false ? plan.text : '').toBe('nothing changed since before-rename')
  })

  it('restores one edited file to the exact original bytes', () => {
    const edited = 'export const first = 1\nexport const extra = 9\n'
    const plan = restorePlan(snapshotOf(original), mapOf({ ...original, 'a.ts': edited }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.edits).toHaveLength(1)
    expect(applyEdits(edited, plan.edits)).toBe(original['a.ts'])
  })

  it('restores several changed files, each to its own original bytes', () => {
    const current = {
      'a.ts': 'export const first = 1 // touched\n',
      'b.ts': '',
      'c.ts': 'export const third = 3\n',
    }
    const snapshot = snapshotOf({ ...original, 'c.ts': current['c.ts'] })
    const plan = restorePlan(snapshot, mapOf(current))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.edits.map((edit) => edit.file)).toEqual(['a.ts', 'b.ts'])
    expect(applyEdits(current['a.ts'], plan.edits.filter((edit) => edit.file === 'a.ts'))).toBe(
      original['a.ts'],
    )
    expect(applyEdits(current['b.ts'], plan.edits.filter((edit) => edit.file === 'b.ts'))).toBe(
      original['b.ts'],
    )
    expect(plan.summary).toContain('restored 2 files to before-rename')
  })

  it('computes offsets against the current text, not the snapshot text', () => {
    // The current text is far longer than the snapshot's. An `end` taken from
    // the snapshot would leave the tail of the current text in place, so this
    // assertion fails loudly if the two are ever swapped.
    const grown = `${original['a.ts']}${'export const padding = 0\n'.repeat(20)}`
    const plan = restorePlan(snapshotOf(original), mapOf({ ...original, 'a.ts': grown }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const edit = plan.edits[0]
    expect(edit?.start).toBe(0)
    expect(edit?.end).toBe(grown.length)
    expect(edit?.end).not.toBe(original['a.ts'].length)
    expect(applyEdits(grown, plan.edits)).toBe(original['a.ts'])
  })

  it('computes offsets against a current text shorter than the snapshot', () => {
    const shrunk = 'x\n'
    const plan = restorePlan(snapshotOf(original), mapOf({ ...original, 'a.ts': shrunk }))
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.edits[0]?.end).toBe(shrunk.length)
    expect(applyEdits(shrunk, plan.edits)).toBe(original['a.ts'])
  })

  it('declines the whole restore when a file was added since the snapshot, naming it', () => {
    const current = mapOf({ ...original, 'added.ts': 'export const third = 3\n' })
    const plan = restorePlan(snapshotOf(original), current)
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toContain('cannot restore before-rename')
    expect(plan.text).toContain('added.ts')
    expect(plan.text).toContain('an edit plan cannot remove')
  })

  it('declines the whole restore when a file is missing since the snapshot, naming it', () => {
    const plan = restorePlan(snapshotOf(original), mapOf({ 'a.ts': original['a.ts'] }))
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toContain('cannot restore before-rename')
    expect(plan.text).toContain('present at snapshot time and now missing: b.ts')
  })

  it('names both problems when a file was added and another deleted', () => {
    const current = mapOf({ 'a.ts': original['a.ts'], 'added.ts': 'export const third = 3\n' })
    const plan = restorePlan(snapshotOf(original), current)
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toContain('added.ts')
    expect(plan.text).toContain('b.ts')
  })

  it('refuses rather than half-restoring when an edit and an addition are mixed', () => {
    const current = mapOf({
      'a.ts': 'export const first = 999\n',
      'b.ts': original['b.ts'],
      'added.ts': 'export const third = 3\n',
    })
    const plan = restorePlan(snapshotOf(original), current)
    expect(plan.ok).toBe(false)
  })
})

describe('describeSnapshot', () => {
  it('reports the label, the time, the file count, and that nothing changed', () => {
    const output = describeSnapshot(snapshotOf(original), mapOf(original))
    expect(output.ok).toBe(true)
    expect(output.text).toContain('before-rename')
    expect(output.text).toContain('2026-08-23T12:00:00.000Z')
    expect(output.text).toContain('2 files')
    expect(output.text).toContain('nothing changed since')
  })

  it('gives one line per changed file with the direction of the change', () => {
    const current = mapOf({
      'a.ts': 'export const first = 999\n',
      'added.ts': 'export const third = 3\n',
    })
    const lines = describeSnapshot(snapshotOf(original), current).text.split('\n')
    expect(lines).toContain('  a.ts — modified since the snapshot')
    expect(lines).toContain('  added.ts — added since the snapshot')
    expect(lines).toContain('  b.ts — deleted since the snapshot')
    expect(lines[1]).toBe('3 files changed since:')
  })
})
