// IO edge for the code index: creates the program and walks the repo.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'
import type { CodeIndex, FileEntry } from '../../core/src/index.ts'
import { collectSourceFiles } from '../../check/src/scan.ts'
import { fileMetrics, folderMetrics, functionMetrics } from './metrics.ts'
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

// A program over the repo's tsconfig.json include set.
export const buildProgram = (repoDir: string): ts.Program => {
  const parsed = parseRepoConfig(repoDir)
  const fileNames =
    parsed !== undefined && parsed.fileNames.length > 0
      ? parsed.fileNames
      : fallbackFileNames(repoDir)
  const options = parsed === undefined ? fallbackCompilerOptions : parsed.options
  return ts.createProgram([...fileNames], { ...options, noEmit: true })
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

const collectMarkdownFiles = async (repoDir: string): Promise<readonly string[]> => {
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

const byFile = (left: FileEntry, right: FileEntry): number =>
  left.file < right.file ? -1 : left.file > right.file ? 1 : 0

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

// The whole index: files, folders, symbols, references, metrics.
export const indexRepo = async (repoDir: string, now: number): Promise<CodeIndex> => {
  const program = buildProgram(repoDir)
  bindSourceFiles(program)
  const programFiles = sourceFileIndex(repoDir, program)
  const typeScriptPaths = await collectSourceFiles(repoDir)
  const loaded = await Promise.all(
    typeScriptPaths.map((path) => readSourceFile(repoDir, programFiles, path)),
  )
  const typeScriptEntries: readonly FileEntry[] = loaded.map(({ sourceFile, text }) => ({
    file: toRepoRelative(repoDir, sourceFile.fileName),
    kind: 'typescript',
    sizeBytes: Buffer.byteLength(text, 'utf8'),
    metrics: fileMetrics(sourceFile, text),
    functions: functionMetrics(repoDir, sourceFile),
  }))
  const markdownPaths = await collectMarkdownFiles(repoDir)
  const markdownEntries = await Promise.all(
    markdownPaths.map((path) => markdownEntry(repoDir, path)),
  )
  const files = [...typeScriptEntries, ...markdownEntries].sort(byFile)
  const symbols = loaded.flatMap(({ sourceFile }) => extractSymbols(repoDir, sourceFile))
  return {
    generatedAt: now,
    root: repoDir,
    files,
    folders: folderMetrics(files),
    symbols,
    references: collectReferences(repoDir, program, symbols),
  }
}
