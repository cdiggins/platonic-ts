// Pure usage-range slicing (BL-0008). Dashboard-side only: slices the raw activity
// list before feeding it into `summarizeUsage`/`outputTokensPerMinute` from
// packages/core and packages/transcripts. No packages/core edits.

import type { AgentActivity } from '../../core/src/index.ts'

export type UsageRangeKey = 'last-hour' | 'today' | 'all' | 'last-100' | 'last-500'

export const USAGE_RANGES: readonly UsageRangeKey[] = [
  'last-hour',
  'today',
  'all',
  'last-100',
  'last-500',
]

export const DEFAULT_USAGE_RANGE: UsageRangeKey = 'today'

export const usageRangeLabel = (range: UsageRangeKey): string => {
  const labels: Record<UsageRangeKey, string> = {
    'last-hour': 'Last hour',
    today: 'Today',
    all: 'All time',
    'last-100': 'Last 100 activities',
    'last-500': 'Last 500 activities',
  }
  return labels[range]
}

// Accepts an arbitrary query-param value and returns a valid range, falling back
// to the default for anything unrecognized (missing param, typo, stale client).
export const parseUsageRange = (value: string | undefined): UsageRangeKey =>
  USAGE_RANGES.find((range) => range === value) ?? DEFAULT_USAGE_RANGE

const startOfDay = (now: number): number => {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const ONE_HOUR_MS = 60 * 60_000

// Slice `activities` (assumed in original discovery/tail order, not necessarily
// timestamp-sorted) down to the ones the given range should include. Time-based
// ranges filter by timestamp; count-based ranges keep the last N by array index,
// which is how `main.ts` appends newly polled activities (chronological append).
// Requesting more items than exist is safe (`slice(-n)` on a short array is a
// no-op).
export const sliceActivitiesByRange = (
  activities: readonly AgentActivity[],
  range: UsageRangeKey,
  now: number,
): readonly AgentActivity[] => {
  switch (range) {
    case 'all':
      return activities
    case 'last-hour': {
      const start = now - ONE_HOUR_MS
      return activities.filter((a) => a.timestamp >= start && a.timestamp <= now)
    }
    case 'today': {
      const start = startOfDay(now)
      return activities.filter((a) => a.timestamp >= start && a.timestamp <= now)
    }
    case 'last-100':
      return activities.slice(-100)
    case 'last-500':
      return activities.slice(-500)
  }
}
