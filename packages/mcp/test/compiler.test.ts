import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { formatSettings, toFileEdits, userPreferences } from '../src/compiler.ts'
import { compilerOf } from './fixture.ts'

const sources = {
  'a.ts': ['export const twice = (value: number): number => value * 2', ''].join('\n'),
  'b.ts': [
    "import { twice } from './a.ts'",
    '',
    'export const four = twice(2)',
    '',
    'export const broken: string = twice(1)',
    '',
  ].join('\n'),
}

const compiler = compilerOf(sources)

describe('createCompiler', () => {
  it('binds the sources into a program the checker can answer from', () => {
    const bound = compiler.boundSourceFile('a.ts')
    expect(bound?.fileName).toBe('C:/repo/a.ts')
  })

  it('maps repo-relative paths to program paths and back', () => {
    expect(compiler.pathOf('b.ts')).toBe('C:/repo/b.ts')
    expect(compiler.fileOf('C:/repo/b.ts')).toBe('b.ts')
  })

  it('reports semantic errors through the language service', () => {
    const found = compiler.language.getSemanticDiagnostics('C:/repo/b.ts')
    expect(found.map((diagnostic) => diagnostic.code)).toContain(2322)
  })

  it('resolves the inferred type of a declaration', () => {
    const declaration = compiler.boundSourceFile('a.ts')?.statements[0]
    const name =
      declaration !== undefined && ts.isVariableStatement(declaration)
        ? declaration.declarationList.declarations[0]?.name
        : undefined
    const type =
      name === undefined
        ? undefined
        : compiler.checker.typeToString(compiler.checker.getTypeAtLocation(name))
    expect(type).toBe('(value: number) => number')
  })
})

describe('toFileEdits', () => {
  it('converts the compiler\u2019s own edits into repo-relative plans', () => {
    const unused = {
      'c.ts': ["import { twice } from './a.ts'", '', 'export const one = 1', ''].join('\n'),
      'a.ts': sources['a.ts'],
    }
    const other = compilerOf(unused)
    const changes = other.language.organizeImports(
      { type: 'file', fileName: 'C:/repo/c.ts' },
      formatSettings,
      userPreferences,
    )
    const edits = toFileEdits(other, changes)
    expect(edits.map((edit) => edit.file)).toEqual(['c.ts'])
    expect(edits[0]?.text).toBe('')
  })
})
