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
export type { IndexIssueKind, IndexIssue, IndexRow, FolderCheck } from './indexTable.ts'
export { parseIndexTable, checkIndexFolder, checkIndexFolders } from './indexTable.ts'
export { scanIndexFolders } from './indexScan.ts'
