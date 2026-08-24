// Pure half of the src-folder INDEX.md generator (BL-0032): harvests each source file's
// PS-057 purpose comment and each subfolder's INDEX.md opening statement into one table.

// One row of a folder index: a source file or a source-bearing subfolder, and the purpose
// text harvested for it. `description` is empty when nothing could be harvested, which is a
// regeneration error rather than something the generator writes out.
export type IndexEntry = {
  readonly name: string
  readonly kind: 'file' | 'folder'
  readonly description: string
}

// One folder that must carry an INDEX.md: its repository-relative path, the entries it holds,
// and its INDEX.md content when the file exists.
export type FolderIndex = {
  readonly folder: string
  readonly entries: readonly IndexEntry[]
  readonly indexContent: string | undefined
}

// Reasons a folder index cannot be regenerated, reported instead of being papered over.
export type IndexIssueKind = 'missing-index' | 'missing-block' | 'missing-description'

// One regeneration failure, scoped to the folder it was found in.
export type IndexIssue = {
  readonly folder: string
  readonly kind: IndexIssueKind
  readonly detail: string
}

const commentText = (line: string): string | undefined => {
  const trimmed = line.trim()
  return trimmed.startsWith('//') ? trimmed.slice(2).trim() : undefined
}

const takeWhile = <T>(items: readonly T[], keep: (item: T) => boolean): readonly T[] => {
  const stop = items.findIndex((item) => !keep(item))
  return stop === -1 ? items : items.slice(0, stop)
}

const joined = (lines: readonly string[]): string | undefined => {
  const text = lines.join(' ').trim()
  return text === '' ? undefined : text
}

// The purpose text harvested from a source file: the first paragraph of its leading `//`
// comment block, joined into one line. A file whose comment opens with a summary paragraph
// and continues after a blank `//` line contributes only that summary. Returns undefined when
// the file does not open with a comment at all — the PS-057 violation regeneration reports.
export const leadingPurpose = (source: string): string | undefined =>
  joined(
    takeWhile(source.split(/\r?\n/), (line) => {
      const text = commentText(line)
      return text !== undefined && text !== ''
    }).map((line) => commentText(line) ?? ''),
  )

// The purpose text harvested from a subfolder's INDEX.md: its opening hand-written paragraph,
// the prose between the `#` heading and the generated table. Returns undefined when the file
// has no such paragraph, so a subfolder can no more go undescribed than a file can.
export const openingStatement = (indexMd: string): string | undefined => {
  const lines = indexMd.split(/\r?\n/)
  const heading = lines.findIndex((line) => line.startsWith('#'))
  if (heading === -1) return undefined
  const body = lines.slice(heading + 1).map((line) => line.trim())
  const first = body.findIndex((line) => line !== '')
  if (first === -1) return undefined
  const isBoundary = (line: string): boolean =>
    line === '' || line.startsWith('<!--') || line.startsWith('|') || line.startsWith('#')
  return joined(takeWhile(body.slice(first), (line) => !isBoundary(line)))
}

// The marker-block name every folder INDEX.md uses. One name for all of them, rather than one
// encoding each folder's path, so renaming or moving a folder does not invalidate its block.
export const srcIndexBlock = 'src-index'

const escapeCell = (text: string): string => text.replace(/\|/g, '\\|')

const rowName = (entry: IndexEntry): string =>
  entry.kind === 'folder' ? `\`${entry.name}/\`` : `\`${entry.name}\``

// The generated table for one folder, sorted by name so the output does not depend on the
// order the filesystem happened to hand back.
export const renderIndexTable = (entries: readonly IndexEntry[]): string =>
  [
    '| File | Purpose |',
    '|---|---|',
    ...[...entries]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => `| ${rowName(entry)} | ${escapeCell(entry.description)} |`),
  ].join('\n')

// The one generated block a folder's INDEX.md carries, keyed by marker name.
export const buildIndexBlocks = (folder: FolderIndex): ReadonlyMap<string, string> =>
  new Map([[srcIndexBlock, renderIndexTable(folder.entries)]])

// Everything that stops a folder index from being regenerated honestly: no INDEX.md, an
// INDEX.md that never opens the generated block, or an entry with nothing to describe it.
export const indexIssues = (folders: readonly FolderIndex[]): readonly IndexIssue[] =>
  folders.flatMap((folder): readonly IndexIssue[] => {
    if (folder.indexContent === undefined) {
      return [
        {
          folder: folder.folder,
          kind: 'missing-index',
          detail: `${folder.folder}/INDEX.md does not exist`,
        },
      ]
    }
    const blockless = folder.indexContent.includes(`BEGIN GENERATED: ${srcIndexBlock} `)
      ? []
      : [
          {
            folder: folder.folder,
            kind: 'missing-block' as const,
            detail: `${folder.folder}/INDEX.md has no "${srcIndexBlock}" generated block`,
          },
        ]
    const undescribed = folder.entries
      .filter((entry) => entry.description === '')
      .map((entry): IndexIssue => {
        const what =
          entry.kind === 'file'
            ? 'has no leading // purpose comment (PS-057)'
            : 'INDEX.md has no opening purpose statement'
        return {
          folder: folder.folder,
          kind: 'missing-description',
          detail: `${folder.folder}/${entry.name} ${what}`,
        }
      })
    return [...blockless, ...undescribed]
  })
