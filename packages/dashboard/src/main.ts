// Composition root: wires transcripts + backlog + docs into the dashboard server.
// Supervisor-owned. Run with: npm run dashboard
import { readdir, stat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import type { AgentActivity, DashboardSnapshot, DocInfo } from '../../core/src/index.ts'
import {
  createTailState,
  pollTranscripts,
  computeStatuses,
  summarizeUsage,
} from '../../transcripts/src/index.ts'
import { loadBacklog } from '../../backlog/src/index.ts'
import { startDashboard } from './server.ts'

const repoDir = resolve(import.meta.dirname, '..', '..', '..')
const windowMs = 5 * 60_000
const maxActivities = 100_000

const transcriptDirs = (): readonly string[] => {
  const defaults = [join(homedir(), '.claude', 'projects', 'C--Users-cdigg-git-platonic-ts')]
  const extra = (process.env['PLATONIC_TRANSCRIPT_DIRS'] ?? '')
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.length > 0)
  return [...defaults, ...extra]
}

const listDocs = async (dir: string): Promise<readonly DocInfo[]> => {
  const entries = await readdir(dir).catch(() => [] as string[])
  const docs = await Promise.all(
    entries
      .filter((name) => name.endsWith('.md'))
      .map(async (name) => {
        const file = join(dir, name)
        const [info, content] = await Promise.all([stat(file), readFile(file, 'utf8')])
        const heading = content
          .split('\n')
          .find((line) => line.startsWith('# '))
        return {
          file,
          title: heading?.slice(2).trim() ?? basename(name, '.md'),
          modifiedAt: info.mtimeMs,
          sizeBytes: info.size,
        }
      }),
  )
  return docs.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

const main = async (): Promise<void> => {
  const dirs = transcriptDirs()
  let tail = createTailState()
  let activities: AgentActivity[] = []

  const provider = async (): Promise<DashboardSnapshot> => {
    const polled = await pollTranscripts(dirs, tail)
    tail = polled.state
    activities = [...activities, ...polled.activities].slice(-maxActivities)
    const now = Date.now()
    const [backlog, docs] = await Promise.all([
      loadBacklog(join(repoDir, 'backlog')),
      listDocs(join(repoDir, 'docs')),
    ])
    return {
      generatedAt: now,
      agents: computeStatuses(activities, now),
      usage: summarizeUsage(activities, now, windowMs),
      backlog,
      docs,
    }
  }

  const port = Number(process.env['PORT'] ?? 4747)
  const started = await startDashboard({ port, provider, pollIntervalMs: 2_000 })
  console.log(`platonic dashboard: http://localhost:${started.port}`)
  console.log(`watching transcript dirs:\n  ${dirs.join('\n  ')}`)
}

void main()
