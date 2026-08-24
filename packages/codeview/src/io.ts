// IO edge: turns browser feedback into a backlog item file.
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BacklogItem, FeedbackInput, FeedbackResult } from '../../core/src/index.ts'
import { renderBacklogItem } from '../../backlog/src/index.ts'

const idPattern = /^BL-(\d{4})/

// Ids are allocated from the filenames rather than the frontmatter: one readdir, no parsing,
// and a file whose frontmatter is broken still reserves its number.
const nextItemId = (filenames: readonly string[]): string => {
  const highest = filenames.reduce((max, name) => {
    const digits = idPattern.exec(name)?.[1]
    const value = digits === undefined ? 0 : Number.parseInt(digits, 10)
    return value > max ? value : max
  }, 0)
  return `BL-${String(highest + 1).padStart(4, '0')}`
}

const slugFromText = (text: string): string => {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length > 0)
    .slice(0, 6)
  return words.length === 0 ? 'feedback' : words.join('-')
}

const maxTitleLength = 72

const titleFromText = (text: string): string => {
  const firstLine = text.trim().split('\n')[0] ?? ''
  const collapsed = firstLine.replace(/\s+/g, ' ').trim()
  if (collapsed.length === 0) return 'Feedback from the code browser'
  return collapsed.length <= maxTitleLength
    ? collapsed
    : `${collapsed.slice(0, maxTitleLength - 1)}…`
}

const bodyFromInput = (input: FeedbackInput): string =>
  [
    '## Feedback',
    input.text.trim(),
    '',
    '## Context',
    `- file: ${input.file ?? '(none)'}`,
    `- symbol: ${input.symbol ?? '(none)'}`,
    '',
    'Filed from the code browser feedback box (`packages/codeview`), untriaged.',
    '',
  ].join('\n')

// Writes a feedback item to backlogDir with a generated ID and slug-based filename.
export const appendFeedbackItem = async (
  backlogDir: string,
  input: FeedbackInput,
  now: number,
): Promise<FeedbackResult> => {
  const existing = await readdir(backlogDir).catch((): readonly string[] => [])
  const id = nextItemId(existing)
  const file = join(backlogDir, `${id}-${slugFromText(input.text)}.md`)
  const item: BacklogItem = {
    id,
    title: titleFromText(input.text),
    type: 'idea',
    status: 'idea',
    priority: '?',
    effort: '?',
    risk: '?',
    approach: 'undecided',
    area: 'repo',
    sprint: undefined,
    owner: undefined,
    created: new Date(now).toISOString().slice(0, 10),
    closed: undefined,
    links: [],
    file,
    body: bodyFromInput(input),
  }
  await writeFile(file, renderBacklogItem(item), 'utf8')
  return { id, file }
}
