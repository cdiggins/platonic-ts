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
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

const asNumber = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const firstBlockOfType = (
  blocks: readonly ContentBlock[],
  type: string,
): ContentBlock | undefined => blocks.find((b) => b.type === type)

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

  const timestamp = parseTimestamp(parsed.timestamp)
  if (timestamp === undefined) return undefined

  const sessionId = asString(parsed.sessionId)
  const isSidechain = parsed.isSidechain === true
  const type = asString(parsed.type)

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
      kind: 'assistant' as ActivityKind,
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
    kind: 'other' as ActivityKind,
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
// Discovery
// ---------------------------------------------------------------------------

const isTranscriptFileName = (name: string): boolean => name.endsWith('.jsonl') || name.endsWith('.output')

export const discoverTranscriptFiles = async (
  dirs: readonly string[],
): Promise<readonly string[]> => {
  const results: string[] = []
  for (const dir of dirs) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isFile() && isTranscriptFileName(entry.name)) {
        results.push(resolve(join(dir, entry.name)))
      }
    }
  }
  return results
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

export const pollTranscripts = async (
  dirs: readonly string[],
  state: TailState,
): Promise<{ readonly state: TailState; readonly activities: readonly AgentActivity[] }> => {
  const files = await discoverTranscriptFiles(dirs)
  const activities: AgentActivity[] = []
  const nextFiles = new Map<string, FileTailState>()

  for (const file of files) {
    let size: number
    try {
      const st = await stat(file)
      size = st.size
    } catch {
      continue
    }

    const prev = state.files.get(file) ?? { offset: 0, remainder: '' }
    const shrunk = size < prev.offset
    const offset = shrunk ? 0 : prev.offset
    const remainder = shrunk ? '' : prev.remainder

    const chunk = await readAppended(file, size, offset)
    const { lines, rest } = splitJsonlChunk(remainder, chunk)

    for (const line of lines) {
      const activity = parseTranscriptLine(file, line)
      if (activity !== undefined) activities.push(activity)
    }

    nextFiles.set(file, { offset: size, remainder: rest })
  }

  return { state: { files: nextFiles }, activities }
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

export const computeStatuses = (
  activities: readonly AgentActivity[],
  now: number,
): readonly AgentStatus[] => {
  const byFile = new Map<string, AgentActivity[]>()
  for (const a of activities) {
    const list = byFile.get(a.file)
    if (list) list.push(a)
    else byFile.set(a.file, [a])
  }

  const statuses: AgentStatus[] = []
  for (const [file, group] of byFile) {
    const sorted = [...group].sort((a, b) => a.timestamp - b.timestamp)
    const last = sorted[sorted.length - 1]
    if (!last) continue

    const lastWithModel = [...sorted].reverse().find((a) => a.model !== undefined)
    const lastWithTool = [...sorted].reverse().find((a) => a.toolName !== undefined)
    const lastWithSnippet = [...sorted].reverse().find((a) => a.snippet !== undefined)
    const lastWithSession = [...sorted].reverse().find((a) => a.sessionId !== undefined)

    const totalInputTokens = sorted.reduce((sum, a) => sum + a.inputTokens, 0)
    const totalOutputTokens = sorted.reduce((sum, a) => sum + a.outputTokens, 0)

    const ext = extname(file)
    const label = basename(file, ext)

    statuses.push({
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
    })
  }

  return statuses.sort((a, b) => a.file.localeCompare(b.file))
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

  const byModelMap = new Map<string, ModelUsage>()
  for (const a of activities) {
    if (a.model === undefined) continue
    const existing = byModelMap.get(a.model)
    const next: ModelUsage = existing
      ? {
          model: a.model,
          inputTokens: existing.inputTokens + a.inputTokens,
          outputTokens: existing.outputTokens + a.outputTokens,
          cacheReadTokens: existing.cacheReadTokens + a.cacheReadTokens,
          cacheCreationTokens: existing.cacheCreationTokens + a.cacheCreationTokens,
          messages: existing.messages + 1,
        }
      : {
          model: a.model,
          inputTokens: a.inputTokens,
          outputTokens: a.outputTokens,
          cacheReadTokens: a.cacheReadTokens,
          cacheCreationTokens: a.cacheCreationTokens,
          messages: 1,
        }
    byModelMap.set(a.model, next)
  }

  const byModel = [...byModelMap.values()].sort((a, b) => b.outputTokens - a.outputTokens)

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCacheReadTokens,
    totalCacheCreationTokens,
    byModel,
    outputTokensPerMinute: outputTokensPerMinute(activities, now, windowMs),
    windowMs,
  }
}
