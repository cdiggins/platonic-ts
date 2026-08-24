// The `platonic check` runner: typecheck -> lint -> ratchet -> tests -> backlog ids ->
// INDEX.md completeness -> generated doc blocks, stopping at first failure. Subprocess steps use spawn with
// node:child_process and shell:true (Windows needs a shell to resolve npx); timing uses
// process.hrtime.bigint() rather than Date.now() (project convention:
// ambient Date.now() is banned outside composition roots — see
// eslint.config.js purityBans — process.hrtime is not, and is monotonic,
// which is the more correct tool for elapsed-time measurement anyway).
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { compareToBaseline, type RatchetCounts } from './ratchet.ts'
import { scanRepo } from './scan.ts'
import { checkIndexFolders, type IndexIssue } from './indexTable.ts'
import { scanIndexFolders } from './indexScan.ts'

// Names of validation steps that can be run independently.
export type StepName = 'typecheck' | 'lint' | 'ratchet' | 'tests' | 'backlog' | 'index' | 'docs'

// Outcome of a single validation step.
export type CheckStepResult = {
  readonly name: StepName
  readonly ok: boolean
  readonly durationMs: number
  readonly detail: string
}

// Results of running all validation steps.
export type CheckReport = {
  readonly steps: readonly CheckStepResult[]
  readonly ok: boolean
}

// Comparison result of current counts to baseline.
export type RatchetVerdict = 'ok' | 'improved' | 'regressed' | 'initialized'

// Result of applying and possibly updating a ratchet baseline.
export type ApplyBaselineResult = {
  readonly verdict: RatchetVerdict
  readonly regressions: readonly string[]
  readonly counts: RatchetCounts
}

const parseBaseline = (raw: string): RatchetCounts | undefined => {
  try {
    return JSON.parse(raw) as RatchetCounts
  } catch {
    return undefined
  }
}

// Baseline file init/rewrite logic, split out from scanning so it is testable
// against a temp dir with fabricated counts (no real repo scan needed).
export const applyBaseline = async (
  baselinePath: string,
  current: RatchetCounts,
): Promise<ApplyBaselineResult> => {
  const raw = await readFile(baselinePath, 'utf8').catch(() => undefined)
  const baseline = raw === undefined ? undefined : parseBaseline(raw)

  if (baseline === undefined) {
    await writeFile(baselinePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
    return { verdict: 'initialized', regressions: [], counts: current }
  }

  const { verdict, regressions } = compareToBaseline(current, baseline)
  if (verdict === 'improved') {
    await writeFile(baselinePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
  }
  return { verdict, regressions, counts: current }
}

type CommandResult = {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
}

const runCommand = (command: string, cwd: string): Promise<CommandResult> =>
  new Promise((resolve) => {
    const start = process.hrtime.bigint()
    const elapsed = (): number => Number(process.hrtime.bigint() - start) / 1_000_000
    const child = spawn(command, { shell: true, cwd })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr, durationMs: elapsed() })
    })
    child.on('error', () => {
      resolve({ code: 1, stdout, stderr, durationMs: elapsed() })
    })
  })

const firstErrorLine = (text: string): string => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  return lines[0] ?? 'no output'
}

const testsSummary = (stdout: string): string | undefined => {
  const line = [...stdout.split(/\r?\n/)].reverse().find((l) => /Tests\s+\d/.test(l))
  return line?.trim()
}

const summarizeCommand = (name: StepName, ok: boolean, stdout: string, stderr: string): string => {
  if (name === 'tests') {
    const summary = testsSummary(stdout)
    if (summary) return summary
  }
  if (ok) return 'clean'
  return firstErrorLine(`${stdout}\n${stderr}`)
}

const commands: Readonly<Record<Exclude<StepName, 'ratchet' | 'index'>, string>> = {
  typecheck: 'npx tsc --noEmit',
  lint: 'npx eslint .',
  tests: 'npx vitest run',
  backlog: 'npx tsx packages/backlog/src/main.ts validate',
  docs: 'npx tsx packages/backlog/src/main.ts docs-regen --check',
}

const formatIndexIssue = (issue: IndexIssue): string => `${issue.folder}: ${issue.kind} — ${issue.detail}`

const runStep = async (
  name: StepName,
  repoDir: string,
  baselinePath: string,
): Promise<CheckStepResult> => {
  if (name === 'ratchet') {
    const start = process.hrtime.bigint()
    const current = await scanRepo(repoDir)
    const result = await applyBaseline(baselinePath, current)
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000
    const ok = result.verdict !== 'regressed'
    const detail =
      result.verdict === 'regressed' ? `regressed: ${result.regressions.join(', ')}` : result.verdict
    return { name, ok, durationMs, detail }
  }

  if (name === 'index') {
    const start = process.hrtime.bigint()
    const checks = await scanIndexFolders(repoDir)
    const issues = checkIndexFolders(checks)
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000
    const ok = issues.length === 0
    const detail = ok
      ? `${checks.length} folder(s) ok`
      : `${issues.length} issue(s): ${issues.map(formatIndexIssue).join('; ')}`
    return { name, ok, durationMs, detail }
  }

  const result = await runCommand(commands[name], repoDir)
  const ok = result.code === 0
  return {
    name,
    ok,
    durationMs: result.durationMs,
    detail: summarizeCommand(name, ok, result.stdout, result.stderr),
  }
}

const defaultSteps: readonly StepName[] = [
  'typecheck',
  'lint',
  'ratchet',
  'tests',
  'backlog',
  'index',
  'docs',
]

// Runs validation steps in order and stops at first failure.
export const runCheck = async (options: {
  readonly repoDir: string
  readonly baselinePath: string
  readonly steps?: readonly StepName[]
}): Promise<CheckReport> => {
  const order = options.steps ?? defaultSteps
  let steps: readonly CheckStepResult[] = []
  for (const name of order) {
    const result = await runStep(name, options.repoDir, options.baselinePath)
    steps = [...steps, result]
    if (!result.ok) break
  }
  return { steps, ok: steps.length > 0 && steps.every((s) => s.ok) }
}
