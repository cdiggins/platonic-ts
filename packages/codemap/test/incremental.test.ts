import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CodeIndex } from '../../core/src/index.ts'
import { changedPaths, referenceRewalkSet } from '../src/incremental.ts'
import { indexRepo, openSession, updateSession } from '../src/io.ts'
import { scanTimestamps, watchRepo } from '../src/watch.ts'

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ['packages/*/src/**/*.ts'],
})

const sourceDir = 'packages/demo/src'

const write = async (repoDir: string, file: string, text: string): Promise<void> => {
  await writeFile(join(repoDir, file), text, 'utf8')
}

// generatedAt is the one field a rebuild is allowed to differ on.
const comparable = (index: CodeIndex): Omit<CodeIndex, 'generatedAt'> => {
  const { generatedAt: _generatedAt, ...rest } = index
  return rest
}

const emptyIndex: CodeIndex = {
  generatedAt: 0,
  root: 'C:/repo',
  files: [],
  folders: [],
  symbols: [],
  references: [],
}

describe('changedPaths', () => {
  it('reports files that appeared, vanished, or moved', () => {
    const previous = new Map([
      ['a.ts', 1],
      ['b.ts', 1],
      ['gone.ts', 1],
    ])
    const current = new Map([
      ['a.ts', 1],
      ['b.ts', 2],
      ['new.ts', 1],
    ])

    expect(changedPaths(previous, current)).toEqual(['b.ts', 'gone.ts', 'new.ts'])
  })
})

describe('referenceRewalkSet', () => {
  const index: CodeIndex = {
    ...emptyIndex,
    references: [
      {
        symbolId: 'a.ts#10',
        file: 'b.ts',
        span: { start: 0, length: 1 },
        line: 1,
        isDefinition: false,
      },
      {
        symbolId: 'c.ts#10',
        file: 'd.ts',
        span: { start: 0, length: 1 },
        line: 1,
        isDefinition: false,
      },
    ],
  }

  it('adds the files that referenced a changed file', () => {
    expect([...referenceRewalkSet(index, new Set(['a.ts']))].sort()).toEqual(['a.ts', 'b.ts'])
  })

  it('leaves files that only reference untouched declarations alone', () => {
    expect([...referenceRewalkSet(index, new Set(['e.ts']))]).toEqual(['e.ts'])
  })
})

describe('updateSession', () => {
  let repoDir = ''

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'platonic-codemap-'))
    await mkdir(join(repoDir, sourceDir), { recursive: true })
    await write(repoDir, 'tsconfig.json', tsconfig)
    await write(repoDir, `${sourceDir}/greet.ts`, 'export const greet = (name: string) => name\n')
    await write(
      repoDir,
      `${sourceDir}/main.ts`,
      "import { greet } from './greet.ts'\n\nexport const hello = () => greet('world')\n",
    )
  })

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true })
  })

  // The property that makes an incremental rebuild safe to prefer: it is not an
  // approximation of a full one, it is the same index.
  const expectsMatchFullRebuild = async (changed: readonly string[]): Promise<void> => {
    const session = await openSession(repoDir, 1)
    const updated = await updateSession(session, changed, 2)

    expect(comparable(updated.index)).toEqual(comparable(await indexRepo(repoDir, 3)))
  }

  it('matches a full rebuild when a declaration is renamed and its user follows', async () => {
    await expectsMatchFullRebuild([])
    await write(repoDir, `${sourceDir}/greet.ts`, 'export const hail = (name: string) => name\n')
    await write(
      repoDir,
      `${sourceDir}/main.ts`,
      "import { hail } from './greet.ts'\n\nexport const hello = () => hail('world')\n",
    )

    await expectsMatchFullRebuild([`${sourceDir}/greet.ts`, `${sourceDir}/main.ts`])
  })

  it('matches a full rebuild when a declaration moves and its user does not change', async () => {
    await write(
      repoDir,
      `${sourceDir}/greet.ts`,
      '// A comment that pushes the declaration down the file.\nexport const greet = (name: string) => name\n',
    )

    await expectsMatchFullRebuild([`${sourceDir}/greet.ts`])
  })

  it('matches a full rebuild when a file is added', async () => {
    await write(repoDir, `${sourceDir}/extra.ts`, 'export const extra = 1\n')

    await expectsMatchFullRebuild([`${sourceDir}/extra.ts`])
  })

  it('matches a full rebuild when a file is deleted', async () => {
    await write(repoDir, `${sourceDir}/main.ts`, 'export const hello = () => 1\n')
    await rm(join(repoDir, sourceDir, 'greet.ts'))

    await expectsMatchFullRebuild([`${sourceDir}/greet.ts`, `${sourceDir}/main.ts`])
  })

  it('matches a full rebuild when a markdown file changes', async () => {
    await mkdir(join(repoDir, 'docs'), { recursive: true })
    await write(repoDir, 'docs/note.md', '# Note\n')

    await expectsMatchFullRebuild(['docs/note.md'])
  })

  it('returns the same session when nothing changed', async () => {
    const session = await openSession(repoDir, 1)

    expect(await updateSession(session, [], 2)).toBe(session)
  })
})

describe('scanTimestamps', () => {
  let repoDir = ''

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'platonic-watch-'))
    await mkdir(join(repoDir, sourceDir), { recursive: true })
    await write(repoDir, `${sourceDir}/one.ts`, 'export const one = 1\n')
  })

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true })
  })

  it('keys every indexed file the way the index keys it', async () => {
    await write(repoDir, 'README.md', '# Demo\n')

    expect([...(await scanTimestamps(repoDir)).keys()].sort()).toEqual([
      'README.md',
      `${sourceDir}/one.ts`,
    ])
  })

  it('reports a write through changedPaths', async () => {
    const before = await scanTimestamps(repoDir)
    await write(repoDir, `${sourceDir}/two.ts`, 'export const two = 2\n')

    expect(changedPaths(before, await scanTimestamps(repoDir))).toEqual([`${sourceDir}/two.ts`])
  })
})

describe('watchRepo', () => {
  let repoDir = ''

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), 'platonic-watch-'))
    await mkdir(join(repoDir, sourceDir), { recursive: true })
  })

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true })
  })

  // Watching is best-effort by design, so the test waits for the report rather
  // than assuming it has arrived, and says nothing where there is no watch.
  it('reports a written source file by its repo-relative path', async () => {
    const touched: string[] = []
    const watch = watchRepo(repoDir, (file) => touched.push(file))
    if (watch === undefined) return

    await write(repoDir, `${sourceDir}/one.ts`, 'export const one = 1\n')
    const deadline = Date.now() + 5_000
    while (touched.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    watch.close()

    expect(touched).toContain(`${sourceDir}/one.ts`)
  })

  it('ignores files the index does not cover', async () => {
    const touched: string[] = []
    const watch = watchRepo(repoDir, (file) => touched.push(file))
    if (watch === undefined) return

    await write(repoDir, `${sourceDir}/notes.txt`, 'ignored\n')
    await new Promise((resolve) => setTimeout(resolve, 250))
    watch.close()

    expect(touched).toEqual([])
  })
})
