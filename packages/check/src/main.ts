// Composition root / CLI entry for `platonic check`. Run with: npx tsx packages/check/src/main.ts
import { resolve } from 'node:path'
import { runCheck } from './run.ts'

const repoDir = resolve(import.meta.dirname, '..', '..', '..')
const baselinePath = resolve(repoDir, 'ratchet.json')

const main = async (): Promise<void> => {
  const report = await runCheck({ repoDir, baselinePath })
  for (const step of report.steps) {
    const mark = step.ok ? 'PASS' : 'FAIL'
    console.log(`[${mark}] ${step.name} (${Math.round(step.durationMs)}ms) — ${step.detail}`)
  }
  console.log(report.ok ? 'check: OK' : 'check: FAILED')
  process.exitCode = report.ok ? 0 : 1
}

void main()
