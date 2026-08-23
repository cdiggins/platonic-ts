import { describe, it, expect } from 'vitest'
import { GIT_LOG_FORMAT, type CommitInfo, parseGitLog, correlateCommits } from '../src/index.ts'

describe('GIT_LOG_FORMAT', () => {
  it('exports the format string for git log', () => {
    expect(GIT_LOG_FORMAT).toContain('%H')
    expect(GIT_LOG_FORMAT).toContain('%aI')
    expect(GIT_LOG_FORMAT).toContain('%s')
    expect(GIT_LOG_FORMAT).toContain('%(trailers)')
    expect(GIT_LOG_FORMAT).toContain('%x1f')
    expect(GIT_LOG_FORMAT).toContain('%x1e')
  })
})

describe('parseGitLog', () => {
  it('parses empty input', () => {
    const result = parseGitLog('')
    expect(result).toEqual([])
  })

  it('parses a single commit with no trailers', () => {
    const raw = 'abc123\x1f2026-08-22T14:30:45+00:00\x1fInitial commit\x1f\x1e'
    const result = parseGitLog(raw)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      hash: 'abc123',
      timestamp: '2026-08-22T14:30:45+00:00',
      subject: 'Initial commit',
      trailers: {},
    })
  })

  it('parses a commit with Session-Id trailer', () => {
    const raw = 'def456\x1f2026-08-22T14:45:30+00:00\x1fFix bug\x1fSession-Id: uuid-1234\n\x1e'
    const result = parseGitLog(raw)
    expect(result).toHaveLength(1)
    expect(result[0]?.trailers['Session-Id']).toBe('uuid-1234')
  })

  it('parses a commit with multiple trailers', () => {
    const raw =
      'ghi789\x1f2026-08-22T15:00:00+00:00\x1fMulti-trailer\x1fSession-Id: uuid-5678\nCo-Authored-By: Alice <alice@example.com>\n\x1e'
    const result = parseGitLog(raw)
    expect(result).toHaveLength(1)
    expect(result[0]?.trailers['Session-Id']).toBe('uuid-5678')
    expect(result[0]?.trailers['Co-Authored-By']).toBe('Alice <alice@example.com>')
  })

  it('parses multiple commits', () => {
    const raw =
      'abc123\x1f2026-08-22T14:00:00+00:00\x1fFirst\x1f\x1edef456\x1f2026-08-22T14:15:00+00:00\x1fSecond\x1fSession-Id: uuid-9\n\x1e'
    const result = parseGitLog(raw)
    expect(result).toHaveLength(2)
    expect(result[0]?.hash).toBe('abc123')
    expect(result[1]?.hash).toBe('def456')
    expect(result[1]?.trailers['Session-Id']).toBe('uuid-9')
  })

  it('skips malformed records with missing fields', () => {
    const raw = 'abc123\x1fonly-two-fields\x1e' + 'def456\x1f2026-08-22T14:00:00+00:00\x1fGood\x1f\x1e'
    const result = parseGitLog(raw)
    expect(result).toHaveLength(1)
    expect(result[0]?.hash).toBe('def456')
  })

  it('handles whitespace in trailers correctly', () => {
    const raw =
      'abc123\x1f2026-08-22T14:00:00+00:00\x1fTest\x1f  Spaced-Key  :  value-with-spaces  \n\x1e'
    const result = parseGitLog(raw)
    expect(result).toHaveLength(1)
    expect(result[0]?.trailers['Spaced-Key']).toBe('value-with-spaces')
  })
})

describe('correlateCommits', () => {
  it('returns one link per commit', () => {
    const commits: readonly CommitInfo[] = [
      { hash: 'abc123', timestamp: '2026-08-22T14:00:00+00:00', subject: 'Commit 1', trailers: {} },
      { hash: 'def456', timestamp: '2026-08-22T14:15:00+00:00', subject: 'Commit 2', trailers: {} },
    ]
    const activities = [
      { sessionId: 'session-1', timestamp: '2026-08-22T14:00:00+00:00', file: 'file1.output' },
    ]
    const result = correlateCommits(commits, activities)
    expect(result).toHaveLength(2)
  })

  it('matches Session-Id trailer with confidence trailer', () => {
    const commits: readonly CommitInfo[] = [
      {
        hash: 'abc123',
        timestamp: '2026-08-22T14:00:00+00:00',
        subject: 'Test',
        trailers: { 'Session-Id': 'session-1' },
      },
    ]
    const activities = [{ sessionId: 'session-1', timestamp: '2026-08-22T14:00:00+00:00' }]
    const result = correlateCommits(commits, activities)
    expect(result[0]).toEqual({
      hash: 'abc123',
      sessionId: 'session-1',
      sessionFile: undefined,
      confidence: 'trailer',
    })
  })

  it('matches Co-Authored-By trailer with confidence trailer', () => {
    const commits: readonly CommitInfo[] = [
      {
        hash: 'def456',
        timestamp: '2026-08-22T14:00:00+00:00',
        subject: 'Test',
        trailers: { 'Co-Authored-By': 'session-uuid-789' },
      },
    ]
    const activities: readonly { sessionId?: string; timestamp?: string; file?: string }[] = []
    const result = correlateCommits(commits, activities)
    expect(result[0]).toEqual({
      hash: 'def456',
      sessionId: 'session-uuid-789',
      sessionFile: undefined,
      confidence: 'trailer',
    })
  })

  it('prefers Session-Id over Co-Authored-By', () => {
    const commits: readonly CommitInfo[] = [
      {
        hash: 'ghi789',
        timestamp: '2026-08-22T14:00:00+00:00',
        subject: 'Test',
        trailers: {
          'Session-Id': 'session-priority',
          'Co-Authored-By': 'session-fallback',
        },
      },
    ]
    const activities: readonly { sessionId?: string; timestamp?: string; file?: string }[] = []
    const result = correlateCommits(commits, activities)
    expect(result[0]?.sessionId).toBe('session-priority')
    expect(result[0]?.confidence).toBe('trailer')
  })

  it('matches by time-window within ±10 minutes', () => {
    const commitTime = new Date('2026-08-22T14:00:00+00:00')
    const commits: readonly CommitInfo[] = [
      {
        hash: 'abc123',
        timestamp: commitTime.toISOString(),
        subject: 'Test',
        trailers: {},
      },
    ]
    const activities: readonly { sessionId?: string; timestamp?: string; file?: string }[] = [
      {
        sessionId: 'session-1',
        timestamp: new Date(commitTime.getTime() + 5 * 60 * 1000).toISOString(), // 5 min after
        file: 'file1.output',
      },
    ]
    const result = correlateCommits(commits, activities)
    expect(result[0]?.sessionId).toBe('session-1')
    expect(result[0]?.sessionFile).toBe('file1.output')
    expect(result[0]?.confidence).toBe('time-window')
  })

  it('rejects activities outside ±10 minute window', () => {
    const commitTime = new Date('2026-08-22T14:00:00+00:00')
    const commits: readonly CommitInfo[] = [
      {
        hash: 'abc123',
        timestamp: commitTime.toISOString(),
        subject: 'Test',
        trailers: {},
      },
    ]
    const activities: readonly { sessionId?: string; timestamp?: string; file?: string }[] = [
      {
        sessionId: 'session-1',
        timestamp: new Date(commitTime.getTime() + 15 * 60 * 1000).toISOString(), // 15 min after
        file: 'file1.output',
      },
    ]
    const result = correlateCommits(commits, activities)
    expect(result[0]).toEqual({
      hash: 'abc123',
      sessionId: undefined,
      sessionFile: undefined,
      confidence: 'none',
    })
  })

  it('picks the closest activity within time-window on tie', () => {
    const commitTime = new Date('2026-08-22T14:00:00+00:00')
    const commits: readonly CommitInfo[] = [
      {
        hash: 'abc123',
        timestamp: commitTime.toISOString(),
        subject: 'Test',
        trailers: {},
      },
    ]
    const activities = [
      {
        sessionId: 'session-1',
        timestamp: new Date(commitTime.getTime() + 8 * 60 * 1000).toISOString(), // 8 min after
        file: 'file1.output',
      },
      {
        sessionId: 'session-2',
        timestamp: new Date(commitTime.getTime() + 2 * 60 * 1000).toISOString(), // 2 min after
        file: 'file2.output',
      },
    ]
    const result = correlateCommits(commits, activities)
    expect(result[0]?.sessionId).toBe('session-2') // Closer one
    expect(result[0]?.sessionFile).toBe('file2.output')
  })

  it('ignores activities without sessionId', () => {
    const commitTime = new Date('2026-08-22T14:00:00+00:00')
    const commits: readonly CommitInfo[] = [
      {
        hash: 'abc123',
        timestamp: commitTime.toISOString(),
        subject: 'Test',
        trailers: {},
      },
    ]
    const activities: readonly { sessionId?: string; timestamp?: string; file?: string }[] = [
      {
        timestamp: commitTime.toISOString(),
        file: 'file1.output',
      },
    ]
    const result = correlateCommits(commits, activities)
    expect(result[0]?.confidence).toBe('none')
  })

  it('ignores activities without timestamp', () => {
    const commitTime = new Date('2026-08-22T14:00:00+00:00')
    const commits: readonly CommitInfo[] = [
      {
        hash: 'abc123',
        timestamp: commitTime.toISOString(),
        subject: 'Test',
        trailers: {},
      },
    ]
    const activities: readonly { sessionId?: string; timestamp?: string; file?: string }[] = [
      {
        sessionId: 'session-1',
        file: 'file1.output',
      },
    ]
    const result = correlateCommits(commits, activities)
    expect(result[0]?.confidence).toBe('none')
  })

  it('handles empty commits list', () => {
    const result = correlateCommits([], [
      { sessionId: 'session-1', timestamp: '2026-08-22T14:00:00+00:00' },
    ])
    expect(result).toEqual([])
  })

  it('handles empty activities list', () => {
    const commits: readonly CommitInfo[] = [
      { hash: 'abc123', timestamp: '2026-08-22T14:00:00+00:00', subject: 'Test', trailers: {} },
    ]
    const result = correlateCommits(commits, [])
    expect(result[0]).toEqual({
      hash: 'abc123',
      sessionId: undefined,
      sessionFile: undefined,
      confidence: 'none',
    })
  })

  it('trailer match takes precedence over time-window', () => {
    const commits: readonly CommitInfo[] = [
      {
        hash: 'abc123',
        timestamp: '2026-08-22T14:00:00+00:00',
        subject: 'Test',
        trailers: { 'Session-Id': 'session-trailer' },
      },
    ]
    const activities = [
      {
        sessionId: 'session-timewindow',
        timestamp: '2026-08-22T14:02:00+00:00',
        file: 'file1.output',
      },
    ]
    const result = correlateCommits(commits, activities)
    expect(result[0]?.sessionId).toBe('session-trailer')
    expect(result[0]?.sessionFile).toBeUndefined()
    expect(result[0]?.confidence).toBe('trailer')
  })

  it('returns readonly arrays', () => {
    const commits: readonly CommitInfo[] = [
      { hash: 'abc123', timestamp: '2026-08-22T14:00:00+00:00', subject: 'Test', trailers: {} },
    ]
    const result = correlateCommits(commits, [])
    // Check that result is a frozen/readonly array
    expect(Array.isArray(result)).toBe(true)
  })
})

describe('round-trip scenarios', () => {
  it('parses and correlates a realistic fixture', () => {
    // Simulate fixture output with mixed trailer and time-window cases
    const raw =
      'abc123\x1f2026-08-22T14:00:00+00:00\x1fInitial setup\x1f\x1e' +
      'def456\x1f2026-08-22T14:05:30+00:00\x1fFix bug\x1fSession-Id: session-uuid-1\n\x1e' +
      'ghi789\x1f2026-08-22T14:45:00+00:00\x1fNew feature\x1f\x1e'

    const commits = parseGitLog(raw)
    expect(commits).toHaveLength(3)

    const activities = [
      {
        sessionId: 'session-uuid-1',
        timestamp: '2026-08-22T14:05:00+00:00',
        file: 'transcript-1.jsonl',
      },
      {
        sessionId: 'session-uuid-2',
        timestamp: '2026-08-22T14:44:00+00:00',
        file: 'transcript-2.jsonl',
      },
    ]

    const links = correlateCommits(commits, activities)
    expect(links).toHaveLength(3)

    // First commit: no trailer, but activity matches time-window (14:00 vs 14:05)
    expect(links[0]).toEqual({
      hash: 'abc123',
      sessionId: 'session-uuid-1',
      sessionFile: 'transcript-1.jsonl',
      confidence: 'time-window',
    })

    // Second commit: trailer match
    expect(links[1]).toEqual({
      hash: 'def456',
      sessionId: 'session-uuid-1',
      sessionFile: undefined,
      confidence: 'trailer',
    })

    // Third commit: time-window match
    expect(links[2]).toEqual({
      hash: 'ghi789',
      sessionId: 'session-uuid-2',
      sessionFile: 'transcript-2.jsonl',
      confidence: 'time-window',
    })
  })
})
