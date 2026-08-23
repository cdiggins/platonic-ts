import { describe, expect, it } from 'vitest'

import {
  type ParsedEntry,
  compositionTable,
  dedupeEntries,
  estTokens,
  grepTable,
  parseEntry,
  renderTable,
  sessionsTable,
  toolsTable,
} from '../src/analyze.ts'

const assistantLine = (uuid: string, text: string): string =>
  JSON.stringify({
    type: 'assistant',
    uuid,
    sessionId: 'sess-1',
    timestamp: '2026-08-23T12:00:00.000Z',
    message: {
      model: 'claude-opus-5',
      content: [
        { type: 'text', text },
        { type: 'thinking', thinking: 'hmm' },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      ],
      usage: { output_tokens: 50, input_tokens: 3, cache_read_input_tokens: 1000, cache_creation_input_tokens: 20 },
    },
  })

const userLine = (uuid: string, text: string): string =>
  JSON.stringify({
    type: 'user',
    uuid,
    sessionId: 'sess-1',
    timestamp: '2026-08-23T12:01:00.000Z',
    message: { role: 'user', content: text },
  })

const EMPTY_ENTRY: ParsedEntry = {
  file: 'f.jsonl',
  sessionId: undefined,
  uuid: undefined,
  timestamp: undefined,
  role: 'other',
  isSidechain: false,
  model: undefined,
  usage: { outputTokens: 0, inputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  slices: new Map(),
  tools: [],
  results: [],
  commandNames: [],
  userText: undefined,
  lineBytes: 0,
}

const mustParse = (line: string): ParsedEntry => {
  const entry = parseEntry('f.jsonl', line)
  expect(entry).toBeDefined()
  return entry ?? EMPTY_ENTRY
}

describe('parseEntry', () => {
  it('splits assistant content into byte-counted slices', () => {
    const entry = parseEntry('f.jsonl', assistantLine('u1', 'hello'))
    expect(entry?.role).toBe('assistant')
    expect(entry?.slices.get('assistantText')).toBe(5)
    expect(entry?.slices.get('thinking')).toBe(3)
    expect(entry?.slices.get('toolUseArgs')).toBe(Buffer.byteLength('{"command":"ls"}'))
    expect(entry?.usage.outputTokens).toBe(50)
    expect(entry?.tools).toEqual([{ name: 'Bash', inputBytes: 16 }])
  })

  it('classifies injected user text separately from typed text', () => {
    const typed = parseEntry('f.jsonl', userLine('u2', 'fix the bug'))
    expect(typed?.slices.get('userText')).toBe(11)
    expect(typed?.slices.get('injected')).toBe(0)
    expect(typed?.userText).toBe('fix the bug')

    const injected = parseEntry('f.jsonl', userLine('u3', '<system-reminder>x</system-reminder>'))
    expect(injected?.slices.get('userText')).toBe(0)
    expect((injected?.slices.get('injected') ?? 0) > 0).toBe(true)
    expect(injected?.userText).toBeUndefined()
  })

  it('counts UTF-8 bytes, not characters', () => {
    const entry = parseEntry('f.jsonl', userLine('u4', 'héllo'))
    expect(entry?.slices.get('userText')).toBe(6)
  })

  it('returns undefined for malformed lines', () => {
    expect(parseEntry('f.jsonl', 'not json')).toBeUndefined()
    expect(parseEntry('f.jsonl', '')).toBeUndefined()
  })
})

describe('dedupeEntries', () => {
  it('keeps first occurrence of a uuid and entries without uuids', () => {
    const a = mustParse(assistantLine('dup', 'one'))
    const b = { ...mustParse(assistantLine('dup', 'one')), file: 'b.jsonl' }
    const noId = mustParse(JSON.stringify({ type: 'other', timestamp: '2026-08-23T12:00:00Z' }))
    expect(dedupeEntries([a, b, noId, noId])).toEqual([a, noId, noId])
  })
})

describe('tables', () => {
  const entries = [
    mustParse(userLine('u1', 'please explain this')),
    mustParse(assistantLine('a1', 'answer')),
    mustParse(assistantLine('a2', 'more')),
  ]

  it('composition sums slices and API totals', () => {
    const t = compositionTable(entries)
    const outRow = t.rows.find((r) => r[0] === 'output tokens (billed)')
    expect(outRow?.[3]).toBe('100')
    const textRow = t.rows.find((r) => r[0] === 'assistant visible text')
    expect(textRow?.[1]).toBe('10')
  })

  it('grep attributes following assistant output tokens to the matching message', () => {
    const t = grepTable(entries, /explain/i)
    expect(t.rows).toHaveLength(1)
    expect(t.rows[0]?.[2]).toBe('100')
  })

  it('sessions and tools views render without throwing', () => {
    expect(renderTable(sessionsTable(entries))).toContain('sess-1')
    expect(renderTable(toolsTable(entries))).toContain('Bash')
  })
})

describe('estTokens', () => {
  it('rounds bytes/4', () => {
    expect(estTokens(10)).toBe(3)
  })
})
