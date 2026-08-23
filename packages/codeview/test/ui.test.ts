import { describe, expect, it } from 'vitest'
import { renderPage } from '../src/ui.ts'

const page = renderPage()

const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1

describe('renderPage document shape', () => {
  it('is one well-formed html document', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(occurrences(page, '<html')).toBe(1)
    expect(occurrences(page, '</html>')).toBe(1)
    expect(occurrences(page, '<body>')).toBe(1)
    expect(page.trimEnd().endsWith('</body>\n</html>')).toBe(true)
    expect(occurrences(page, '<head>')).toBe(1)
    expect(occurrences(page, '<title>')).toBe(1)
  })

  it('carries exactly one inline style block and one inline script block', () => {
    expect(occurrences(page, '<style>')).toBe(1)
    expect(occurrences(page, '</style>')).toBe(1)
    expect(occurrences(page, '<script>')).toBe(1)
    expect(occurrences(page, '</script>')).toBe(1)
  })

  it('is pure: repeated calls produce the identical document', () => {
    expect(renderPage()).toBe(page)
  })
})

describe('renderPage self-containment', () => {
  it('makes no external resource references', () => {
    expect(page).not.toContain('http://')
    expect(page).not.toContain('https://')
    expect(page).not.toContain('src=')
    expect(page).not.toContain('<link')
    expect(page).not.toContain('<img')
    expect(page).not.toContain('@import')
  })

  it('names the observability dashboard port without linking to it', () => {
    expect(page).toContain('4747')
  })
})

describe('renderPage api usage', () => {
  it('calls every endpoint the seam defines', () => {
    expect(page).toContain('/api/index')
    expect(page).toContain('/api/file?path=')
    expect(page).toContain('/api/references?symbol=')
    expect(page).toContain('/api/feedback')
  })

  it('posts feedback as json carrying the selected file and symbol', () => {
    expect(page).toContain("method: 'POST'")
    expect(page).toContain('JSON.stringify({ text: text, file: state.file, symbol: state.symbol })')
  })

  it('encodes path and symbol query parameters', () => {
    expect(page).toContain('encodeURIComponent(path)')
    expect(page).toContain('encodeURIComponent(symbolId)')
  })
})

describe('renderPage rendered-source contract', () => {
  it('targets the anchors and ids that renderSourceHtml emits', () => {
    expect(page).toContain("closest('a.symbol')")
    expect(page).toContain("getAttribute('data-symbol')")
    expect(page).toContain("getElementById('sym-' + symbolId)")
  })

  it('resolves a symbol id to its defining file by the prefix before the last hash', () => {
    expect(page).toContain("lastIndexOf('#')")
  })

  it('has fallbacks for locating a line', () => {
    expect(page).toContain('[data-line="')
    expect(page).toContain("getElementById('line-' + line)")
    expect(page).toContain("querySelectorAll('.line')")
  })

  it('styles both syntax tokens and rendered markdown prose', () => {
    expect(page).toContain('.code .keyword')
    expect(page).toContain('.code .string')
    expect(page).toContain('.code .comment')
    expect(page).toContain('.markdown h1')
    expect(page).toContain('.markdown pre')
    expect(page).toContain('.markdown table')
  })

  it('chooses the prose container for markdown file views', () => {
    expect(page).toContain("view.kind === 'markdown' ? 'markdown' : 'code'")
  })
})

describe('renderPage panes', () => {
  it('mounts the three panes and the feedback controls', () => {
    for (const id of [
      'tree',
      'source-body',
      'metrics',
      'feedback-text',
      'feedback-send',
      'feedback-status',
      'explain',
      'explain-toggle',
    ]) {
      expect(page).toContain(`id="${id}"`)
    }
  })

  it('renders every raw metric field, not only the score', () => {
    for (const field of [
      'lines',
      'statements',
      'maxNestingDepth',
      'parameters',
      'mutableBindings',
      'classes',
      'throwStatements',
      'explicitAny',
      'asCasts',
      'nonNullAssertions',
      'tsDirectives',
      'eslintDisables',
      'exportedSymbols',
      'imports',
    ]) {
      expect(page).toContain(`'${field}'`)
    }
    expect(page).toContain('platonicScore')
  })

  it('applies one score colour ramp shared by the tree and both panes', () => {
    for (const className of ['s-a', 's-b', 's-c', 's-d', 's-e', 's-none']) {
      expect(page).toContain(`.${className} {`)
    }
    expect(page).toContain('function scoreClass(score)')
  })

  it('sorts the function table by score by default and allows re-sorting', () => {
    expect(page).toContain("functionSort: 'score'")
    expect(page).toContain('data-sort="name"')
    expect(page).toContain('data-sort="line"')
    expect(page).toContain('data-sort="score"')
  })

  it('shows folder metrics when a folder is selected', () => {
    expect(page).toContain('function renderMetricsForFolder(path)')
    expect(page).toContain('folder metrics')
  })
})

describe('renderPage robustness', () => {
  it('has an empty state for an empty index, a file without functions, and a failed fetch', () => {
    expect(page).toContain('index is empty')
    expect(page).toContain('no functions')
    expect(page).toContain('could not load the index')
    expect(page).toContain('could not load ')
    expect(page).toContain('class="error"')
  })

  it('turns a non-ok response into a value rather than a rejection', () => {
    expect(page).toContain('{ ok: false, error:')
  })
})

describe('renderPage self-documentation', () => {
  it('carries the collapsible explanation panel with every required heading', () => {
    for (const heading of [
      '<h3>What this page is for</h3>',
      '<h3>The three panes</h3>',
      '<h3>Where the data comes from</h3>',
      '<h3>The platonic score</h3>',
      '<h3>Feedback</h3>',
      '<h3>What this is not</h3>',
    ]) {
      expect(page).toContain(heading)
    }
  })

  it('explains the provenance, the heuristic caveat, and the feedback route', () => {
    expect(page).toContain('packages/codemap')
    expect(page).toContain('TypeScript compiler')
    expect(page).toContain('heuristic, not a verdict')
    expect(page).toContain('backlog/')
    expect(page).toContain('observability dashboard')
  })
})
