import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  backlogIdNumber,
  firstFreeNumber,
  formatBacklogId,
  formatMarkerName,
  markerNumber,
  markerNumbers,
  usedNumbers,
  validateBacklogIds,
} from '../src/ids.js'
import {
  allocateBacklogItems,
  backfillMarkers,
  markerDirName,
  readBacklogFileInfos,
  readMarkerNames,
} from '../src/io.js'

describe('formatBacklogId', () => {
  it('zero-pads to four digits', () => {
    expect(formatBacklogId(1)).toBe('BL-0001')
    expect(formatBacklogId(25)).toBe('BL-0025')
  })

  it('does not truncate past four digits', () => {
    expect(formatBacklogId(12345)).toBe('BL-12345')
  })
})

describe('backlogIdNumber', () => {
  it('reads the number from a slugged item filename', () => {
    expect(backlogIdNumber('BL-0024-metrics-rollup-glance-page.md')).toBe(24)
  })

  it('reads the number from a bare item filename', () => {
    expect(backlogIdNumber('BL-0024.md')).toBe(24)
  })

  it('reads the number from a bare id', () => {
    expect(backlogIdNumber('BL-0024')).toBe(24)
  })

  it('handles five-digit ids', () => {
    expect(backlogIdNumber('BL-12345-thing.md')).toBe(12345)
  })

  it('rejects generated views and anything unnumbered', () => {
    expect(backlogIdNumber('BACKLOG.md')).toBeUndefined()
    expect(backlogIdNumber('DONE.md')).toBeUndefined()
    expect(backlogIdNumber('notes.md')).toBeUndefined()
  })

  it('rejects a short or malformed prefix', () => {
    expect(backlogIdNumber('BL-24-thing.md')).toBeUndefined()
    expect(backlogIdNumber('BL0024-thing.md')).toBeUndefined()
    expect(backlogIdNumber('XBL-0024-thing.md')).toBeUndefined()
  })
})

describe('markerNumber', () => {
  it('reads a padded marker name', () => {
    expect(markerNumber('0025')).toBe(25)
    expect(formatMarkerName(25)).toBe('0025')
  })

  it('rejects anything that is not a padded number', () => {
    expect(markerNumber('25')).toBeUndefined()
    expect(markerNumber('next')).toBeUndefined()
    expect(markerNumber('0025.md')).toBeUndefined()
  })
})

describe('firstFreeNumber', () => {
  it('is one past the highest number in use', () => {
    expect(firstFreeNumber([1, 24, 7])).toBe(25)
  })

  it('starts at 1 for an empty backlog', () => {
    expect(firstFreeNumber([])).toBe(1)
  })

  it('ignores gaps rather than reusing them', () => {
    expect(firstFreeNumber([1, 2, 9])).toBe(10)
  })
})

describe('usedNumbers / markerNumbers', () => {
  it('skips names it cannot read a number from', () => {
    expect(usedNumbers(['BL-0001-a.md', 'BACKLOG.md', 'BL-0003-c.md'])).toEqual([1, 3])
    expect(markerNumbers(['0001', 'next', '0003'])).toEqual([1, 3])
  })
})

describe('validateBacklogIds', () => {
  const ok = { filename: 'BL-0001-a.md', frontmatterId: 'BL-0001' }

  it('accepts a well-formed backlog', () => {
    expect(validateBacklogIds([ok], ['0001'])).toEqual([])
  })

  it('ignores the generated views', () => {
    const files = [ok, { filename: 'BACKLOG.md', frontmatterId: undefined }]
    expect(validateBacklogIds(files, ['0001'])).toEqual([])
  })

  it('reports two files sharing a number', () => {
    const files = [ok, { filename: 'BL-0001-b.md', frontmatterId: 'BL-0001' }]
    const issues = validateBacklogIds(files, ['0001'])
    expect(issues.map((i) => i.kind)).toContain('duplicate-number')
  })

  it('reports frontmatter that disagrees with the filename', () => {
    const files = [{ filename: 'BL-0001-a.md', frontmatterId: 'BL-0002' }]
    const issues = validateBacklogIds(files, ['0001'])
    expect(issues.map((i) => i.kind)).toContain('id-mismatch')
  })

  it('reports a file with no readable frontmatter', () => {
    const files = [{ filename: 'BL-0001-a.md', frontmatterId: undefined }]
    const issues = validateBacklogIds(files, ['0001'])
    expect(issues.map((i) => i.kind)).toContain('unparseable-file')
  })

  it('reports an item with no BL-NNNN prefix', () => {
    const files = [{ filename: 'scratch.md', frontmatterId: 'BL-0009' }]
    const issues = validateBacklogIds(files, [])
    expect(issues.map((i) => i.kind)).toEqual(['unnumbered-file'])
  })

  it('reports an item created outside the allocator', () => {
    const issues = validateBacklogIds([ok], [])
    expect(issues.map((i) => i.kind)).toContain('missing-marker')
  })
})

describe('allocateBacklogItems', () => {
  let dir: string

  beforeEach(async () => {
    dir = join(tmpdir(), `backlog-ids-${process.pid}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  const names = async (): Promise<readonly string[]> => (await fs.readdir(dir)).sort()

  it('starts at 1 in an empty backlog and creates the item file', async () => {
    const allocated = await allocateBacklogItems(dir, ['first-thing'])
    expect(allocated.map((a) => a.id)).toEqual(['BL-0001'])
    expect(await names()).toContain('BL-0001-first-thing.md')
  })

  it('records a permanent marker for every number handed out', async () => {
    await allocateBacklogItems(dir, ['a', 'b'])
    expect([...(await readMarkerNames(dir))].sort()).toEqual(['0001', '0002'])
  })

  it('allocates a contiguous block in one call', async () => {
    const allocated = await allocateBacklogItems(dir, ['a', 'b', 'c'])
    expect(allocated.map((a) => a.id)).toEqual(['BL-0001', 'BL-0002', 'BL-0003'])
  })

  it('continues above existing items that predate the allocator', async () => {
    await fs.writeFile(join(dir, 'BL-0024-legacy.md'), '---\nid: BL-0024\ntitle: T\n---\n')
    const allocated = await allocateBacklogItems(dir, ['next-one'])
    expect(allocated[0]?.id).toBe('BL-0025')
  })

  it('never reuses a number after its item file is deleted', async () => {
    const [first] = await allocateBacklogItems(dir, ['gone'])
    await fs.rm(first?.path ?? '')
    const allocated = await allocateBacklogItems(dir, ['later'])
    expect(allocated[0]?.id).toBe('BL-0002')
  })

  it('never reuses a number after its item file is renamed', async () => {
    const [first] = await allocateBacklogItems(dir, ['old-slug'])
    await fs.rename(first?.path ?? '', join(dir, 'BL-0001-new-slug.md'))
    const allocated = await allocateBacklogItems(dir, ['later'])
    expect(allocated[0]?.id).toBe('BL-0002')
  })

  it('skips a number whose item file was hand-created, keeping ids unique', async () => {
    // Number 1 is unclaimed, but a file already sits at the name the allocator
    // would pick. It must step over rather than overwrite.
    await fs.writeFile(join(dir, 'BL-0001-squatter.md'), 'hand written')
    const allocated = await allocateBacklogItems(dir, ['fresh'])
    expect(allocated[0]?.id).toBe('BL-0002')
    expect(await fs.readFile(join(dir, 'BL-0001-squatter.md'), 'utf-8')).toBe('hand written')
  })

  it('hands out no duplicates under concurrent allocation', async () => {
    const rounds = await Promise.all(
      Array.from({ length: 12 }, (_unused, index) => allocateBacklogItems(dir, [`slug-${index}`])),
    )
    const ids = rounds.flat().map((a) => a.id)
    expect(ids).toHaveLength(12)
    expect(new Set(ids).size).toBe(12)
  })

  it('hands out no duplicates when concurrent callers ask for blocks', async () => {
    const rounds = await Promise.all(
      Array.from({ length: 6 }, (_unused, index) =>
        allocateBacklogItems(dir, [`a-${index}`, `b-${index}`, `c-${index}`]),
      ),
    )
    const numbers = rounds.flat().map((a) => a.number)
    expect(numbers).toHaveLength(18)
    expect(new Set(numbers).size).toBe(18)
  })
})

describe('backfillMarkers', () => {
  let dir: string

  beforeEach(async () => {
    dir = join(tmpdir(), `backlog-backfill-${process.pid}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(dir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('records markers for pre-existing items and is idempotent', async () => {
    await fs.writeFile(join(dir, 'BL-0001-a.md'), '---\nid: BL-0001\ntitle: A\n---\n')
    await fs.writeFile(join(dir, 'BL-0002-b.md'), '---\nid: BL-0002\ntitle: B\n---\n')
    expect(await backfillMarkers(dir)).toEqual([1, 2])
    expect(await backfillMarkers(dir)).toEqual([])
    expect([...(await readMarkerNames(dir))].sort()).toEqual(['0001', '0002'])
  })

  it('leaves a backfilled backlog validating clean', async () => {
    await fs.writeFile(join(dir, 'BL-0001-a.md'), '---\nid: BL-0001\ntitle: A\n---\n')
    await backfillMarkers(dir)
    const files = await readBacklogFileInfos(dir)
    expect(validateBacklogIds(files, await readMarkerNames(dir))).toEqual([])
  })

  it('puts markers in a directory the item scan ignores', async () => {
    await fs.writeFile(join(dir, 'BL-0001-a.md'), '---\nid: BL-0001\ntitle: A\n---\n')
    await backfillMarkers(dir)
    expect(await fs.readdir(join(dir, markerDirName))).toEqual(['0001'])
    expect((await readBacklogFileInfos(dir)).map((f) => f.filename)).toEqual(['BL-0001-a.md'])
  })
})
