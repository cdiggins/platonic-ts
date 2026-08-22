import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseBacklogFile,
  loadBacklog,
  renderBacklogItem,
  buildBacklogTable,
  buildDoneLog,
  isOpen,
} from '../src/index.js'
import type { BacklogItem } from '../../core/src/index.js'

const fullItem: BacklogItem = {
  id: 'core-001',
  title: 'Test task',
  type: 'feature',
  status: 'ready',
  priority: 'p1',
  effort: 'M',
  risk: 'low',
  area: 'core',
  sprint: '2026-01-A',
  owner: 'alice',
  created: '2026-08-22',
  closed: undefined,
  links: ['docs/notes.md', 'core-002'],
  file: 'test.md',
  body: 'Task body here.',
}

describe('parseBacklogFile', () => {
  it('parses valid WorkQuarry frontmatter with all fields', () => {
    const content = `---
id: core-001
title: Test task
type: feature
status: ready
priority: p1
effort: M
risk: low
area: core
sprint: 2026-01-A
owner: alice
created: 2026-08-22
closed:
links: [docs/notes.md, core-002]
---
Task body here.`

    const item = parseBacklogFile('test.md', content)
    expect(item).toEqual(fullItem)
  })

  it('returns undefined if id is missing', () => {
    const content = `---
title: Test task
status: ready
---
Body`
    expect(parseBacklogFile('test.md', content)).toBeUndefined()
  })

  it('returns undefined if title is missing', () => {
    const content = `---
id: core-001
status: ready
---
Body`
    expect(parseBacklogFile('test.md', content)).toBeUndefined()
  })

  it('returns undefined if no frontmatter', () => {
    const content = 'Just a regular markdown file'
    expect(parseBacklogFile('test.md', content)).toBeUndefined()
  })

  it('defaults status to idea if missing', () => {
    const content = `---
id: core-001
title: Test
---
Body`
    const item = parseBacklogFile('test.md', content)
    expect(item?.status).toBe('idea')
  })

  it('defaults status to idea if invalid and unmapped', () => {
    const content = `---
id: core-001
title: Test
status: bogus
---
Body`
    const item = parseBacklogFile('test.md', content)
    expect(item?.status).toBe('idea')
  })

  it('defaults priority/effort/risk/type to unset markers if missing', () => {
    const content = `---
id: core-001
title: Test
---
Body`
    const item = parseBacklogFile('test.md', content)
    expect(item?.priority).toBe('?')
    expect(item?.effort).toBe('?')
    expect(item?.risk).toBe('?')
    expect(item?.type).toBe('idea')
  })

  it('accepts all valid WorkQuarry status values', () => {
    const statuses = ['idea', 'ready', 'in-progress', 'done', 'dropped']
    for (const status of statuses) {
      const content = `---
id: core-001
title: Test
status: ${status}
---
Body`
      const item = parseBacklogFile('test.md', content)
      expect(item?.status).toBe(status)
    }
  })

  it('parses links list', () => {
    const content = `---
id: core-001
title: Test
links: [a, b, c]
---
Body`
    const item = parseBacklogFile('test.md', content)
    expect(item?.links).toEqual(['a', 'b', 'c'])
  })

  it('defaults links to empty array when missing', () => {
    const content = `---
id: core-001
title: Test
---
Body`
    const item = parseBacklogFile('test.md', content)
    expect(item?.links).toEqual([])
  })

  describe('legacy thin-schema migration', () => {
    it('maps legacy status todo -> ready', () => {
      const content = `---
id: BL-0001
title: Test
status: todo
priority: 1
---
Body`
      const item = parseBacklogFile('test.md', content)
      expect(item?.status).toBe('ready')
    })

    it('maps legacy status doing -> in-progress', () => {
      const content = `---
id: BL-0001
title: Test
status: doing
---
Body`
      const item = parseBacklogFile('test.md', content)
      expect(item?.status).toBe('in-progress')
    })

    it('maps legacy status blocked -> ready', () => {
      const content = `---
id: BL-0001
title: Test
status: blocked
---
Body`
      const item = parseBacklogFile('test.md', content)
      expect(item?.status).toBe('ready')
    })

    it('keeps legacy status done as done', () => {
      const content = `---
id: BL-0001
title: Test
status: done
---
Body`
      const item = parseBacklogFile('test.md', content)
      expect(item?.status).toBe('done')
    })

    it('maps legacy numeric priority 1 -> p1', () => {
      const content = `---
id: BL-0001
title: Test
priority: 1
---
Body`
      const item = parseBacklogFile('test.md', content)
      expect(item?.priority).toBe('p1')
    })

    it('maps legacy numeric priority 2 -> p2', () => {
      const content = `---
id: BL-0001
title: Test
priority: 2
---
Body`
      const item = parseBacklogFile('test.md', content)
      expect(item?.priority).toBe('p2')
    })

    it('maps legacy numeric priority 3+ -> p3', () => {
      const content = `---
id: BL-0001
title: Test
priority: 4
---
Body`
      const item = parseBacklogFile('test.md', content)
      expect(item?.priority).toBe('p3')
    })

    it('old thin file with only id/title/status/priority/owner/created still parses', () => {
      const content = `---
id: BL-0001
title: Legacy item
status: todo
priority: 2
owner: bob
created: 2026-08-22
---
Old body.`
      const item = parseBacklogFile('test.md', content)
      expect(item).toEqual({
        id: 'BL-0001',
        title: 'Legacy item',
        type: 'idea',
        status: 'ready',
        priority: 'p2',
        effort: '?',
        risk: '?',
        area: undefined,
        sprint: undefined,
        owner: 'bob',
        created: '2026-08-22',
        closed: undefined,
        links: [],
        file: 'test.md',
        body: 'Old body.',
      })
    })
  })
})

describe('renderBacklogItem', () => {
  it('renders item with all fields and round-trips', () => {
    const md = renderBacklogItem(fullItem)
    expect(md).toContain('id: core-001')
    expect(md).toContain('type: feature')
    expect(md).toContain('status: ready')
    expect(md).toContain('priority: p1')
    expect(md).toContain('effort: M')
    expect(md).toContain('risk: low')
    expect(md).toContain('area: core')
    expect(md).toContain('sprint: 2026-01-A')
    expect(md).toContain('links: [docs/notes.md, core-002]')

    const reparsed = parseBacklogFile('test.md', md)
    expect(reparsed).toEqual(fullItem)
  })

  it('round-trips without owner, area, sprint, closed, links', () => {
    const minimal: BacklogItem = {
      id: 'core-003',
      title: 'Minimal test',
      type: 'idea',
      status: 'idea',
      priority: '?',
      effort: '?',
      risk: '?',
      area: undefined,
      sprint: undefined,
      owner: undefined,
      created: undefined,
      closed: undefined,
      links: [],
      file: 'test.md',
      body: 'Body',
    }
    const rendered = renderBacklogItem(minimal)
    const reparsed = parseBacklogFile('test.md', rendered)
    expect(reparsed).toEqual(minimal)
  })
})

describe('isOpen', () => {
  it('done and dropped are closed, everything else open', () => {
    expect(isOpen({ ...fullItem, status: 'idea' })).toBe(true)
    expect(isOpen({ ...fullItem, status: 'ready' })).toBe(true)
    expect(isOpen({ ...fullItem, status: 'in-progress' })).toBe(true)
    expect(isOpen({ ...fullItem, status: 'done' })).toBe(false)
    expect(isOpen({ ...fullItem, status: 'dropped' })).toBe(false)
  })
})

describe('buildBacklogTable', () => {
  it('lists only open items as a markdown table', () => {
    const table = buildBacklogTable([
      { ...fullItem, id: 'a-1', status: 'ready' },
      { ...fullItem, id: 'a-2', status: 'done', closed: '2026-08-22' },
    ])
    expect(table).toContain('a-1')
    expect(table).not.toContain('a-2')
    expect(table).toContain('GENERATED')
  })
})

describe('buildDoneLog', () => {
  it('lists only closed items, newest first', () => {
    const log = buildDoneLog([
      { ...fullItem, id: 'a-1', status: 'ready' },
      { ...fullItem, id: 'a-2', status: 'done', closed: '2026-08-20' },
      { ...fullItem, id: 'a-3', status: 'dropped', closed: '2026-08-22' },
    ])
    expect(log).not.toContain('a-1')
    expect(log).toContain('a-2')
    expect(log).toContain('a-3')
    expect(log.indexOf('a-3')).toBeLessThan(log.indexOf('a-2'))
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
id: core-001
title: Test
status: ready
priority: p1
---
Body`
    await fs.writeFile(join(tempDir, 'item1.md'), content)

    const items = await loadBacklog(tempDir)
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('core-001')
  })

  it('returns empty array for missing directory', async () => {
    const items = await loadBacklog('/nonexistent/dir/xyz')
    expect(items).toEqual([])
  })

  it('skips non-.md files', async () => {
    const mdContent = `---
id: core-001
title: Test
---
Body`
    await fs.writeFile(join(tempDir, 'item.md'), mdContent)
    await fs.writeFile(join(tempDir, 'readme.txt'), 'not parsed')

    const items = await loadBacklog(tempDir)
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('core-001')
  })

  it('skips unparseable .md files', async () => {
    const goodContent = `---
id: core-001
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
    expect(items[0]?.id).toBe('core-001')
  })

  it('sorts by status order: in-progress, ready, idea, done, dropped', async () => {
    const files = [
      { name: 'done.md', status: 'done' },
      { name: 'dropped.md', status: 'dropped' },
      { name: 'inprogress.md', status: 'in-progress' },
      { name: 'idea.md', status: 'idea' },
      { name: 'ready.md', status: 'ready' },
    ]

    for (const { name, status } of files) {
      const content = `---
id: ${name.replace('.md', '')}
title: ${status}
status: ${status}
priority: p1
---
Body`
      await fs.writeFile(join(tempDir, name), content)
    }

    const items = await loadBacklog(tempDir)
    expect(items.map((i) => i.status)).toEqual(['in-progress', 'ready', 'idea', 'done', 'dropped'])
  })

  it('sorts by ascending priority within same status', async () => {
    const files = [
      { name: 'p3.md', priority: 'p3' },
      { name: 'p1.md', priority: 'p1' },
      { name: 'p2.md', priority: 'p2' },
    ]

    for (const { name, priority } of files) {
      const content = `---
id: ${name.replace('.md', '')}
title: Item
status: ready
priority: ${priority}
---
Body`
      await fs.writeFile(join(tempDir, name), content)
    }

    const items = await loadBacklog(tempDir)
    expect(items.map((i) => i.priority)).toEqual(['p1', 'p2', 'p3'])
  })

  it('does not recurse into subdirectories', async () => {
    const subdir = join(tempDir, 'subdir')
    await fs.mkdir(subdir)

    const topContent = `---
id: core-001
title: Top
---
Body`
    const subContent = `---
id: core-002
title: Sub
---
Body`

    await fs.writeFile(join(tempDir, 'top.md'), topContent)
    await fs.writeFile(join(subdir, 'sub.md'), subContent)

    const items = await loadBacklog(tempDir)
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('core-001')
  })
})
