import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseBacklogFile, loadBacklog, renderBacklogItem } from '../src/index.js'
import type { BacklogItem } from '../../core/src/index.js'

describe('parseBacklogFile', () => {
  it('parses valid frontmatter with all fields', () => {
    const content = `---
id: BL-0001
title: Test task
status: todo
priority: 1
owner: alice
created: 2026-08-22
---
Task body here.`

    const item = parseBacklogFile('test.md', content)
    expect(item).toEqual({
      id: 'BL-0001',
      title: 'Test task',
      status: 'todo',
      priority: 1,
      owner: 'alice',
      created: '2026-08-22',
      file: 'test.md',
      body: 'Task body here.',
    })
  })

  it('returns undefined if id is missing', () => {
    const content = `---
title: Test task
status: todo
priority: 1
---
Body`
    expect(parseBacklogFile('test.md', content)).toBeUndefined()
  })

  it('returns undefined if title is missing', () => {
    const content = `---
id: BL-0001
status: todo
priority: 1
---
Body`
    expect(parseBacklogFile('test.md', content)).toBeUndefined()
  })

  it('returns undefined if no frontmatter', () => {
    const content = 'Just a regular markdown file'
    expect(parseBacklogFile('test.md', content)).toBeUndefined()
  })

  it('defaults status to todo if missing', () => {
    const content = `---
id: BL-0001
title: Test
priority: 2
---
Body`
    const item = parseBacklogFile('test.md', content)
    expect(item?.status).toBe('todo')
  })

  it('defaults status to todo if invalid', () => {
    const content = `---
id: BL-0001
title: Test
status: invalid
priority: 2
---
Body`
    const item = parseBacklogFile('test.md', content)
    expect(item?.status).toBe('todo')
  })

  it('defaults priority to 3 if missing', () => {
    const content = `---
id: BL-0001
title: Test
---
Body`
    const item = parseBacklogFile('test.md', content)
    expect(item?.priority).toBe(3)
  })

  it('defaults priority to 3 if invalid', () => {
    const content = `---
id: BL-0001
title: Test
priority: notanumber
---
Body`
    const item = parseBacklogFile('test.md', content)
    expect(item?.priority).toBe(3)
  })

  it('trims body whitespace', () => {
    const content = `---
id: BL-0001
title: Test
---

   Body with whitespace

`
    const item = parseBacklogFile('test.md', content)
    expect(item?.body).toBe('Body with whitespace')
  })

  it('parses multiline body', () => {
    const content = `---
id: BL-0001
title: Test
---
Line 1
Line 2
Line 3`
    const item = parseBacklogFile('test.md', content)
    expect(item?.body).toBe('Line 1\nLine 2\nLine 3')
  })

  it('accepts valid status values', () => {
    const statuses = ['todo', 'doing', 'done', 'blocked']
    for (const status of statuses) {
      const content = `---
id: BL-0001
title: Test
status: ${status}
---
Body`
      const item = parseBacklogFile('test.md', content)
      expect(item?.status).toBe(status)
    }
  })
})

describe('renderBacklogItem', () => {
  it('renders item with all fields', () => {
    const item: BacklogItem = {
      id: 'BL-0001',
      title: 'Test task',
      status: 'todo',
      priority: 1,
      owner: 'alice',
      created: '2026-08-22',
      file: 'test.md',
      body: 'Task body.',
    }
    const md = renderBacklogItem(item)
    expect(md).toContain('---')
    expect(md).toContain('id: BL-0001')
    expect(md).toContain('title: Test task')
    expect(md).toContain('status: todo')
    expect(md).toContain('priority: 1')
    expect(md).toContain('owner: alice')
    expect(md).toContain('created: 2026-08-22')
    expect(md).toContain('Task body.')
  })

  it('omits owner when undefined', () => {
    const item: BacklogItem = {
      id: 'BL-0001',
      title: 'Test',
      status: 'todo',
      priority: 3,
      owner: undefined,
      created: '2026-08-22',
      file: 'test.md',
      body: 'Body',
    }
    const md = renderBacklogItem(item)
    expect(md).not.toContain('owner:')
  })

  it('omits created when undefined', () => {
    const item: BacklogItem = {
      id: 'BL-0001',
      title: 'Test',
      status: 'todo',
      priority: 3,
      owner: 'alice',
      created: undefined,
      file: 'test.md',
      body: 'Body',
    }
    const md = renderBacklogItem(item)
    expect(md).not.toContain('created:')
  })

  it('round-trips through parseBacklogFile', () => {
    const original: BacklogItem = {
      id: 'BL-0005',
      title: 'Round trip test',
      status: 'doing',
      priority: 2,
      owner: 'bob',
      created: '2026-08-22',
      file: 'test.md',
      body: 'Multi\nline\nbody',
    }
    const rendered = renderBacklogItem(original)
    const reparsed = parseBacklogFile('test.md', rendered)

    expect(reparsed).toEqual(original)
  })

  it('round-trips without owner and created', () => {
    const original: BacklogItem = {
      id: 'BL-0003',
      title: 'Minimal test',
      status: 'blocked',
      priority: 4,
      owner: undefined,
      created: undefined,
      file: 'test.md',
      body: 'Body',
    }
    const rendered = renderBacklogItem(original)
    const reparsed = parseBacklogFile('test.md', rendered)

    expect(reparsed).toEqual(original)
  })
})

describe('loadBacklog', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = join(tmpdir(), `backlog-test-${Date.now()}`)
    await fs.mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true })
    } catch {
      // ignore
    }
  })

  it('loads and parses .md files', async () => {
    const content = `---
id: BL-0001
title: Test
status: todo
priority: 1
---
Body`
    await fs.writeFile(join(tempDir, 'item1.md'), content)

    const items = await loadBacklog(tempDir)
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('BL-0001')
  })

  it('returns empty array for missing directory', async () => {
    const items = await loadBacklog('/nonexistent/dir/xyz')
    expect(items).toEqual([])
  })

  it('skips non-.md files', async () => {
    const mdContent = `---
id: BL-0001
title: Test
---
Body`
    await fs.writeFile(join(tempDir, 'item.md'), mdContent)
    await fs.writeFile(join(tempDir, 'readme.txt'), 'not parsed')

    const items = await loadBacklog(tempDir)
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('BL-0001')
  })

  it('skips unparseable .md files', async () => {
    const goodContent = `---
id: BL-0001
title: Good
---
Body`
    const badContent = `---
title: Missing id
---
Body`

    await fs.writeFile(join(tempDir, 'good.md'), goodContent)
    await fs.writeFile(join(tempDir, 'bad.md'), badContent)

    const items = await loadBacklog(tempDir)
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('BL-0001')
  })

  it('sorts by status order: doing, todo, blocked, done', async () => {
    const files = [
      { name: 'done.md', status: 'done' },
      { name: 'doing.md', status: 'doing' },
      { name: 'blocked.md', status: 'blocked' },
      { name: 'todo.md', status: 'todo' },
    ]

    for (const { name, status } of files) {
      const content = `---
id: ${name.replace('.md', '')}
title: ${status}
status: ${status}
priority: 1
---
Body`
      await fs.writeFile(join(tempDir, name), content)
    }

    const items = await loadBacklog(tempDir)
    expect(items).toHaveLength(4)
    expect(items[0]?.status).toBe('doing')
    expect(items[1]?.status).toBe('todo')
    expect(items[2]?.status).toBe('blocked')
    expect(items[3]?.status).toBe('done')
  })

  it('sorts by ascending priority within same status', async () => {
    const files = [
      { name: 'p3.md', priority: 3 },
      { name: 'p1.md', priority: 1 },
      { name: 'p2.md', priority: 2 },
    ]

    for (const { name, priority } of files) {
      const content = `---
id: ${name.replace('.md', '')}
title: Item
status: todo
priority: ${priority}
---
Body`
      await fs.writeFile(join(tempDir, name), content)
    }

    const items = await loadBacklog(tempDir)
    expect(items).toHaveLength(3)
    expect(items[0]?.priority).toBe(1)
    expect(items[1]?.priority).toBe(2)
    expect(items[2]?.priority).toBe(3)
  })

  it('does not recurse into subdirectories', async () => {
    const subdir = join(tempDir, 'subdir')
    await fs.mkdir(subdir)

    const topContent = `---
id: BL-0001
title: Top
---
Body`
    const subContent = `---
id: BL-0002
title: Sub
---
Body`

    await fs.writeFile(join(tempDir, 'top.md'), topContent)
    await fs.writeFile(join(subdir, 'sub.md'), subContent)

    const items = await loadBacklog(tempDir)
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('BL-0001')
  })
})
