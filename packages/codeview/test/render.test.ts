import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SymbolInfo, SymbolReference } from '../../core/src/index.ts'
import {
  escapeHtml,
  highlightTypeScript,
  renderMarkdown,
  renderSourceHtml,
} from '../src/render.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const readRepoFile = (relative: string): string => readFileSync(resolve(repoRoot, relative), 'utf8')

const classOf = (source: string, text: string): string | undefined =>
  highlightTypeScript(source).find((token) => token.text === text)?.class

const definition = (id: string, start: number, length: number, line: number): SymbolReference => ({
  symbolId: id,
  file: 'x.ts',
  span: { start, length },
  line,
  isDefinition: true,
})

const usage = (id: string, start: number, length: number, line: number): SymbolReference => ({
  ...definition(id, start, length, line),
  isDefinition: false,
})

const noSymbols: readonly SymbolInfo[] = []

describe('escapeHtml', () => {
  it('escapes every markup-significant character', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    )
  })
})

describe('highlightTypeScript', () => {
  it('covers a real source file with no gaps or overlaps', () => {
    const source = readRepoFile('packages/check/src/ratchet.ts')
    const tokens = highlightTypeScript(source)
    expect(tokens.map((token) => token.text).join('')).toBe(source)
    expect(tokens.every((token, index) => token.start === tokens.slice(0, index).reduce((sum, t) => sum + t.text.length, 0))).toBe(true)
  })

  it('covers a file full of templates, regexes and comments with no gaps', () => {
    const source = readRepoFile('packages/codeview/src/render.ts')
    expect(
      highlightTypeScript(source)
        .map((token) => token.text)
        .join(''),
    ).toBe(source)
  })

  it('round-trips CRLF, empty input and unterminated literals', () => {
    const cases = ['', 'const a = 1\r\n// tail\r\n', 'const bad = "unterminated', '\t \n\n', '`a${b}c`']
    for (const source of cases) {
      expect(
        highlightTypeScript(source)
          .map((token) => token.text)
          .join(''),
      ).toBe(source)
    }
  })

  it('handles a file far larger than the call stack', () => {
    const big = 'const alpha = 1\n'.repeat(5000)
    const tokens = highlightTypeScript(big)
    expect(tokens.map((token) => token.text).join('')).toBe(big)
    expect(renderSourceHtml(big, noSymbols, []).match(/class="code-line"/g)?.length).toBe(5000)
  })

  it('classifies keywords, strings, numbers, comments and identifiers', () => {
    const snippet = "const alpha = 'text' // note\nconst count = 42\n"
    expect(classOf(snippet, 'const')).toBe('keyword')
    expect(classOf(snippet, "'text'")).toBe('string')
    expect(classOf(snippet, '// note')).toBe('comment')
    expect(classOf(snippet, 'alpha')).toBe('identifier')
    expect(classOf(snippet, '42')).toBe('number')
    expect(classOf(snippet, '=')).toBe('punctuation')
    expect(classOf(snippet, ' ')).toBe('plain')
  })

  it('classifies a JSDoc block as a comment', () => {
    expect(classOf('/** doc */\nconst a = 1\n', '/** doc */')).toBe('comment')
  })

  it('marks an identifier in an unambiguous type position as a type', () => {
    expect(classOf('type Shape = string\n', 'Shape')).toBe('type')
    expect(classOf('const value = input as Shape\n', 'Shape')).toBe('type')
  })
})

describe('renderSourceHtml', () => {
  const source = 'const alpha = 1\nconst beta = alpha\n'
  const references: readonly SymbolReference[] = [
    definition('x.ts#6', 6, 5, 1),
    usage('x.ts#6', 29, 5, 2),
  ]

  it('numbers every line and gives each an anchor target', () => {
    const html = renderSourceHtml(source, noSymbols, [])
    expect(html.startsWith('<div class="source">')).toBe(true)
    expect(html).toContain('<div class="code-line" id="line-1">')
    expect(html).toContain('<span class="line-number">2</span>')
    expect(html.match(/class="code-line"/g)?.length).toBe(2)
  })

  it('links reference spans and marks the definition with a sym- id', () => {
    const html = renderSourceHtml(source, noSymbols, references)
    expect(html).toContain(
      '<a class="symbol" data-symbol="x.ts#6" href="#" id="sym-x.ts#6"><span class="token-identifier">alpha</span></a>',
    )
    expect(html).toContain(
      '<a class="symbol" data-symbol="x.ts#6" href="#"><span class="token-identifier">alpha</span></a>',
    )
    expect(html.match(/class="symbol"/g)?.length).toBe(2)
  })

  it('drops out-of-range and misaligned spans without corrupting the text', () => {
    const bad: readonly SymbolReference[] = [
      usage('x.ts#0', 9999, 5, 1),
      usage('x.ts#1', 6, 99, 1),
      usage('x.ts#2', 7, 3, 1),
    ]
    const html = renderSourceHtml(source, noSymbols, bad)
    expect(html).not.toContain('class="symbol"')
    expect(html).toContain('<span class="token-identifier">alpha</span>')
  })

  it('escapes hostile source instead of emitting markup', () => {
    const hostile = 'const s = "</script><img onerror=alert(1) src=x>" // <b>&\n'
    const html = renderSourceHtml(hostile, noSymbols, [])
    expect(html).not.toContain('</script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;/script&gt;')
    expect(html).toContain('&amp;')
  })

  it('escapes a symbol id that carries markup characters', () => {
    const html = renderSourceHtml(source, noSymbols, [definition('a"><img>.ts#6', 6, 5, 1)])
    expect(html).not.toContain('<img>')
    expect(html).toContain('data-symbol="a&quot;&gt;&lt;img&gt;.ts#6"')
  })

  it('produces the same lines for CRLF and LF input', () => {
    const lf = renderSourceHtml('const a = 1\nconst b = 2\n', noSymbols, [])
    const crlf = renderSourceHtml('const a = 1\r\nconst b = 2\r\n', noSymbols, [])
    expect(crlf).toBe(lf)
    expect(lf.match(/class="code-line"/g)?.length).toBe(2)
  })

  it('renders a real repo file without losing any source line', () => {
    const file = readRepoFile('packages/core/src/index.ts')
    const html = renderSourceHtml(file, noSymbols, [])
    const expected = file.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length
    expect(html.match(/class="code-line"/g)?.length).toBe(expected)
  })
})

describe('renderMarkdown', () => {
  it('renders headings, paragraphs and rules', () => {
    expect(renderMarkdown('# Title\n\ntext here\n\n---\n')).toBe(
      '<h1>Title</h1>\n<p>text here</p>\n<hr />',
    )
    expect(renderMarkdown('### Deep\n')).toBe('<h3>Deep</h3>')
  })

  it('renders inline emphasis, code, links and images', () => {
    expect(renderMarkdown('a **bold** and *italic* and `code`\n')).toBe(
      '<p>a <strong>bold</strong> and <em>italic</em> and <code>code</code></p>',
    )
    expect(renderMarkdown('[docs](https://example.com/a)\n')).toBe(
      '<p><a href="https://example.com/a">docs</a></p>',
    )
    expect(renderMarkdown('![alt](./p.png)\n')).toBe('<p><img src="./p.png" alt="alt" /></p>')
  })

  it('refuses a javascript: url and leaves it as text', () => {
    const html = renderMarkdown('[click](javascript:alert(1))\n')
    expect(html).not.toContain('href="javascript')
    expect(html).toContain('click')
  })

  it('renders fenced code blocks escaped and unhighlighted', () => {
    expect(renderMarkdown('```ts\nconst a = 1 < 2\n```\n')).toBe(
      '<pre><code class="language-ts">const a = 1 &lt; 2</code></pre>',
    )
    expect(renderMarkdown('```\n<script>bad()</script>\n```\n')).toBe(
      '<pre><code>&lt;script&gt;bad()&lt;/script&gt;</code></pre>',
    )
  })

  it('renders unordered, ordered and one level of nested lists', () => {
    expect(renderMarkdown('- one\n- two\n')).toBe('<ul><li>one</li><li>two</li></ul>')
    expect(renderMarkdown('1. one\n2. two\n')).toBe('<ol><li>one</li><li>two</li></ol>')
    expect(renderMarkdown('- outer\n  - inner\n- after\n')).toBe(
      '<ul><li>outer<ul><li>inner</li></ul></li><li>after</li></ul>',
    )
  })

  it('renders blockquotes', () => {
    expect(renderMarkdown('> quoted **text**\n')).toBe(
      '<blockquote><p>quoted <strong>text</strong></p></blockquote>',
    )
  })

  it('renders pipe tables', () => {
    expect(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n')).toBe(
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    )
  })

  it('escapes raw HTML instead of passing it through', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('degrades unsupported constructs to escaped text', () => {
    const html = renderMarkdown('Setext\n======\n\n<div class="x">raw</div>\n')
    expect(html).not.toContain('<div class="x">')
    expect(html).toContain('&lt;div')
  })

  it('handles CRLF input identically to LF', () => {
    expect(renderMarkdown('# T\r\n\r\n- a\r\n')).toBe(renderMarkdown('# T\n\n- a\n'))
  })

  it('handles a document with more blocks than the call stack has frames', () => {
    const html = renderMarkdown('para\n\n- item\n\n'.repeat(5000))
    expect(html.match(/<p>para<\/p>/g)?.length).toBe(5000)
    expect(html.match(/<li>item<\/li>/g)?.length).toBe(5000)
  })

  it('renders a real repo document with every supported construct', () => {
    const html = renderMarkdown(readRepoFile('docs/style-guide.md'))
    expect(html).toContain('<h1>')
    expect(html).toContain('<table>')
    expect(html).toContain('<pre><code')
    expect(html).toContain('<li>')
    expect(html).toContain('<strong>')
    expect(html).not.toContain('<script')
  })
})
