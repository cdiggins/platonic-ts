import { describe, expect, it } from 'vitest'
import { applyCodeFix, codeFixes, diagnostics, organizeImports } from '../src/diagnostics.ts'
import { applyEdits } from '../src/edit.ts'
import { compilerOf } from './fixture.ts'

const twice = 'export const twice = (value: number): number => value * 2\n'

const brokenSources = {
  'a.ts': twice,
  'b.ts': ["import { twice } from './a.ts'", '', 'export const four: string = twice(2)', ''].join('\n'),
  'clean.ts': ["import { twice } from './a.ts'", '', 'export const four = twice(2)', ''].join('\n'),
}

describe('diagnostics', () => {
  it('finds a type error and locates it', () => {
    const found = diagnostics(compilerOf(brokenSources), ['b.ts'])
    expect(found.ok).toBe(true)
    expect(found.text).toContain('b.ts:3 TS2322')
    expect(found.text).toContain('b.ts: 1 errors')
    expect(found.text.split('\n')[0]).toContain('1 errors in 1 files')
  })

  it('says it is not the gate, in the output itself', () => {
    const found = diagnostics(compilerOf(brokenSources), ['b.ts'])
    expect(found.text).toContain('not the gate')
  })

  it('reports a clean file as clean rather than saying nothing', () => {
    const found = diagnostics(compilerOf(brokenSources), ['a.ts', 'clean.ts'])
    expect(found.ok).toBe(true)
    expect(found.text.split('\n')[0]).toContain('no errors in 2 files')
    expect(found.text).toContain('a.ts: clean')
    expect(found.text).toContain('clean.ts: clean')
  })

  it('reports a file that is not in the program instead of skipping it', () => {
    const found = diagnostics(compilerOf(brokenSources), ['a.ts', 'ghost.ts'])
    expect(found.text).toContain('ghost.ts: not in the program')
    expect(found.ok).toBe(true)
  })

  it('fails when no named file is in the program', () => {
    const found = diagnostics(compilerOf(brokenSources), ['ghost.ts'])
    expect(found.ok).toBe(false)
    expect(found.text).toContain('ghost.ts: not in the program')
  })
})

const typeOnly = {
  'a.ts': 'export type Alpha = { readonly value: number }\n',
  'use.ts': 'export const read = (alpha: Alpha): number => alpha.value\n',
}

describe('codeFixes', () => {
  it('lists the fix name, its description, and the files it would touch', () => {
    const listed = codeFixes(compilerOf(typeOnly), 'use.ts', 1)
    expect(listed.ok).toBe(true)
    expect(listed.text).toContain('use.ts:1 TS2304')
    expect(listed.text).toContain('import')
    expect(listed.text).toContain("Add import from \"./a.ts\"")
    expect(listed.text).toContain('touches use.ts')
  })

  it('considers every diagnostic in the file when no line is given', () => {
    const listed = codeFixes(compilerOf(typeOnly), 'use.ts', undefined)
    expect(listed.text).toContain('fixes at use.ts')
  })

  it('finds nothing on a line with no diagnostic', () => {
    const listed = codeFixes(compilerOf(typeOnly), 'a.ts', 1)
    expect(listed.text).toContain('no code fixes at a.ts:1')
  })

  it('declines a file that is not in the program', () => {
    const listed = codeFixes(compilerOf(typeOnly), 'ghost.ts', undefined)
    expect(listed.ok).toBe(false)
    expect(listed.text).toContain('not in the program')
  })
})

describe('applyCodeFix', () => {
  it('applies the only available fix without being told its name', () => {
    const compiler = compilerOf(typeOnly)
    const plan = applyCodeFix(compiler, 'use.ts', 1, undefined)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.edits).toEqual([
      { file: 'use.ts', start: 0, end: 0, text: "import { Alpha } from './a.ts'\n\n" },
    ])
    expect(plan.summary).toContain('TS2304')
    expect(plan.summary).toContain('fixed by import')
    expect(plan.summary).toContain('touching use.ts')
    expect(applyEdits(typeOnly['use.ts'], plan.edits)).toBe(
      "import { Alpha } from './a.ts'\n\nexport const read = (alpha: Alpha): number => alpha.value\n",
    )
  })

  it('applies the named fix when several are offered', () => {
    // A value-position missing name offers both an import and a stub declaration.
    const compiler = compilerOf({ 'a.ts': twice, 'call.ts': 'export const four = twice(2)\n' })
    const plan = applyCodeFix(compiler, 'call.ts', 1, 'import')
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.edits).toEqual([
      { file: 'call.ts', start: 0, end: 0, text: "import { twice } from './a.ts'\n\n" },
    ])
  })

  it('declines two competing fixes and lists both', () => {
    const compiler = compilerOf({
      'a.ts': 'export const alpha = 1\n',
      'b.ts': 'export const alpha = 2\n',
      'c.ts': 'export const total = alpha + 1\n',
    })
    const plan = applyCodeFix(compiler, 'c.ts', 1, 'import')
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toContain('refusing to guess')
    expect(plan.text).toContain("Add import from \"./a.ts\"")
    expect(plan.text).toContain("Add import from \"./b.ts\"")
    expect(plan.text).toContain('pass fixName=')
  })

  it('declines an unknown fix name and lists what is available', () => {
    const plan = applyCodeFix(compilerOf(typeOnly), 'use.ts', 1, 'nonesuch')
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toContain('no fix named nonesuch')
    expect(plan.text).toContain('import')
  })

  it('declines when there is nothing to fix', () => {
    const plan = applyCodeFix(compilerOf(typeOnly), 'a.ts', undefined, undefined)
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toContain('no code fixes at a.ts')
  })

  it('declines a file that is not in the program', () => {
    const plan = applyCodeFix(compilerOf(typeOnly), 'ghost.ts', undefined, undefined)
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toContain('not in the program')
  })

  it('applies a spelling fix in place, replacing exactly the misspelled span', () => {
    const compiler = compilerOf({ 'f.ts': 'export const size = "abc".lenght\n' })
    const plan = applyCodeFix(compiler, 'f.ts', 1, undefined)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.edits).toEqual([{ file: 'f.ts', start: 26, end: 32, text: 'length' }])
  })
})

const tidy = {
  'a.ts': 'export const twice = (value: number): number => value * 2\nexport const thrice = (value: number): number => value * 3\n',
  'messy.ts': ["import { thrice, twice } from './a.ts'", '', 'export const one = twice(1)', ''].join('\n'),
  'neat.ts': ["import { twice } from './a.ts'", '', 'export const two = twice(2)', ''].join('\n'),
}

describe('organizeImports', () => {
  it('removes an unused import and returns the edit', () => {
    const compiler = compilerOf(tidy)
    const plan = organizeImports(compiler, ['messy.ts'])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.edits).toEqual([
      { file: 'messy.ts', start: 0, end: 39, text: "import { twice } from './a.ts'\n" },
    ])
    expect(applyEdits(tidy['messy.ts'], plan.edits)).toBe(
      "import { twice } from './a.ts'\n\nexport const one = twice(1)\n",
    )
    expect(plan.summary).toContain('organized imports in 1 of 1 files: messy.ts')
  })

  it('contributes no edits for a file whose imports are already tidy', () => {
    const plan = organizeImports(compilerOf(tidy), ['messy.ts', 'neat.ts'])
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.edits.map((edit) => edit.file)).toEqual(['messy.ts'])
    expect(plan.summary).toContain('1 of 2 files')
  })

  it('declines rather than reporting an empty write when nothing changes', () => {
    const plan = organizeImports(compilerOf(tidy), ['neat.ts', 'a.ts'])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toBe('imports already organized in 2 files')
  })

  it('declines a file that is not in the program', () => {
    const plan = organizeImports(compilerOf(tidy), ['neat.ts', 'ghost.ts'])
    expect(plan.ok).toBe(false)
    if (plan.ok) return
    expect(plan.text).toContain('not in the program: ghost.ts')
  })
})
