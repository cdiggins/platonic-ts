import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyBaseline } from '../src/run.ts'
import type { RatchetCounts } from '../src/ratchet.ts'

const zero: RatchetCounts = {
  explicitAny: 0,
  asCasts: 0,
  nonNullAssertions: 0,
  tsDirectives: 0,
  eslintDisables: 0,
}

describe('applyBaseline', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'platonic-check-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('initializes the baseline file when missing', async () => {
    const baselinePath = join(dir, 'ratchet.json')
    const current: RatchetCounts = { ...zero, explicitAny: 5 }

    const result = await applyBaseline(baselinePath, current)

    expect(result.verdict).toBe('initialized')
    expect(result.regressions).toEqual([])
    expect(JSON.parse(await readFile(baselinePath, 'utf8'))).toEqual(current)
  })

  it('auto-tightens: rewrites the baseline on improvement', async () => {
    const baselinePath = join(dir, 'ratchet.json')
    await applyBaseline(baselinePath, { ...zero, explicitAny: 5 })

    const improved: RatchetCounts = { ...zero, explicitAny: 2 }
    const result = await applyBaseline(baselinePath, improved)

    expect(result.verdict).toBe('improved')
    expect(JSON.parse(await readFile(baselinePath, 'utf8'))).toEqual(improved)
  })

  it('does not rewrite the baseline on regression', async () => {
    const baselinePath = join(dir, 'ratchet.json')
    const baseline: RatchetCounts = { ...zero, explicitAny: 2 }
    await applyBaseline(baselinePath, baseline)

    const regressed: RatchetCounts = { ...zero, explicitAny: 5 }
    const result = await applyBaseline(baselinePath, regressed)

    expect(result.verdict).toBe('regressed')
    expect(result.regressions).toEqual(['explicitAny'])
    expect(JSON.parse(await readFile(baselinePath, 'utf8'))).toEqual(baseline)
  })

  it('reports ok and leaves the file untouched when equal to baseline', async () => {
    const baselinePath = join(dir, 'ratchet.json')
    const baseline: RatchetCounts = { ...zero, explicitAny: 3 }
    await applyBaseline(baselinePath, baseline)

    const result = await applyBaseline(baselinePath, baseline)

    expect(result.verdict).toBe('ok')
    expect(JSON.parse(await readFile(baselinePath, 'utf8'))).toEqual(baseline)
  })

  it('treats a corrupt baseline file as missing and re-initializes it', async () => {
    const baselinePath = join(dir, 'ratchet.json')
    await writeFile(baselinePath, 'not json', 'utf8')

    const current: RatchetCounts = { ...zero, explicitAny: 1 }
    const result = await applyBaseline(baselinePath, current)

    expect(result.verdict).toBe('initialized')
    expect(JSON.parse(await readFile(baselinePath, 'utf8'))).toEqual(current)
  })
})
