// Composition root / CLI entry for the backlog.
//   npx tsx packages/backlog/src/main.ts regen
//   npx tsx packages/backlog/src/main.ts next-id <slug> [<slug> ...]
//   npx tsx packages/backlog/src/main.ts validate
//   npx tsx packages/backlog/src/main.ts archive
import { spawn } from 'node:child_process'
import { basename, dirname, relative, resolve } from 'node:path'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import type { BacklogItem } from '../../core/src/index.js'
import { archiveDirName, isOpen, loadBacklog, buildBacklogTable, buildDoneLog } from './index.ts'
import { validateBacklogIds } from './ids.ts'
import {
  allocateBacklogItems,
  backfillMarkers,
  readBacklogFileInfos,
  readMarkerNames,
} from './io.ts'

const repoDir = resolve(import.meta.dirname, '..', '..', '..')
const backlogDir = resolve(repoDir, 'backlog')
const archiveDir = resolve(backlogDir, archiveDirName)

const usage = `usage:
  regen                        rebuild BACKLOG.md and DONE.md from item frontmatter
  next-id <slug> [<slug> ...]  claim one id per slug and create its empty item file
  validate                     report duplicate, misnamed, or unclaimed ids
  backfill-markers             record markers for items that predate the allocator
  archive                      move done/dropped items into backlog/archive/`

const regen = async (): Promise<void> => {
  const items = await loadBacklog(backlogDir)
  await writeFile(resolve(backlogDir, 'BACKLOG.md'), buildBacklogTable(items), 'utf-8')
  await writeFile(resolve(backlogDir, 'DONE.md'), buildDoneLog(items), 'utf-8')
  console.log(`regenerated BACKLOG.md and DONE.md from ${items.length} item(s)`)
}

const nextId = async (slugs: readonly string[]): Promise<void> => {
  if (slugs.length === 0) {
    console.error(`next-id needs at least one slug\n${usage}`)
    process.exitCode = 1
    return
  }
  const allocated = await allocateBacklogItems(backlogDir, slugs)
  for (const item of allocated) console.log(`${item.id}\t${relative(repoDir, item.path)}`)
  if (allocated.length < slugs.length) {
    console.error(`could only allocate ${allocated.length} of ${slugs.length} id(s)`)
    process.exitCode = 1
  }
}

const validate = async (): Promise<void> => {
  const [files, markers] = await Promise.all([
    readBacklogFileInfos(backlogDir),
    readMarkerNames(backlogDir),
  ])
  const issues = validateBacklogIds(files, markers)
  for (const issue of issues) console.error(`${issue.kind}: ${issue.detail}`)
  if (issues.length > 0) {
    console.error(`${issues.length} id issue(s)`)
    process.exitCode = 1
    return
  }
  console.log(`ids ok — ${markers.length} allocated, no duplicates`)
}

const backfill = async (): Promise<void> => {
  const created = await backfillMarkers(backlogDir)
  console.log(
    created.length === 0
      ? 'no markers to backfill'
      : `backfilled ${created.length} marker(s): ${created.join(', ')}`,
  )
}

// Archiving is a deliberate, reviewable step rather than a side effect of
// regen: it rewrites paths in git history, which nobody should trigger by
// accident while rebuilding a generated table.
const isArchived = (item: BacklogItem): boolean =>
  basename(dirname(item.file)) === archiveDirName

// `git mv` keeps the file's history attached to its new path. If git is
// unavailable, or the file is untracked, fall back to a plain rename — the
// move itself matters more than the history record.
const gitMove = (from: string, to: string): Promise<boolean> =>
  new Promise((done) => {
    const child = spawn('git', ['mv', from, to], { cwd: repoDir })
    child.on('close', (code) => {
      done(code === 0)
    })
    child.on('error', () => {
      done(false)
    })
  })

const moveToArchive = async (item: BacklogItem): Promise<string> => {
  const name = basename(item.file)
  const target = resolve(archiveDir, name)
  const moved = await gitMove(item.file, target)
  if (!moved) await rename(item.file, target)
  return `${name}${moved ? '' : ' (renamed; git mv failed)'}`
}

const archive = async (): Promise<void> => {
  const items = await loadBacklog(backlogDir)
  const closed = items.filter((item) => !isOpen(item) && !isArchived(item))
  if (closed.length === 0) {
    console.log('nothing to archive — backlog/ holds only open items')
    return
  }
  await mkdir(archiveDir, { recursive: true })
  const moved: string[] = []
  for (const item of closed) moved.push(await moveToArchive(item))
  console.log(`archived ${moved.length} item(s) into backlog/${archiveDirName}/:`)
  for (const name of moved) console.log(`  ${name}`)
}

const main = async (): Promise<void> => {
  const command = process.argv[2] ?? 'regen'
  const rest = process.argv.slice(3)
  if (command === 'regen') {
    await regen()
    return
  }
  if (command === 'next-id') {
    await nextId(rest)
    return
  }
  if (command === 'validate') {
    await validate()
    return
  }
  if (command === 'backfill-markers') {
    await backfill()
    return
  }
  if (command === 'archive') {
    await archive()
    return
  }
  console.error(`unknown command: ${command}\n${usage}`)
  process.exitCode = 1
}

void main()
