import { readdir, readFile } from 'node:fs/promises'
import type { BacklogItem, BacklogStatus } from '../../core/src/index.js'

const isValidStatus = (s: unknown): s is BacklogStatus =>
  s === 'todo' || s === 'doing' || s === 'done' || s === 'blocked'

const parseFrontmatter = (text: string): ReadonlyMap<string, string> =>
  new Map(
    text.split('\n').flatMap((line) => {
      const colonIdx = line.indexOf(':')
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      return colonIdx > 0 && key && value ? [[key, value] as const] : []
    }),
  )

export const parseBacklogFile = (file: string, content: string): BacklogItem | undefined => {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!frontmatterMatch || !frontmatterMatch[1] || !frontmatterMatch[2]) return undefined

  const fm = parseFrontmatter(frontmatterMatch[1])
  const id = fm.get('id')
  const title = fm.get('title')
  if (!id || !title) return undefined

  const statusRaw = fm.get('status')
  const priorityRaw = fm.get('priority')
  const priority = priorityRaw ? parseInt(priorityRaw, 10) : 3

  return {
    id,
    title,
    status: isValidStatus(statusRaw) ? statusRaw : 'todo',
    priority: Number.isNaN(priority) ? 3 : priority,
    owner: fm.get('owner'),
    created: fm.get('created'),
    file,
    body: frontmatterMatch[2].trim(),
  }
}

const statusOrder: Record<BacklogStatus, number> = { doing: 0, todo: 1, blocked: 2, done: 3 }

export const loadBacklog = async (dir: string): Promise<readonly BacklogItem[]> => {
  const files = await readdir(dir).catch(() => [] as string[])
  const parsed = await Promise.all(
    files
      .filter((f) => f.endsWith('.md'))
      .map((filename) =>
        readFile(`${dir}/${filename}`, 'utf-8')
          .then((content) => parseBacklogFile(`${dir}/${filename}`, content))
          .catch(() => undefined),
      ),
  )
  return parsed
    .filter((item): item is BacklogItem => item !== undefined)
    .sort(
      (a, b) => statusOrder[a.status] - statusOrder[b.status] || a.priority - b.priority,
    )
}

export const renderBacklogItem = (item: BacklogItem): string => {
  const lines = [
    `id: ${item.id}`,
    `title: ${item.title}`,
    `status: ${item.status}`,
    `priority: ${item.priority}`,
    ...(item.owner !== undefined ? [`owner: ${item.owner}`] : []),
    ...(item.created !== undefined ? [`created: ${item.created}`] : []),
  ]
  return `---\n${lines.join('\n')}\n---\n${item.body}`
}
