import { describe, expect, it } from 'vitest'
import { findBoundaryViolations, forbiddenEdges, type BoundaryRule } from '../src/boundary.ts'

const rules: readonly BoundaryRule[] = [{ from: 'packages/check', to: 'packages/codemap' }]

// Builds a relative specifier into packages/codemap at runtime. The boundary step scans this
// test file too, line by line; a literal offending specifier in a fixture string would trip
// it, so fixtures assemble their specifiers instead of spelling them out.
const intoCodemap = (upLevels: number, rest: string): string =>
  [...Array.from({ length: upLevels }, () => '..'), 'codemap', rest].join('/')

describe('findBoundaryViolations', () => {
  it('accepts files with no imports into the forbidden package', () => {
    const files = [
      {
        path: 'packages/check/src/run.ts',
        source: [
          "import { spawn } from 'node:child_process'",
          "import { scanRepo } from './scan.ts'",
        ].join('\n'),
      },
    ]
    expect(findBoundaryViolations(files, rules)).toEqual([])
  })

  it('flags a relative import that resolves into the forbidden package', () => {
    const specifier = intoCodemap(2, 'src/index.ts')
    const files = [
      {
        path: 'packages/check/src/run.ts',
        source: `import { buildIndex } from '${specifier}'`,
      },
    ]
    const issues = findBoundaryViolations(files, rules)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toEqual({
      file: 'packages/check/src/run.ts',
      line: 1,
      specifier,
      rule: rules[0],
    })
  })

  it('flags type-only imports, re-exports, side-effect imports, and dynamic imports', () => {
    const files = [
      {
        path: 'packages/check/src/deep/nested.ts',
        source: [
          `import type { CodeIndex } from '${intoCodemap(3, 'src/index.ts')}'`,
          `export { watchRepo } from '${intoCodemap(3, 'src/watch.ts')}'`,
          `import '${intoCodemap(3, 'src/io.ts')}'`,
          `const lazy = await import('${intoCodemap(3, 'src/clones.ts')}')`,
        ].join('\n'),
      },
    ]
    const issues = findBoundaryViolations(files, rules)
    expect(issues.map((i) => i.line)).toEqual([1, 2, 3, 4])
  })

  it('allows the reverse direction: codemap importing check is not this edge', () => {
    const files = [
      {
        path: 'packages/codemap/src/io.ts',
        source: "import { collectSourceFiles } from '../../check/src/scan.ts'",
      },
    ]
    expect(findBoundaryViolations(files, rules)).toEqual([])
  })

  it('does not flag a specifier that merely mentions codemap outside the forbidden dir', () => {
    const files = [
      {
        path: 'packages/check/src/run.ts',
        source: "import { x } from './codemap-report.ts'",
      },
    ]
    expect(findBoundaryViolations(files, rules)).toEqual([])
  })

  it('the shipped rule set forbids check -> codemap', () => {
    expect(forbiddenEdges).toContainEqual({ from: 'packages/check', to: 'packages/codemap' })
  })
})
