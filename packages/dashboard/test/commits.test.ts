import { describe, expect, it } from 'vitest'
import type { CommitInfo, CommitSessionLink } from '../../gitlink/src/index.ts'
import { buildCommitRows } from '../src/commits.ts'

const commit = (overrides: Partial<CommitInfo> = {}): CommitInfo => ({
  hash: 'abcdef1234567890',
  timestamp: '2026-08-22T10:00:00.000Z',
  subject: 'do the thing',
  trailers: {},
  ...overrides,
})

describe('buildCommitRows', () => {
  it('shortens the hash and carries subject/timestamp through', () => {
    const rows = buildCommitRows([commit()], [])
    const row = rows[0]
    expect(row?.hash).toBe('abcdef1234567890')
    expect(row?.shortHash).toBe('abcdef1')
    expect(row?.subject).toBe('do the thing')
    expect(row?.timestamp).toBe('2026-08-22T10:00:00.000Z')
  })

  it('falls back to confidence "none" and no session label when no link matches', () => {
    const rows = buildCommitRows([commit()], [])
    expect(rows[0]?.confidence).toBe('none')
    expect(rows[0]?.sessionLabel).toBeUndefined()
  })

  it('joins a trailer-confidence link by hash and uses sessionId as the label', () => {
    const links: readonly CommitSessionLink[] = [
      { hash: 'abcdef1234567890', sessionId: 'sess-1', confidence: 'trailer' },
    ]
    const rows = buildCommitRows([commit()], links)
    expect(rows[0]?.confidence).toBe('trailer')
    expect(rows[0]?.sessionLabel).toBe('sess-1')
  })

  it('falls back to sessionFile as the label when sessionId is absent', () => {
    const links: readonly CommitSessionLink[] = [
      { hash: 'abcdef1234567890', sessionFile: '/a.jsonl', confidence: 'time-window' },
    ]
    const rows = buildCommitRows([commit()], links)
    expect(rows[0]?.confidence).toBe('time-window')
    expect(rows[0]?.sessionLabel).toBe('/a.jsonl')
  })

  it('preserves commit order (newest first, as git log and correlateCommits already produce)', () => {
    const commits = [commit({ hash: 'h1' }), commit({ hash: 'h2' })]
    const rows = buildCommitRows(commits, [])
    expect(rows.map((r) => r.hash)).toEqual(['h1', 'h2'])
  })
})
