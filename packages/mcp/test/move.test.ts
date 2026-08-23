import { describe, it, expect } from 'vitest'
import { applyEdits, editsByFile, type EditPlan } from '../src/edit.ts'
import { moveSymbol, renameFile, specifierFor } from '../src/move.ts'
import { compilerOf, workspaceOf } from './fixture.ts'

const lines = (...text: readonly string[]): string => text.join('\n')

// Applying a plan the way the server does: every file it touches, rewritten.
const applied = (
  sources: Readonly<Record<string, string>>,
  plan: EditPlan,
  file: string,
): string => {
  if (!plan.ok) return `DECLINED: ${plan.text}`
  const edits = editsByFile(plan.edits).get(file) ?? []
  return applyEdits(sources[file] ?? '', edits)
}

const declinedText = (plan: EditPlan): string => (plan.ok ? 'PLAN WAS ACCEPTED' : plan.text)

describe('specifierFor', () => {
  it('writes a sibling as ./name.ts and a parent hop as ../', () => {
    expect(specifierFor('packages/mcp/src/a.ts', 'packages/mcp/src/b.ts')).toBe('./b.ts')
    expect(specifierFor('packages/mcp/src/a.ts', 'packages/core/src/index.ts')).toBe(
      '../../core/src/index.ts',
    )
    expect(specifierFor('a.ts', 'nested/b.ts')).toBe('./nested/b.ts')
  })
})

describe('moveSymbol', () => {
  const sources = {
    'a.ts': lines(
      "import { helper } from './shared.ts'",
      '',
      '// Doubles what it is given.',
      'export const twice = (value: number): number => helper(value) * 2',
      '',
      'export const other = 1',
      '',
    ),
    'b.ts': lines('export const untouched = 0', ''),
    'c.ts': lines("import { twice } from './a.ts'", '', 'export const four = twice(2)', ''),
    'shared.ts': lines('export const helper = (value: number): number => value', ''),
  }

  it('moves the declaration, its comment, and repoints the importer', () => {
    const plan = moveSymbol(workspaceOf(sources), 'twice', undefined, 'b.ts')
    expect(plan.ok).toBe(true)
    expect(applied(sources, plan, 'a.ts')).toBe(
      lines("import { helper } from './shared.ts'", '', 'export const other = 1', ''),
    )
    expect(applied(sources, plan, 'b.ts')).toBe(
      lines(
        "import { helper } from './shared.ts'",
        '',
        'export const untouched = 0',
        '',
        '// Doubles what it is given.',
        'export const twice = (value: number): number => helper(value) * 2',
        '',
      ),
    )
    expect(applied(sources, plan, 'c.ts')).toBe(
      lines("import { twice } from './b.ts'", '', 'export const four = twice(2)', ''),
    )
  })

  it('summarises the move in files, not offsets', () => {
    const plan = moveSymbol(workspaceOf(sources), 'twice', undefined, 'b.ts')
    expect(plan.ok ? plan.summary : '').toBe(
      'moved twice from a.ts to b.ts; rewrote imports in 1 other files',
    )
  })

  it('merges into an importer’s existing clause rather than adding a second import', () => {
    const set = {
      'a.ts': lines('export const twice = (value: number): number => value * 2', ''),
      'b.ts': lines('export const half = (value: number): number => value / 2', ''),
      'c.ts': lines(
        "import { twice } from './a.ts'",
        "import { half } from './b.ts'",
        '',
        'export const both = twice(1) + half(2)',
        '',
      ),
    }
    const plan = moveSymbol(workspaceOf(set), 'twice', undefined, 'b.ts')
    expect(applied(set, plan, 'c.ts')).toBe(
      lines(
        "import { half, twice } from './b.ts'",
        '',
        'export const both = twice(1) + half(2)',
        '',
      ),
    )
  })

  it('imports the symbol back into the file it left, when that file still uses it', () => {
    const set = {
      'a.ts': lines(
        'export const twice = (value: number): number => value * 2',
        '',
        'export const four = twice(2)',
        '',
      ),
      'b.ts': lines('export const untouched = 0', ''),
    }
    const plan = moveSymbol(workspaceOf(set), 'twice', undefined, 'b.ts')
    expect(applied(set, plan, 'a.ts')).toBe(
      lines("import { twice } from './b.ts'", '', 'export const four = twice(2)', ''),
    )
    expect(applied(set, plan, 'b.ts')).toBe(
      lines(
        'export const untouched = 0',
        '',
        'export const twice = (value: number): number => value * 2',
        '',
      ),
    )
  })

  it('drops the target’s own import of the symbol, which would now import itself', () => {
    const set = {
      'a.ts': lines('export const twice = (value: number): number => value * 2', ''),
      'b.ts': lines(
        "import { twice } from './a.ts'",
        '',
        'export const four = twice(2)',
        '',
      ),
    }
    const plan = moveSymbol(workspaceOf(set), 'twice', undefined, 'b.ts')
    expect(applied(set, plan, 'b.ts')).toBe(
      lines(
        'export const four = twice(2)',
        '',
        'export const twice = (value: number): number => value * 2',
        '',
      ),
    )
  })

  it('declines when a dependency of the declaration is not exported, naming it', () => {
    const set = {
      'a.ts': lines(
        'const secret = 3',
        '',
        'export const twice = (value: number): number => value * secret',
        '',
      ),
      'b.ts': lines('export const untouched = 0', ''),
    }
    const plan = moveSymbol(workspaceOf(set), 'twice', undefined, 'b.ts')
    expect(plan.ok).toBe(false)
    expect(declinedText(plan)).toContain('not exported from a.ts')
    expect(declinedText(plan)).toContain('secret at a.ts:1')
  })

  it('declines a move that would point two files at each other', () => {
    const set = {
      'a.ts': lines(
        'export const base = 1',
        '',
        'export const twice = (value: number): number => value * base',
        '',
        'export const four = twice(2)',
        '',
      ),
      'b.ts': lines('export const untouched = 0', ''),
    }
    const plan = moveSymbol(workspaceOf(set), 'twice', undefined, 'b.ts')
    expect(plan.ok).toBe(false)
    expect(declinedText(plan)).toBe(
      'the move would make b.ts import a.ts and a.ts import b.ts. Split them differently.',
    )
  })

  it('declines when the target file does not exist', () => {
    const plan = moveSymbol(workspaceOf(sources), 'twice', undefined, 'new.ts')
    expect(declinedText(plan)).toBe(
      'new.ts is not in the workspace; move_symbol does not create files.',
    )
  })

  it('declines when the target already declares the name', () => {
    const set = {
      'a.ts': lines('export const twice = (value: number): number => value * 2', ''),
      'b.ts': lines('const twice = 2', '', 'export const four = twice * 2', ''),
    }
    const plan = moveSymbol(workspaceOf(set), 'twice', undefined, 'b.ts')
    expect(declinedText(plan)).toContain('b.ts already declares twice at b.ts:1')
  })

  it('declines an unresolvable name the way the other editing tools do', () => {
    expect(declinedText(moveSymbol(workspaceOf(sources), 'missing', undefined, 'b.ts'))).toBe(
      'no declaration named missing. Try search.',
    )
  })

  it('declines a move into the file the symbol already lives in', () => {
    expect(declinedText(moveSymbol(workspaceOf(sources), 'twice', undefined, 'a.ts'))).toBe(
      'twice is already declared in a.ts.',
    )
  })

  it('declines when an importer renamed the symbol on import', () => {
    const set = {
      'a.ts': lines('export const twice = (value: number): number => value * 2', ''),
      'b.ts': lines('export const untouched = 0', ''),
      'c.ts': lines("import { twice as double } from './a.ts'", '', 'export const four = double(2)', ''),
    }
    expect(declinedText(moveSymbol(workspaceOf(set), 'twice', undefined, 'b.ts'))).toBe(
      'twice is imported under another name in c.ts; move it by hand.',
    )
  })

  it('carries a dependency that lives in a third file into the target', () => {
    const set = {
      'a.ts': lines(
        "import { helper, spare } from './shared.ts'",
        '',
        'export const twice = (value: number): number => helper(value) * 2',
        '',
        'export const one = spare',
        '',
      ),
      'b.ts': lines("import { spare } from './shared.ts'", '', 'export const untouched = spare', ''),
      'shared.ts': lines(
        'export const helper = (value: number): number => value',
        '',
        'export const spare = 1',
        '',
      ),
    }
    const plan = moveSymbol(workspaceOf(set), 'twice', undefined, 'b.ts')
    expect(applied(set, plan, 'b.ts')).toBe(
      lines(
        "import { spare, helper } from './shared.ts'",
        '',
        'export const untouched = spare',
        '',
        'export const twice = (value: number): number => helper(value) * 2',
        '',
      ),
    )
  })
})

describe('renameFile', () => {
  const sources = {
    'a.ts': lines('export const twice = (value: number): number => value * 2', ''),
    'b.ts': lines("import { twice } from './a.ts'", '', 'export const four = twice(2)', ''),
    'nested/c.ts': lines("import { twice } from '../a.ts'", '', 'export const six = twice(3)', ''),
  }

  it('rewrites every importer’s specifier and leaves the file move to the caller', () => {
    const compiler = compilerOf(sources)
    const plan = renameFile(compiler, 'a.ts', 'renamed.ts')
    expect(plan.ok).toBe(true)
    expect(applied(sources, plan, 'b.ts')).toBe(
      lines("import { twice } from './renamed.ts'", '', 'export const four = twice(2)', ''),
    )
    expect(applied(sources, plan, 'nested/c.ts')).toBe(
      lines("import { twice } from '../renamed.ts'", '', 'export const six = twice(3)', ''),
    )
    expect(plan.ok ? plan.summary : '').toContain('then move a.ts to renamed.ts')
  })

  it('declines a rename onto a path that already exists', () => {
    expect(declinedText(renameFile(compilerOf(sources), 'a.ts', 'b.ts'))).toBe(
      'b.ts already exists; pick a path that is free.',
    )
  })

  it('declines a rename of a file that is not in the program', () => {
    expect(declinedText(renameFile(compilerOf(sources), 'absent.ts', 'renamed.ts'))).toBe(
      'absent.ts is not in the program.',
    )
  })
})
