// Runnable SessionStart hook entry point (`tsx packages/hooks/src/sessionStart.ts`). Reads the
// SessionStart payload Claude Code pipes to stdin ({ session_id, cwd, source, ... }) and appends
// one HookEvent line to `<cwd>/.claude/events/events.jsonl`. Never throws and never sets a
// non-zero exit code: a hook must not block the agent.

import { pathToFileURL } from 'node:url'

import type { HookEvent } from './index.ts'
import { appendHookEvent, readStdinPayload } from './io.ts'
import { asString, isRecord } from './payload.ts'

// Exported (pure) so test/hooks.test.ts can exercise payload mapping without touching stdin.
export const buildEvent = (payload: unknown): HookEvent | undefined => {
  if (!isRecord(payload)) return undefined
  const sessionId = asString(payload.session_id)
  if (sessionId === undefined) return undefined

  const cwd = asString(payload.cwd)

  return {
    type: 'session-start',
    timestamp: new Date().toISOString(),
    sessionId,
    ...(cwd === undefined ? {} : { cwd }),
  }
}

const main = (): void => {
  try {
    const payload = readStdinPayload()
    const event = buildEvent(payload)
    if (event === undefined) return
    const repoRoot = (isRecord(payload) ? asString(payload.cwd) : undefined) ?? process.cwd()
    appendHookEvent(repoRoot, event)
  } catch {
    // A hook must never block the agent: swallow every error and exit 0 regardless.
  }
}

// Only run when executed directly (`tsx sessionStart.ts`), not when imported by tests —
// otherwise importing this module would block forever reading stdin.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) main()
