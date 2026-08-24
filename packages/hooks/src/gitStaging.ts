// Pure rules for which files a commit is allowed to contain, shared by the two guards that
// enforce them: the PreToolUse hook (inspects a shell command before it runs) and the
// pre-commit hook (inspects the staged path set). Agents here share one working tree, so a
// commit may only contain files its author named — see AGENTS.md "Conventions".

// One shell command split into segments of tokens, splitting only on UNQUOTED separators
// (`;`, newline, `|`, `&`) and unquoted whitespace. Quoted runs collapse into their token, so
// a multi-line `-m` message never reads as a separator and `echo 'git add -A'` is not a
// `git add`. Tokens are not unquoted-and-restored: a token that contained quotes carries a
// `\0` marker and therefore never compares equal to a bare word like `git`.
type ScanState = {
  readonly segments: readonly (readonly string[])[]
  readonly tokens: readonly string[]
  readonly token: string
  readonly quote: string | undefined
  readonly escaped: boolean
}

const EMPTY_SCAN: ScanState = { segments: [], tokens: [], token: '', quote: undefined, escaped: false }

const SEPARATORS = new Set([';', '\n', '|', '&'])
const QUOTES = new Set(["'", '"', '`'])

const closeToken = (s: ScanState): ScanState =>
  s.token === '' ? s : { ...s, tokens: [...s.tokens, s.token], token: '' }

const closeSegment = (s: ScanState): ScanState => {
  const t = closeToken(s)
  return t.tokens.length === 0 ? t : { ...t, segments: [...t.segments, t.tokens], tokens: [] }
}

const scanChar = (s: ScanState, c: string): ScanState => {
  if (s.escaped) return { ...s, token: s.token + c, escaped: false }
  if (s.quote !== undefined) return c === s.quote ? { ...s, quote: undefined } : { ...s, token: s.token + c }
  if (c === '\\') return { ...s, escaped: true }
  if (QUOTES.has(c)) return { ...s, quote: c, token: `${s.token}\0` }
  if (SEPARATORS.has(c)) return closeSegment(s)
  if (/\s/.test(c)) return closeToken(s)
  return { ...s, token: s.token + c }
}

// Splits a shell command into its separate commands, each a token list. Quote-aware.
export const shellSegments = (command: string): readonly (readonly string[])[] =>
  closeSegment([...command].reduce(scanChar, EMPTY_SCAN)).segments

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
export const packageOf = (path: string): string | undefined =>
  /^packages\/([^/]+)\//.exec(path)?.[1]

// Fails a staged path set that spans more than one package. This is a proxy, not a proof: it
// cannot see who edited what, only that the commit is wider than one fence and so is the shape
// a broad `git add` produces. Deliberate cross-package commits override it (see preCommit.ts).
export const wideCommitViolations = (paths: readonly string[]): readonly string[] => {
  const packages = [...new Set(paths.map(packageOf))].filter((p): p is string => p !== undefined).sort()
  if (packages.length < 2) return []
  return [`this commit spans ${packages.length} packages (${packages.join(', ')}); a fenced commit touches one.`]
}

// The text a guard prints when it refuses: the rules broken, why the rule exists, then the
// remedy. Agents read a hook's stderr as a correction, so it must say what to run instead.
export const refusalMessage = (violations: readonly string[], remedy: readonly string[]): string =>
  [
    'Blocked by the repository staging guard.',
    ...violations.map((v) => `  - ${v}`),
    '',
    'Agents here share one working tree, so a commit may only contain files you edited',
    'yourself (AGENTS.md "Conventions"; per-track fences in CONTRACTS.md).',
    '',
    ...remedy,
  ].join('\n')
