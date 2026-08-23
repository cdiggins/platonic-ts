// Pure planning core for `platonic init`: given a description of what already
// exists in a target repository, decide what a retrofit would install.
//
// The rule that shapes every decision: never clobber. A file the target already
// has is either merged key-by-key (JSON, additions only) or installed alongside
// under a `.platonic.` name (everything else). Anything that cannot be
// reconciled mechanically leaves the plan as a manual step for a human.
import { compareToBaseline, type RatchetCounts } from '../../check/src/index.ts'
import { eslintConfigContent } from './templates/eslint.ts'
import { freshPackageJson, platonicDevDependencies, platonicScripts } from './templates/packageJson.ts'
import { freshTsconfig, strictCompilerOptions } from './templates/tsconfig.ts'

// Retrofit strictness levels: observe (scan only), standard (minimal ratchet), full (tight checks).
export type StrictnessProfile = 'observe' | 'standard' | 'full'

// JSON-serializable value: primitives, arrays, or objects.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

// A JSON object with string keys and JsonValue values.
export type JsonObject = { readonly [key: string]: JsonValue }

/** What the target repository looks like right now. Produced by `snapshotTarget`. */
export type TargetSnapshot = {
  readonly hasGit: boolean
  /** Names of the probed config files that exist, repo-relative, forward slashes. */
  readonly existingFiles: readonly string[]
  readonly packageJson: JsonObject | undefined
  readonly tsconfig: JsonObject | undefined
  readonly ratchetBaseline: RatchetCounts | undefined
  /** Escape-hatch counts for the target as it stands today. */
  readonly counts: RatchetCounts
  readonly scannedFileCount: number
}

// A merge conflict in a JSON file: a key with both existing and proposed values.
export type JsonConflict = {
  /** Dotted key path, e.g. `compilerOptions.strict`. */
  readonly key: string
  readonly existing: JsonValue
  readonly proposed: JsonValue
}

// One action the init plan either performs (write, merge) or deliberately skips.
export type InitAction =
  | {
      readonly kind: 'writeFile'
      readonly path: string
      readonly content: string
      readonly reason: string
    }
  | {
      readonly kind: 'mergeJson'
      readonly path: string
      readonly additions: JsonObject
      readonly conflicts: readonly JsonConflict[]
      readonly reason: string
    }
  | { readonly kind: 'skip'; readonly path: string; readonly reason: string }

export type InitPlan = {
  readonly profile: StrictnessProfile
  readonly actions: readonly InitAction[]
  /** What the plan deliberately refuses to do on its own. */
  readonly manualSteps: readonly string[]
}

// Result of applying one InitAction: what changed, and why.
export type ApplyOutcome = {
  readonly path: string
  readonly kind: InitAction['kind']
  readonly changed: boolean
  readonly detail: string
}

// Summary of what was applied to the target: dry-run flag and per-file outcomes.
export type ApplyReport = {
  readonly dryRun: boolean
  readonly outcomes: readonly ApplyOutcome[]
}

// Type guard: true if value is a plain object with string keys (a JsonObject).
export const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isJsonArray = (value: JsonValue): value is readonly JsonValue[] => Array.isArray(value)

const jsonEquals = (a: JsonValue, b: JsonValue): boolean => {
  if (isJsonArray(a) && isJsonArray(b)) {
    return a.length === b.length && a.every((item, index) => jsonEquals(item, b[index] ?? null))
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => jsonEquals(a[key] ?? null, b[key] ?? null))
    )
  }
  return a === b
}

type MergeSplit = { readonly additions: JsonObject; readonly conflicts: readonly JsonConflict[] }

const emptySplit: MergeSplit = { additions: {}, conflicts: [] }

/**
 * Split a proposed JSON fragment against what the target already has: keys it
 * lacks become additions, keys it holds with a different value become
 * conflicts, keys it already agrees on vanish.
 */
const splitMerge = (
  existing: JsonObject | undefined,
  proposed: JsonObject,
  prefix: string,
): MergeSplit =>
  Object.entries(proposed).reduce<MergeSplit>((split, [key, value]) => {
    const current = existing?.[key]
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (current === undefined) {
      return { ...split, additions: { ...split.additions, [key]: value } }
    }
    if (isJsonObject(current) && isJsonObject(value)) {
      const nested = splitMerge(current, value, path)
      const additions =
        Object.keys(nested.additions).length === 0
          ? split.additions
          : { ...split.additions, [key]: nested.additions }
      return { additions, conflicts: [...split.conflicts, ...nested.conflicts] }
    }
    if (jsonEquals(current, value)) return split
    return {
      ...split,
      conflicts: [...split.conflicts, { key: path, existing: current, proposed: value }],
    }
  }, emptySplit)

// Converts a JsonObject to a file-ready string: 2-space JSON with trailing newline.
export const jsonFileContent = (value: JsonObject): string => `${JSON.stringify(value, null, 2)}\n`

const eslintFileNames: readonly string[] = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
]

/** Config file names a snapshot probes for; also every name a plan may touch. */
export const probedFiles: readonly string[] = [
  'package.json',
  'tsconfig.json',
  'ratchet.json',
  ...eslintFileNames,
]

const isEmpty = (value: JsonObject): boolean => Object.keys(value).length === 0

const planPackageJson = (target: TargetSnapshot, profile: StrictnessProfile): InitAction => {
  if (target.packageJson === undefined) {
    return {
      kind: 'writeFile',
      path: 'package.json',
      content: jsonFileContent(freshPackageJson(profile)),
      reason: 'no package.json in target',
    }
  }
  const proposed: JsonObject = {
    scripts: platonicScripts(profile),
    devDependencies: platonicDevDependencies(profile),
  }
  if (profile === 'observe') {
    return {
      kind: 'skip',
      path: 'package.json',
      reason: 'observe profile installs no scripts or dependencies',
    }
  }
  const split = splitMerge(target.packageJson, proposed, '')
  if (isEmpty(split.additions) && split.conflicts.length === 0) {
    return { kind: 'skip', path: 'package.json', reason: 'already has every proposed entry' }
  }
  return {
    kind: 'mergeJson',
    path: 'package.json',
    additions: split.additions,
    conflicts: split.conflicts,
    reason: 'add platonic scripts and dev dependencies',
  }
}

const planTsconfig = (target: TargetSnapshot, profile: StrictnessProfile): InitAction => {
  if (profile === 'observe') {
    return {
      kind: 'skip',
      path: 'tsconfig.json',
      reason: 'observe profile installs no compiler gates',
    }
  }
  if (target.tsconfig === undefined) {
    return {
      kind: 'writeFile',
      path: 'tsconfig.json',
      content: jsonFileContent(freshTsconfig),
      reason: 'no tsconfig.json in target',
    }
  }
  const split = splitMerge(target.tsconfig, { compilerOptions: strictCompilerOptions }, '')
  if (isEmpty(split.additions) && split.conflicts.length === 0) {
    return { kind: 'skip', path: 'tsconfig.json', reason: 'already strict on every proposed flag' }
  }
  return {
    kind: 'mergeJson',
    path: 'tsconfig.json',
    additions: split.additions,
    conflicts: split.conflicts,
    reason: 'raise compiler strictness',
  }
}

const planEslint = (target: TargetSnapshot, profile: StrictnessProfile): InitAction => {
  if (profile === 'observe') {
    return {
      kind: 'skip',
      path: 'eslint.config.js',
      reason: 'observe profile installs no lint gates',
    }
  }
  const content = eslintConfigContent(profile)
  const existing = eslintFileNames.find((name) => target.existingFiles.includes(name))
  return existing === undefined
    ? { kind: 'writeFile', path: 'eslint.config.js', content, reason: 'no eslint config in target' }
    : {
        kind: 'writeFile',
        path: 'eslint.platonic.config.js',
        content,
        reason: `${existing} exists — installed alongside, never merged`,
      }
}

const ratchetSkipReason = (target: TargetSnapshot): string => {
  if (target.ratchetBaseline === undefined) {
    return 'ratchet.json exists but does not parse as counts — left untouched'
  }
  const { verdict, regressions } = compareToBaseline(target.counts, target.ratchetBaseline)
  return verdict === 'regressed'
    ? `baseline exists; current counts regressed on ${regressions.join(', ')}`
    : `baseline exists; current counts ${verdict}`
}

const planRatchet = (target: TargetSnapshot): InitAction =>
  target.existingFiles.includes('ratchet.json')
    ? { kind: 'skip', path: 'ratchet.json', reason: ratchetSkipReason(target) }
    : {
        kind: 'writeFile',
        path: 'ratchet.json',
        content: jsonFileContent({ ...target.counts }),
        reason: `baseline at current counts over ${target.scannedFileCount} file(s)`,
      }

const conflictSteps = (actions: readonly InitAction[]): readonly string[] =>
  actions.flatMap((action) =>
    action.kind === 'mergeJson'
      ? action.conflicts.map(
          (conflict) =>
            `${action.path}: keeps ${conflict.key} = ${JSON.stringify(conflict.existing)}, platonic wants ${JSON.stringify(conflict.proposed)} — reconcile by hand`,
        )
      : [],
  )

const sidecarSteps = (actions: readonly InitAction[]): readonly string[] =>
  actions.flatMap((action) =>
    action.kind === 'writeFile' && action.path === 'eslint.platonic.config.js'
      ? ['eslint.platonic.config.js: merge into the existing eslint config, or point CI at it']
      : [],
  )

// Generates a configuration plan for the target repository at the given strictness profile.
export const planInit = (target: TargetSnapshot, profile: StrictnessProfile): InitPlan => {
  const actions: readonly InitAction[] = [
    planPackageJson(target, profile),
    planTsconfig(target, profile),
    planEslint(target, profile),
    planRatchet(target),
  ]
  const gitStep = target.hasGit
    ? []
    : ['target is not a git repository — nothing to revert to if the retrofit goes wrong']
  const includeStep =
    profile !== 'observe' && target.tsconfig === undefined
      ? ['tsconfig.json: set `include` to the source globs for this repo']
      : []
  const ratchetStep = target.existingFiles.includes('ratchet.json')
    ? []
    : ['ratchet.json records a baseline only; re-run `platonic init` to compare against it']
  return {
    profile,
    actions,
    manualSteps: [
      ...gitStep,
      ...conflictSteps(actions),
      ...sidecarSteps(actions),
      ...includeStep,
      ...ratchetStep,
    ],
  }
}

export { eslintConfigContent } from './templates/eslint.ts'
export { formatPlan, formatApplyReport } from './format.ts'
