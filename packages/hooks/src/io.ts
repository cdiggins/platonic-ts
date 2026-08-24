// IO edge for hook scripts: read the JSON payload Claude Code pipes to a hook's stdin, and
// append formatted events to the repo's event log. Kept separate from index.ts so the codec
// (parseHookEventLine/formatHookEvent) stays pure and testable without touching the filesystem.

import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeSync } from 'node:fs'
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

// Refuses the operation a guard was asked to allow: writes the reason to fd 2 and exits
// non-zero. Both halves matter — Claude Code and git surface a hook's stderr only when it also
// fails. Exit 2 cancels a tool call and feeds stderr back to the agent; git treats any non-zero
// exit as a rejected commit.
export const refuse = (message: string, exitCode: number): void => {
  writeSync(2, `${message}\n`)
  process.exitCode = exitCode
}

// Repo-relative paths staged for the commit in progress. Returns an empty list if git cannot
// be run, so a broken environment fails open rather than blocking every commit.
export const stagedPaths = (): readonly string[] => {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMRT'], {
      encoding: 'utf8',
    })
    return out.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  } catch {
    return []
  }
}

// True when the committer has declared a deliberate cross-package commit via
// PLATONIC_WIDE_COMMIT=1. Read here because environment access is an IO edge.
export const wideCommitAllowed = (): boolean => process.env.PLATONIC_WIDE_COMMIT === '1'
