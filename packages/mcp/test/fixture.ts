// An in-memory workspace: the same shape the server builds from disk, without
// touching one. Symbols and references come from the real extractor, so the
// tests exercise the resolution the tools actually depend on.
import ts from 'typescript'
import type { CodeIndex } from '../../core/src/index.ts'
import { collectReferences, extractSymbols } from '../../codemap/src/symbols.ts'
import type { Workspace } from '../src/workspace.ts'
import { createCompiler, type Compiler } from '../src/compiler.ts'

const ROOT = 'C:/repo'

const compilerOptions: ts.CompilerOptions = {
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
}

export const workspaceOf = (sources: Readonly<Record<string, string>>): Workspace => {
  // Keyed by absolute path so that relative imports resolve; the workspace is
  // keyed by repo-relative path, the way the index is.
  const files = new Map(
    Object.entries(sources).map(([name, text]) => {
      const path = `${ROOT}/${name}`
      return [path, ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)] as const
    }),
  )
  const host: ts.CompilerHost = {
    getSourceFile: (name) => files.get(name),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => undefined,
    getCurrentDirectory: () => ROOT,
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => files.has(name),
    readFile: (name) => sources[name.slice(ROOT.length + 1)],
  }
  const program = ts.createProgram([...files.keys()], compilerOptions, host)
  program.getTypeChecker()
  const symbols = program
    .getSourceFiles()
    .filter((sourceFile) => files.has(sourceFile.fileName))
    .flatMap((sourceFile) => extractSymbols(ROOT, sourceFile))
  const index: CodeIndex = {
    generatedAt: 0,
    root: ROOT,
    files: [],
    folders: [],
    symbols,
    references: collectReferences(ROOT, program, symbols),
  }
  return {
    index,
    sources: new Map(
      [...files.entries()].map(([path, sourceFile]) => [path.slice(ROOT.length + 1), sourceFile]),
    ),
  }
}

// The same sources, bound: a program with a checker and a language service over
// them. Tools that ask the compiler questions take this; the rest take the
// workspace above.
export const compilerOf = (sources: Readonly<Record<string, string>>): Compiler =>
  createCompiler(ROOT, new Map(Object.entries(sources)), workspaceOf(sources))
