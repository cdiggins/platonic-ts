import { describe, it, expect } from 'vitest'
import {
  buildIndexBlocks,
  indexIssues,
  leadingPurpose,
  openingStatement,
  renderIndexTable,
  srcIndexBlock,
  type FolderIndex,
} from '../src/indexdoc.js'
import { spliceBlocks } from '../src/docsgen.js'

const fileEntry = (name: string, description: string) =>
  ({ name, kind: 'file', description }) as const

describe('leadingPurpose', () => {
  it('harvests the first paragraph of a leading comment block', () => {
    const source = ['// Purpose line one', '// and line two.', '//', '// Detail nobody needs in a table.', 'export const x = 1'].join('\n')
    expect(leadingPurpose(source)).toBe('Purpose line one and line two.')
  })

  it('stops at the first line that is not a comment', () => {
    const source = ['// Only this.', "import ts from 'typescript'", '// Not this.'].join('\n')
    expect(leadingPurpose(source)).toBe('Only this.')
  })

  it('reports nothing for a file that does not open with a comment', () => {
    expect(leadingPurpose("export const x = 1\n// too late\n")).toBeUndefined()
  })

  it('reads a CRLF file the same as an LF one', () => {
    expect(leadingPurpose('// Purpose.\r\nexport const x = 1\r\n')).toBe('Purpose.')
  })
})

describe('openingStatement', () => {
  it('harvests the hand-written paragraph between the heading and the table', () => {
    const md = [
      '# packages/init/src/templates',
      '',
      'Source text for the config files',
      'a retrofit can install.',
      '',
      `<!-- BEGIN GENERATED: ${srcIndexBlock} (npm run docs:regen) -->`,
      '| File | Purpose |',
      '<!-- END GENERATED -->',
    ].join('\n')
    expect(openingStatement(md)).toBe('Source text for the config files a retrofit can install.')
  })

  it('reports nothing when the index has only a heading and a table', () => {
    expect(openingStatement('# folder\n\n| File | Purpose |\n')).toBeUndefined()
  })
})

describe('renderIndexTable', () => {
  it('sorts rows by name, marks folders with a trailing slash, and escapes pipes', () => {
    const table = renderIndexTable([
      { name: 'templates', kind: 'folder', description: 'Config text.' },
      fileEntry('args.ts', 'Parses a | b.'),
    ])
    expect(table.split('\n')).toEqual([
      '| File | Purpose |',
      '|---|---|',
      '| `args.ts` | Parses a \\| b. |',
      '| `templates/` | Config text. |',
    ])
  })
})

const withBlock = (body: string): string =>
  [
    '# packages/demo/src',
    '',
    'Hand-written folder purpose.',
    '',
    `<!-- BEGIN GENERATED: ${srcIndexBlock} (npm run docs:regen) -->`,
    body,
    '<!-- END GENERATED -->',
    '',
  ].join('\n')

const folder = (indexContent: string | undefined): FolderIndex => ({
  folder: 'packages/demo/src',
  entries: [fileEntry('a.ts', 'Does A.')],
  indexContent,
})

describe('splicing a folder index', () => {
  it('replaces the table and leaves the hand-written opening untouched', () => {
    const before = withBlock('| File | Purpose |\n|---|---|\n| `stale.ts` | Gone. |')
    const after = spliceBlocks(before, buildIndexBlocks(folder(before)))
    expect(after).toContain('Hand-written folder purpose.')
    expect(after).not.toContain('stale.ts')
    expect(after).toContain('| `a.ts` | Does A. |')
  })

  it('is idempotent: splicing the output again changes nothing', () => {
    const once = spliceBlocks(withBlock(''), buildIndexBlocks(folder(undefined)))
    const twice = spliceBlocks(once, buildIndexBlocks(folder(once)))
    expect(twice).toBe(once)
  })

  it('keeps a CRLF document single-flavoured', () => {
    const crlf = withBlock('').replace(/\n/g, '\r\n')
    const spliced = spliceBlocks(crlf, buildIndexBlocks(folder(crlf)))
    expect(spliced).toBe(spliceBlocks(spliced, buildIndexBlocks(folder(spliced))))
    expect(spliced.includes('\n') && !/[^\r]\n/.test(spliced)).toBe(true)
  })
})

describe('indexIssues', () => {
  it('accepts a folder whose index exists, opens the block, and describes every entry', () => {
    expect(indexIssues([folder(withBlock(''))])).toEqual([])
  })

  it('reports a source folder with no INDEX.md', () => {
    expect(indexIssues([folder(undefined)])).toEqual([
      {
        folder: 'packages/demo/src',
        kind: 'missing-index',
        detail: 'packages/demo/src/INDEX.md does not exist',
      },
    ])
  })

  it('reports an INDEX.md that never opens the generated block', () => {
    const issues = indexIssues([folder('# packages/demo/src\n\nPurpose.\n')])
    expect(issues.map((issue) => issue.kind)).toEqual(['missing-block'])
  })

  it('reports a file with no purpose comment and a subfolder with no opening statement', () => {
    const issues = indexIssues([
      {
        folder: 'packages/demo/src',
        entries: [fileEntry('a.ts', ''), { name: 'sub', kind: 'folder', description: '' }],
        indexContent: withBlock(''),
      },
    ])
    expect(issues.map((issue) => issue.detail)).toEqual([
      'packages/demo/src/a.ts has no leading // purpose comment (PS-057)',
      'packages/demo/src/sub INDEX.md has no opening purpose statement',
    ])
  })
})
