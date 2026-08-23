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

// WorkQuarry schema (see backlog/decisions/2026-08-22-adopt-workquarry-format.md).
// idea = captured, untriaged. ready = triaged + pickable. in-progress = being worked.
// done/dropped = closed (dropped: killed without shipping).
export type BacklogStatus = 'idea' | 'ready' | 'in-progress' | 'done' | 'dropped'

export type BacklogType = 'feature' | 'debt' | 'bug' | 'idea' | 'problem' | 'retire'

export type BacklogPriority = 'p1' | 'p2' | 'p3' | '?'

export type BacklogEffort = 'S' | 'M' | 'L' | '?'

export type BacklogRisk = 'low' | 'med' | 'high' | '?'

export type BacklogItem = {
  readonly id: string
  readonly title: string
  readonly type: BacklogType
  readonly status: BacklogStatus
  readonly priority: BacklogPriority
  readonly effort: BacklogEffort
  readonly risk: BacklogRisk
  readonly area: string | undefined
  readonly sprint: string | undefined
  readonly owner: string | undefined
  readonly created: string | undefined
  readonly closed: string | undefined
  readonly links: readonly string[]
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

// ---------------------------------------------------------------------------
// Code overview browser (BL-0016). Produced by packages/codemap, served by
// packages/codeview. Paths are repo-relative and use forward slashes on every
// platform, so they are stable identifiers in URLs and in the index.
// ---------------------------------------------------------------------------

export type SourceSpan = {
  readonly start: number
  readonly length: number
}

export type SymbolKind =
  | 'function'
  | 'variable'
  | 'type'
  | 'interface'
  | 'class'
  | 'enum'
  | 'method'
  | 'property'
  | 'module'
  | 'other'

// `${file}#${declaration name start offset}` — stable while the file is unchanged.
export type SymbolId = string

export type SymbolInfo = {
  readonly id: SymbolId
  readonly name: string
  readonly kind: SymbolKind
  readonly file: string
  readonly span: SourceSpan
  readonly line: number
  readonly exported: boolean
  readonly containerName: string | undefined
  readonly signature: string | undefined
}

export type SymbolReference = {
  readonly symbolId: SymbolId
  readonly file: string
  readonly span: SourceSpan
  readonly line: number
  readonly isDefinition: boolean
}

// One metric shape at every granularity (function, file, folder) so the same
// renderer and the same score apply to all three. Counts are sums; a folder's
// metrics are the sum of its files'.
export type CodeMetrics = {
  readonly lines: number
  // Every node of the TypeScript AST in this unit, the unit's own root included.
  readonly nodes: number
  readonly statements: number
  readonly maxNestingDepth: number
  readonly parameters: number
  readonly mutableBindings: number
  readonly classes: number
  readonly throwStatements: number
  readonly explicitAny: number
  readonly asCasts: number
  readonly nonNullAssertions: number
  readonly tsDirectives: number
  readonly eslintDisables: number
  readonly exportedSymbols: number
  readonly imports: number
  // 0..100. 100 = no measured deviation from the platonic ideals. Computed by
  // scoreMetrics in packages/codemap; never stored independently.
  readonly platonicScore: number
}

export type FunctionMetrics = {
  readonly symbolId: SymbolId
  readonly name: string
  readonly line: number
  readonly metrics: CodeMetrics
}

export type FileKind = 'typescript' | 'markdown' | 'other'

export type FileEntry = {
  readonly file: string
  readonly kind: FileKind
  readonly sizeBytes: number
  readonly metrics: CodeMetrics | undefined
  readonly functions: readonly FunctionMetrics[]
}

export type FolderEntry = {
  readonly path: string
  readonly fileCount: number
  readonly metrics: CodeMetrics
}

export type CodeIndex = {
  readonly generatedAt: number
  readonly root: string
  readonly files: readonly FileEntry[]
  readonly folders: readonly FolderEntry[]
  readonly symbols: readonly SymbolInfo[]
  readonly references: readonly SymbolReference[]
}

// What GET /api/file returns: everything needed to render one file's page.
export type FileView = {
  readonly file: string
  readonly kind: FileKind
  readonly html: string
  readonly metrics: CodeMetrics | undefined
  readonly functions: readonly FunctionMetrics[]
  readonly symbols: readonly SymbolInfo[]
}

// Feedback typed into the code browser and routed into `backlog/` as a new item.
export type FeedbackInput = {
  readonly text: string
  readonly file: string | undefined
  readonly symbol: string | undefined
}

export type FeedbackResult = {
  readonly id: string
  readonly file: string
}
