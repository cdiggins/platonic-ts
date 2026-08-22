import { promises as fs } from 'node:fs'
import { readdir } from 'node:fs/promises'
import type { BacklogItem, BacklogStatus } from '../../core/src/index.js'

const isValidStatus = (s: unknown): s is BacklogStatus =>
  s === 'todo' || s === 'doing' || s === 'done' || s === 'blocked'

export const parseBacklogFile = (file: string, content: string): BacklogItem | undefined => {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!frontmatterMatch || !frontmatterMatch[1] || !frontmatterMatch[2]) return undefined

  const frontmatterText = frontmatterMatch[1]
  const bodyText = frontmatterMatch[2]
  const fm = new Map<string, string>()

  // Parse YAML-ish frontmatter
  for (const line of frontmatterText.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      if (key && value) {
        fm.set(key, value)
      }
    }
  }

  const id = fm.get('id')
  const title = fm.get('title')

  if (!id || !title) return undefined

  const statusRaw = fm.get('status')
  const status: BacklogStatus = isValidStatus(statusRaw) ? statusRaw : 'todo'

  const priorityRaw = fm.get('priority')
  const priority = priorityRaw ? parseInt(priorityRaw, 10) : 3
  const priorityValid = !Number.isNaN(priority) ? priority : 3

  const owner = fm.get('owner')
  const created = fm.get('created')
  const body = bodyText.trim()

  return { id, title, status, priority: priorityValid, owner, created, file, body }
}

export const loadBacklog = async (dir: string): Promise<readonly BacklogItem[]> => {
  let files: string[] = []
  try {
    files = await readdir(dir)
  } catch {
    return []
  }

  const mdFiles = files.filter((f) => f.endsWith('.md'))
  const items: BacklogItem[] = []

  for (const filename of mdFiles) {
    const filepath = `${dir}/${filename}`
    try {
      const content = await fs.readFile(filepath, 'utf-8')
      const item = parseBacklogFile(filepath, content)
      if (item) {
        items.push(item)
      }
    } catch {
      // Skip unparseable files
    }
  }

  // Sort by status order (doing, todo, blocked, done), then ascending priority
  const statusOrder: Record<BacklogStatus, number> = {
    doing: 0,
    todo: 1,
    blocked: 2,
    done: 3,
  }

  items.sort((a, b) => {
    const statusDiff = statusOrder[a.status] - statusOrder[b.status]
    if (statusDiff !== 0) return statusDiff
    return a.priority - b.priority
  })

  return items
}

export const renderBacklogItem = (item: BacklogItem): string => {
  let fm = `id: ${item.id}\ntitle: ${item.title}\nstatus: ${item.status}\npriority: ${item.priority}`

  if (item.owner !== undefined) {
    fm += `\nowner: ${item.owner}`
  }

  if (item.created !== undefined) {
    fm += `\ncreated: ${item.created}`
  }

  return `---\n${fm}\n---\n${item.body}`
}
