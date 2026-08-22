import { describe, expect, it } from 'vitest'
import {
  outputTokensPerMinute,
  splitJsonlChunk,
  truncate,
  type AgentActivity,
} from '../src/index.ts'

const activity = (timestamp: number, outputTokens: number): AgentActivity => ({
  file: 'f.jsonl',
  sessionId: 's',
  timestamp,
  kind: 'assistant',
  model: 'm',
  toolName: undefined,
  inputTokens: 0,
  outputTokens,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  snippet: undefined,
  isSidechain: false,
})

describe('splitJsonlChunk', () => {
  it('returns complete lines and keeps the partial tail', () => {
    const { lines, rest } = splitJsonlChunk('', '{"a":1}\n{"b":2}\n{"c"')
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
    expect(rest).toBe('{"c"')
  })

  it('joins the previous remainder with the new chunk', () => {
    const { lines, rest } = splitJsonlChunk('{"c"', ':3}\n')
    expect(lines).toEqual(['{"c":3}'])
    expect(rest).toBe('')
  })

  it('strips carriage returns and empty lines', () => {
    const { lines } = splitJsonlChunk('', '{"a":1}\r\n\r\n{"b":2}\n')
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
  })
})

describe('outputTokensPerMinute', () => {
  it('scales window totals to a per-minute rate', () => {
    const now = 120_000
    const acts = [activity(30_000, 100), activity(110_000, 200)]
    expect(outputTokensPerMinute(acts, now, 120_000)).toBe(150)
  })

  it('ignores activity outside the window', () => {
    const acts = [activity(0, 500), activity(59_000, 100)]
    expect(outputTokensPerMinute(acts, 60_000, 10_000)).toBe(600)
  })
})

describe('truncate', () => {
  it('leaves short text alone and shortens long text with ellipsis', () => {
    expect(truncate('abc', 5)).toBe('abc')
    expect(truncate('abcdef', 5)).toBe('abcd…')
  })
})
