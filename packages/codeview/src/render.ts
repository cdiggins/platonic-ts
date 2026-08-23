// Pure rendering: syntax highlighting, navigable source HTML, markdown.
// STUB — Track J fills these in. Signatures are the wave contract.
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

export const highlightTypeScript = (_source: string): readonly HighlightToken[] => []

// Highlighted source wrapped in numbered lines, with every reference span turned
// into a clickable anchor carrying its symbol id.
export const renderSourceHtml = (
  _source: string,
  _symbols: readonly SymbolInfo[],
  _references: readonly SymbolReference[],
): string => ''

export const renderMarkdown = (_markdown: string): string => ''
