// IO edge for hook scripts: read the JSON payload Claude Code pipes to a hook's stdin, and
// append formatted events to the repo's event log. Kept separate from index.ts so the codec
// (parseHookEventLine/formatHookEvent) stays pure and testable without touching the filesystem.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { formatHookEvent, type HookEvent } from './index.ts'

// Reads and JSON-parses the hook payload from stdin (fd 0). Returns undefined on any failure
// (empty stdin, invalid JSON) rather than throwing — callers treat that as "no event to log".
export const readStdinPayload = (): unknown => {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return undefined
  }
}

// Appends one JSONL line for `event` to `<repoRoot>/.claude/events/events.jsonl`, creating the
// directory if it doesn't exist yet. Synchronous: hook scripts are short-lived processes and
// must finish before Claude Code proceeds.
export const appendHookEvent = (repoRoot: string, event: HookEvent): void => {
  const file = join(repoRoot, '.claude', 'events', 'events.jsonl')
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${formatHookEvent(event)}\n`, 'utf8')
}
