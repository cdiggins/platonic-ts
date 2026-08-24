// Guards the wiring, not the rules: does the command in .claude/settings.json actually run and
// actually block? A PreToolUse hook that fails to launch exits non-2 and Claude Code lets the
// tool call through, so a mistyped command turns the guard off with no error anywhere. That
// happened once — `tsx` is not on PATH — and the rule tests all still passed.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..', '..', '..')

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// The command Claude Code is configured to run for PreToolUse, read the way Claude Code reads it.
const configuredCommand = (): { readonly command: string; readonly matcher: string } => {
  const settings: unknown = JSON.parse(readFileSync(join(repoRoot, '.claude', 'settings.json'), 'utf8'))
  const hooks = isRecord(settings) && isRecord(settings.hooks) ? settings.hooks.PreToolUse : undefined
  const entry: unknown = Array.isArray(hooks) ? hooks[0] : undefined
  const inner: unknown = isRecord(entry) && Array.isArray(entry.hooks) ? entry.hooks[0] : undefined
  const command = isRecord(inner) && typeof inner.command === 'string' ? inner.command : ''
  const matcher = isRecord(entry) && typeof entry.matcher === 'string' ? entry.matcher : ''
  return { command, matcher }
}

const runHook = (payload: unknown): { readonly status: number | null; readonly stderr: string } => {
  const result = spawnSync(configuredCommand().command, {
    cwd: repoRoot,
    input: JSON.stringify(payload),
    shell: true,
    encoding: 'utf8',
  })
  return { status: result.status, stderr: result.stderr }
}

describe('PreToolUse wiring', () => {
  it('matches both shell tools', () => {
    const { matcher } = configuredCommand()
    expect(matcher).toContain('Bash')
    expect(matcher).toContain('PowerShell')
  })

  it('launches: a violation exits 2 rather than failing to start', () => {
    const { status, stderr } = runHook({ tool_name: 'Bash', tool_input: { command: 'git add -A' } })
    // 127 here means the interpreter was not found, which reads as "allowed" to Claude Code.
    expect(status).toBe(2)
    expect(stderr).toContain('stages files you did not name')
  })

  it('blocks POSIX chaining sent to PowerShell', () => {
    const { status } = runHook({ tool_name: 'PowerShell', tool_input: { command: 'a && b' } })
    expect(status).toBe(2)
  })

  it('lets an ordinary command through', () => {
    const { status } = runHook({ tool_name: 'Bash', tool_input: { command: 'npm run check' } })
    expect(status).toBe(0)
  })
})
