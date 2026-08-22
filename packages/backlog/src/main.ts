// Composition root / CLI entry for backlog view regeneration.
// Run with: npx tsx packages/backlog/src/main.ts regen
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { loadBacklog, buildBacklogTable, buildDoneLog } from './index.ts'

const repoDir = resolve(import.meta.dirname, '..', '..', '..')
const backlogDir = resolve(repoDir, 'backlog')

const regen = async (): Promise<void> => {
  const items = await loadBacklog(backlogDir)
  await writeFile(resolve(backlogDir, 'BACKLOG.md'), buildBacklogTable(items), 'utf-8')
  await writeFile(resolve(backlogDir, 'DONE.md'), buildDoneLog(items), 'utf-8')
  console.log(`regenerated BACKLOG.md and DONE.md from ${items.length} item(s)`)
}

const main = async (): Promise<void> => {
  const cmd = process.argv[2] ?? 'regen'
  if (cmd === 'regen') {
    await regen()
    return
  }
  console.error(`unknown command: ${cmd}\nusage: tsx packages/backlog/src/main.ts regen`)
  process.exitCode = 1
}

void main()
