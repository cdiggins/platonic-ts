// Composition root / CLI entry for `platonic init`:
//   npx tsx packages/init/src/main.ts <targetDir> [--profile observe|standard|full] [--dry-run] [--yes]
//
// The plan is always printed before anything happens, and nothing is written
// without `--yes`: a retrofitter that surprises a repository is worse than no
// retrofitter at all.
import { resolve } from 'node:path'
import { parseInitArgs } from './args.ts'
import { formatApplyReport, formatPlan, planInit } from './index.ts'
import { applyPlan, snapshotTarget } from './io.ts'

const main = async (): Promise<void> => {
  const args = parseInitArgs(process.argv.slice(2))
  if (!args.ok) {
    console.error(args.reason)
    process.exitCode = 1
    return
  }

  const targetDir = resolve(args.targetDir)
  const snapshot = await snapshotTarget(targetDir)
  const plan = planInit(snapshot, args.profile)

  console.log(`target: ${targetDir}${snapshot.hasGit ? '' : ' (not a git repository)'}`)
  console.log(
    `scanned ${snapshot.scannedFileCount} TypeScript file(s); counts ${JSON.stringify(snapshot.counts)}`,
  )
  console.log(formatPlan(plan))

  const report = await applyPlan(targetDir, plan, { dryRun: args.dryRun })
  console.log(formatApplyReport(report))
  if (args.dryRun) {
    console.log('nothing written — re-run with --yes to apply')
  }
}

void main()
