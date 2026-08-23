import { describe, it, expect } from 'vitest'
import { applyEdits, editsByFile } from '../src/edit.ts'
import { changeSignature } from '../src/signature.ts'
import { workspaceOf } from './fixture.ts'

const declaration = [
  '// Scales a value. The comment and the body must survive untouched.',
  'export const scale = (value: number): number => {',
  '  return value * 2',
  '}',
  '',
].join('\n')

const callers = [
  "import { scale } from './a.ts'",
  '',
  'export const one = scale(1)',
  '',
  'export const two = scale(2 + 3)',
  '',
].join('\n')

const sources = { 'a.ts': declaration, 'b.ts': callers }

const applied = (
  files: Readonly<Record<string, string>>,
  plan: ReturnType<typeof changeSignature>,
): Readonly<Record<string, string>> => {
  if (!plan.ok) return files
  return Object.fromEntries(
    Object.entries(files).map(([file, text]) => [
      file,
      applyEdits(text, editsByFile(plan.edits).get(file) ?? []),
    ]),
  )
}

describe('changeSignature', () => {
  it('adds a parameter with a literal argument at every call site', () => {
    const workspace = workspaceOf(sources)
    const plan = changeSignature(workspace, 'scale', undefined, {
      parameters: ['value: number', 'factor: number'],
      arguments: ['$0', '1'],
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const result = applied(sources, plan)
    expect(result['a.ts']).toBe(
      [
        '// Scales a value. The comment and the body must survive untouched.',
        'export const scale = (value: number, factor: number): number => {',
        '  return value * 2',
        '}',
        '',
      ].join('\n'),
    )
    expect(result['b.ts']).toBe(
      [
        "import { scale } from './a.ts'",
        '',
        'export const one = scale(1, 1)',
        '',
        'export const two = scale(2 + 3, 1)',
        '',
      ].join('\n'),
    )
    expect(plan.summary).toBe(
      [
        'a.ts:2 — scale(value: number, factor: number); rewrote 2 call sites',
        'b.ts:3',
        'b.ts:5',
      ].join('\n'),
    )
  })

  it('leaves the leading comment and the body byte-identical', () => {
    const workspace = workspaceOf(sources)
    const plan = changeSignature(workspace, 'scale', undefined, {
      parameters: ['value: number', 'factor: number'],
      arguments: ['$0', '1'],
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const edit = plan.edits.find((candidate) => candidate.file === 'a.ts')
    expect(declaration.slice(0, edit?.start)).toBe(
      ['// Scales a value. The comment and the body must survive untouched.', 'export const scale = ('].join(
        '\n',
      ),
    )
    expect(declaration.slice(edit?.end)).toBe(
      ['): number => {', '  return value * 2', '}', ''].join('\n'),
    )
  })

  it('removes a parameter', () => {
    const twoParameters = {
      'a.ts': ['export const add = (left: number, right: number): number => left + right', ''].join(
        '\n',
      ),
      'b.ts': ["import { add } from './a.ts'", '', 'export const sum = add(1, 2)', ''].join('\n'),
    }
    const plan = changeSignature(workspaceOf(twoParameters), 'add', undefined, {
      parameters: ['left: number'],
      arguments: ['$0'],
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const result = applied(twoParameters, plan)
    expect(result['a.ts']).toBe('export const add = (left: number): number => left + right\n')
    expect(result['b.ts']).toBe(
      ["import { add } from './a.ts'", '', 'export const sum = add(1)', ''].join('\n'),
    )
  })

  it('reorders two parameters', () => {
    const twoParameters = {
      'a.ts': ['export const pair = (left: number, right: string): string => right + left', ''].join(
        '\n',
      ),
      'b.ts': ["import { pair } from './a.ts'", '', "export const p = pair(1, 'a')", ''].join('\n'),
    }
    const plan = changeSignature(workspaceOf(twoParameters), 'pair', undefined, {
      parameters: ['right: string', 'left: number'],
      arguments: ['$1', '$0'],
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const result = applied(twoParameters, plan)
    expect(result['a.ts']).toBe('export const pair = (right: string, left: number): string => right + left\n')
    expect(result['b.ts']).toBe(
      ["import { pair } from './a.ts'", '', "export const p = pair('a', 1)", ''].join('\n'),
    )
  })

  it('rewrites only the declaration when there are no call sites', () => {
    const alone = {
      'a.ts': ['export const lonely = (value: number): number => value', ''].join('\n'),
    }
    const plan = changeSignature(workspaceOf(alone), 'lonely', undefined, {
      parameters: ['value: number', 'extra: string'],
      arguments: ['$0', "''"],
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.edits).toHaveLength(1)
    expect(applied(alone, plan)['a.ts']).toBe(
      'export const lonely = (value: number, extra: string): number => value\n',
    )
    expect(plan.summary).toBe('a.ts:1 — lonely(value: number, extra: string); rewrote 0 call sites')
  })

  it('declines when the function is passed as a value, naming the site', () => {
    const asValue = {
      'a.ts': ['export const twice = (value: number): number => value * 2', ''].join('\n'),
      'b.ts': [
        "import { twice } from './a.ts'",
        '',
        'export const here = twice(1)',
        '',
        'export const mapped = [1, 2].map(twice)',
        '',
      ].join('\n'),
    }
    const plan = changeSignature(workspaceOf(asValue), 'twice', undefined, {
      parameters: ['value: number', 'factor: number'],
      arguments: ['$0', '1'],
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toBe(
      [
        'twice has 1 sites this signature change cannot rewrite:',
        'b.ts:5 not a call — used as a value, a type, or a re-export',
        'Nothing was changed. Fix those sites first, or edit them by hand.',
      ].join('\n'),
    )
  })

  it('passes over the import that brings the name in, and declines a re-export', () => {
    const reExported = {
      'a.ts': ['export const twice = (value: number): number => value * 2', ''].join('\n'),
      'b.ts': ["import { twice } from './a.ts'", '', 'export { twice }', ''].join('\n'),
    }
    const plan = changeSignature(workspaceOf(reExported), 'twice', 'a.ts', {
      parameters: ['value: number', 'factor: number'],
      arguments: ['$0', '1'],
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toBe(
      [
        'twice has 1 sites this signature change cannot rewrite:',
        'b.ts:3 not a call — used as a value, a type, or a re-export',
        'Nothing was changed. Fix those sites first, or edit them by hand.',
      ].join('\n'),
    )
  })

  it('declines when a placeholder is out of range at a call site', () => {
    const plan = changeSignature(workspaceOf(sources), 'scale', undefined, {
      parameters: ['value: number', 'factor: number'],
      arguments: ['$0', '$1'],
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toBe(
      [
        'scale has 2 sites this signature change cannot rewrite:',
        'b.ts:3 $1 has no argument here (1 given)',
        'b.ts:5 $1 has no argument here (1 given)',
        'Nothing was changed. Fix those sites first, or edit them by hand.',
      ].join('\n'),
    )
  })

  it('declines a call site that spreads its arguments', () => {
    const spread = {
      'a.ts': ['export const add = (left: number, right: number): number => left + right', ''].join(
        '\n',
      ),
      'b.ts': [
        "import { add } from './a.ts'",
        '',
        'const pair: readonly [number, number] = [1, 2]',
        '',
        'export const sum = add(...pair)',
        '',
      ].join('\n'),
    }
    const plan = changeSignature(workspaceOf(spread), 'add', undefined, {
      parameters: ['left: number'],
      arguments: ['$0'],
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toContain('b.ts:5 spread argument — the mapping is not computable')
  })

  it('declines a declaration that is not a function', () => {
    const notAFunction = { 'a.ts': ['export const total = 1 + 2', ''].join('\n') }
    const plan = changeSignature(workspaceOf(notAFunction), 'total', undefined, {
      parameters: [],
      arguments: [],
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toBe(
      'total at a.ts:1 is not a function whose parameters can be located.',
    )
  })

  it('declines an unknown name', () => {
    const plan = changeSignature(workspaceOf(sources), 'missing', undefined, {
      parameters: [],
      arguments: [],
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toContain('no declaration named missing')
  })

  it('declines when one call site encloses another', () => {
    const nested = {
      'a.ts': ['export const twice = (value: number): number => value * 2', ''].join('\n'),
      'b.ts': ["import { twice } from './a.ts'", '', 'export const four = twice(twice(1))', ''].join(
        '\n',
      ),
    }
    const plan = changeSignature(workspaceOf(nested), 'twice', undefined, {
      parameters: ['value: number', 'factor: number'],
      arguments: ['$0', '2'],
    })
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toContain('b.ts:3 nested call — an enclosing call is also a site')
  })
})
