// The bound half of the workspace: a TypeScript program and language service
// over the same texts the index was built from. Tools that need inferred types,
// diagnostics, or the compiler's own edit computations take this; tools that
// only need shapes keep taking a Workspace, which costs no binding.
import ts from 'typescript'
import type { FileEdit } from './edit.ts'
import type { Workspace } from './workspace.ts'

export type Compiler = {
  readonly workspace: Workspace
  readonly language: ts.LanguageService
  readonly program: ts.Program
  readonly checker: ts.TypeChecker
  readonly root: string
  // Repo-relative path to the absolute path the program keys files by, and back.
  readonly pathOf: (file: string) => string
  readonly fileOf: (path: string) => string
  // The program's copy of a file: it has parent pointers and resolved symbols,
  // which the workspace's own parse does not.
  readonly boundSourceFile: (file: string) => ts.SourceFile | undefined
}

export const compilerOptions: ts.CompilerOptions = {
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  strict: true,
  skipLibCheck: true,
}

// What the compiler's own edit computations format their output with. Matching
// the repository's style here is what keeps a code fix from arriving with
// semicolons and double quotes.
export const formatSettings: ts.FormatCodeSettings = {
  indentSize: 2,
  tabSize: 2,
  convertTabsToSpaces: true,
  newLineCharacter: '\n',
  semicolons: ts.SemicolonPreference.Remove,
  insertSpaceAfterCommaDelimiter: true,
  insertSpaceAfterKeywordsInControlFlowStatements: true,
  insertSpaceBeforeAndAfterBinaryOperators: true,
  insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: true,
}

export const userPreferences: ts.UserPreferences = {
  quotePreference: 'single',
  importModuleSpecifierEnding: 'js',
  importModuleSpecifierPreference: 'relative',
  includeCompletionsForModuleExports: false,
  organizeImportsIgnoreCase: false,
}

const normalize = (path: string): string => path.replace(/\\/g, '/')

export const createCompiler = (
  root: string,
  texts: ReadonlyMap<string, string>,
  workspace: Workspace,
): Compiler => {
  const base = normalize(root).replace(/\/$/, '')
  const pathOf = (file: string): string => `${base}/${normalize(file)}`
  const fileOf = (path: string): string =>
    normalize(path).startsWith(`${base}/`) ? normalize(path).slice(base.length + 1) : normalize(path)
  const fileNames = [...texts.keys()].map(pathOf)
  // Module resolution walks directories before it looks at files, so a host
  // that only knows about files answers "no such directory" and resolves
  // nothing. The directories are derived from the paths themselves.
  const directories = new Set(
    fileNames.flatMap((path) =>
      path
        .split('/')
        .slice(0, -1)
        .map((_, depth, parts) => parts.slice(0, depth + 1).join('/')),
    ),
  )
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => fileNames,
    getScriptVersion: () => '1',
    getScriptSnapshot: (path) => {
      const own = texts.get(fileOf(path))
      const text = own ?? ts.sys.readFile(path)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => base,
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (path) => texts.has(fileOf(path)) || ts.sys.fileExists(path),
    readFile: (path) => texts.get(fileOf(path)) ?? ts.sys.readFile(path),
    readDirectory: (...args) => ts.sys.readDirectory(...args),
    directoryExists: (path) =>
      directories.has(normalize(path).replace(/\/$/, '')) || ts.sys.directoryExists(path),
    getDirectories: (path) => ts.sys.getDirectories(path),
    useCaseSensitiveFileNames: () => false,
    getNewLine: () => '\n',
  }
  const language = ts.createLanguageService(host, ts.createDocumentRegistry())
  const program = language.getProgram() ?? ts.createProgram(fileNames, compilerOptions)
  return {
    workspace,
    language,
    program,
    checker: program.getTypeChecker(),
    root: base,
    pathOf,
    fileOf,
    boundSourceFile: (file) => program.getSourceFile(pathOf(file)),
  }
}

// The compiler reports its edits as spans against files it names absolutely;
// every write tool here speaks repo-relative offsets. Files the compiler wants
// to create are dropped, because a plan can only rewrite files that exist.
export const toFileEdits = (
  compiler: Compiler,
  changes: readonly ts.FileTextChanges[],
): readonly FileEdit[] =>
  changes
    .filter((change) => change.isNewFile !== true)
    .flatMap((change) =>
      change.textChanges.map((textChange) => ({
        file: compiler.fileOf(change.fileName),
        start: textChange.span.start,
        end: textChange.span.start + textChange.span.length,
        text: textChange.newText,
      })),
    )

export const newFilesIn = (changes: readonly ts.FileTextChanges[]): readonly string[] =>
  changes.filter((change) => change.isNewFile === true).map((change) => change.fileName)

export const describeDiagnostic = (compiler: Compiler, diagnostic: ts.Diagnostic): string => {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')
  const sourceFile = diagnostic.file
  if (sourceFile === undefined || diagnostic.start === undefined)
    return `TS${diagnostic.code}: ${message}`
  const { line } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start)
  return `${compiler.fileOf(sourceFile.fileName)}:${line + 1} TS${diagnostic.code}: ${message}`
}
