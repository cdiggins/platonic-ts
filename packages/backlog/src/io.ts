// Root zone: the filesystem half of backlog id allocation.
//
// The whole scheme rests on one primitive — exclusive file creation. `open(…,
// 'wx')` either creates the file or fails with EEXIST, atomically, on NTFS and
// POSIX alike. So the act of claiming a number and the act of recording it are
// the same operation, and there is no window in which two processes both
// believe they hold number 25. That is why there is no lock file here, and so
// nothing to time out, steal, or clean up after a killed agent.
//
// The directory scan below picks the starting point only. If it is stale or
// wrong the probe just fails a claim and walks up; correctness never depends
// on it.
import { mkdir, open, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseBacklogFile } from './index.ts'
import {
  type BacklogFileInfo,
  firstFreeNumber,
  formatBacklogId,
  formatMarkerName,
  markerNumbers,
  usedNumbers,
} from './ids.ts'

export const markerDirName = '.ids'

export type AllocatedItem = {
  readonly id: string
  readonly number: number
  readonly path: string
}

// Reading `code` through Reflect keeps this free of casts (PS-009).
const errorCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) return undefined
  const code: unknown = Reflect.get(error, 'code')
  return typeof code === 'string' ? code : undefined
}

// Outcome of an exclusive create. `exists` means someone else holds the name;
// `failed` means the filesystem said something else entirely, which must stop
// the probe rather than be mistaken for contention.
type ClaimResult = 'created' | 'exists' | 'failed'

const createExclusive = async (path: string): Promise<ClaimResult> => {
  const outcome = await open(path, 'wx').then(
    (handle) => handle,
    (error: unknown): ClaimResult => (errorCode(error) === 'EEXIST' ? 'exists' : 'failed'),
  )
  if (typeof outcome === 'string') return outcome
  await outcome.close()
  return 'created'
}

const listNames = async (dir: string): Promise<readonly string[]> =>
  readdir(dir).catch((): string[] => [])

const itemFileName = (id: string, slug: string): string =>
  slug === '' ? `${id}.md` : `${id}-${slug}.md`

// Claims the first free number at or above `from`, creating both its permanent
// marker and its (empty) item file. Returns undefined only if the search runs
// past `limit`, which means something is badly wrong rather than merely busy.
const claimFrom = async (
  dir: string,
  slug: string,
  from: number,
  limit: number,
): Promise<AllocatedItem | undefined> => {
  for (let value = from; value < limit; value++) {
    const marker = await createExclusive(join(dir, markerDirName, formatMarkerName(value)))
    if (marker === 'failed') return undefined
    if (marker === 'exists') continue

    const id = formatBacklogId(value)
    const path = join(dir, itemFileName(id, slug))
    // The marker is ours, so an item file at this path was hand-created
    // outside the allocator. Burn the number and move up rather than
    // overwrite someone's work.
    if ((await createExclusive(path)) !== 'created') continue
    return { id, number: value, path }
  }
  return undefined
}

export const allocateBacklogItems = async (
  dir: string,
  slugs: readonly string[],
): Promise<readonly AllocatedItem[]> => {
  await mkdir(join(dir, markerDirName), { recursive: true })
  const [files, markers] = await Promise.all([listNames(dir), listNames(join(dir, markerDirName))])
  const start = Math.max(
    firstFreeNumber(usedNumbers(files)),
    firstFreeNumber(markerNumbers(markers)),
  )
  const limit = start + slugs.length + 1000

  const allocated: AllocatedItem[] = []
  let next = start
  for (const slug of slugs) {
    const item = await claimFrom(dir, slug, next, limit)
    if (item === undefined) return allocated
    allocated.push(item)
    next = item.number + 1
  }
  return allocated
}

// Backfills markers for items that predate the allocator. Idempotent: an
// existing marker is left alone.
export const backfillMarkers = async (dir: string): Promise<readonly number[]> => {
  await mkdir(join(dir, markerDirName), { recursive: true })
  const files = await listNames(dir)
  const existing = new Set(markerNumbers(await listNames(join(dir, markerDirName))))
  const missing = [...new Set(usedNumbers(files))]
    .filter((value) => !existing.has(value))
    .sort((a, b) => a - b)
  const created = await Promise.all(
    missing.map(async (value) =>
      (await createExclusive(join(dir, markerDirName, formatMarkerName(value)))) === 'created'
        ? value
        : undefined,
    ),
  )
  return created.filter((value): value is number => value !== undefined)
}

export const readBacklogFileInfos = async (dir: string): Promise<readonly BacklogFileInfo[]> => {
  const files = (await listNames(dir)).filter((name) => name.endsWith('.md'))
  return Promise.all(
    files.map(async (filename) => {
      const content = await readFile(join(dir, filename), 'utf-8').catch(() => undefined)
      const item = content === undefined ? undefined : parseBacklogFile(filename, content)
      return { filename, frontmatterId: item?.id }
    }),
  )
}

export const readMarkerNames = async (dir: string): Promise<readonly string[]> =>
  listNames(join(dir, markerDirName))
