// Pure rules for which files a commit is allowed to contain, shared by the two guards that
// enforce them: the PreToolUse hook (inspects a shell command before it runs) and the
// pre-commit hook (inspects the staged path set). Agents here share one working tree, so a
// commit may only contain files its author named — see AGENTS.md "Conventions".

import { shellSegments } from './shell.ts'

// Index of the git subcommand in `words`, skipping git's own options (`-C dir`, `-c k=v`).
const subcommandIndex = (words: readonly string[], i: number): number => {
  const w = words[i]
  if (w === undefined || !w.startsWith('-')) return i
  return subcommandIndex(words, i + (w === '-C' || w === '-c' ? 2 : 1))
}

// Arguments to `git add` that stage files the author did not name.
const BROAD_ADD = new Set(['-A', '--all', '.', ':/', '*', '-u', '--update'])

const addViolations = (args: readonly string[]): readonly string[] => {
  const broad = args.filter((a) => BROAD_ADD.has(a))
  if (broad.length > 0) return [`\`git add ${broad.join(' ')}\` stages files you did not name.`]
  // Vacuously true for a bare `git add`, which stages nothing but signals the same intent.
  if (args.every((a) => a.startsWith('-'))) return ['`git add` with no pathspec stages the whole worktree.']
  return []
}

const commitViolations = (args: readonly string[]): readonly string[] => {
  if (args.some((a) => a === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a)))
    return ['`git commit -a` commits every tracked modification, not just your files.']
  if (args.includes('--') || args.includes('--amend')) return []
  return ['`git commit` without a `-- <paths>` pathspec commits whatever happens to be staged.']
}

const segmentViolations = (words: readonly string[]): readonly string[] => {
  const gitAt = words.indexOf('git')
  if (gitAt === -1) return []
  const i = subcommandIndex(words, gitAt + 1)
  const args = words.slice(i + 1)
  if (words[i] === 'add') return addViolations(args)
  if (words[i] === 'commit') return commitViolations(args)
  return []
}

// Every staging rule the shell command breaks; empty means the command may run.
export const stagingViolations = (command: string): readonly string[] =>
  shellSegments(command).flatMap(segmentViolations)

// The package a repo-relative path belongs to, or undefined for shared and root-level files
// (AGENTS.md, CONTRACTS.md, docs/, backlog/, configs) which any commit may carry.
export const packageOf = (path: string): string | undefined => /^packages\/([^/]+)\//.exec(path)?.[1]

// Fails a staged path set that spans more than one package. This is a proxy, not a proof: it
// cannot see who edited what, only that the commit is wider than one fence and so is the shape
// a broad `git add` produces. Deliberate cross-package commits override it (see preCommit.ts).
export const wideCommitViolations = (paths: readonly string[]): readonly string[] => {
  const packages = [...new Set(paths.map(packageOf))].filter((p): p is string => p !== undefined).sort()
  if (packages.length < 2) return []
  return [`this commit spans ${packages.length} packages (${packages.join(', ')}); a fenced commit touches one.`]
}

// Why a commit here may only contain files its author edited, shown with every staging refusal.
export const STAGING_RATIONALE = [
  'Agents here share one working tree, so a commit may only contain files you edited',
  'yourself (AGENTS.md "Conventions"; per-track fences in CONTRACTS.md).',
]
