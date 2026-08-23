import { describe, it, expect } from 'vitest'
import { planInit, type InitAction, type InitPlan, type TargetSnapshot } from '../src/index.ts'
import type { RatchetCounts } from '../../check/src/index.ts'

const zero: RatchetCounts = {
  undocumentedExports: 0,
  explicitAny: 0,
  asCasts: 0,
  nonNullAssertions: 0,
  tsDirectives: 0,
  eslintDisables: 0,
}

const emptyRepo: TargetSnapshot = {
  hasGit: true,
  existingFiles: [],
  packageJson: undefined,
  tsconfig: undefined,
  ratchetBaseline: undefined,
  counts: { ...zero, asCasts: 4 },
  scannedFileCount: 12,
}

const actionFor = (plan: InitPlan, path: string): InitAction => {
  const action = plan.actions.find((candidate) => candidate.path === path)
  if (action === undefined) throw new Error(`no action for ${path}`)
  return action
}

describe('planInit — empty repository', () => {
  it('writes every file outright under the standard profile', () => {
    const plan = planInit(emptyRepo, 'standard')

    expect(plan.actions.map((action) => action.kind)).toEqual([
      'writeFile',
      'writeFile',
      'writeFile',
      'writeFile',
    ])
    expect(plan.actions.map((action) => action.path)).toEqual([
      'package.json',
      'tsconfig.json',
      'eslint.config.js',
      'ratchet.json',
    ])
  })

  it('baselines the ratchet at the target current counts, not at zero', () => {
    const action = actionFor(planInit(emptyRepo, 'standard'), 'ratchet.json')

    expect(action.kind).toBe('writeFile')
    if (action.kind !== 'writeFile') return
    expect(JSON.parse(action.content)).toEqual({ ...zero, asCasts: 4 })
    expect(action.reason).toContain('12 file(s)')
  })

  it('installs the functional subset only for the full profile', () => {
    const standard = actionFor(planInit(emptyRepo, 'standard'), 'eslint.config.js')
    const full = actionFor(planInit(emptyRepo, 'full'), 'eslint.config.js')

    expect(standard.kind === 'writeFile' && standard.content).not.toContain('functional/no-classes')
    expect(full.kind === 'writeFile' && full.content).toContain('functional/no-classes')
    expect(full.kind === 'writeFile' && full.content).toContain('eslint-plugin-functional')
  })

  it('observe installs the ratchet and nothing that can fail', () => {
    const plan = planInit(emptyRepo, 'observe')

    expect(actionFor(plan, 'tsconfig.json').kind).toBe('skip')
    expect(actionFor(plan, 'eslint.config.js').kind).toBe('skip')
    expect(actionFor(plan, 'ratchet.json').kind).toBe('writeFile')

    const packageAction = actionFor(plan, 'package.json')
    expect(packageAction.kind).toBe('writeFile')
    if (packageAction.kind !== 'writeFile') return
    expect(JSON.parse(packageAction.content)).toMatchObject({ scripts: {}, devDependencies: {} })
  })

  it('flags a target with no git history as a manual risk', () => {
    const plan = planInit({ ...emptyRepo, hasGit: false }, 'standard')

    expect(plan.manualSteps.some((step) => step.includes('not a git repository'))).toBe(true)
  })
})

describe('planInit — existing configs are never clobbered', () => {
  const withTsconfig: TargetSnapshot = {
    ...emptyRepo,
    existingFiles: ['package.json', 'tsconfig.json', 'eslint.config.js'],
    packageJson: { name: 'legacy', scripts: { lint: 'eslint src --fix' } },
    tsconfig: { compilerOptions: { strict: false, target: 'ES2018' }, include: ['src'] },
  }

  it('merges an existing tsconfig, listing conflicts instead of overwriting them', () => {
    const action = actionFor(planInit(withTsconfig, 'standard'), 'tsconfig.json')

    expect(action.kind).toBe('mergeJson')
    if (action.kind !== 'mergeJson') return
    expect(action.conflicts).toEqual([
      { key: 'compilerOptions.strict', existing: false, proposed: true },
    ])
    expect(action.additions).toEqual({
      compilerOptions: {
        noUncheckedIndexedAccess: true,
        exactOptionalPropertyTypes: true,
        noImplicitReturns: true,
        noFallthroughCasesInSwitch: true,
        noImplicitOverride: true,
      },
    })
    expect(JSON.stringify(action.additions)).not.toContain('target')
  })

  it('reports every conflict as a manual step', () => {
    const plan = planInit(withTsconfig, 'standard')

    expect(
      plan.manualSteps.some(
        (step) => step.includes('compilerOptions.strict') && step.includes('reconcile by hand'),
      ),
    ).toBe(true)
    expect(
      plan.manualSteps.some((step) => step.includes('scripts.lint')),
    ).toBe(true)
  })

  it('installs the eslint config under a sidecar name when one already exists', () => {
    const plan = planInit(withTsconfig, 'full')
    const action = actionFor(plan, 'eslint.platonic.config.js')

    expect(action.kind).toBe('writeFile')
    expect(action.reason).toContain('eslint.config.js exists')
    expect(plan.manualSteps.some((step) => step.startsWith('eslint.platonic.config.js:'))).toBe(true)
  })

  it('adds only the missing package.json entries', () => {
    const action = actionFor(planInit(withTsconfig, 'standard'), 'package.json')

    expect(action.kind).toBe('mergeJson')
    if (action.kind !== 'mergeJson') return
    expect(action.additions).toEqual({
      scripts: { typecheck: 'tsc --noEmit', check: 'npm run typecheck && npm run lint' },
      devDependencies: { eslint: '^10.9.0', typescript: '^5.6.0', 'typescript-eslint': '^8.67.0' },
    })
  })

  it('skips a key the target already agrees on', () => {
    const agreed: TargetSnapshot = {
      ...emptyRepo,
      existingFiles: ['tsconfig.json'],
      tsconfig: {
        compilerOptions: {
          strict: true,
          noUncheckedIndexedAccess: true,
          exactOptionalPropertyTypes: true,
          noImplicitReturns: true,
          noFallthroughCasesInSwitch: true,
          noImplicitOverride: true,
        },
      },
    }

    const action = actionFor(planInit(agreed, 'standard'), 'tsconfig.json')

    expect(action.kind).toBe('skip')
    expect(action.reason).toContain('already strict')
  })
})

describe('planInit — an existing ratchet baseline becomes a drift report', () => {
  const withBaseline = (baseline: RatchetCounts, counts: RatchetCounts): TargetSnapshot => ({
    ...emptyRepo,
    existingFiles: ['ratchet.json'],
    ratchetBaseline: baseline,
    counts,
  })

  it('never rewrites the baseline', () => {
    const action = actionFor(
      planInit(withBaseline({ ...zero, asCasts: 4 }, { ...zero, asCasts: 4 }), 'standard'),
      'ratchet.json',
    )

    expect(action.kind).toBe('skip')
    expect(action.reason).toContain('counts ok')
  })

  it('names the regressed counters', () => {
    const action = actionFor(
      planInit(withBaseline({ ...zero, asCasts: 1 }, { ...zero, asCasts: 9 }), 'standard'),
      'ratchet.json',
    )

    expect(action.reason).toContain('regressed on asCasts')
  })

  it('reports an unparseable baseline instead of replacing it', () => {
    const target: TargetSnapshot = {
      ...emptyRepo,
      existingFiles: ['ratchet.json'],
      ratchetBaseline: undefined,
    }

    expect(actionFor(planInit(target, 'standard'), 'ratchet.json').reason).toContain(
      'does not parse',
    )
  })
})
