// Barrel for the code index. Supervisor-owned: one level of re-export (PS-023).
export { toRepoRelative, extractSymbols, collectReferences } from './symbols.ts'
export { buildProgram, indexRepo } from './io.ts'
export {
  emptyMetrics,
  sumMetrics,
  scoreMetrics,
  fileMetrics,
  functionMetrics,
  folderMetrics,
} from './metrics.ts'
