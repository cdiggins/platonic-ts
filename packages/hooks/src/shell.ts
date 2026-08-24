// Quote-aware reading of a shell command string, shared by the PreToolUse guards. Splitting
// only on UNQUOTED separators is what keeps the guards honest: a multi-line `-m` message is not
// two commands, and `echo 'git add -A'` is not a `git add`.
//
// Tuned for POSIX quoting. PowerShell's backtick escape reads here as a quote delimiter, which
// can hide a violation from a guard but only rarely invents one.

// A word, or the run of separator characters between two words (`&&`, `;`, `|`).
export type ShellToken = { readonly kind: 'word' | 'separator'; readonly text: string }

type ScanState = {
  readonly tokens: readonly ShellToken[]
  readonly text: string
  readonly kind: 'word' | 'separator'
  readonly quote: string | undefined
  readonly escaped: boolean
}

const EMPTY_SCAN: ScanState = { tokens: [], text: '', kind: 'word', quote: undefined, escaped: false }

const SEPARATORS = new Set([';', '\n', '|', '&'])
const QUOTES = new Set(["'", '"', '`'])

const flush = (s: ScanState): ScanState =>
  s.text === '' ? s : { ...s, tokens: [...s.tokens, { kind: s.kind, text: s.text }], text: '' }

// Appends `c` to the current token, first closing the token if `c` starts a different kind.
const append = (s: ScanState, c: string, kind: 'word' | 'separator'): ScanState => {
  const base = s.kind === kind ? s : { ...flush(s), kind }
  return { ...base, text: base.text + c }
}

const scanChar = (s: ScanState, c: string): ScanState => {
  if (s.escaped) return { ...append(s, c, 'word'), escaped: false }
  if (s.quote !== undefined) return c === s.quote ? { ...s, quote: undefined } : append(s, c, 'word')
  if (c === '\\') return { ...s, escaped: true }
  // A quoted run stays inside its word and carries a marker, so a token that contained quotes
  // never compares equal to a bare word like `git`.
  if (QUOTES.has(c)) return { ...append(s, '\0', 'word'), quote: c }
  if (SEPARATORS.has(c)) return append(s, c, 'separator')
  if (/\s/.test(c)) return flush(s)
  return append(s, c, 'word')
}

// The command as words and the separator runs between them, in order.
export const scanTokens = (command: string): readonly ShellToken[] =>
  flush([...command].reduce(scanChar, EMPTY_SCAN)).tokens

// The command split into its separate commands, each a list of words.
export const shellSegments = (command: string): readonly (readonly string[])[] =>
  scanTokens(command)
    .reduce<readonly (readonly string[])[]>(
      (segments, token) =>
        token.kind === 'separator'
          ? [...segments, []]
          : [...segments.slice(0, -1), [...(segments[segments.length - 1] ?? []), token.text]],
      [[]],
    )
    .filter((segment) => segment.length > 0)

// The POSIX chaining operators (`&&`, `||`) that appear unquoted in the command.
export const unquotedChainOperators = (command: string): readonly string[] =>
  [...new Set(scanTokens(command).flatMap((t) => (t.kind === 'separator' ? chainOperatorsIn(t.text) : [])))].sort()

const chainOperatorsIn = (separatorRun: string): readonly string[] =>
  ['&&', '||'].filter((op) => separatorRun.includes(op))
