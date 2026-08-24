// Runnable PreToolUse hook entry point (`tsx packages/hooks/src/preToolUse.ts`), matched on the
// Bash and PowerShell tools. Reads the payload Claude Code pipes to stdin and refuses commands
// that stage files the agent did not name, or that cannot parse in the shell they were sent to.
//
// Unlike this package's logging hooks, this one is meant to block: exit code 2 cancels the tool
// call and returns stderr to the agent as a correction. It still fails open on its own errors,
// since a broken guard here would block every command in the repository.

import { pathToFileURL } from 'node:url'

import { STAGING_RATIONALE, stagingViolations } from './gitStaging.ts'
import { readStdinPayload, refuse } from './io.ts'
import { asString, isRecord } from './payload.ts'
import { POWERSHELL_RATIONALE, POWERSHELL_REMEDY, powershellViolations } from './powershell.ts'
import { refusalMessage } from './refusal.ts'

// The shell command a PreToolUse payload carries, or '' for payloads that carry none.
export const commandFrom = (payload: unknown): string => {
  if (!isRecord(payload)) return ''
  const input = payload.tool_input
  return (isRecord(input) ? asString(input.command) : undefined) ?? ''
}

const STAGING_REMEDY = [
  'Commit the files you touched by name:',
  '  git commit -m "<message>" -- packages/foo/src/a.ts packages/foo/test/a.test.ts',
  '',
  'Run `git status --porcelain` first if you are unsure which files are yours.',
]

// The refusal for a payload, or undefined to let the command run. Exported for tests: it is the
// whole decision, with stdin and the exit code left to main.
export const refusalFor = (payload: unknown): string | undefined => {
  const command = commandFrom(payload)
  const tool = isRecord(payload) ? asString(payload.tool_name) : undefined

  // Dialect first: a command that cannot parse never reaches the staging question.
  const dialect = tool === 'PowerShell' ? powershellViolations(command) : []
  if (dialect.length > 0) return refusalMessage(dialect, POWERSHELL_RATIONALE, POWERSHELL_REMEDY)

  const staging = stagingViolations(command)
  if (staging.length > 0) return refusalMessage(staging, STAGING_RATIONALE, STAGING_REMEDY)

  return undefined
}

const main = (): void => {
  const refusal = ((): string | undefined => {
    try {
      return refusalFor(readStdinPayload())
    } catch {
      return undefined
    }
  })()
  if (refusal === undefined) return
  refuse(refusal, 2)
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) main()
