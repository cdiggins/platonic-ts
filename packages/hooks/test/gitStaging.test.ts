import { describe, expect, it } from 'vitest'

import { packageOf, stagingViolations, wideCommitViolations } from '../src/gitStaging.ts'
import { commandFrom, refusalFor } from '../src/preToolUse.ts'
import { refusalMessage } from '../src/refusal.ts'
import { shellSegments, unquotedChainOperators } from '../src/shell.ts'

const blocked = (command: string): boolean => stagingViolations(command).length > 0

describe('shellSegments', () => {
  it('splits on unquoted separators', () => {
    expect(shellSegments('git add a.ts && git commit -m x -- a.ts')).toHaveLength(2)
  })

  it('keeps a quoted run inside one token', () => {
    expect(shellSegments("git commit -m 'line one\n\nline two' -- a.ts")).toHaveLength(1)
  })

  it('marks quoted tokens so they never match a bare word', () => {
    expect(shellSegments("echo 'git'").flat()).not.toContain('git')
  })
})

describe('unquotedChainOperators', () => {
  it.each([
    ['a && b', ['&&']],
    ['a || b', ['||']],
    ['a && b || c', ['&&', '||']],
    ['a; b', []],
    ['a | b', []],
    ["echo 'a && b'", []],
    ['git commit -m "fix && ship" -- a.ts', []],
  ])('reads %j as %j', (command, expected) => {
    expect(unquotedChainOperators(command)).toEqual(expected)
  })
})

describe('stagingViolations', () => {
  it.each([
    'git add -A',
    'git add .',
    'git add --all packages/a/src/x.ts',
    'git add',
    'git add -u',
    'git -C sub add -A',
    'git commit -am x',
    'git commit -a -m x',
    'git commit -m x',
    'npm test && git add -A',
  ])('blocks %j', (command) => {
    expect(blocked(command)).toBe(true)
  })

  it.each([
    'git add packages/a/src/x.ts',
    'git commit -m msg -- packages/a/src/x.ts',
    "git commit -m 'subject\n\nbody' -- a.ts b.ts",
    'git commit --amend --no-edit',
    'git add packages/a/src/x.ts && git commit -m msg -- packages/a/src/x.ts',
    'git status --porcelain',
    "echo 'git add -A'",
    'npm run check',
  ])('allows %j', (command) => {
    expect(blocked(command)).toBe(false)
  })

  it('names every offending argument', () => {
    expect(stagingViolations('git add -A .')[0]).toContain('git add -A .')
  })
})

describe('packageOf', () => {
  it('reads the package directory', () => {
    expect(packageOf('packages/codemap/src/index.ts')).toBe('codemap')
  })

  it('treats shared and root files as belonging to no package', () => {
    expect(packageOf('AGENTS.md')).toBeUndefined()
    expect(packageOf('docs/style-guide.md')).toBeUndefined()
    expect(packageOf('packages')).toBeUndefined()
  })
})

describe('wideCommitViolations', () => {
  it('allows one package plus any number of shared files', () => {
    expect(wideCommitViolations(['packages/a/src/x.ts', 'AGENTS.md', 'backlog/BL-0001.md'])).toEqual([])
  })

  it('allows a commit of only shared files', () => {
    expect(wideCommitViolations(['AGENTS.md', 'CONTRACTS.md'])).toEqual([])
  })

  it('rejects a commit spanning two packages', () => {
    const [message] = wideCommitViolations(['packages/a/src/x.ts', 'packages/b/src/y.ts'])
    expect(message).toContain('a, b')
  })

  it('allows an empty staged set', () => {
    expect(wideCommitViolations([])).toEqual([])
  })
})

describe('commandFrom', () => {
  it('reads the tool command', () => {
    expect(commandFrom({ tool_input: { command: 'git add -A' } })).toBe('git add -A')
  })

  it('yields an empty command for payloads without one', () => {
    expect(commandFrom({ tool_input: { file_path: 'a.ts' } })).toBe('')
    expect(commandFrom(undefined)).toBe('')
  })
})

describe('refusalFor', () => {
  const payload = (tool: string, command: string): unknown => ({ tool_name: tool, tool_input: { command } })

  it('refuses POSIX chaining sent to PowerShell', () => {
    expect(refusalFor(payload('PowerShell', 'npm run check && git push'))).toContain('not a valid statement separator')
  })

  it('allows the same chaining on Bash', () => {
    expect(refusalFor(payload('Bash', 'npm run check && git push'))).toBeUndefined()
  })

  it('allows PowerShell-native chaining on PowerShell', () => {
    expect(refusalFor(payload('PowerShell', 'npm run check; if ($?) { git push }'))).toBeUndefined()
  })

  it('points a refused PowerShell command at the Bash tool', () => {
    expect(refusalFor(payload('PowerShell', 'a && b'))).toContain('Prefer the Bash tool')
  })

  it('enforces staging rules on both shells', () => {
    expect(refusalFor(payload('PowerShell', 'git add -A'))).toContain('stages files you did not name')
    expect(refusalFor(payload('Bash', 'git add -A'))).toContain('stages files you did not name')
  })

  it('reports the parse error first when a command breaks both rules', () => {
    const refusal = refusalFor(payload('PowerShell', 'git add -A && git commit -m x'))
    expect(refusal).toContain('not a valid statement separator')
    expect(refusal).not.toContain('stages files you did not name')
  })

  it('allows an unrelated command', () => {
    expect(refusalFor(payload('Bash', 'npm run check'))).toBeUndefined()
  })
})

describe('refusalMessage', () => {
  it('states the rule broken, the reason, and the remedy', () => {
    const text = refusalMessage(['broke a rule.'], ['because of this'], ['do this instead'])
    expect(text).toContain('broke a rule.')
    expect(text).toContain('because of this')
    expect(text).toContain('do this instead')
  })
})
