// CLI entry: analyze a Claude Code session-transcript corpus.
//
//   npm run transcripts                     # composition (default view)
//   npm run transcripts -- all              # every view
//   npm run transcripts -- sessions|tools|models|skills
//   npm run transcripts -- grep "caveman off|speak plain"
//   npm run transcripts -- --dir <path>     # explicit transcript directory
//   npm run transcripts -- --sidechain      # include subagent sidechain entries
//   npm run transcripts -- --json           # raw table data as JSON
//
// Default directory is this project's transcript store:
//   ~/.claude/projects/<cwd with every non-alphanumeric replaced by '-'>

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import {
  compositionTable,
  dedupeEntries,
  grepTable,
  modelsTable,
  parseEntry,
  renderTable,
  skillsTable,
  sessionsTable,
  toolsTable,
  type ParsedEntry,
  type Table,
} from './analyze.ts'
import { discoverTranscriptFiles } from './index.ts'

const projectSlug = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-')

const defaultDir = (): string => join(homedir(), '.claude', 'projects', projectSlug(process.cwd()))

type CliOptions = {
  readonly command: string
  readonly pattern: string | undefined
  readonly dir: string
  readonly json: boolean
  readonly sidechain: boolean
}

const parseArgs = (argv: readonly string[]): CliOptions => {
  const dirIndex = argv.indexOf('--dir')
  const dirValueIndex = dirIndex === -1 ? -1 : dirIndex + 1
  const positional = argv.filter((a, i) => !a.startsWith('--') && i !== dirValueIndex)
  return {
    command: positional[0] ?? 'composition',
    pattern: positional[1],
    dir: dirIndex !== -1 ? (argv[dirIndex + 1] ?? defaultDir()) : defaultDir(),
    json: argv.includes('--json'),
    sidechain: argv.includes('--sidechain'),
  }
}

const loadCorpus = async (dir: string, sidechain: boolean): Promise<readonly ParsedEntry[]> => {
  const files = await discoverTranscriptFiles([dir])
  const perFile = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(file, 'utf8')
      return content
        .split('\n')
        .map((line) => parseEntry(file, line))
        .filter((e): e is ParsedEntry => e !== undefined)
    }),
  )
  const entries = dedupeEntries(perFile.flat())
  return sidechain ? entries : entries.filter((e) => !e.isSidechain)
}

// Returns the tables to print, or an error message string.
const buildTables = (entries: readonly ParsedEntry[], opts: CliOptions): readonly Table[] | string => {
  switch (opts.command) {
    case 'composition':
      return [compositionTable(entries)]
    case 'sessions':
      return [sessionsTable(entries)]
    case 'tools':
      return [toolsTable(entries)]
    case 'models':
      return [modelsTable(entries)]
    case 'skills':
      return [skillsTable(entries)]
    case 'grep':
      return opts.pattern === undefined
        ? 'grep needs a pattern: transcripts grep "<regex>"'
        : [grepTable(entries, new RegExp(opts.pattern, 'i'))]
    case 'all':
      return [
        compositionTable(entries),
        sessionsTable(entries),
        toolsTable(entries),
        modelsTable(entries),
        skillsTable(entries),
      ]
    default:
      return `unknown command '${opts.command}' (use composition|sessions|tools|models|skills|grep|all)`
  }
}

const main = async (): Promise<void> => {
  const opts = parseArgs(process.argv.slice(2))
  const entries = await loadCorpus(opts.dir, opts.sidechain)
  if (entries.length === 0) {
    console.error(`no transcript entries found in ${opts.dir}`)
    process.exitCode = 1
    return
  }

  const tables = buildTables(entries, opts)
  if (typeof tables === 'string') {
    console.error(tables)
    process.exitCode = 1
    return
  }
  const header = `corpus: ${opts.dir}\nentries: ${entries.length.toLocaleString('en-US')} (deduplicated${opts.sidechain ? ', sidechain included' : ', main chain only'})`
  console.log(
    opts.json
      ? JSON.stringify({ dir: opts.dir, entries: entries.length, tables }, null, 2)
      : [header, '', ...tables.map(renderTable)].join('\n\n'),
  )
}

await main()
