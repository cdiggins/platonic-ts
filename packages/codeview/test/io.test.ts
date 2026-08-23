import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendFeedbackItem } from '../src/io.ts'
import { parseBacklogFile } from '../../backlog/src/index.ts'

const now = Date.UTC(2026, 7, 22, 12, 0, 0)

const makeBacklogDir = async (files: Readonly<Record<string, string>> = {}): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'codeview-backlog-'))
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, 'utf8')
  }
  return dir
}

const itemStub = (id: string): string =>
  `---\nid: ${id}\ntitle: Existing item\nstatus: ready\n---\nbody\n`

describe('appendFeedbackItem', () => {
  let dir: string | undefined

  afterEach(() => {
    // Temp dirs are left to the OS; nothing here writes into the real backlog/.
    dir = undefined
  })

  it('allocates BL-0001 in an empty directory', async () => {
    dir = await makeBacklogDir()
    const result = await appendFeedbackItem(
      dir,
      { text: 'The server file is doing too much', file: undefined, symbol: undefined },
      now,
    )
    expect(result.id).toBe('BL-0001')
    expect(result.file).toBe(join(dir, 'BL-0001-the-server-file-is-doing-too.md'))
    expect(await readdir(dir)).toEqual(['BL-0001-the-server-file-is-doing-too.md'])
  })

  it('allocates the next id after the highest existing one', async () => {
    dir = await makeBacklogDir({
      'BACKLOG.md': '# generated view\n',
      'BL-0001-a.md': itemStub('BL-0001'),
      'BL-0009-b.md': itemStub('BL-0009'),
      'BL-0016-c.md': itemStub('BL-0016'),
    })
    const result = await appendFeedbackItem(
      dir,
      { text: 'another idea', file: undefined, symbol: undefined },
      now,
    )
    expect(result.id).toBe('BL-0017')
  })

  it('round-trips through parseBacklogFile', async () => {
    dir = await makeBacklogDir()
    const result = await appendFeedbackItem(
      dir,
      {
        text: 'Split render.ts: highlighting and markdown are two concerns',
        file: 'packages/codeview/src/render.ts',
        symbol: 'packages/codeview/src/render.ts#120',
      },
      now,
    )
    const content = await readFile(result.file, 'utf8')
    const parsed = parseBacklogFile(result.file, content)

    expect(parsed).toBeDefined()
    expect(parsed?.id).toBe(result.id)
    expect(parsed?.title).toBe('Split render.ts: highlighting and markdown are two concerns')
    expect(parsed?.type).toBe('idea')
    expect(parsed?.status).toBe('idea')
    expect(parsed?.priority).toBe('?')
    expect(parsed?.effort).toBe('?')
    expect(parsed?.risk).toBe('?')
    expect(parsed?.area).toBe('repo')
    expect(parsed?.created).toBe('2026-08-22')
    expect(parsed?.body).toContain('Split render.ts: highlighting and markdown are two concerns')
    expect(parsed?.body).toContain('packages/codeview/src/render.ts')
    expect(parsed?.body).toContain('packages/codeview/src/render.ts#120')
    expect(parsed?.body).toContain('code browser')
  })

  it('keeps a multi-line note out of the title but verbatim in the body', async () => {
    dir = await makeBacklogDir()
    const text = 'first line of the note\nsecond line with detail'
    const result = await appendFeedbackItem(dir, { text, file: undefined, symbol: undefined }, now)
    const parsed = parseBacklogFile(result.file, await readFile(result.file, 'utf8'))

    expect(parsed?.title).toBe('first line of the note')
    expect(parsed?.body).toContain(text)
  })

  it('truncates a very long title and still slugs the filename', async () => {
    dir = await makeBacklogDir()
    const text = `${'word '.repeat(40)}end`
    const result = await appendFeedbackItem(dir, { text, file: undefined, symbol: undefined }, now)
    const parsed = parseBacklogFile(result.file, await readFile(result.file, 'utf8'))

    expect(parsed?.title.length).toBeLessThanOrEqual(72)
    expect(result.file.endsWith('BL-0001-word-word-word-word-word-word.md')).toBe(true)
  })

  it('falls back to a generic slug when the text has no word characters', async () => {
    dir = await makeBacklogDir()
    const result = await appendFeedbackItem(
      dir,
      { text: '!!! ???', file: undefined, symbol: undefined },
      now,
    )
    expect(result.file.endsWith('BL-0001-feedback.md')).toBe(true)
    const parsed = parseBacklogFile(result.file, await readFile(result.file, 'utf8'))
    expect(parsed?.title).toBe('!!! ???')
  })
})
