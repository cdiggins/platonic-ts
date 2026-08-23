// Command-line argument parsing for `platonic init`, pure so the safety rule —
// nothing is written unless `--yes` is present — is testable without a filesystem.
import type { StrictnessProfile } from './index.ts'

export type ParsedArgs =
  | {
      readonly ok: true
      readonly targetDir: string
      readonly profile: StrictnessProfile
      /** True whenever the run must not write: either `--dry-run`, or no `--yes`. */
      readonly dryRun: boolean
    }
  | { readonly ok: false; readonly reason: string }

const profiles: readonly StrictnessProfile[] = ['observe', 'standard', 'full']

const isProfile = (value: string): value is StrictnessProfile =>
  profiles.some((profile) => profile === value)

const valueAfter = (argv: readonly string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
}

export const parseInitArgs = (argv: readonly string[]): ParsedArgs => {
  const profileValue = valueAfter(argv, '--profile')
  const targetDir = argv.find(
    (arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--profile',
  )

  if (targetDir === undefined) {
    return { ok: false, reason: 'usage: init <targetDir> [--profile observe|standard|full] [--dry-run] [--yes]' }
  }
  if (profileValue !== undefined && !isProfile(profileValue)) {
    return { ok: false, reason: `unknown profile: ${profileValue} (expected observe, standard, or full)` }
  }
  const profile: StrictnessProfile = profileValue === undefined ? 'observe' : profileValue
  const dryRun = argv.includes('--dry-run') || !argv.includes('--yes')
  return { ok: true, targetDir, profile, dryRun }
}
