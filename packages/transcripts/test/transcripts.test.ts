import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  computeStatuses,
  createTailState,
  discoverTranscriptFiles,
  parseTranscriptLine,
  pollTranscripts,
  summarizeUsage,
} from '../src/index.ts'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'sample.jsonl')

const loadFixtureLines = async (): Promise<readonly string[]> => {
  const content = await readFile(FIXTURE, 'utf8')
  return content.split('\n').filter((l) => l.length > 0)
}

describe('parseTranscriptLine', () => {
  it('parses an assistant text line', async () => {
    const lines = await loadFixtureLines()
    const activity = parseTranscriptLine(FIXTURE, lines[0]!)
    expect(activity).toBeDefined()
    expect(activity?.kind).toBe('assistant')
    expect(activity?.model).toBe('claude-opus-4')
    expect(activity?.snippet).toBe('Looking at the file now.')
    expect(activity?.inputTokens).toBe(100)
    expect(activity?.outputTokens).toBe(20)
    expect(activity?.cacheReadTokens).toBe(5)
    expect(activity?.cacheCreationTokens).toBe(1)
    expect(activity?.toolName).toBeUndefined()
    expect(activity?.sessionId).toBe('sess-1')
    expect(activity?.isSidechain).toBe(false)
  })

  it('parses an assistant tool_use line', async () => {
    const lines = await loadFixtureLines()
    const activity = parseTranscriptLine(FIXTURE, lines[1]!)
    expect(activity?.kind).toBe('assistant')
    expect(activity?.toolName).toBe('Read')
    expect(activity?.snippet).toBeUndefined()
    expect(activity?.inputTokens).toBe(50)
    expect(activity?.outputTokens).toBe(10)
    expect(activity?.cacheReadTokens).toBe(0)
  })

  it('parses a plain user string message', async () => {
    const lines = await loadFixtureLines()
    const activity = parseTranscriptLine(FIXTURE, lines[2]!)
    expect(activity?.kind).toBe('user')
    expect(activity?.snippet).toBe('please continue')
    expect(activity?.model).toBeUndefined()
  })

  it('parses a user tool_result message', async () => {
    const lines = await loadFixtureLines()
    const activity = parseTranscriptLine(FIXTURE, lines[3]!)
    expect(activity?.kind).toBe('tool_result')
  })

  it('parses a user array-of-text message', async () => {
    const lines = await loadFixtureLines()
    const activity = parseTranscriptLine(FIXTURE, lines[4]!)
    expect(activity?.kind).toBe('user')
    expect(activity?.snippet).toBe('another note from user')
  })

  it('parses an other-typed line with a timestamp as kind other', async () => {
    const lines = await loadFixtureLines()
    const activity = parseTranscriptLine(FIXTURE, lines[5]!)
    expect(activity?.kind).toBe('other')
    expect(activity?.timestamp).toBeGreaterThan(0)
  })

  it('returns undefined for a line with no timestamp', async () => {
    const lines = await loadFixtureLines()
    const activity = parseTranscriptLine(FIXTURE, lines[6]!)
    expect(activity).toBeUndefined()
  })

  it('returns undefined for malformed JSON', async () => {
    const lines = await loadFixtureLines()
    const activity = parseTranscriptLine(FIXTURE, lines[7]!)
    expect(activity).toBeUndefined()
  })

  it('returns undefined for an empty line', () => {
    expect(parseTranscriptLine(FIXTURE, '')).toBeUndefined()
    expect(parseTranscriptLine(FIXTURE, '   ')).toBeUndefined()
  })

  it('truncates long snippets to 120 chars', () => {
    const longText = 'x'.repeat(200)
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-22T10:00:00.000Z',
      sessionId: 's',
      isSidechain: false,
      message: { model: 'm', content: [{ type: 'text', text: longText }], usage: {} },
    })
    const activity = parseTranscriptLine('f', line)
    expect(activity?.snippet?.length).toBe(120)
  })
})

describe('discoverTranscriptFiles', () => {
  it('finds .jsonl and .output files non-recursively, skipping missing dirs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'transcripts-discover-'))
    try {
      await writeFile(join(dir, 'a.jsonl'), '')
      await writeFile(join(dir, 'b.output'), '')
      await writeFile(join(dir, 'c.txt'), '')
      const found = await discoverTranscriptFiles([dir, join(dir, 'does-not-exist')])
      const names = found.map((f) => f.split(/[\\/]/).pop())
      expect(names.sort()).toEqual(['a.jsonl', 'b.output'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('pollTranscripts', () => {
  it('tails appended bytes incrementally and resets on shrink', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'transcripts-tail-'))
    try {
      const file = join(dir, 'session.jsonl')
      const line1 = JSON.stringify({
        type: 'assistant',
        timestamp: '2026-08-22T10:00:00.000Z',
        sessionId: 's1',
        isSidechain: false,
        message: { model: 'm', content: [{ type: 'text', text: 'first' }], usage: { output_tokens: 1 } },
      })
      await writeFile(file, line1 + '\n')

      let state = createTailState()
      const first = await pollTranscripts([dir], state)
      expect(first.activities).toHaveLength(1)
      expect(first.activities[0]?.snippet).toBe('first')
      state = first.state

      const second = await pollTranscripts([dir], state)
      expect(second.activities).toHaveLength(0)
      state = second.state

      const line2 = JSON.stringify({
        type: 'assistant',
        timestamp: '2026-08-22T10:00:05.000Z',
        sessionId: 's1',
        isSidechain: false,
        message: { model: 'm', content: [{ type: 'text', text: 'second' }], usage: { output_tokens: 2 } },
      })
      await writeFile(file, line2 + '\n', { flag: 'a' })

      const third = await pollTranscripts([dir], state)
      expect(third.activities).toHaveLength(1)
      expect(third.activities[0]?.snippet).toBe('second')
      state = third.state

      // Shrink the file (simulating truncation) and write a fresh line; offset should reset.
      const line3 = JSON.stringify({
        type: 'assistant',
        timestamp: '2026-08-22T10:00:10.000Z',
        sessionId: 's1',
        isSidechain: false,
        message: { model: 'm', content: [{ type: 'text', text: 'restarted' }], usage: { output_tokens: 3 } },
      })
      await writeFile(file, line3 + '\n')

      const fourth = await pollTranscripts([dir], state)
      expect(fourth.activities).toHaveLength(1)
      expect(fourth.activities[0]?.snippet).toBe('restarted')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('handles a partial trailing line across polls', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'transcripts-partial-'))
    try {
      const file = join(dir, 'session.jsonl')
      const full = JSON.stringify({
        type: 'assistant',
        timestamp: '2026-08-22T10:00:00.000Z',
        sessionId: 's1',
        isSidechain: false,
        message: { model: 'm', content: [{ type: 'text', text: 'whole' }], usage: {} },
      })
      // Write the line without a trailing newline (partial from the writer's perspective).
      await writeFile(file, full)

      let state = createTailState()
      const first = await pollTranscripts([dir], state)
      expect(first.activities).toHaveLength(0)
      state = first.state

      await writeFile(file, '\n', { flag: 'a' })
      const second = await pollTranscripts([dir], state)
      expect(second.activities).toHaveLength(1)
      expect(second.activities[0]?.snippet).toBe('whole')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('computeStatuses', () => {
  it('groups by file, marks active, and picks last known fields', () => {
    const now = Date.parse('2026-08-22T10:01:00.000Z')
    const activities = [
      parseTranscriptLine('/a.jsonl', JSON.stringify({
        type: 'assistant', timestamp: '2026-08-22T10:00:00.000Z', sessionId: 's1', isSidechain: false,
        message: { model: 'model-a', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 5 } },
      }))!,
      parseTranscriptLine('/a.jsonl', JSON.stringify({
        type: 'user', timestamp: '2026-08-22T10:00:30.000Z', sessionId: 's1', isSidechain: false,
        message: { content: [{ type: 'tool_result', content: 'ok' }] },
      }))!,
      parseTranscriptLine('/b.jsonl', JSON.stringify({
        type: 'assistant', timestamp: '2026-08-22T09:00:00.000Z', sessionId: 's2', isSidechain: true,
        message: { model: 'model-b', content: [{ type: 'text', text: 'old' }], usage: { input_tokens: 1, output_tokens: 1 } },
      }))!,
    ]

    const statuses = computeStatuses(activities, now)
    expect(statuses).toHaveLength(2)

    const a = statuses.find((s) => s.file === '/a.jsonl')!
    expect(a.label).toBe('a')
    expect(a.active).toBe(true)
    expect(a.lastModel).toBe('model-a')
    expect(a.totalInputTokens).toBe(10)
    expect(a.totalOutputTokens).toBe(5)

    const b = statuses.find((s) => s.file === '/b.jsonl')!
    expect(b.label).toBe('b')
    expect(b.active).toBe(false)
    expect(b.isSidechain).toBe(true)
  })
})

describe('summarizeUsage', () => {
  it('totals tokens, groups byModel sorted desc by outputTokens, computes rate', () => {
    const now = Date.parse('2026-08-22T10:01:00.000Z')
    const activities = [
      parseTranscriptLine('/a.jsonl', JSON.stringify({
        type: 'assistant', timestamp: '2026-08-22T10:00:00.000Z', sessionId: 's1', isSidechain: false,
        message: { model: 'model-a', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 } },
      }))!,
      parseTranscriptLine('/a.jsonl', JSON.stringify({
        type: 'assistant', timestamp: '2026-08-22T10:00:30.000Z', sessionId: 's1', isSidechain: false,
        message: { model: 'model-b', content: [{ type: 'text', text: 'yo' }], usage: { input_tokens: 20, output_tokens: 40 } },
      }))!,
    ]

    const summary = summarizeUsage(activities, now, 60_000)
    expect(summary.totalInputTokens).toBe(30)
    expect(summary.totalOutputTokens).toBe(45)
    expect(summary.totalCacheReadTokens).toBe(2)
    expect(summary.totalCacheCreationTokens).toBe(1)
    expect(summary.byModel).toHaveLength(2)
    expect(summary.byModel[0]?.model).toBe('model-b')
    expect(summary.byModel[0]?.outputTokens).toBe(40)
    expect(summary.byModel[1]?.model).toBe('model-a')
    expect(summary.windowMs).toBe(60_000)
    expect(summary.outputTokensPerMinute).toBeGreaterThan(0)
  })
})
