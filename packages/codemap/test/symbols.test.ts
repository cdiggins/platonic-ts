import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { toRepoRelative, extractSymbols, collectReferences } from '../src/symbols.ts'
import { indexRepo, buildProgram } from '../src/io.ts'

const ROOT = 'C:/repo'

const parse = (file: string, source: string): ts.SourceFile =>
  ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)

// A program over in-memory sources, so reference resolution is testable without
// touching the filesystem.
const programOf = (sources: Readonly<Record<string, string>>): ts.Program => {
  const files = new Map(
    Object.entries(sources).map(([name, text]) => [name, parse(name, text)] as const),
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
    readFile: (name) => sources[name],
  }
  return ts.createProgram([...files.keys()], {
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
  }, host)
}

describe('toRepoRelative', () => {
  it('turns a Windows absolute path into a forward-slash repo path', () => {
    expect(toRepoRelative('C:\\repo', 'C:\\repo\\packages\\core\\src\\index.ts')).toBe(
      'packages/core/src/index.ts',
    )
  })

  it('accepts a root with a trailing separator and mixed separators', () => {
    expect(toRepoRelative('C:\\repo\\', 'C:/repo/packages/core/src/index.ts')).toBe(
      'packages/core/src/index.ts',
    )
    expect(toRepoRelative('/home/me/repo', '/home/me/repo/packages/a/src/a.ts')).toBe(
      'packages/a/src/a.ts',
    )
  })

  it('tolerates drive-letter case drift', () => {
    expect(toRepoRelative('c:\\repo', 'C:/repo/packages/a/src/a.ts')).toBe('packages/a/src/a.ts')
  })

  it('leaves a path outside the root alone', () => {
    expect(toRepoRelative('C:/repo', 'C:/other/x.ts')).toBe('C:/other/x.ts')
  })
})

describe('extractSymbols', () => {
  const source = [
    'export const greet = (name: string): string => `hi ${name}`',
    '',
    'const count = 3',
    '',
    'export type Greeting = { readonly text: string }',
    '',
    'const outer = () => {',
    '  const inner = (value: number): number => value + 1',
    '  return inner(count)',
    '}',
    '',
  ].join('\n')
  const sourceFile = parse(`${ROOT}/packages/demo/src/greet.ts`, source)
  const symbols = extractSymbols(ROOT, sourceFile)

  it('finds an exported arrow-function const as a function', () => {
    const greet = symbols.find((symbol) => symbol.name === 'greet')
    expect(greet).toBeDefined()
    expect(greet?.kind).toBe('function')
    expect(greet?.exported).toBe(true)
    expect(greet?.line).toBe(1)
    expect(greet?.file).toBe('packages/demo/src/greet.ts')
    expect(greet?.span).toEqual({ start: source.indexOf('greet'), length: 5 })
    expect(greet?.id).toBe(`packages/demo/src/greet.ts#${source.indexOf('greet')}`)
    expect(greet?.signature).toBe('greet(name: string): string')
    expect(greet?.containerName).toBeUndefined()
  })

  it('separates plain variables from functions and marks unexported ones', () => {
    const count = symbols.find((symbol) => symbol.name === 'count')
    expect(count?.kind).toBe('variable')
    expect(count?.exported).toBe(false)
    expect(count?.signature).toBe('count = 3')
  })

  it('records type aliases and their members', () => {
    const alias = symbols.find((symbol) => symbol.name === 'Greeting')
    expect(alias?.kind).toBe('type')
    expect(alias?.exported).toBe(true)
    expect(alias?.line).toBe(5)
    const member = symbols.find((symbol) => symbol.name === 'text')
    expect(member?.kind).toBe('property')
    expect(member?.containerName).toBe('Greeting')
  })

  it('names the enclosing declaration as the container of a nested symbol', () => {
    const inner = symbols.find((symbol) => symbol.name === 'inner')
    expect(inner?.containerName).toBe('outer')
    expect(inner?.kind).toBe('function')
    expect(inner?.exported).toBe(false)
    expect(inner?.line).toBe(8)
  })

  it('extracts the first doc-comment line, statement comments included', () => {
    const documented = parse(
      `${ROOT}/packages/demo/src/doc.ts`,
      [
        '// File header, separated by a blank line.',
        '',
        '// Doubles the value.',
        '// Second line is not the doc line.',
        'export const twice = (value: number): number => value * 2',
        '',
        '/** Greets by name. */',
        'export function greet(name: string): string { return name }',
        '',
        'export const bare = 1',
        '',
      ].join('\n'),
    )
    const byName = new Map(extractSymbols(ROOT, documented).map((symbol) => [symbol.name, symbol]))
    expect(byName.get('twice')?.docLine).toBe('Doubles the value.')
    expect(byName.get('greet')?.docLine).toBe('Greets by name.')
    expect(byName.get('bare')?.docLine).toBeUndefined()
  })

  it('does not give the file header to the first declaration as its doc', () => {
    const headerOnly = parse(
      `${ROOT}/packages/demo/src/header.ts`,
      '// A file header.\n\nexport const first = 1\n',
    )
    const first = extractSymbols(ROOT, headerOnly).find((symbol) => symbol.name === 'first')
    expect(first?.docLine).toBeUndefined()
  })

  it('returns symbols in source order', () => {
    const starts = symbols.map((symbol) => symbol.span.start)
    expect([...starts].sort((a, b) => a - b)).toEqual(starts)
  })

  it('reads `export` without parent pointers, the way program files arrive', () => {
    // ts.createProgram does not set parent pointers until the checker binds the
    // file, so export detection must not walk upwards.
    const unbound = ts.createSourceFile(
      `${ROOT}/packages/demo/src/unbound.ts`,
      'export const shown = 1\nconst hidden = 2\nexport const loop = (xs: readonly number[]) => { for (const item of xs) { void item } }\n',
      ts.ScriptTarget.Latest,
    )
    const byName = new Map(extractSymbols(ROOT, unbound).map((symbol) => [symbol.name, symbol]))
    expect(byName.get('shown')?.exported).toBe(true)
    expect(byName.get('hidden')?.exported).toBe(false)
    expect(byName.get('loop')?.exported).toBe(true)
    expect(byName.get('item')?.exported).toBe(false)
  })

  it('covers interfaces, classes, enums and methods', () => {
    const other = parse(
      `${ROOT}/packages/demo/src/shapes.ts`,
      [
        'export interface Shape { area(): number }',
        'export class Box { size = 1 }',
        'export enum Color { Red }',
        'export function measure(box: Box): number { return box.size }',
        '',
      ].join('\n'),
    )
    const kinds = new Map(extractSymbols(ROOT, other).map((symbol) => [symbol.name, symbol.kind]))
    expect(kinds.get('Shape')).toBe('interface')
    expect(kinds.get('Box')).toBe('class')
    expect(kinds.get('Color')).toBe('enum')
    expect(kinds.get('area')).toBe('method')
    expect(kinds.get('measure')).toBe('function')
    expect(kinds.get('size')).toBe('property')
  })
})

describe('collectReferences', () => {
  it('links a use site in another file back to the declaration', () => {
    const declarationFile = `${ROOT}/packages/demo/src/greet.ts`
    const useFile = `${ROOT}/packages/demo/src/use.ts`
    const declarationSource = 'export const greet = (name: string): string => name\n'
    const useSource = "import { greet } from './greet.ts'\n\nexport const shout = () => greet('x')\n"
    const program = programOf({ [declarationFile]: declarationSource, [useFile]: useSource })
    const symbols = [declarationFile, useFile].flatMap((name) => {
      const sourceFile = program.getSourceFile(name)
      return sourceFile === undefined ? [] : extractSymbols(ROOT, sourceFile)
    })

    const references = collectReferences(ROOT, program, symbols)
    const greetId = `packages/demo/src/greet.ts#${declarationSource.indexOf('greet')}`
    const toGreet = references.filter((reference) => reference.symbolId === greetId)

    expect(toGreet.some((reference) => reference.isDefinition)).toBe(true)
    expect(
      toGreet.some(
        (reference) => reference.file === 'packages/demo/src/use.ts' && !reference.isDefinition,
      ),
    ).toBe(true)
    // Import specifier + call site, both in use.ts.
    expect(toGreet.filter((reference) => reference.file === 'packages/demo/src/use.ts').length).toBe(2)
  })

  it('ignores identifiers that resolve outside the indexed symbol set', () => {
    const file = `${ROOT}/packages/demo/src/only.ts`
    const program = programOf({ [file]: 'export const value = String(1)\n' })
    const sourceFile = program.getSourceFile(file)
    const symbols = sourceFile === undefined ? [] : extractSymbols(ROOT, sourceFile)

    const references = collectReferences(ROOT, program, symbols)

    expect(references.every((reference) => reference.symbolId.startsWith('packages/'))).toBe(true)
    expect(references.some((reference) => reference.file.includes('lib.'))).toBe(false)
  })
})

describe('indexRepo', () => {
  it('indexes this repository', async () => {
    const started = Date.now()
    const index = await indexRepo(process.cwd(), 1234)
    const elapsedMs = Date.now() - started

    expect(index.generatedAt).toBe(1234)
    expect(index.files.length).toBeGreaterThan(0)
    expect(index.files.map((entry) => entry.file)).toContain('packages/core/src/index.ts')
    expect(index.files.some((entry) => entry.kind === 'markdown')).toBe(true)
    expect(index.files.some((entry) => entry.file === 'README.md')).toBe(true)
    expect(index.symbols.some((symbol) => symbol.name === 'splitJsonlChunk')).toBe(true)
    expect(index.references.length).toBeGreaterThan(0)
    const paths = index.files.map((entry) => entry.file)
    expect([...paths].sort()).toEqual(paths)
    expect(elapsedMs).toBeLessThan(60_000)
  }, 120_000)
})

describe('buildProgram', () => {
  it('creates a program over the repo source files', () => {
    const program = buildProgram(process.cwd())
    const files = program
      .getSourceFiles()
      .filter((sourceFile) => !sourceFile.isDeclarationFile)
      .map((sourceFile) => toRepoRelative(process.cwd(), sourceFile.fileName))
    expect(files).toContain('packages/core/src/index.ts')
  }, 60_000)
})
