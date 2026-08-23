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

const tailToken = (source: string, cursor: number): readonly HighlightToken[] =>
  cursor < source.length ? [{ text: source.slice(cursor), class: 'plain', start: cursor }] : []

const scanFrom = (
  scanner: ts.Scanner,
  source: string,
  cursor: number,
  previous: ts.SyntaxKind | undefined,
): readonly HighlightToken[] => {
  const kind = scanner.scan()
  const end = Math.min(scanner.getTokenEnd(), source.length)
  if (kind === ts.SyntaxKind.EndOfFileToken || end <= cursor) return tailToken(source, cursor)
  const start = Math.max(Math.min(scanner.getTokenFullStart(), end), cursor)
  const gap: readonly HighlightToken[] =
    start > cursor ? [{ text: source.slice(cursor, start), class: 'plain', start: cursor }] : []
  const token: HighlightToken = {
    text: source.slice(start, end),
    class: classifyToken(kind, previous),
    start,
  }
  return [...gap, token, ...scanFrom(scanner, source, end, isTrivia(kind) ? previous : kind)]
}

export const highlightTypeScript = (source: string): readonly HighlightToken[] =>
  scanFrom(
    ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source),
    source,
    0,
    undefined,
  )

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

const sourceLines = (source: string): readonly SourceLine[] => {
  const parts = source.split('\n')
  const kept = parts.length > 1 && parts[parts.length - 1] === '' ? parts.slice(0, -1) : parts
  return kept.reduce<readonly SourceLine[]>((lines, text, index) => {
    const previous = lines[lines.length - 1]
    const start = previous === undefined ? 0 : previous.end + 1
    return [...lines, { number: index + 1, start, end: start + text.length }]
  }, [])
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
  const content = tokens
    .filter((token) => token.start < line.end && token.start + token.text.length > line.start)
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

const takeWhile = <T>(items: readonly T[], keep: (item: T) => boolean): readonly T[] => {
  const stop = items.findIndex((item) => !keep(item))
  return stop === -1 ? items : items.slice(0, stop)
}

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

const renderItems = (items: readonly ListItem[]): string => {
  const head = items[0]
  if (head === undefined) return ''
  const rest = items.slice(1)
  const children = takeWhile(rest, (item) => item.indent > head.indent)
  const nested = children.length === 0 ? '' : renderList(children)
  return `<li>${renderInline(head.text)}${nested}</li>${renderItems(rest.slice(children.length))}`
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

const renderFence = (info: string, rest: readonly string[]): readonly string[] => {
  const close = rest.findIndex((line) => FENCE_END_RE.test(line))
  const body = close === -1 ? rest : rest.slice(0, close)
  const html = `<pre><code${languageClass(info)}>${escapeHtml(body.join('\n'))}</code></pre>`
  return [html, ...renderMarkdownLines(close === -1 ? [] : rest.slice(close + 1))]
}

const renderQuote = (lines: readonly string[]): readonly string[] => {
  const quoted = takeWhile(lines, (line) => QUOTE_RE.test(line))
  const inner = quoted.map((line) => QUOTE_RE.exec(line)?.[1] ?? '')
  return [
    `<blockquote>${renderMarkdownLines(inner).join('')}</blockquote>`,
    ...renderMarkdownLines(lines.slice(quoted.length)),
  ]
}

const renderParagraph = (lines: readonly string[]): readonly string[] => {
  const body = [lines[0] ?? '', ...takeWhile(lines.slice(1), (line) => !isBlockStart(line))]
  return [
    `<p>${renderInline(body.join(' ').trim())}</p>`,
    ...renderMarkdownLines(lines.slice(body.length)),
  ]
}

const renderMarkdownLines = (lines: readonly string[]): readonly string[] => {
  const first = lines[0]
  if (first === undefined) return []
  if (first.trim() === '') return renderMarkdownLines(lines.slice(1))
  const rest = lines.slice(1)
  const fence = FENCE_RE.exec(first)
  if (fence !== null) return renderFence(fence[1] ?? '', rest)
  if (RULE_RE.test(first)) return ['<hr />', ...renderMarkdownLines(rest)]
  const heading = HEADING_RE.exec(first)
  if (heading !== null) {
    const level = (heading[1] ?? '#').length
    return [`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`, ...renderMarkdownLines(rest)]
  }
  if (QUOTE_RE.test(first)) return renderQuote(lines)
  if (first.includes('|') && isTableDivider(rest[0] ?? '')) {
    const rows = takeWhile(lines, (line) => line.includes('|'))
    return [renderTable(rows), ...renderMarkdownLines(lines.slice(rows.length))]
  }
  if (ITEM_RE.test(first)) {
    const listLines = takeWhile(lines, (line) => ITEM_RE.test(line))
    const items = listLines.flatMap((line) => {
      const item = parseItem(line)
      return item === undefined ? [] : [item]
    })
    return [renderList(items), ...renderMarkdownLines(lines.slice(listLines.length))]
  }
  return renderParagraph(lines)
}

export const renderMarkdown = (markdown: string): string =>
  renderMarkdownLines(markdown.split('\n').map((line) => line.replace(/\r$/, ''))).join('\n')
