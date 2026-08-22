export type { RatchetCounts } from './ratchet.ts'
export { countEscapeHatches, sumCounts, compareToBaseline } from './ratchet.ts'
export { collectSourceFiles, scanRepo } from './scan.ts'
export type {
  StepName,
  CheckStepResult,
  CheckReport,
  RatchetVerdict,
  ApplyBaselineResult,
} from './run.ts'
export { runCheck, applyBaseline } from './run.ts'
