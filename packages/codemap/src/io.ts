// IO edge for the code index: creates the program and walks the repo.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import type { CodeIndex, FileEntry } from '../../core/src/index.ts'
import { collectSourceFiles } from '../../check/src/scan.ts'
import { mergeIndex, mergeSymbols, referenceRewalkSet } from './incremental.ts'
import { fileMetrics, functionMetrics } from './metrics.ts'
import { collectReferences, extractSymbols, toRepoRelative } from './symbols.ts'

// Used only when the repo's tsconfig.json is missing or unreadable; mirrors the
// settings the repo compiles with so the checker still resolves relative
// `.ts` imports.
const fallbackCompilerOptions: ts.CompilerOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
  noEmit: true,
}

const sourceGlobs: readonly string[] = ['packages/*/src/**/*.ts', 'packages/*/test/**/*.ts']

const markdownDirectories: readonly string[] = ['docs', 'decisions', 'backlog']

const parseRepoConfig = (repoDir: string): ts.ParsedCommandLine | undefined => {
  const read = ts.readConfigFile(join(repoDir, 'tsconfig.json'), (path) => ts.sys.readFile(path))
  return read.error !== undefined || read.config === undefined
    ? undefined
    : ts.parseJsonConfigFileContent(read.config, ts.sys, repoDir)
}

const fallbackFileNames = (repoDir: string): readonly string[] =>
  ts.sys.readDirectory(repoDir, ['.ts'], ['node_modules'], [...sourceGlobs])

const programInputs = (
  repoDir: string,
): { readonly fileNames: readonly string[]; readonly options: ts.CompilerOptions } => {
  const parsed = parseRepoConfig(repoDir)
  const fileNames =
    parsed !== undefined && parsed.fileNames.length > 0
      ? parsed.fileNames
      : fallbackFileNames(repoDir)
  const options = parsed === undefined ? fallbackCompilerOptions : parsed.options
  return { fileNames, options: { ...options, noEmit: true } }
}

// A program over the repo's tsconfig.json include set.
export const buildProgram = (repoDir: string): ts.Program => {
  const { fileNames, options } = programInputs(repoDir)
  return ts.createProgram([...fileNames], options)
}

const walkMarkdownFiles = async (dir: string): Promise<readonly string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const found = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === 'node_modules') return []
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return walkMarkdownFiles(full)
      return entry.isFile() && entry.name.endsWith('.md') ? [full] : []
    }),
  )
  return found.flat()
}

export const collectMarkdownFiles = async (repoDir: string): Promise<readonly string[]> => {
  const rootEntries = await readdir(repoDir, { withFileTypes: true }).catch(() => [])
  const rootFiles = rootEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(repoDir, entry.name))
  const nested = await Promise.all(
    markdownDirectories.map((dir) => walkMarkdownFiles(join(repoDir, dir))),
  )
  return [...rootFiles, ...nested.flat()]
}

// Program file names are normalized differently from `path.join` output, so the
// index is keyed by repo-relative path, case-folded for Windows.
const sourceFileIndex = (repoDir: string, program: ts.Program): ReadonlyMap<string, ts.SourceFile> =>
  new Map(
    program
      .getSourceFiles()
      .map((sourceFile) => [
        toRepoRelative(repoDir, sourceFile.fileName).toLowerCase(),
        sourceFile,
      ]),
  )

const toForwardSlashPath = (path: string): string => path.split('\\').join('/')

const readSourceFile = async (
  repoDir: string,
  program: ReadonlyMap<string, ts.SourceFile>,
  path: string,
): Promise<{ readonly sourceFile: ts.SourceFile; readonly text: string }> => {
  const file = toRepoRelative(repoDir, path)
  const text = await readFile(path, 'utf8').catch(() => '')
  const fromProgram = program.get(file.toLowerCase())
  return {
    sourceFile:
      fromProgram ?? ts.createSourceFile(toForwardSlashPath(path), text, ts.ScriptTarget.Latest, true),
    text,
  }
}

// Every file the index covers, keyed the way the index keys them.
const indexedPaths = async (repoDir: string): Promise<readonly string[]> =>
  [...(await collectSourceFiles(repoDir)), ...(await collectMarkdownFiles(repoDir))].map((path) =>
    toRepoRelative(repoDir, path),
  )

const markdownEntry = async (repoDir: string, path: string): Promise<FileEntry> => {
  const text = await readFile(path, 'utf8').catch(() => '')
  return {
    file: toRepoRelative(repoDir, path),
    kind: 'markdown',
    sizeBytes: Buffer.byteLength(text, 'utf8'),
    metrics: undefined,
    functions: [],
  }
}

// A program's source files carry no parent pointers until something binds them,
// and creating the checker is what binds them all. Doing it up front keeps every
// later walk independent of the order the phases happen to run in.
const bindSourceFiles = (program: ts.Program): void => {
  program.getTypeChecker()
}

// The whole index: files, folders, symbols, references. A one-shot build for
// callers that will not ask again; a long-running one wants openSession.
export const indexRepo = async (repoDir: string, now: number): Promise<CodeIndex> =>
  (await openSession(repoDir, now)).index

type ProgramCache = {
  readonly host: ts.CompilerHost
  readonly evict: (changed: ReadonlySet<string>) => void
}

// Handing the compiler the source files it parsed last time, together with the
// old program, is what makes a rebuild cheap: it reuses the program structure
// instead of re-reading and re-parsing the repository. Measured on this repo,
// a rebuild after one edit costs 9ms against 740ms for a fresh program.
const programCache = (repoDir: string, options: ts.CompilerOptions): ProgramCache => {
  const parsed = new Map<string, ts.SourceFile>()
  const base = ts.createCompilerHost(options, true)
  return {
    host: {
      ...base,
      getSourceFile: (name, languageVersion, onError, shouldCreate) => {
        const reused = parsed.get(name)
        if (reused !== undefined) return reused
        const fresh = base.getSourceFile(name, languageVersion, onError, shouldCreate)
        if (fresh !== undefined) parsed.set(name, fresh)
        return fresh
      },
    },
    evict: (changed) =>
      [...parsed.keys()]
        .filter((name) => changed.has(toRepoRelative(repoDir, name)))
        .forEach((name) => parsed.delete(name)),
  }
}

// A repository held open for repeated indexing: the index itself plus the
// compiler state that lets the next rebuild reuse everything that did not
// change. Sessions are values — updateSession returns a new one.
export type IndexSession = {
  readonly repoDir: string
  readonly index: CodeIndex
  readonly program: ts.Program
  readonly cache: ProgramCache
}

const typeScriptEntry = (repoDir: string, sourceFile: ts.SourceFile, text: string): FileEntry => ({
  file: toRepoRelative(repoDir, sourceFile.fileName),
  kind: 'typescript',
  sizeBytes: Buffer.byteLength(text, 'utf8'),
  metrics: fileMetrics(sourceFile, text),
  functions: functionMetrics(repoDir, sourceFile),
})

// Opens a repository for indexing and builds the first index. A full build is
// an update that treats every file as changed, so both paths run one code path.
export const openSession = async (repoDir: string, now: number): Promise<IndexSession> => {
  const { fileNames, options } = programInputs(repoDir)
  const cache = programCache(repoDir, options)
  const program = ts.createProgram([...fileNames], options, cache.host)
  bindSourceFiles(program)
  const empty: CodeIndex = {
    generatedAt: now,
    root: repoDir,
    files: [],
    folders: [],
    symbols: [],
    references: [],
  }
  const changed = new Set(await indexedPaths(repoDir))
  return { repoDir, index: await updateIndex(repoDir, program, empty, changed, now), program, cache }
}

const updateIndex = async (
  repoDir: string,
  program: ts.Program,
  previous: CodeIndex,
  changed: ReadonlySet<string>,
  now: number,
): Promise<CodeIndex> => {
  const programFiles = sourceFileIndex(repoDir, program)
  const typeScriptPaths = (await collectSourceFiles(repoDir)).filter((path) =>
    changed.has(toRepoRelative(repoDir, path)),
  )
  const loaded = await Promise.all(
    typeScriptPaths.map((path) => readSourceFile(repoDir, programFiles, path)),
  )
  const markdownPaths = (await collectMarkdownFiles(repoDir)).filter((path) =>
    changed.has(toRepoRelative(repoDir, path)),
  )
  const entries = [
    ...loaded.map(({ sourceFile, text }) => typeScriptEntry(repoDir, sourceFile, text)),
    ...(await Promise.all(markdownPaths.map((path) => markdownEntry(repoDir, path)))),
  ]
  const symbols = mergeSymbols(
    previous.symbols,
    changed,
    loaded.flatMap(({ sourceFile }) => extractSymbols(repoDir, sourceFile)),
  )
  const rewalked = referenceRewalkSet(previous, changed)
  return mergeIndex(previous, {
    now,
    changed,
    rewalked,
    entries,
    symbols,
    references: collectReferences(repoDir, program, symbols, rewalked),
  })
}

// Re-reads only `changed` (repo-relative paths, deletions included) and returns
// a session whose index is what a full rebuild would have produced.
export const updateSession = async (
  session: IndexSession,
  changed: readonly string[],
  now: number,
): Promise<IndexSession> => {
  if (changed.length === 0) return session
  const changedSet = new Set(changed)
  session.cache.evict(changedSet)
  const { fileNames, options } = programInputs(session.repoDir)
  const program = ts.createProgram([...fileNames], options, session.cache.host, session.program)
  bindSourceFiles(program)
  const index = await updateIndex(session.repoDir, program, session.index, changedSet, now)
  return { ...session, index, program }
}

