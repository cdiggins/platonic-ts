import { describe, it, expect } from 'vitest'
import { parseInitArgs } from '../src/args.ts'

describe('parseInitArgs', () => {
  it('defaults to the observe profile and to writing nothing', () => {
    const parsed = parseInitArgs(['../other-repo'])

    expect(parsed).toEqual({
      ok: true,
      targetDir: '../other-repo',
      profile: 'observe',
      dryRun: true,
    })
  })

  it('only leaves dry-run mode for an explicit --yes', () => {
    expect(parseInitArgs(['repo', '--yes'])).toMatchObject({ dryRun: false })
    expect(parseInitArgs(['repo', '--yes', '--dry-run'])).toMatchObject({ dryRun: true })
  })

  it('does not mistake the profile value for the target directory', () => {
    expect(parseInitArgs(['--profile', 'full', 'repo'])).toMatchObject({
      targetDir: 'repo',
      profile: 'full',
    })
  })

  it('rejects an unknown profile', () => {
    expect(parseInitArgs(['repo', '--profile', 'strict'])).toEqual({
      ok: false,
      reason: 'unknown profile: strict (expected observe, standard, or full)',
    })
  })

  it('rejects a missing target directory', () => {
    const parsed = parseInitArgs(['--profile', 'full'])

    expect(parsed.ok).toBe(false)
  })
})
