// Parses one backlog markdown file's frontmatter into a `BacklogItem` (tolerating the
// pre-WorkQuarry schema), loads the full backlog from disk, and renders the generated views.
import { readdir, readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  BacklogApproach,
  BacklogEffort,
  BacklogItem,
  BacklogPriority,
  BacklogRisk,
  BacklogStatus,
  BacklogType,
} from '../../core/src/index.js'

// Tolerant migration from the old thin schema (status: todo|doing|done|blocked,
// priority: number) to WorkQuarry's (status: idea|ready|in-progress|done|dropped,
// priority: p1|p2|p3|?). Old files without these fields still parse with sensible
// defaults. See backlog/decisions/2026-08-22-adopt-workquarry-format.md.
const legacyStatusMap: Readonly<Record<string, BacklogStatus>> = {
  todo: 'ready',
  doing: 'in-progress',
  done: 'done',
  blocked: 'ready',
}

const validStatuses: readonly BacklogStatus[] = ['idea', 'ready', 'in-progress', 'done', 'dropped']
const validTypes: readonly BacklogType[] = ['feature', 'debt', 'bug', 'idea', 'problem', 'retire']
const validPriorities: readonly BacklogPriority[] = ['p1', 'p2', 'p3', '?']
const validEfforts: readonly BacklogEffort[] = ['S', 'M', 'L', '?']
const validRisks: readonly BacklogRisk[] = ['low', 'med', 'high', '?']
const validApproaches: readonly BacklogApproach[] = ['sequential', 'parallel', 'undecided']

const isOneOf = <T extends string>(values: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && values.some((candidate) => candidate === v)

const parseStatus = (raw: string | undefined): BacklogStatus => {
  if (raw === undefined) return 'idea'
  if (isOneOf(validStatuses, raw)) return raw
  const legacy = legacyStatusMap[raw]
  return legacy ?? 'idea'
}

const parseType = (raw: string | undefined): BacklogType =>
  isOneOf(validTypes, raw) ? raw : 'idea'

// Legacy numeric priority (1 = highest) maps onto the three WorkQuarry tiers;
// anything below 3 collapses into p3 rather than inventing a p4 tier.
const legacyPriorityMap = (n: number): BacklogPriority => {
  if (n <= 1) return 'p1'
  if (n === 2) return 'p2'
  return 'p3'
}

const parsePriority = (raw: string | undefined): BacklogPriority => {
  if (raw === undefined) return '?'
  const unquoted = raw.replace(/^"(.*)"$/, '$1')
  if (isOneOf(validPriorities, unquoted)) return unquoted
  const n = Number.parseInt(unquoted, 10)
  return Number.isNaN(n) ? '?' : legacyPriorityMap(n)
}

const parseEffort = (raw: string | undefined): BacklogEffort => {
  const unquoted = raw?.replace(/^"(.*)"$/, '$1')
  return isOneOf(validEfforts, unquoted) ? unquoted : '?'
}

const parseRisk = (raw: string | undefined): BacklogRisk => {
  const unquoted = raw?.replace(/^"(.*)"$/, '$1')
  return isOneOf(validRisks, unquoted) ? unquoted : '?'
}

const parseApproach = (raw: string | undefined): BacklogApproach => {
  const unquoted = raw?.replace(/^"(.*)"$/, '$1')
  return isOneOf(validApproaches, unquoted) ? unquoted : 'undecided'
}

const parseLinks = (raw: string | undefined): readonly string[] => {
  if (raw === undefined) return []
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '')
  return inner
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

const parseFrontmatter = (text: string): ReadonlyMap<string, string> =>
  new Map(
    text.split('\n').flatMap((line) => {
      const colonIdx = line.indexOf(':')
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      return colonIdx > 0 && key ? [[key, value] as const] : []
    }),
  )

// Parses a backlog item from file content, extracting frontmatter and body.
export const parseBacklogFile = (file: string, content: string): BacklogItem | undefined => {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!frontmatterMatch || !frontmatterMatch[1]) return undefined

  const fm = parseFrontmatter(frontmatterMatch[1])
  const id = fm.get('id')
  const title = fm.get('title')
  if (!id || !title) return undefined

  const emptyToUndefined = (v: string | undefined): string | undefined =>
    v === undefined || v === '' ? undefined : v

  return {
    id,
    title,
    type: parseType(fm.get('type')),
    status: parseStatus(fm.get('status')),
    priority: parsePriority(fm.get('priority')),
    effort: parseEffort(fm.get('effort')),
    risk: parseRisk(fm.get('risk')),
    approach: parseApproach(fm.get('approach')),
    area: emptyToUndefined(fm.get('area')),
    sprint: emptyToUndefined(fm.get('sprint')),
    owner: emptyToUndefined(fm.get('owner')),
    created: emptyToUndefined(fm.get('created')),
    closed: emptyToUndefined(fm.get('closed')),
    links: parseLinks(fm.get('links')),
    file,
    body: (frontmatterMatch[2] ?? '').trim(),
  }
}

const statusOrder: Record<BacklogStatus, number> = {
  'in-progress': 0,
  ready: 1,
  idea: 2,
  done: 3,
  dropped: 4,
}

const priorityOrder: Record<BacklogPriority, number> = { p1: 0, p2: 1, p3: 2, '?': 3 }

// Closed items are moved here by `npm run backlog:archive` so that `backlog/`
// itself only holds live work. The archive is not a different format: files
// keep their frontmatter and are loaded as ordinary items, so every consumer
// (regen, dashboard, id checks) sees the whole item set and nothing can
// silently disappear — or have its id handed out twice.
export const archiveDirName = 'archive'

const loadItemsFrom = async (dir: string): Promise<readonly BacklogItem[]> => {
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
  return parsed.filter((item): item is BacklogItem => item !== undefined)
}

export const loadBacklog = async (dir: string): Promise<readonly BacklogItem[]> => {
  const [live, archived] = await Promise.all([
    loadItemsFrom(dir),
    loadItemsFrom(`${dir}/${archiveDirName}`),
  ])
  // Filename breaks ties so ordering depends on the item, not on which of the
  // two directories it happens to sit in — moving a file must not reshuffle
  // any generated view.
  return [...live, ...archived].sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] ||
      priorityOrder[a.priority] - priorityOrder[b.priority] ||
      basename(a.file).localeCompare(basename(b.file)),
  )
}

// Formats a backlog item as frontmatter followed by its body content.
export const renderBacklogItem = (item: BacklogItem): string => {
  const links = `[${item.links.join(', ')}]`
  const lines = [
    `id: ${item.id}`,
    `title: ${item.title}`,
    `type: ${item.type}`,
    `status: ${item.status}`,
    `priority: ${item.priority}`,
    `effort: ${item.effort}`,
    `risk: ${item.risk}`,
    `approach: ${item.approach}`,
    `area: ${item.area ?? ''}`,
    `sprint: ${item.sprint ?? ''}`,
    ...(item.owner !== undefined ? [`owner: ${item.owner}`] : []),
    `created: ${item.created ?? ''}`,
    `closed: ${item.closed ?? ''}`,
    `links: ${links}`,
  ]
  return `---\n${lines.join('\n')}\n---\n${item.body}`
}

// ---------------------------------------------------------------------------
// Generated views: BACKLOG.md (open items) and DONE.md (closed items, an
// event log rather than a cache — it is fully recomputed from frontmatter,
// but only ever grows, since items don't leave the done/dropped set).
// ---------------------------------------------------------------------------

// Checks if a backlog item is still open (not done or dropped).
export const isOpen = (item: BacklogItem): boolean =>
  item.status !== 'done' && item.status !== 'dropped'

// Generates BACKLOG.md table of open items, sorted by status and priority.
export const buildBacklogTable = (items: readonly BacklogItem[]): string => {
  const open = items.filter(isOpen)
  const lines = [
    '# Backlog — open items',
    '',
    '<!-- GENERATED — do not hand-edit. Regenerate: npm run backlog:regen -->',
    '',
    'One line per open item; full detail in the linked file. Process: `.claude/skills/track-backlog/SKILL.md`.',
    'Item frontmatter is the source of truth; this file is a generated view.',
    '',
    '| id | title | type | pri | effort | risk | area | status | sprint |',
    '|----|-------|------|-----|--------|------|------|--------|--------|',
    ...open.map(
      (i) =>
        `| [${i.id}](${basename(i.file)}) | ${i.title} | ${i.type} | ${i.priority} | ${i.effort} | ${i.risk} | ${i.area ?? ''} | ${i.status} | ${i.sprint ?? ''} |`,
    ),
  ]
  return `${lines.join('\n')}\n`
}

// Generates DONE.md log of closed items, newest first.
export const buildDoneLog = (items: readonly BacklogItem[]): string => {
  const closed = items
    .filter((i) => !isOpen(i))
    .sort((a, b) => (b.closed ?? '').localeCompare(a.closed ?? ''))
  const lines = [
    '# Done — closed items',
    '',
    '<!-- GENERATED — do not hand-edit. Regenerate: npm run backlog:regen -->',
    '',
    'Append-only log of closed items, newest first. Regenerated from frontmatter;',
    'items only ever join this list, never leave it, so it behaves as an event log.',
    '',
    ...closed.map(
      (i) => `- ${i.closed ?? '?'} — [${i.id}](${basename(i.file)}) — ${i.title} — ${i.status}`,
    ),
  ]
  return `${lines.join('\n')}\n`
}

export {
  backlogIdNumber,
  formatBacklogId,
  formatMarkerName,
  markerNumber,
  markerNumbers,
  firstFreeNumber,
  usedNumbers,
  validateBacklogIds,
  type BacklogFileInfo,
  type BacklogIdIssue,
  type BacklogIdIssueKind,
} from './ids.ts'
