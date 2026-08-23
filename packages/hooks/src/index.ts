// Pure event type + JSONL codec for Claude Code hook events. IO (reading hook stdin payloads,
// appending to the event log) lives in postToolUse.ts / sessionStart.ts. Tailing live events
// is via tail.ts (pollHookEvents).

import { asString, isRecord } from './payload.ts'
export type { HookTailState } from './tail.ts'
export { createHookTailState, pollHookEvents } from './tail.ts'

// Event logged by Claude Code hooks: a tool use or session start with context metadata.
export type HookEvent = {
  readonly type: 'tool' | 'session-start'
  readonly timestamp: string
  readonly sessionId: string
  readonly tool?: string
  readonly skill?: string
  readonly cwd?: string
}

const isHookEventType = (v: unknown): v is HookEvent['type'] => v === 'tool' || v === 'session-start'

// Pure. One JSONL line -> HookEvent, or undefined for malformed/unrecognized lines.
export const parseHookEventLine = (line: string): HookEvent | undefined => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  if (!isHookEventType(parsed.type)) return undefined

  const timestamp = asString(parsed.timestamp)
  const sessionId = asString(parsed.sessionId)
  if (timestamp === undefined || sessionId === undefined) return undefined

  const tool = asString(parsed.tool)
  const skill = asString(parsed.skill)
  const cwd = asString(parsed.cwd)

  return {
    type: parsed.type,
    timestamp,
    sessionId,
    ...(tool === undefined ? {} : { tool }),
    ...(skill === undefined ? {} : { skill }),
    ...(cwd === undefined ? {} : { cwd }),
  }
}

// Pure. HookEvent -> one JSONL line. parseHookEventLine(formatHookEvent(e)) round-trips.
export const formatHookEvent = (event: HookEvent): string => JSON.stringify(event)
