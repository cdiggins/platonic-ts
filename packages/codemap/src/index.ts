// Barrel for the code index. Supervisor-owned: one level of re-export (PS-023).
export { toRepoRelative, extractSymbols, collectReferences } from './symbols.ts'
export {
  buildProgram,
  indexRepo,
  openSession,
  updateSession,
  type IndexSession,
} from './io.ts'
export { scanTimestamps, watchRepo, type RepoWatch } from './watch.ts'
export { changedPaths } from './incremental.ts'
export {
  emptyMetrics,
  sumMetrics,
  scoreMetrics,
  fileMetrics,
  functionMetrics,
  folderMetrics,
} from './metrics.ts'
export { childrenOf, subtreeNodes, sizedNodes, type SizedNode } from './walk.ts'
export { summarize, type Summary } from './summary.ts'
export {
  zoneOf,
  sizeReport,
  populationNames,
  type Zone,
  type PopulationName,
  type PopulationReport,
  type SizeReport,
  type SourceEntry,
} from './stats.ts'
export { formatSizeReport, formatCloneReport } from './report.ts'
export {
  expressionShape,
  sameShape,
  defaultShapeOptions,
  type Shape,
  type ShapeOptions,
  type LiteralMode,
} from './shapes.ts'
export {
  shapedExpressions,
  groupByShape,
  repeatedExpressions,
  defaultCloneOptions,
  type ExpressionOccurrence,
  type ShapedExpression,
  type ShapeGroup,
  type CloneOptions,
} from './clones.ts'
