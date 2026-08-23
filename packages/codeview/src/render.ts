// Pure rendering: syntax highlighting, navigable source HTML, markdown.
//
// highlightTypeScript emits a gap-free cover of the source: concatenating every
// token's text reproduces the input byte for byte, whitespace and CRLF included.
// renderSourceHtml depends on that — it decorates whole tokens by offset and
// never re-slices the source, so a bad reference span can only drop an anchor,
// never shift or corrupt the text.
//
// PS-056 on PS-024 (300-line cap): the wave contract fixes the tokeniser, the
// source view, and the markdown renderer in this one module, and only the
// supervisor may add files. Splitting is a supervisor change, not a track one.
import ts from 'typescript'
import type { SymbolInfo, SymbolReference } from '../../core/src/index.ts'

export type TokenClass =
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'identifier'
  | 'type'
  | 'punctuation'
  | 'plain'

export type HighlightToken = {
  readonly text: string
  readonly class: TokenClass
  readonly start: number
}

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (character) =>
    character === '&'
      ? '&amp;'
      : character === '<'
        ? '&lt;'
        : character === '>'
          ? '&gt;'
          : character === '"'
            ? '&quot;'
            : '&#39;',
  )

const takeWhile = <T>(items: readonly T[], keep: (item: T) => boolean): readonly T[] => {
  const stop = items.findIndex((item) => !keep(item))
  return stop === -1 ? items : items.slice(0, stop)
}

// ---------------------------------------------------------------------------
// TypeScript tokenising
// ---------------------------------------------------------------------------

const isTrivia = (kind: ts.SyntaxKind): boolean =>
  kind >= ts.SyntaxKind.FirstTriviaToken && kind <= ts.SyntaxKind.LastTriviaToken

const isComment = (kind: ts.SyntaxKind): boolean =>
  kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia

const isStringLike = (kind: ts.SyntaxKind): boolean =>
  kind === ts.SyntaxKind.StringLiteral ||
  kind === ts.SyntaxKind.RegularExpressionLiteral ||
  (kind >= ts.SyntaxKind.NoSubstitutionTemplateLiteral && kind <= ts.SyntaxKind.TemplateTail)

const isNumberLike = (kind: ts.SyntaxKind): boolean =>
  kind === ts.SyntaxKind.NumericLiteral || kind === ts.SyntaxKind.BigIntLiteral

const isName = (kind: ts.SyntaxKind): boolean =>
  kind === ts.SyntaxKind.Identifier || kind === ts.SyntaxKind.PrivateIdentifier

const isKeyword = (kind: ts.SyntaxKind): boolean =>
  kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword

const isPunctuation = (kind: ts.SyntaxKind): boolean =>
  kind >= ts.SyntaxKind.FirstPunctuation && kind <= ts.SyntaxKind.LastPunctuation

// The scanner has no checker, so type position is only inferred where a single
// preceding keyword makes it unambiguous. Anything less certain stays
// 'identifier': a wrong colour is worse than a plain one.
const typeIntroducers: readonly ts.SyntaxKind[] = [
  ts.SyntaxKind.TypeKeyword,
  ts.SyntaxKind.InterfaceKeyword,
  ts.SyntaxKind.KeyOfKeyword,
  ts.SyntaxKind.SatisfiesKeyword,
  ts.SyntaxKind.ImplementsKeyword,
  ts.SyntaxKind.AsKeyword,
  ts.SyntaxKind.IsKeyword,
]

const classifyToken = (kind: ts.SyntaxKind, previous: ts.SyntaxKind | undefined): TokenClass =>
  isComment(kind)
    ? 'comment'
    : isStringLike(kind)
      ? 'string'
      : isNumberLike(kind)
        ? 'number'
        : isName(kind)
          ? previous !== undefined && typeIntroducers.includes(previous)
            ? 'type'
            : 'identifier'
          : isKeyword(kind)
            ? 'keyword'
            : isPunctuation(kind)
              ? 'punctuation'
              : 'plain'

type RawToken = { readonly kind: ts.SyntaxKind; readonly start: number; readonly end: number }

// Array.from drives the scanner: a token stream is far longer than the call
// stack can carry, and pushing into an array is out (PS-004). One token per
// character is the exact upper bound; everything past end-of-file is dropped.
const rawTokens = (source: string): readonly RawToken[] => {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source,
  )
  const scanned = Array.from({ length: source.length + 1 }, (): RawToken => {
    const kind = scanner.scan()
    return { kind, start: scanner.getTokenFullStart(), end: scanner.getTokenEnd() }
  })
  return takeWhile(scanned, (token) => token.kind !== ts.SyntaxKind.EndOfFileToken)
}

// Bounded look-back: the significant token before a name is at most a few
// trivia away in real code, and an unbounded search costs more than the
// heuristic is worth.
const previousSignificant = (
  tokens: readonly RawToken[],
  index: number,
  budget: number,
): ts.SyntaxKind | undefined => {
  const candidate = tokens[index - 1]
  return candidate === undefined || budget === 0
    ? undefined
    : isTrivia(candidate.kind)
      ? previousSignificant(tokens, index - 1, budget - 1)
      : candidate.kind
}

export const highlightTypeScript = (source: string): readonly HighlightToken[] => {
  const raw = rawTokens(source)
  const tokens = raw.flatMap((token, index): readonly HighlightToken[] => {
    const cursor = Math.min(raw[index - 1]?.end ?? 0, source.length)
    const end = Math.min(token.end, source.length)
    const start = Math.max(Math.min(token.start, end), cursor)
    const gap: readonly HighlightToken[] =
      start > cursor ? [{ text: source.slice(cursor, start), class: 'plain', start: cursor }] : []
    return end <= cursor
      ? gap
      : [
          ...gap,
          {
            text: source.slice(start, end),
            class: classifyToken(token.kind, previousSignificant(raw, index, 8)),
            start,
          },
        ]
  })
  const covered = Math.min(raw[raw.length - 1]?.end ?? 0, source.length)
  return covered < source.length
    ? [...tokens, { text: source.slice(covered), class: 'plain', start: covered }]
    : tokens
}

// ---------------------------------------------------------------------------
// Navigable source view
// ---------------------------------------------------------------------------

type SourceLine = {
  readonly number: number
  readonly start: number
  // Exclusive; a trailing '\r' of a CRLF pair is inside the line and stripped
  // when rendering, so offsets stay identical to the bytes on disk.
  readonly end: number
}

// PS-020: a running offset instead of an accumulating reduce. Rebuilding the
// list per line is quadratic, and a file view has to stay linear in its input.
const sourceLines = (source: string): readonly SourceLine[] => {
  const parts = source.split('\n')
  const kept = parts.length > 1 && parts[parts.length - 1] === '' ? parts.slice(0, -1) : parts
  let start = 0
  return kept.map((text, index) => {
    const line = { number: index + 1, start, end: start + text.length }
    start = line.end + 1
    return line
  })
}

// First index whose token starts at or after `offset`, over a token list that
// is sorted and gap-free.
const lowerBound = (
  tokens: readonly HighlightToken[],
  offset: number,
  low: number,
  high: number,
): number => {
  if (low >= high) return low
  const middle = (low + high) >> 1
  return (tokens[middle]?.start ?? 0) < offset
    ? lowerBound(tokens, offset, middle + 1, high)
    : lowerBound(tokens, offset, low, middle)
}

const tokensOnLine = (
  tokens: readonly HighlightToken[],
  line: SourceLine,
): readonly HighlightToken[] => {
  const first = Math.max(0, lowerBound(tokens, line.start + 1, 0, tokens.length) - 1)
  const last = lowerBound(tokens, line.end, first, tokens.length)
  return tokens
    .slice(first, Math.max(first, last))
    .filter((token) => token.start < line.end && token.start + token.text.length > line.start)
}

const referenceIndex = (references: readonly SymbolReference[]): ReadonlyMap<number, SymbolReference> =>
  new Map<number, SymbolReference>(
    [
      ...references.filter((reference) => !reference.isDefinition),
      ...references.filter((reference) => reference.isDefinition),
    ].map((reference): [number, SymbolReference] => [reference.span.start, reference]),
  )

const renderAnchor = (reference: SymbolReference, inner: string): string => {
  const id = escapeHtml(reference.symbolId)
  const target = reference.isDefinition ? ` id="sym-${id}"` : ''
  return `<a class="symbol" data-symbol="${id}" href="#"${target}>${inner}</a>`
}

// The slice of a token that falls inside one line, with the '\r' of a CRLF
// pair removed: it is invisible in HTML and would otherwise ride into a span.
const clipToken = (token: HighlightToken, line: SourceLine): string =>
  token.text
    .slice(Math.max(0, line.start - token.start), Math.min(token.text.length, line.end - token.start))
    .replace(/\r/g, '')

const renderToken = (
  token: HighlightToken,
  text: string,
  references: ReadonlyMap<number, SymbolReference>,
): string => {
  const html = `<span class="token-${token.class}">${escapeHtml(text)}</span>`
  const reference = references.get(token.start)
  return reference !== undefined &&
    text === token.text &&
    reference.span.length === token.text.length
    ? renderAnchor(reference, html)
    : html
}

const renderLine = (
  line: SourceLine,
  tokens: readonly HighlightToken[],
  references: ReadonlyMap<number, SymbolReference>,
): string => {
  const content = tokensOnLine(tokens, line)
    .map((token): readonly [HighlightToken, string] => [token, clipToken(token, line)])
    .filter(([, text]) => text !== '')
    .map(([token, text]) => renderToken(token, text, references))
    .join('')
  return (
    `<div class="code-line" id="line-${line.number}">` +
    `<span class="line-number">${line.number}</span>` +
    `<span class="line-code">${content}</span>` +
    `</div>`
  )
}

export const renderSourceHtml = (
  source: string,
  _symbols: readonly SymbolInfo[],
  references: readonly SymbolReference[],
): string => {
  const tokens = highlightTypeScript(source)
  const index = referenceIndex(references)
  const lines = sourceLines(source)
    .map((line) => renderLine(line, tokens, index))
    .join('')
  return `<div class="source">${lines}</div>`
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const FENCE_RE = /^\s{0,3}(?:```|~~~)\s*(.*)$/
const FENCE_END_RE = /^\s{0,3}(?:```|~~~)\s*$/
const RULE_RE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/
const ITEM_RE = /^(\s*)(?:[-*+]|(\d+)[.)])\s+(.*)$/
const INLINE_RE =
  /`([^`]+)`|!\[([^\]]*)\]\(([^)\s]*)\)|\[([^\]]*)\]\(([^)\s]*)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g

// Rendered onto already-escaped text, so quotes cannot break out of the
// attribute; the scheme check is what stops `javascript:` in untrusted input.
const isSafeUrl = (url: string): boolean => {
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url)
  return scheme === null || ['http', 'https', 'mailto'].includes((scheme[1] ?? '').toLowerCase())
}

const renderInline = (text: string): string =>
  escapeHtml(text).replace(
    INLINE_RE,
    (
      match: string,
      code?: string,
      imageAlt?: string,
      imageUrl?: string,
      linkText?: string,
      linkUrl?: string,
      boldStars?: string,
      boldScores?: string,
      italicStar?: string,
      italicScore?: string,
    ): string =>
      code !== undefined
        ? `<code>${code}</code>`
        : imageUrl !== undefined
          ? isSafeUrl(imageUrl)
            ? `<img src="${imageUrl}" alt="${imageAlt ?? ''}" />`
            : match
          : linkUrl !== undefined
            ? isSafeUrl(linkUrl)
              ? `<a href="${linkUrl}">${linkText ?? ''}</a>`
              : match
            : boldStars !== undefined || boldScores !== undefined
              ? `<strong>${boldStars ?? boldScores ?? ''}</strong>`
              : `<em>${italicStar ?? italicScore ?? ''}</em>`,
  )

const isTableDivider = (line: string): boolean =>
  line.includes('|') && line.includes('-') && /^[\s|:-]+$/.test(line)

const isBlockStart = (line: string): boolean =>
  line.trim() === '' ||
  FENCE_RE.test(line) ||
  RULE_RE.test(line) ||
  HEADING_RE.test(line) ||
  QUOTE_RE.test(line) ||
  ITEM_RE.test(line)

const tableCells = (line: string): readonly string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())

const renderRow = (line: string, tag: 'th' | 'td'): string =>
  `<tr>${tableCells(line)
    .map((cell) => `<${tag}>${renderInline(cell)}</${tag}>`)
    .join('')}</tr>`

const renderTable = (rows: readonly string[]): string =>
  `<table><thead>${renderRow(rows[0] ?? '', 'th')}</thead><tbody>` +
  `${rows
    .slice(2)
    .map((row) => renderRow(row, 'td'))
    .join('')}</tbody></table>`

type ListItem = {
  readonly indent: number
  readonly ordered: boolean
  readonly text: string
}

const parseItem = (line: string): ListItem | undefined => {
  const match = ITEM_RE.exec(line)
  return match === null
    ? undefined
    : {
        indent: (match[1] ?? '').length,
        ordered: match[2] !== undefined,
        text: match[3] ?? '',
      }
}

// Array.from with a cursor rather than recursion per item: recursion depth here
// is data-driven, and a long list must not reach the stack limit. Nesting still
// recurses, and nesting depth is bounded by indentation in practice.
const renderItems = (items: readonly ListItem[]): string => {
  let cursor = 0
  return Array.from({ length: items.length }, (): string => {
    const head = items[cursor]
    if (head === undefined) return ''
    const children = takeWhile(items.slice(cursor + 1), (item) => item.indent > head.indent)
    cursor = cursor + 1 + children.length
    const nested = children.length === 0 ? '' : renderList(children)
    return `<li>${renderInline(head.text)}${nested}</li>`
  }).join('')
}

const renderList = (items: readonly ListItem[]): string => {
  const tag = items[0]?.ordered === true ? 'ol' : 'ul'
  return `<${tag}>${renderItems(items)}</${tag}>`
}

const languageClass = (info: string): string => {
  const word = info.trim().split(/\s+/)[0] ?? ''
  const safe = word.replace(/[^A-Za-z0-9+#_-]/g, '')
  return safe === '' ? '' : ` class="language-${safe}"`
}

// One block plus the number of input lines it swallowed.
type MarkdownBlock = { readonly html: string; readonly consumed: number }

const fenceBlock = (info: string, rest: readonly string[]): MarkdownBlock => {
  const close = rest.findIndex((line) => FENCE_END_RE.test(line))
  const body = close === -1 ? rest : rest.slice(0, close)
  return {
    html: `<pre><code${languageClass(info)}>${escapeHtml(body.join('\n'))}</code></pre>`,
    consumed: 1 + body.length + (close === -1 ? 0 : 1),
  }
}

const quoteBlock = (lines: readonly string[]): MarkdownBlock => {
  const quoted = takeWhile(lines, (line) => QUOTE_RE.test(line))
  const inner = quoted.map((line) => QUOTE_RE.exec(line)?.[1] ?? '')
  return { html: `<blockquote>${renderBlocks(inner)}</blockquote>`, consumed: quoted.length }
}

const listBlock = (lines: readonly string[]): MarkdownBlock => {
  const listLines = takeWhile(lines, (line) => ITEM_RE.test(line))
  const items = listLines.flatMap((line) => {
    const item = parseItem(line)
    return item === undefined ? [] : [item]
  })
  return { html: renderList(items), consumed: listLines.length }
}

const paragraphBlock = (lines: readonly string[]): MarkdownBlock => {
  const body = [lines[0] ?? '', ...takeWhile(lines.slice(1), (line) => !isBlockStart(line))]
  return { html: `<p>${renderInline(body.join(' ').trim())}</p>`, consumed: body.length }
}

// `lines[0]` is non-blank. Anything unrecognised falls through to a paragraph,
// where it is escaped as plain text rather than emitted as markup.
const nextBlock = (lines: readonly string[]): MarkdownBlock => {
  const first = lines[0] ?? ''
  const rest = lines.slice(1)
  const fence = FENCE_RE.exec(first)
  if (fence !== null) return fenceBlock(fence[1] ?? '', rest)
  if (RULE_RE.test(first)) return { html: '<hr />', consumed: 1 }
  const heading = HEADING_RE.exec(first)
  if (heading !== null) {
    const level = (heading[1] ?? '#').length
    return { html: `<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`, consumed: 1 }
  }
  if (QUOTE_RE.test(first)) return quoteBlock(lines)
  if (first.includes('|') && isTableDivider(rest[0] ?? '')) {
    const rows = takeWhile(lines, (line) => line.includes('|'))
    return { html: renderTable(rows), consumed: rows.length }
  }
  if (ITEM_RE.test(first)) return listBlock(lines)
  return paragraphBlock(lines)
}

// A document has at most one block per line, so Array.from over the lines is an
// exact upper bound on the number of blocks — and, unlike recursion per block,
// it costs no stack. Blocks past the end render as '' and drop out.
const renderBlocks = (lines: readonly string[]): string => {
  let cursor = 0
  return Array.from({ length: lines.length }, (): string => {
    const remaining = lines.slice(cursor)
    const blank = takeWhile(remaining, (line) => line.trim() === '').length
    const body = remaining.slice(blank)
    if (body.length === 0) return ''
    const block = nextBlock(body)
    cursor = cursor + blank + Math.max(1, block.consumed)
    return block.html
  })
    .filter((html) => html !== '')
    .join('\n')
}

// Backlog items and ADRs open with YAML frontmatter. Rendered as markdown it
// becomes a rule, a paragraph of key/value noise, and another rule; dropping it
// is what a reader wants. A lone leading `---` with no closing fence is a real
// horizontal rule and is left alone.
const withoutFrontmatter = (lines: readonly string[]): readonly string[] => {
  const closing = lines[0] === '---' ? lines.indexOf('---', 1) : -1
  return closing === -1 ? lines : lines.slice(closing + 1)
}

export const renderMarkdown = (markdown: string): string =>
  renderBlocks(withoutFrontmatter(markdown.split('\n').map((line) => line.replace(/\r$/, ''))))
