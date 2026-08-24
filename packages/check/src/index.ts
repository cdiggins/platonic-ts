// Barrel: the escape-hatch counting, check-run, and import-boundary surface this package
// offers callers outside `packages/check`.
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
export type { BoundarySourceFile, BoundaryRule, BoundaryIssue } from './boundary.ts'
export { findBoundaryViolations, forbiddenEdges } from './boundary.ts'
export { collectBoundaryFiles } from './boundaryScan.ts'
