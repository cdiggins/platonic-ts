// Runnable git pre-commit hook entry point, invoked by `.githooks/pre-commit`. Backstops the
// PreToolUse guard for commits it cannot see — a manual terminal, an editor, an MCP tool with
// its own commit path. Git knows only the staged path set, not who staged it, so this checks
// the one property that set reveals: a commit wider than a single package fence.
//
// Set PLATONIC_WIDE_COMMIT=1 for a deliberate cross-package commit.

import { pathToFileURL } from 'node:url'

import { STAGING_RATIONALE, wideCommitViolations } from './gitStaging.ts'
import { refuse, stagedPaths, wideCommitAllowed } from './io.ts'
import { refusalMessage } from './refusal.ts'

const REMEDY = [
  'Commit each package separately:',
  '  git commit -m "<message>" -- packages/foo/src/a.ts',
  '',
  'If the change genuinely spans packages, say so explicitly:',
  '  PLATONIC_WIDE_COMMIT=1 git commit -m "<message>" -- <paths>',
]

const main = (): void => {
  if (wideCommitAllowed()) return
  const violations = wideCommitViolations(stagedPaths())
  if (violations.length === 0) return
  refuse(refusalMessage(violations, STAGING_RATIONALE, REMEDY), 1)
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) main()
