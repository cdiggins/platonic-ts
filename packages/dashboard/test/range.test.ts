import { describe, expect, it } from 'vitest'
import type { AgentActivity } from '../../core/src/index.ts'
import {
  DEFAULT_USAGE_RANGE,
  parseUsageRange,
  sliceActivitiesByRange,
  USAGE_RANGES,
  usageRangeLabel,
} from '../src/range.ts'

const activity = (timestamp: number, overrides: Partial<AgentActivity> = {}): AgentActivity => ({
  file: 'a.jsonl',
  sessionId: 's1',
  timestamp,
  kind: 'assistant',
  model: 'claude-sonnet-5',
  toolName: undefined,
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  snippet: undefined,
  isSidechain: false,
  ...overrides,
})

describe('parseUsageRange', () => {
  it('accepts every known range key', () => {
    for (const r of USAGE_RANGES) {
      expect(parseUsageRange(r)).toBe(r)
    }
  })

  it('falls back to the default for unknown or missing values', () => {
    expect(parseUsageRange(undefined)).toBe(DEFAULT_USAGE_RANGE)
    expect(parseUsageRange('')).toBe(DEFAULT_USAGE_RANGE)
    expect(parseUsageRange('bogus')).toBe(DEFAULT_USAGE_RANGE)
  })
})

describe('usageRangeLabel', () => {
  it('has a human label for every range', () => {
    for (const r of USAGE_RANGES) {
      expect(usageRangeLabel(r).length).toBeGreaterThan(0)
    }
  })
})

describe('sliceActivitiesByRange', () => {
  const now = new Date('2026-08-22T15:00:00.000Z').getTime()
  // Local-timezone day boundary, matching sliceActivitiesByRange's own
  // `new Date(now).setHours(0,0,0,0)` so this test is timezone-independent.
  const dayStart = (() => {
    const d = new Date(now)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  })()
  const oneHourAgo = now - 60 * 60_000

  it('all returns everything unchanged', () => {
    const activities = [activity(0), activity(now), activity(now + 1)]
    expect(sliceActivitiesByRange(activities, 'all', now)).toEqual(activities)
  })

  it('last-hour includes the boundary and excludes just before it', () => {
    const boundary = activity(oneHourAgo)
    const justBefore = activity(oneHourAgo - 1)
    const inside = activity(now - 1_000)
    const future = activity(now + 1_000)
    const result = sliceActivitiesByRange([justBefore, boundary, inside, future], 'last-hour', now)
    expect(result).toEqual([boundary, inside])
  })

  it('today includes local-day-start boundary and excludes the prior instant', () => {
    const boundary = activity(dayStart)
    const justBefore = activity(dayStart - 1)
    const laterToday = activity(now - 1_000)
    const result = sliceActivitiesByRange([justBefore, boundary, laterToday], 'today', now)
    expect(result).toEqual([boundary, laterToday])
  })

  it('last-100 keeps only the final 100 by index, oldest-appended-first order', () => {
    const activities = Array.from({ length: 150 }, (_, i) => activity(i))
    const result = sliceActivitiesByRange(activities, 'last-100', now)
    expect(result).toHaveLength(100)
    expect(result[0]).toEqual(activity(50))
    expect(result[result.length - 1]).toEqual(activity(149))
  })

  it('last-500 is a no-op when the list is shorter than the window', () => {
    const activities = [activity(0), activity(1), activity(2)]
    expect(sliceActivitiesByRange(activities, 'last-500', now)).toEqual(activities)
  })

  it('last-100 is a no-op when the list is exactly the window size', () => {
    const activities = Array.from({ length: 100 }, (_, i) => activity(i))
    expect(sliceActivitiesByRange(activities, 'last-100', now)).toEqual(activities)
  })
})
