// Guards the wiring, not the rules: does the command in .githooks/pre-commit actually run and
// actually block? Git treats a hook that fails to launch as script error only when the shell
// reports it; a hook whose node invocation is mistyped exits 127 and the commit path has no
// other test executing it. Mirrors wiring.test.ts, which covers the PreToolUse side.
//
// The staged set is fabricated in a scratch git repository and exposed to the hook via GIT_DIR,
// so the command still runs from the real repo root (where `tsx` resolves) while `git diff
// --cached` inside it reads the scratch index.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = join(import.meta.dirname, '..', '..', '..')

// The command .githooks/pre-commit execs, read the way sh reads it.
const hookCommand = (): string => {
  const script = readFileSync(join(repoRoot, '.githooks', 'pre-commit'), 'utf8')
  const exec = script.split('\n').find((line) => line.startsWith('exec '))
  expect(exec, 'the hook script no longer has an exec line; update this test').toBeDefined()
  return (exec ?? '').slice('exec '.length).trim()
}

const git = (cwd: string, args: readonly string[]): void => {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' })
  expect(result.status, `git ${args.join(' ')}: ${result.stderr}`).toBe(0)
}

// A scratch repository with `paths` staged and an initial commit so HEAD exists.
const scratchRepoWithStaged = (paths: readonly string[]): string => {
  const dir = mkdtempSync(join(tmpdir(), 'precommit-wiring-'))
  git(dir, ['init', '--quiet'])
  git(dir, ['-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '--allow-empty', '--quiet', '-m', 'init'])
  for (const path of paths) {
    mkdirSync(join(dir, dirname(path)), { recursive: true })
    writeFileSync(join(dir, path), 'x\n', 'utf8')
  }
  git(dir, ['add', '--', ...paths])
  return dir
}

const runHook = (
  scratchRepo: string,
  extraEnv: Readonly<Record<string, string>> = {},
): { readonly status: number | null; readonly stderr: string } => {
  const { PLATONIC_WIDE_COMMIT: _dropped, ...env } = process.env
  const result = spawnSync(hookCommand(), {
    cwd: repoRoot,
    env: { ...env, GIT_DIR: join(scratchRepo, '.git'), ...extraEnv },
    shell: true,
    encoding: 'utf8',
  })
  return { status: result.status, stderr: result.stderr }
}

const scratchRepos: string[] = []
let broadRepo = ''
let narrowRepo = ''

beforeAll(() => {
  broadRepo = scratchRepoWithStaged(['packages/aaa/src/a.ts', 'packages/bbb/src/b.ts'])
  narrowRepo = scratchRepoWithStaged(['packages/aaa/src/a.ts', 'docs/note.md'])
  scratchRepos.push(broadRepo, narrowRepo)
})

afterAll(() => {
  for (const dir of scratchRepos) rmSync(dir, { recursive: true, force: true })
})

describe('pre-commit wiring', () => {
  it('launches: a staged set spanning two packages exits 1 rather than failing to start', () => {
    const { status, stderr } = runHook(broadRepo)
    // 127 here means node or tsx was not found, which git reports but no test would catch.
    expect(status).toBe(1)
    expect(stderr).toContain('spans 2 packages')
  })

  it('lets a single-package staged set through', () => {
    const { status, stderr } = runHook(narrowRepo)
    expect(stderr).toBe('')
    expect(status).toBe(0)
  })

  it('lets a declared wide commit through', () => {
    const { status } = runHook(broadRepo, { PLATONIC_WIDE_COMMIT: '1' })
    expect(status).toBe(0)
  })
})
