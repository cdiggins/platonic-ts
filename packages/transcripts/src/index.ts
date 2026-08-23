// Parse and tail Claude Code transcript JSONL files into normalized AgentActivity
// records, plus pure aggregations (statuses, usage) over the accumulated list.

import { open, readdir, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

import {
  type ActivityKind,
  type AgentActivity,
  type AgentStatus,
  type ModelUsage,
  type UsageSummary,
  outputTokensPerMinute,
  splitJsonlChunk,
  truncate,
} from '../../core/src/index.ts'

const ACTIVE_WINDOW_MS = 120_000

// ---------------------------------------------------------------------------
// Line parsing
// ---------------------------------------------------------------------------

type ContentBlock = {
  readonly type?: unknown
  readonly text?: unknown
  readonly name?: unknown
  readonly input?: unknown
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

const asNumber = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const firstBlockOfType = (
  blocks: readonly ContentBlock[],
  type: string,
): ContentBlock | undefined => blocks.find((b) => b.type === type)

const allBlocksOfType = (
  blocks: readonly ContentBlock[],
  type: string,
): readonly ContentBlock[] => blocks.filter((b) => b.type === type)

const parseTimestamp = (raw: unknown): number | undefined => {
  const s = asString(raw)
  if (s === undefined) return undefined
  const t = Date.parse(s)
  return Number.isNaN(t) ? undefined : t
}

export const parseTranscriptLine = (file: string, line: string): AgentActivity | undefined => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined

  const sessionId = asString(parsed.sessionId)
  const isSidechain = parsed.isSidechain === true
  const type = asString(parsed.type)

  // custom-title lines carry no timestamp field ({"type":"custom-title","customTitle":"...",
  // "sessionId":"..."} — verified against real transcripts). Use a fixed sentinel timestamp
  // (0) so the record stays a valid, deterministic AgentActivity; computeStatuses only uses
  // relative order among title-bearing activities, never this value's absolute position.
  if (type === 'custom-title') {
    const customTitle = asString(parsed.customTitle)
    if (customTitle === undefined) return undefined
    const activity: AgentActivity = {
      file,
      sessionId,
      timestamp: 0,
      isSidechain,
      kind: 'other',
      model: undefined,
      toolName: undefined,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      snippet: undefined,
      title: customTitle,
    }
    return activity
  }

  const timestamp = parseTimestamp(parsed.timestamp)
  if (timestamp === undefined) return undefined

  const base = { file, sessionId, timestamp, isSidechain }

  if (type === 'assistant') {
    const message = isRecord(parsed.message) ? parsed.message : undefined
    const model = message ? asString(message.model) : undefined
    const content = message && Array.isArray(message.content) ? (message.content as ContentBlock[]) : []
    const toolUse = firstBlockOfType(content, 'tool_use')
    const textBlock = firstBlockOfType(content, 'text')
    const toolName = toolUse ? asString(toolUse.name) : undefined
    const snippetText = textBlock ? asString(textBlock.text) : undefined
    const usage = message && isRecord(message.usage) ? message.usage : undefined

    const activity: AgentActivity = {
      ...base,
      kind: 'assistant',
      model,
      toolName,
      inputTokens: usage ? asNumber(usage.input_tokens) : 0,
      outputTokens: usage ? asNumber(usage.output_tokens) : 0,
      cacheReadTokens: usage ? asNumber(usage.cache_read_input_tokens) : 0,
      cacheCreationTokens: usage ? asNumber(usage.cache_creation_input_tokens) : 0,
      snippet: snippetText === undefined ? undefined : truncate(snippetText, 120),
    }
    return activity
  }

  if (type === 'user') {
    const message = isRecord(parsed.message) ? parsed.message : undefined
    const content = message ? message.content : undefined

    let kind: ActivityKind = 'user'
    let snippetText: string | undefined

    if (typeof content === 'string') {
      snippetText = content
    } else if (Array.isArray(content)) {
      const blocks = content as ContentBlock[]
      if (blocks.length > 0 && blocks.every((b) => b.type === 'tool_result')) {
        kind = 'tool_result'
      } else {
        const textBlock = firstBlockOfType(blocks, 'text')
        snippetText = textBlock ? asString(textBlock.text) : undefined
      }
    }

    const activity: AgentActivity = {
      ...base,
      kind,
      model: undefined,
      toolName: undefined,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      snippet: snippetText === undefined ? undefined : truncate(snippetText, 120),
    }
    return activity
  }

  const activity: AgentActivity = {
    ...base,
    kind: 'other',
    model: undefined,
    toolName: undefined,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    snippet: undefined,
  }
  return activity
}

// ---------------------------------------------------------------------------
// Tool/skill invocation history (additive; does not change parseTranscriptLine)
// ---------------------------------------------------------------------------

export type ToolInvocation = {
  readonly file: string
  readonly sessionId: string | undefined
  readonly timestamp: string | undefined
  readonly tool: string
  readonly skill: string | undefined
  readonly detail: string | undefined
}

const truncateDetail = (text: string): string => truncate(text, 80)

// Short human-readable string describing the call, derived from its input. Kept under ~80
// chars. Falls back through the fields most tools are likely to carry.
const detailFromInput = (input: Record<string, unknown>): string | undefined => {
  const description = asString(input.description)
  if (description !== undefined) return truncateDetail(description)

  const filePath = asString(input.file_path) ?? asString(input.path) ?? asString(input.notebook_path)
  if (filePath !== undefined) return truncateDetail(basename(filePath))

  const command = asString(input.command)
  if (command !== undefined) return truncateDetail(command)

  const pattern = asString(input.pattern)
  if (pattern !== undefined) return truncateDetail(pattern)

  const prompt = asString(input.prompt)
  if (prompt !== undefined) return truncateDetail(prompt)

  return undefined
}

// Pure. One transcript line -> one ToolInvocation per tool_use block in an assistant
// message (all blocks, not just the first). Non-assistant lines, malformed JSON, and lines
// with no tool_use blocks all yield [].
export const parseToolInvocations = (file: string, line: string): readonly ToolInvocation[] => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return []
  }
  if (!isRecord(parsed)) return []
  if (asString(parsed.type) !== 'assistant') return []

  const sessionId = asString(parsed.sessionId)
  const timestamp = asString(parsed.timestamp)
  const message = isRecord(parsed.message) ? parsed.message : undefined
  const content = message && Array.isArray(message.content) ? (message.content as ContentBlock[]) : []
  const toolUseBlocks = allBlocksOfType(content, 'tool_use')

  return toolUseBlocks
    .map((block): ToolInvocation | undefined => {
      const tool = asString(block.name)
      if (tool === undefined) return undefined
      const input = isRecord(block.input) ? block.input : {}
      const skill = tool === 'Skill' ? asString(input.skill) : undefined
      const detail = detailFromInput(input)
      return { file, sessionId, timestamp, tool, skill, detail }
    })
    .filter((inv): inv is ToolInvocation => inv !== undefined)
}

// Pure. Most-recent-first slice of the given invocations, optionally capped to `limit`
// entries. Order among entries with equal/undefined timestamps is stable (input order
// reversed), since transcript lines already arrive in chronological order.
export const invocationHistory = (
  invocations: readonly ToolInvocation[],
  limit?: number,
): readonly ToolInvocation[] => {
  const reversed = [...invocations].reverse()
  return limit === undefined ? reversed : reversed.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const isTranscriptFileName = (name: string): boolean => name.endsWith('.jsonl') || name.endsWith('.output')

export const discoverTranscriptFiles = async (
  dirs: readonly string[],
): Promise<readonly string[]> => {
  const perDir = await Promise.all(
    dirs.map(async (dir): Promise<readonly string[]> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return []
      }
      return entries
        .filter((entry) => entry.isFile() && isTranscriptFileName(entry.name))
        .map((entry) => resolve(join(dir, entry.name)))
    }),
  )
  return perDir.flat()
}

// Subagent task transcripts live under `<tempRoot>\<session-dir>\tasks\*.output`. Returns the
// `tasks` directories that actually exist (one level under tempRoot); missing tempRoot -> [].
export const discoverSessionTaskDirs = async (
  tempRoot: string,
): Promise<readonly string[]> => {
  let entries
  try {
    entries = await readdir(tempRoot, { withFileTypes: true })
  } catch {
    return []
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(join(tempRoot, entry.name, 'tasks')))

  const checked = await Promise.all(
    candidates.map(async (dir): Promise<string | undefined> => {
      try {
        const st = await stat(dir)
        return st.isDirectory() ? dir : undefined
      } catch {
        return undefined
      }
    }),
  )

  return checked.filter((dir): dir is string => dir !== undefined)
}

// ---------------------------------------------------------------------------
// Incremental tailing
// ---------------------------------------------------------------------------

type FileTailState = {
  readonly offset: number
  readonly remainder: string
}

export type TailState = {
  readonly files: ReadonlyMap<string, FileTailState>
}

export const createTailState = (): TailState => ({ files: new Map() })

const readAppended = async (
  file: string,
  size: number,
  offset: number,
): Promise<string> => {
  if (size <= offset) return ''
  const handle = await open(file, 'r')
  try {
    const length = size - offset
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, offset)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

type FilePollResult = {
  readonly file: string
  readonly tail: FileTailState
  readonly activities: readonly AgentActivity[]
}

export const pollTranscripts = async (
  dirs: readonly string[],
  state: TailState,
): Promise<{ readonly state: TailState; readonly activities: readonly AgentActivity[] }> => {
  const files = await discoverTranscriptFiles(dirs)

  const results = await Promise.all(
    files.map(async (file): Promise<FilePollResult | undefined> => {
      let size: number
      try {
        const st = await stat(file)
        size = st.size
      } catch {
        return undefined
      }

      const prev = state.files.get(file) ?? { offset: 0, remainder: '' }
      const shrunk = size < prev.offset
      const offset = shrunk ? 0 : prev.offset
      const remainder = shrunk ? '' : prev.remainder

      const chunk = await readAppended(file, size, offset)
      const { lines, rest } = splitJsonlChunk(remainder, chunk)

      const activities = lines
        .map((line) => parseTranscriptLine(file, line))
        .filter((a): a is AgentActivity => a !== undefined)

      return { file, tail: { offset: size, remainder: rest }, activities }
    }),
  )

  const kept = results.filter((r): r is FilePollResult => r !== undefined)
  const nextFiles = new Map(kept.map((r) => [r.file, r.tail] as const))
  const activities = kept.flatMap((r) => r.activities)

  return { state: { files: nextFiles }, activities }
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

export const computeStatuses = (
  activities: readonly AgentActivity[],
  now: number,
): readonly AgentStatus[] => {
  const files = [...new Set(activities.map((a) => a.file))]

  const statuses = files
    .map((file): AgentStatus | undefined => {
      const group = activities.filter((a) => a.file === file)
      const sorted = [...group].sort((a, b) => a.timestamp - b.timestamp)
      const last = sorted[sorted.length - 1]
      if (!last) return undefined

      const lastWithModel = [...sorted].reverse().find((a) => a.model !== undefined)
      const lastWithTool = [...sorted].reverse().find((a) => a.toolName !== undefined)
      const lastWithSnippet = [...sorted].reverse().find((a) => a.snippet !== undefined)
      const lastWithSession = [...sorted].reverse().find((a) => a.sessionId !== undefined)
      const lastWithTitle = [...sorted].reverse().find((a) => a.title !== undefined)

      const totalInputTokens = sorted.reduce((sum, a) => sum + a.inputTokens, 0)
      const totalOutputTokens = sorted.reduce((sum, a) => sum + a.outputTokens, 0)

      const ext = extname(file)
      const label = lastWithTitle?.title ?? basename(file, ext)

      return {
        file,
        sessionId: lastWithSession?.sessionId,
        label,
        isSidechain: last.isSidechain,
        lastActivityAt: last.timestamp,
        lastModel: lastWithModel?.model,
        lastTool: lastWithTool?.toolName,
        lastSnippet: lastWithSnippet?.snippet,
        totalInputTokens,
        totalOutputTokens,
        active: now - last.timestamp <= ACTIVE_WINDOW_MS,
      }
    })
    .filter((s): s is AgentStatus => s !== undefined)

  return [...statuses].sort((a, b) => a.file.localeCompare(b.file))
}

export const summarizeUsage = (
  activities: readonly AgentActivity[],
  now: number,
  windowMs: number,
): UsageSummary => {
  const totalInputTokens = activities.reduce((sum, a) => sum + a.inputTokens, 0)
  const totalOutputTokens = activities.reduce((sum, a) => sum + a.outputTokens, 0)
  const totalCacheReadTokens = activities.reduce((sum, a) => sum + a.cacheReadTokens, 0)
  const totalCacheCreationTokens = activities.reduce((sum, a) => sum + a.cacheCreationTokens, 0)

  const models = [...new Set(activities.map((a) => a.model).filter((m): m is string => m !== undefined))]

  const byModel = models.map((model): ModelUsage => {
    const group = activities.filter((a) => a.model === model)
    return {
      model,
      inputTokens: group.reduce((sum, a) => sum + a.inputTokens, 0),
      outputTokens: group.reduce((sum, a) => sum + a.outputTokens, 0),
      cacheReadTokens: group.reduce((sum, a) => sum + a.cacheReadTokens, 0),
      cacheCreationTokens: group.reduce((sum, a) => sum + a.cacheCreationTokens, 0),
      messages: group.length,
    }
  })

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    byModel: [...byModel].sort((a, b) => b.outputTokens - a.outputTokens),
    outputTokensPerMinute: outputTokensPerMinute(activities, now, windowMs),
    windowMs,
  }
}
