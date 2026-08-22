// Shared contract types and pure helpers for the platonic-ts observability layer.
// Supervisor-owned: tracks read this file, request changes via NOTES.md, never edit it.

// ---------------------------------------------------------------------------
// Activity: one normalized record derived from a Claude Code transcript line.
// ---------------------------------------------------------------------------

export type ActivityKind = 'assistant' | 'user' | 'tool_result' | 'other'

export type AgentActivity = {
  readonly file: string
  readonly sessionId: string | undefined
  readonly timestamp: number
  readonly kind: ActivityKind
  readonly model: string | undefined
  readonly toolName: string | undefined
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheCreationTokens: number
  readonly snippet: string | undefined
  // Human-readable session title when the line carries one (custom-title lines).
  // Optional so wave-1 call sites stay valid; Track E populates it.
  readonly title?: string | undefined
  readonly isSidechain: boolean
}

// ---------------------------------------------------------------------------
// Derived views served by the dashboard.
// ---------------------------------------------------------------------------

export type AgentStatus = {
  readonly file: string
  readonly sessionId: string | undefined
  readonly label: string
  readonly isSidechain: boolean
  readonly lastActivityAt: number
  readonly lastModel: string | undefined
  readonly lastTool: string | undefined
  readonly lastSnippet: string | undefined
  readonly totalInputTokens: number
  readonly totalOutputTokens: number
  readonly active: boolean
}

export type ModelUsage = {
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheCreationTokens: number
  readonly messages: number
}

export type UsageSummary = {
  readonly totalInputTokens: number
  readonly totalOutputTokens: number
  readonly totalCacheReadTokens: number
  readonly totalCacheCreationTokens: number
  readonly byModel: readonly ModelUsage[]
  readonly outputTokensPerMinute: number
  readonly windowMs: number
}

export type BacklogStatus = 'todo' | 'doing' | 'done' | 'blocked'

export type BacklogItem = {
  readonly id: string
  readonly title: string
  readonly status: BacklogStatus
  readonly priority: number
  readonly owner: string | undefined
  readonly created: string | undefined
  readonly file: string
  readonly body: string
}

export type DocInfo = {
  readonly file: string
  readonly title: string
  readonly modifiedAt: number
  readonly sizeBytes: number
}

export type DashboardSnapshot = {
  readonly generatedAt: number
  readonly agents: readonly AgentStatus[]
  readonly usage: UsageSummary
  readonly backlog: readonly BacklogItem[]
  readonly docs: readonly DocInfo[]
}

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

// Splits a chunk of appended JSONL text into complete lines plus a trailing
// remainder (an incomplete final line to be prepended to the next chunk).
export const splitJsonlChunk = (
  remainder: string,
  chunk: string,
): { readonly lines: readonly string[]; readonly rest: string } => {
  const combined = remainder + chunk
  const parts = combined.split('\n')
  const rest = parts[parts.length - 1] ?? ''
  const lines = parts
    .slice(0, -1)
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line.length > 0)
  return { lines, rest }
}

// Output tokens per minute over a sliding window ending at `now`.
export const outputTokensPerMinute = (
  activities: readonly AgentActivity[],
  now: number,
  windowMs: number,
): number => {
  const start = now - windowMs
  const total = activities
    .filter((a) => a.timestamp >= start && a.timestamp <= now)
    .reduce((sum, a) => sum + a.outputTokens, 0)
  return windowMs <= 0 ? 0 : (total * 60_000) / windowMs
}

export const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
