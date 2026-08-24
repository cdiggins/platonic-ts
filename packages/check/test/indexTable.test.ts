import { describe, it, expect } from 'vitest'
import { parseIndexTable, checkIndexFolder, checkIndexFolders, type FolderCheck } from '../src/indexTable.ts'

describe('parseIndexTable', () => {
  it('parses rows after the header separator, stripping backticks', () => {
    const content = [
      '# packages/foo/src',
      '',
      'Purpose statement.',
      '',
      '| File | Purpose |',
      '|---|---|',
      '| `index.ts` | Does the thing. |',
      '| `io.ts` | Reads the thing. |',
    ].join('\n')

    expect(parseIndexTable(content)).toEqual([
      { name: 'index.ts', description: 'Does the thing.' },
      { name: 'io.ts', description: 'Reads the thing.' },
    ])
  })

  it('returns no rows when there is no table', () => {
    expect(parseIndexTable('# packages/foo/src\n\nJust prose, no table.')).toEqual([])
  })

  it('records an empty description as an empty string, not undefined', () => {
    const content = ['| File | Purpose |', '|---|---|', '| `index.ts` |  |'].join('\n')
    expect(parseIndexTable(content)).toEqual([{ name: 'index.ts', description: '' }])
  })
})

describe('checkIndexFolder', () => {
  const table = (rows: readonly string[]): string =>
    ['| File | Purpose |', '|---|---|', ...rows].join('\n')

  it('flags a missing INDEX.md', () => {
    const check: FolderCheck = { folder: 'packages/foo/src', expectedNames: ['index.ts'], indexContent: undefined }
    expect(checkIndexFolder(check)).toEqual([
      { folder: 'packages/foo/src', kind: 'missing-index', detail: 'packages/foo/src/INDEX.md is missing' },
    ])
  })

  it('flags a file present on disk but absent from the table', () => {
    const check: FolderCheck = {
      folder: 'packages/foo/src',
      expectedNames: ['index.ts', 'io.ts'],
      indexContent: table(['| `index.ts` | Does the thing. |']),
    }
    const issues = checkIndexFolder(check)
    expect(issues).toEqual([
      { folder: 'packages/foo/src', kind: 'missing-entry', detail: 'io.ts is not listed in INDEX.md' },
    ])
  })

  it('flags a listed file that no longer exists', () => {
    const check: FolderCheck = {
      folder: 'packages/foo/src',
      expectedNames: ['index.ts'],
      indexContent: table(['| `index.ts` | Does the thing. |', '| `deleted.ts` | Gone. |']),
    }
    const issues = checkIndexFolder(check)
    expect(issues).toEqual([
      { folder: 'packages/foo/src', kind: 'ghost-entry', detail: 'deleted.ts is listed but does not exist' },
    ])
  })

  it('flags an empty description on a real file', () => {
    const check: FolderCheck = {
      folder: 'packages/foo/src',
      expectedNames: ['index.ts'],
      indexContent: table(['| `index.ts` |  |']),
    }
    const issues = checkIndexFolder(check)
    expect(issues).toEqual([
      { folder: 'packages/foo/src', kind: 'empty-description', detail: 'index.ts has an empty description' },
    ])
  })

  it('reports no issues for a complete, accurate index', () => {
    const check: FolderCheck = {
      folder: 'packages/foo/src',
      expectedNames: ['index.ts', 'io.ts'],
      indexContent: table([
        '| `index.ts` | Does the thing. |',
        '| `io.ts` | Reads the thing. |',
      ]),
    }
    expect(checkIndexFolder(check)).toEqual([])
  })
})

describe('checkIndexFolders', () => {
  it('flattens issues across multiple folders in order', () => {
    const checks: readonly FolderCheck[] = [
      { folder: 'packages/a/src', expectedNames: ['index.ts'], indexContent: undefined },
      {
        folder: 'packages/b/src',
        expectedNames: ['index.ts'],
        indexContent: table(['| `index.ts` | Does the thing. |']),
      },
    ]
    expect(checkIndexFolders(checks)).toEqual([
      { folder: 'packages/a/src', kind: 'missing-index', detail: 'packages/a/src/INDEX.md is missing' },
    ])
  })
})

const table = (rows: readonly string[]): string => ['| File | Purpose |', '|---|---|', ...rows].join('\n')
