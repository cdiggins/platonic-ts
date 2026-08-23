import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planInit } from '../src/index.ts'
import { applyPlan, scanTarget, snapshotTarget } from '../src/io.ts'

const write = async (dir: string, name: string, content: string): Promise<void> => {
  await writeFile(join(dir, name), content, 'utf8')
}

describe('snapshotTarget / applyPlan round trip', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'platonic-init-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('counts escape hatches in the target and ignores node_modules', async () => {
    await mkdir(join(dir, 'src'), { recursive: true })
    await mkdir(join(dir, 'node_modules', 'junk'), { recursive: true })
    await write(join(dir, 'src'), 'a.ts', 'const a = x as Foo\nconst b: any = 1\n')
    await write(join(dir, 'node_modules', 'junk'), 'b.ts', 'const c: any = 1\n')

    const scan = await scanTarget(dir)

    expect(scan.fileCount).toBe(1)
    expect(scan.counts.asCasts).toBe(1)
    expect(scan.counts.explicitAny).toBe(1)
  })

  it('reports which config files already exist', async () => {
    await write(dir, 'package.json', '{"name":"target"}')
    await write(dir, 'eslint.config.mjs', 'export default []')

    const snapshot = await snapshotTarget(dir)

    expect(snapshot.existingFiles).toEqual(['package.json', 'eslint.config.mjs'])
    expect(snapshot.packageJson).toEqual({ name: 'target' })
    expect(snapshot.tsconfig).toBeUndefined()
    expect(snapshot.hasGit).toBe(false)
  })

  it('treats an unparseable ratchet.json as no baseline', async () => {
    await write(dir, 'ratchet.json', 'not json at all')

    const snapshot = await snapshotTarget(dir)

    expect(snapshot.existingFiles).toContain('ratchet.json')
    expect(snapshot.ratchetBaseline).toBeUndefined()
  })

  it('writes nothing in dry-run mode', async () => {
    await write(dir, 'package.json', '{"name":"target"}')
    const before = await readFile(join(dir, 'package.json'), 'utf8')

    const plan = planInit(await snapshotTarget(dir), 'full')
    const report = await applyPlan(dir, plan, { dryRun: true })

    expect(report.dryRun).toBe(true)
    expect(report.outcomes.every((outcome) => !outcome.changed)).toBe(true)
    expect(await readFile(join(dir, 'package.json'), 'utf8')).toBe(before)
    expect((await readdir(dir)).sort()).toEqual(['package.json'])
  })

  it('applies the plan when not dry-running, and is idempotent on a second pass', async () => {
    await write(dir, 'package.json', '{"name":"target","scripts":{"lint":"eslint src --fix"}}')
    await write(dir, 'tsconfig.json', '{"compilerOptions":{"strict":false}}')
    await mkdir(join(dir, 'src'), { recursive: true })
    await write(join(dir, 'src'), 'a.ts', 'const a = x as Foo\n')

    const plan = planInit(await snapshotTarget(dir), 'standard')
    await applyPlan(dir, plan, { dryRun: false })

    const packageJson: unknown = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    expect(packageJson).toMatchObject({
      name: 'target',
      // the conflicting script survives untouched
      scripts: { lint: 'eslint src --fix', typecheck: 'tsc --noEmit' },
    })

    const tsconfig: unknown = JSON.parse(await readFile(join(dir, 'tsconfig.json'), 'utf8'))
    expect(tsconfig).toMatchObject({
      compilerOptions: { strict: false, noUncheckedIndexedAccess: true },
    })

    expect(JSON.parse(await readFile(join(dir, 'ratchet.json'), 'utf8'))).toMatchObject({
      asCasts: 1,
    })
    expect(await readFile(join(dir, 'eslint.config.js'), 'utf8')).toContain('tseslint.config(')

    const second = planInit(await snapshotTarget(dir), 'standard')
    const secondReport = await applyPlan(dir, second, { dryRun: false })

    // package.json and tsconfig.json still carry the unresolved conflicts, so
    // they stay merge actions — but with nothing left to add, so nothing changes
    expect(secondReport.outcomes.map((outcome) => outcome.kind)).toEqual([
      'mergeJson',
      'mergeJson',
      'writeFile',
      'skip',
    ])
    expect(secondReport.outcomes.slice(0, 2).every((outcome) => !outcome.changed)).toBe(true)
    // the eslint config now exists, so the second pass installs a sidecar it
    // refuses to overwrite rather than replacing the file it wrote before
    expect(secondReport.outcomes[2]?.path).toBe('eslint.platonic.config.js')
  })

  it('refuses to overwrite a file that appeared after the plan was made', async () => {
    const plan = planInit(await snapshotTarget(dir), 'standard')
    await write(dir, 'tsconfig.json', '{"compilerOptions":{}}')

    const report = await applyPlan(dir, plan, { dryRun: false })
    const tsconfigOutcome = report.outcomes.find((outcome) => outcome.path === 'tsconfig.json')

    expect(tsconfigOutcome?.changed).toBe(false)
    expect(tsconfigOutcome?.detail).toContain('refusing to overwrite')
    expect(await readFile(join(dir, 'tsconfig.json'), 'utf8')).toBe('{"compilerOptions":{}}')
  })

  it('reports a missing target directory instead of creating one', async () => {
    const missing = join(dir, 'nope')
    const plan = planInit(await snapshotTarget(dir), 'standard')

    const report = await applyPlan(missing, plan, { dryRun: false })

    expect(report.outcomes).toHaveLength(1)
    expect(report.outcomes[0]?.detail).toContain('does not exist')
  })
})
