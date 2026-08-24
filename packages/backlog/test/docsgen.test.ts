import { describe, it, expect } from 'vitest'
import {
  buildBlocks,
  extractMarkers,
  firstSentence,
  missingDescriptions,
  parseSkillFrontmatter,
  spliceBlocks,
  staleBlockNames,
  unknownBlockNames,
  type DocsSources,
} from '../src/docsgen.js'

const sources: DocsSources = {
  scripts: [
    { name: 'check', command: 'tsx packages/check/src/main.ts', description: 'The gate.' },
    { name: 'test', command: 'vitest run', description: 'Runs the suite.' },
  ],
  packages: [
    { dir: 'core', name: '@platonic/core', description: 'Shared types.' },
    { dir: 'backlog', name: '@platonic/backlog', description: 'Work items.' },
  ],
  skills: [{ name: 'parallel-wave', description: 'Runs a wave.' }],
}

const doc = [
  '# Title',
  '',
  'Hand-written prose that must survive.',
  '',
  '<!-- BEGIN GENERATED: packages (npm run docs:regen) -->',
  '<!-- END GENERATED -->',
  '',
  'More prose | with a pipe.',
  '',
  '<!-- BEGIN GENERATED: npm-scripts (npm run docs:regen) -->',
  'stale content',
  '<!-- END GENERATED -->',
  '',
  'Closing prose.',
  '',
].join('\n')

describe('extractMarkers', () => {
  it('finds every generated block in document order', () => {
    expect(extractMarkers(doc).map((b) => b.name)).toEqual(['packages', 'npm-scripts'])
  })

  it('ignores comments that are not generated markers', () => {
    expect(extractMarkers('<!-- GENERATED — do not hand-edit -->')).toEqual([])
  })
})

describe('spliceBlocks', () => {
  it('fills a block with the rendered table', () => {
    const out = spliceBlocks(doc, buildBlocks(sources))
    expect(out).toContain('| `packages/core` | Shared types. |')
    expect(out).toContain('| `npm run check` | The gate. |')
  })

  it('is idempotent — regenerating twice is byte-identical', () => {
    const blocks = buildBlocks(sources)
    const once = spliceBlocks(doc, blocks)
    expect(spliceBlocks(once, blocks)).toBe(once)
  })

  it('leaves hand-written prose byte-for-byte intact', () => {
    const out = spliceBlocks(doc, buildBlocks(sources))
    const prose = (text: string): readonly string[] =>
      text.split('\n').filter((line) => !line.startsWith('|') && line !== 'stale content')
    expect(prose(out)).toEqual(prose(doc))
  })

  it('preserves CRLF line endings', () => {
    const crlf = doc.replace(/\n/g, '\r\n')
    const out = spliceBlocks(crlf, buildBlocks(sources))
    expect(out.includes('\r\n')).toBe(true)
    expect(/[^\r]\n/.test(out)).toBe(false)
  })

  it('leaves a block with no generator untouched', () => {
    const orphan = '<!-- BEGIN GENERATED: nosuch (npm run docs:regen) -->\nkeep me\n<!-- END GENERATED -->'
    expect(spliceBlocks(orphan, buildBlocks(sources))).toBe(orphan)
  })

  it('drops a package that no longer exists on the next regen', () => {
    const filled = spliceBlocks(doc, buildBlocks(sources))
    const fewer: DocsSources = { ...sources, packages: sources.packages.filter((p) => p.dir !== 'core') }
    const after = spliceBlocks(filled, buildBlocks(fewer))
    expect(after).not.toContain('`packages/core`')
    expect(after).toContain('`packages/backlog`')
  })
})

describe('staleBlockNames', () => {
  it('reports a block whose body is not what regen would write', () => {
    expect(staleBlockNames(doc, buildBlocks(sources))).toEqual(['packages', 'npm-scripts'])
  })

  it('reports nothing once the document is regenerated', () => {
    const blocks = buildBlocks(sources)
    expect(staleBlockNames(spliceBlocks(doc, blocks), blocks)).toEqual([])
  })

  it('sees through a line-ending difference only when content differs', () => {
    const blocks = buildBlocks(sources)
    const crlf = spliceBlocks(doc.replace(/\n/g, '\r\n'), blocks)
    expect(staleBlockNames(crlf, blocks)).toEqual([])
  })
})

describe('unknownBlockNames', () => {
  it('names markers no generator produces', () => {
    const orphan = '<!-- BEGIN GENERATED: nosuch (npm run docs:regen) -->\n<!-- END GENERATED -->'
    expect(unknownBlockNames(orphan, buildBlocks(sources))).toEqual(['nosuch'])
  })
})

describe('parseSkillFrontmatter', () => {
  it('reads name and the lead sentence of description', () => {
    const skill = '---\nname: track-idea\ndescription: Logs an idea. Use when the user says /track-idea.\n---\n\n# body\n'
    expect(parseSkillFrontmatter(skill)).toEqual({ name: 'track-idea', description: 'Logs an idea.' })
  })

  it('returns undefined when frontmatter is absent or incomplete', () => {
    expect(parseSkillFrontmatter('# no frontmatter')).toBeUndefined()
    expect(parseSkillFrontmatter('---\nname: x\n---\n')).toBeUndefined()
  })
})

describe('firstSentence', () => {
  it('keeps the whole text when there is no sentence break', () => {
    expect(firstSentence('one clause with no period')).toBe('one clause with no period')
  })
})

describe('missingDescriptions', () => {
  it('names every source row with nothing to print', () => {
    const gaps: DocsSources = {
      scripts: [{ name: 'lint', command: 'eslint .', description: '' }],
      packages: [{ dir: 'mcp', name: '@platonic/mcp', description: '' }],
      skills: [{ name: 'caveman', description: '' }],
    }
    expect(missingDescriptions(gaps)).toEqual(['npm run lint', 'packages/mcp', 'skill caveman'])
  })

  it('is empty when every row is documented', () => {
    expect(missingDescriptions(sources)).toEqual([])
  })
})

describe('escaping', () => {
  it('escapes pipes in a description so the table survives', () => {
    const piped: DocsSources = {
      scripts: [{ name: 'x', command: 'x', description: 'a | b' }],
      packages: [],
      skills: [],
    }
    expect(buildBlocks(piped).get('npm-scripts')).toContain('a \\| b')
  })
})
