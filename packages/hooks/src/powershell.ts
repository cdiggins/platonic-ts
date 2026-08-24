// Dialect rules for commands sent to the PowerShell tool, which runs Windows PowerShell 5.1.
//
// Only rules that are always wrong belong here. `&&` and `||` qualify: 5.1 has no pipeline
// chain operators, so the parser rejects the whole command and nothing runs — including any
// part that would have succeeded. Catching it before the call turns a wasted round-trip into a
// correction. Rules that are merely usually-wrong (`2>&1` on a native exe, `Set-Content`
// encoding defaults) are left to the tool description; a guard that cries wolf gets worked
// around rather than heeded.

import { unquotedChainOperators } from './shell.ts'

// Every PowerShell 5.1 parse error this guard can prove in advance; empty means the command may
// run. Never inspects a POSIX shell command — Git Bash chains fine.
export const powershellViolations = (command: string): readonly string[] => {
  const operators = unquotedChainOperators(command)
  if (operators.length === 0) return []
  return [
    `${operators.join(' and ')} ${operators.length > 1 ? 'are' : 'is'} not a valid statement separator in Windows PowerShell 5.1; the command fails to parse before anything runs.`,
  ]
}

// Why PowerShell is not the default shell here, shown with a refused PowerShell command.
export const POWERSHELL_RATIONALE = [
  'Windows PowerShell 5.1 has no pipeline chain operators. It is also slower to start than',
  'Git Bash and carries more dialect traps, so it is not the default shell here.',
]

// What to run instead of a PowerShell command that cannot parse: the Bash tool, or 5.1's own
// chaining for work that genuinely needs PowerShell.
export const POWERSHELL_REMEDY = [
  'Prefer the Bash tool, where POSIX chaining works as written:',
  '  npm run check && git commit -m "<message>" -- <paths>',
  '',
  'If the command genuinely needs PowerShell (registry, ACLs, .NET, Get-Process), chain it',
  'the 5.1 way instead:',
  '  Cmdlet-One; if ($?) { Cmdlet-Two }',
]
