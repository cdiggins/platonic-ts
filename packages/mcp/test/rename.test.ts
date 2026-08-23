import { describe, it, expect } from 'vitest'
import { applyEdits, editsByFile } from '../src/edit.ts'
import { renameSymbol, unrewritableOccurrences } from '../src/rename.ts'
import { sourceOf, type Workspace } from '../src/workspace.ts'
import { workspaceOf } from './fixture.ts'

const plain = {
  'a.ts': ['export const twice = (value: number): number => value * 2', ''].join('\n'),
  'b.ts': [
    "import { twice } from './a.ts'",
    '',
    'export const four = (): number => twice(twice(1))',
    '',
    '// A local of the same name, resolving to something else entirely.',
    'export const shadowed = (twice: string): string => twice',
    '',
  ].join('\n'),
}

const rewritten = (workspace: Workspace, plan: ReturnType<typeof renameSymbol>): string =>
  !plan.ok
    ? ''
    : [...editsByFile(plan.edits).entries()]
        .map(([file, edits]) => applyEdits(sourceOf(workspace, file)?.text ?? '', edits))
        .join('\n----\n')

describe('renameSymbol', () => {
  it('rewrites the declaration, the import, and every use', () => {
    const workspace = workspaceOf(plain)
    const plan = renameSymbol(workspace, 'twice', undefined, 'doubled')
    expect(plan.ok).toBe(true)
    const text = rewritten(workspace, plan)
    expect(text).toContain('export const doubled = (value: number): number => value * 2')
    expect(text).toContain("import { doubled } from './a.ts'")
    expect(text).toContain('doubled(doubled(1))')
  })

  it('leaves a same-named parameter in another scope alone', () => {
    const workspace = workspaceOf(plain)
    const text = rewritten(workspace, renameSymbol(workspace, 'twice', undefined, 'doubled'))
    expect(text).toContain('export const shadowed = (twice: string): string => twice')
  })

  it('refuses an identifier it cannot write', () => {
    const workspace = workspaceOf(plain)
    expect(renameSymbol(workspace, 'twice', undefined, 'not an identifier').ok).toBe(false)
    expect(renameSymbol(workspace, 'twice', undefined, 'class').ok).toBe(false)
  })

  it('refuses a name already declared in a file it would rewrite', () => {
    const workspace = workspaceOf({
      'a.ts': 'export const twice = 2\nexport const doubled = 4\n',
    })
    const plan = renameSymbol(workspace, 'twice', undefined, 'doubled')
    expect(plan.ok).toBe(false)
    expect(plan.ok ? '' : plan.text).toContain('already declared')
  })

  it('declines rather than half-rename around a shorthand property', () => {
    const workspace = workspaceOf({
      'a.ts': 'export const twice = 2\nexport const packed = { twice }\n',
    })
    const plan = renameSymbol(workspace, 'twice', undefined, 'doubled')
    expect(plan.ok).toBe(false)
    expect(plan.ok ? '' : plan.text).toContain('shorthand')
  })

  it('declines around a renamed import specifier', () => {
    const workspace = workspaceOf({
      'a.ts': 'export const twice = 2\n',
      'b.ts': "import { twice as t } from './a.ts'\nexport const use = t\n",
    })
    const plan = renameSymbol(workspace, 'twice', undefined, 'doubled')
    expect(plan.ok).toBe(false)
    expect(plan.ok ? '' : plan.text).toContain('aliased-specifier')
  })
})

describe('unrewritableOccurrences', () => {
  it('finds nothing in source that has none', () => {
    expect(unrewritableOccurrences(workspaceOf(plain), 'twice')).toEqual([])
  })
})
