import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { defaultCloneOptions, repeatedExpressions, type ShapeGroup } from '../src/clones.ts'
import { applyEdits } from '../src/edits.ts'
import { defaultExtractOptions, extractionPlan, type ExtractionPlan } from '../src/extract.ts'
import type { SourceEntry } from '../src/stats.ts'

// A real program over in-memory files, so the plans below are checked with the same type
// information the command line has rather than with types this test made up.
const programOf = (files: Readonly<Record<string, string>>): ts.Program => {
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    noEmit: true,
  }
  const host = ts.createCompilerHost(options)
  const original = host.getSourceFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    const text = files[name]
    return text === undefined
      ? original(name, languageVersion, onError, shouldCreate)
      : ts.createSourceFile(name, text, languageVersion, true)
  }
  host.fileExists = (name) => files[name] !== undefined || ts.sys.fileExists(name)
  host.readFile = (name) => files[name] ?? ts.sys.readFile(name)
  return ts.createProgram(Object.keys(files), options, host)
}

type Fixture = {
  readonly entries: readonly SourceEntry[]
  readonly checker: ts.TypeChecker
  readonly text: (file: string) => string
}

const fixture = (files: Readonly<Record<string, string>>): Fixture => {
  const program = programOf(files)
  const entries = Object.keys(files).map((file) => {
    const sourceFile = program.getSourceFile(file)
    if (sourceFile === undefined) throw new Error(`no source file for ${file}`)
    return { file, sourceFile }
  })
  return {
    entries,
    checker: program.getTypeChecker(),
    text: (file) => files[file] ?? '',
  }
}

const firstGroup = (entries: readonly SourceEntry[], minNodes = 8): ShapeGroup => {
  const groups = repeatedExpressions(entries, { ...defaultCloneOptions, minNodes })
  const group = groups[0]
  if (group === undefined) throw new Error('no repeated shape found')
  return group
}

const planFor = (fixed: Fixture, name: string, minNodes = 8): ExtractionPlan =>
  extractionPlan(firstGroup(fixed.entries, minNodes), fixed.entries, {
    ...defaultExtractOptions,
    name,
    checker: fixed.checker,
  })

const rewritten = (fixed: Fixture, plan: ExtractionPlan, file: string): string => {
  const result = applyEdits(plan.edits, file, fixed.text(file))
  if (!result.ok) throw new Error(`edits did not apply: ${result.reason}`)
  return result.text
}

describe('extractionPlan: a function of the names that differ', () => {
  const fixed = fixture({
    'packages/a/src/rows.ts': [
      'type Row = { readonly active: boolean }',
      '',
      'export const openRows = (rows: readonly Row[]): number =>',
      '  rows.filter((row) => row.active).length',
      '',
      'export const liveItems = (items: readonly Row[], limit: number): number =>',
      '  items.filter((item) => item.active).length + limit',
      '',
    ].join('\n'),
  })

  it('parameterizes the local names and types them from the program', () => {
    const plan = planFor(fixed, 'countActive')
    expect(plan.blockers).toEqual([])
    expect(plan.form).toBe('function')
    expect(plan.parameters).toEqual([
      { name: 'rows', hole: 0, type: 'readonly Row[]', arguments: ['rows', 'items'] },
    ])
    expect(plan.declaration).toBe(
      'const countActive = (rows: readonly Row[]): number => rows.filter((row) => row.active).length',
    )
  })

  it('rewrites both sites to calls and puts the declaration above them', () => {
    const plan = planFor(fixed, 'countActive')
    const text = rewritten(fixed, plan, 'packages/a/src/rows.ts')
    expect(text).toContain('const countActive = (rows: readonly Row[]): number =>')
    expect(text).toContain('export const openRows = (rows: readonly Row[]): number =>\n  countActive(rows)')
    expect(text).toContain(
      'export const liveItems = (items: readonly Row[], limit: number): number =>\n' +
        '  countActive(items) + limit',
    )
    expect(text.indexOf('const countActive')).toBeLessThan(text.indexOf('export const openRows'))
  })
})

describe('extractionPlan: names it can keep reading', () => {
  const fixed = fixture({
    'packages/a/src/guard.ts': [
      'export const isRecord = (v: unknown): boolean =>',
      "  typeof v === 'object' && v !== null && !Array.isArray(v)",
      '',
      'export const describeValue = (value: unknown): string =>',
      "  typeof value === 'object' && value !== null && !Array.isArray(value) ? 'record' : 'other'",
      '',
    ].join('\n'),
  })

  it('keeps a global out of the parameter list and parameterizes the rest', () => {
    const plan = planFor(fixed, 'isPlainRecord')
    expect(plan.kept).toEqual(['Array'])
    expect(plan.parameters.map((parameter) => parameter.name)).toEqual(['v'])
    expect(plan.declaration).toContain('!Array.isArray(v)')
    expect(plan.requirements).toEqual([])
  })
})

describe('extractionPlan: a shared value across files', () => {
  const fixed = fixture({
    'packages/a/src/one.ts': [
      'export type Plan = { readonly ok: boolean; readonly text: string }',
      '',
      'export const failed = (text: string): Plan => ({ ok: false, text })',
      '',
    ].join('\n'),
    'packages/b/src/two.ts': [
      'export type Plan = { readonly ok: boolean; readonly text: string }',
      '',
      'export const refused = (text: string): Plan => ({ ok: false, text })',
      '',
    ].join('\n'),
  })

  it('extracts a function-valued expression as a value, not a function of no arguments', () => {
    const plan = planFor(fixed, 'refusal', 10)
    expect(plan.form).toBe('value')
    expect(plan.parameters).toEqual([])
    expect(plan.declaration).toBe(
      'export const refusal = (text: string): Plan => ({ ok: false, text })',
    )
  })

  it('exports it from the first file and imports it into the second', () => {
    const plan = planFor(fixed, 'refusal', 10)
    expect(plan.destination).toBe('packages/a/src/one.ts')
    expect(rewritten(fixed, plan, 'packages/a/src/one.ts')).toContain(
      'export const failed = refusal',
    )
    const second = rewritten(fixed, plan, 'packages/b/src/two.ts')
    expect(second).toContain("import { refusal } from '../../a/src/one.ts'")
    expect(second).toContain('export const refused = refusal')
  })
})

describe('extractionPlan: a destination of the caller’s choosing', () => {
  const declaration = 'export const failed = (text: string): Plan => ({ ok: false, text })'
  const planType = 'export type Plan = { readonly ok: boolean; readonly text: string }'
  const fixed = fixture({
    'packages/a/src/one.ts': `${planType}\n\n${declaration}\n`,
    'packages/b/src/two.ts': `${planType}\n\nexport const refused = (text: string): Plan => ({ ok: false, text })\n`,
    'packages/c/src/shared.ts': 'export const version = 1\n',
  })

  it('names the types the destination would have to declare or import', () => {
    const plan = extractionPlan(firstGroup(fixed.entries, 10), fixed.entries, {
      ...defaultExtractOptions,
      name: 'refusal',
      destination: 'packages/c/src/shared.ts',
      checker: fixed.checker,
    })
    expect(plan.destination).toBe('packages/c/src/shared.ts')
    expect(plan.requirements.map((note) => note.message)).toContain(
      'the body names the type `Plan`, which packages/c/src/shared.ts does not declare or import',
    )
    expect(rewritten(fixed, plan, 'packages/a/src/one.ts')).toContain(
      "import { refusal } from '../../c/src/shared.ts'",
    )
  })
})

describe('extractionPlan: what stays a function', () => {
  const fixed = fixture({
    'packages/a/src/limits.ts': [
      'const base = 10',
      '',
      'export const first = (): number => Math.max(base * 2, base + 5)',
      '',
      'export const second = (extra: number): number => Math.max(base * 2, base + 5) + extra',
      '',
    ].join('\n'),
  })

  it('wraps an expression that reads only ambient names, so it still runs at each site', () => {
    const plan = planFor(fixed, 'ceiling')
    expect(plan.form).toBe('function')
    expect(plan.parameters).toEqual([])
    expect(plan.kept).toEqual(['Math', 'base'])
    expect(plan.declaration).toBe('const ceiling = (): number => Math.max(base * 2, base + 5)')
    expect(rewritten(fixed, plan, 'packages/a/src/limits.ts')).toContain(
      'export const first = (): number => ceiling()',
    )
  })
})

describe('extractionPlan: refusals', () => {
  it('refuses an expression that reads `this`', () => {
    const fixed = fixture({
      'packages/a/src/this.ts': [
        'const shape = { size: 1, count: 2 }',
        '',
        'export const one = function (): number { return this.size + this.count + 1 }',
        '',
        'export const two = function (): number { return this.size + this.count + 1 }',
        '',
      ].join('\n'),
    })
    const plan = planFor(fixed, 'total')
    expect(plan.blockers.map((note) => note.message)).toContain('reads `this`')
    expect(plan.edits).toEqual([])
  })

  it('refuses an expression that assigns to a name it does not declare', () => {
    const fixed = fixture({
      'packages/a/src/count.ts': [
        'let total = 0',
        '',
        'export const bump = (step: number): number => (total = total + step * 2)',
        '',
        'export const raise = (amount: number): number => (total = total + amount * 2)',
        '',
      ].join('\n'),
    })
    const plan = planFor(fixed, 'add')
    expect(plan.blockers.map((note) => note.message)).toContain(
      'assigns to a name it does not declare',
    )
    expect(plan.edits).toEqual([])
  })

  it('refuses a name one of the receiving files already declares', () => {
    const planType = 'export type Plan = { readonly ok: boolean; readonly text: string }'
    const body = '(text: string): Plan => ({ ok: false, text })'
    const fixed = fixture({
      'packages/a/src/one.ts': `${planType}\n\nexport const failed = ${body}\n`,
      'packages/b/src/two.ts': `${planType}\n\nconst refusal = 1\n\nexport const refused = ${body}\n`,
    })
    const plan = planFor(fixed, 'refusal', 10)
    expect(plan.blockers.map((note) => note.message)).toContain(
      '`refusal` is already declared in packages/b/src/two.ts',
    )
    expect(plan.edits).toEqual([])
  })

  it('refuses an import that would close a cycle', () => {
    const planType = 'export type Plan = { readonly ok: boolean; readonly text: string }'
    const body = '(text: string): Plan => ({ ok: false, text })'
    const fixed = fixture({
      'packages/a/src/one.ts': [
        "import { tag } from './two.ts'",
        '',
        planType,
        '',
        `export const failed = ${body}`,
        '',
        'export const label = tag',
        '',
      ].join('\n'),
      'packages/a/src/two.ts': `export const tag = 'x'\n\n${planType}\n\nexport const refused = ${body}\n`,
    })
    const plan = planFor(fixed, 'refusal', 10)
    expect(plan.blockers.map((note) => note.message)).toContain(
      'packages/a/src/one.ts imports packages/a/src/two.ts, so importing back would close a cycle',
    )
  })

  it('says so when it had no type checker to annotate with', () => {
    const fixed = fixture({
      'packages/a/src/rows.ts': [
        'export const openRows = (rows: readonly { readonly active: boolean }[]): number =>',
        '  rows.filter((row) => row.active).length',
        '',
        'export const liveItems = (items: readonly { readonly active: boolean }[], n: number): number =>',
        '  items.filter((item) => item.active).length + n',
        '',
      ].join('\n'),
    })
    const plan = extractionPlan(firstGroup(fixed.entries), fixed.entries, defaultExtractOptions)
    expect(plan.parameters.map((parameter) => parameter.type)).toEqual([undefined])
    expect(plan.requirements.map((note) => note.message)).toContain(
      'no type checker was given, so the declaration has no type annotations',
    )
  })
})
