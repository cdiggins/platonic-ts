// Pure parsing and validation for src-folder INDEX.md files (BL-0032): every
// `packages/*/src` folder, and any subfolder of one that holds source files, must carry an
// INDEX.md listing each file/subfolder with a non-empty description. IO (walking the
// filesystem to find folders and read INDEX.md content) lives in indexScan.ts.

// Kinds of INDEX.md completeness failure this check can find.
export type IndexIssueKind = 'missing-index' | 'missing-entry' | 'ghost-entry' | 'empty-description'

// One INDEX.md completeness problem, scoped to the folder it was found in.
export type IndexIssue = {
  readonly folder: string
  readonly kind: IndexIssueKind
  readonly detail: string
}

// One row of an INDEX.md file table: the name in the first cell, the description in the
// second. Backticks around a filename are stripped so `` `index.ts` `` matches `index.ts`.
export type IndexRow = {
  readonly name: string
  readonly description: string
}

const isSeparatorRow = (cells: readonly string[]): boolean =>
  cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell))

const rowCells = (line: string): readonly string[] => {
  const parts = line.split('|').map((cell) => cell.trim())
  return parts.slice(1, -1)
}

// Parses the first markdown table found in an INDEX.md body into name/description rows.
// Rows before the header separator (the header row itself) are not data and are skipped.
export const parseIndexTable = (content: string): readonly IndexRow[] => {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().startsWith('|'))
  const separatorIndex = lines.findIndex((line) => isSeparatorRow(rowCells(line)))
  if (separatorIndex === -1) return []

  return lines.slice(separatorIndex + 1).map((line) => {
    const cells = rowCells(line)
    const name = (cells[0] ?? '').replace(/`/g, '').trim()
    const description = (cells[1] ?? '').trim()
    return { name, description }
  })
}

// What one folder's INDEX.md must be checked against: the file and source-bearing-subfolder
// names that should each appear as a table row, and the INDEX.md content if it exists.
export type FolderCheck = {
  readonly folder: string
  readonly expectedNames: readonly string[]
  readonly indexContent: string | undefined
}

// Validates one folder's INDEX.md against the names it is expected to list: the index must
// exist, every expected name must be listed, no listed name may be a ghost (absent from
// disk), and no listed row may carry an empty description.
export const checkIndexFolder = (check: FolderCheck): readonly IndexIssue[] => {
  const { folder, expectedNames, indexContent } = check
  if (indexContent === undefined) {
    return [{ folder, kind: 'missing-index', detail: `${folder}/INDEX.md is missing` }]
  }

  const rows = parseIndexTable(indexContent)
  const listedNames = new Set(rows.map((row) => row.name))
  const expectedSet = new Set(expectedNames)

  const missing = expectedNames
    .filter((name) => !listedNames.has(name))
    .map((name): IndexIssue => ({ folder, kind: 'missing-entry', detail: `${name} is not listed in INDEX.md` }))

  const ghosts = rows
    .filter((row) => !expectedSet.has(row.name))
    .map((row): IndexIssue => ({ folder, kind: 'ghost-entry', detail: `${row.name} is listed but does not exist` }))

  const empty = rows
    .filter((row) => expectedSet.has(row.name) && row.description.length === 0)
    .map((row): IndexIssue => ({ folder, kind: 'empty-description', detail: `${row.name} has an empty description` }))

  return [...missing, ...ghosts, ...empty]
}

// Validates every folder's INDEX.md and flattens the results in folder order.
export const checkIndexFolders = (checks: readonly FolderCheck[]): readonly IndexIssue[] =>
  checks.flatMap(checkIndexFolder)
