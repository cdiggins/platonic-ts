// Runnable PreToolUse hook entry point (`tsx packages/hooks/src/preToolUse.ts`), matched on the
// Bash and PowerShell tools. Reads the payload Claude Code pipes to stdin and refuses commands that stage or
// commit files the agent did not name. Unlike this package's logging hooks, this one is meant
// to block: exit code 2 cancels the tool call and returns stderr to the agent as a correction.

import { pathToFileURL } from 'node:url'

import { refusalMessage, stagingViolations } from './gitStaging.ts'
import { readStdinPayload, refuse } from './io.ts'
import { asString, isRecord } from './payload.ts'

// The shell command a Bash-tool PreToolUse payload carries, or '' when the payload is not one.
export const commandFrom = (payload: unknown): string => {
  if (!isRecord(payload)) return ''
  const input = payload.tool_input
  return (isRecord(input) ? asString(input.command) : undefined) ?? ''
}

const REMEDY = [
  'Commit the files you touched by name:',
  '  git commit -m "<message>" -- packages/foo/src/a.ts packages/foo/test/a.test.ts',
  '',
  'Run `git status --porcelain` first if you are unsure which files are yours.',
]

const main = (): void => {
  // Fails open: any error here would block every Bash call in the repository.
  const violations = ((): readonly string[] => {
    try {
      return stagingViolations(commandFrom(readStdinPayload()))
    } catch {
      return []
    }
  })()
  if (violations.length === 0) return
  refuse(refusalMessage(violations, REMEDY), 2)
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) main()
