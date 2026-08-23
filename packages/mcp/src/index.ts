// Barrel for the MCP server's pure surface. One level of re-export (PS-023).
export type { RequestId, RpcRequest, RpcResponse, ParsedLine } from './protocol.ts'
export { parseLine, resultOf, errorOf, encodeResponse } from './protocol.ts'
export type { ToolSpec, ToolSchema } from './schema.ts'
export { readText, readFlag, readCount, readTextList, readRecordList } from './schema.ts'
export { toolSpecs } from './tools.ts'
export type { Workspace, SymbolLookup } from './workspace.ts'
export { findSymbols, resolveSymbol, sourceOf } from './workspace.ts'
export { declarationRange, declarationText, syntaxErrorIn } from './declaration.ts'
export type { ToolOutput } from './query.ts'
export { outline, symbolSource, usages, search, repoMap } from './query.ts'
export type { FileEdit, EditPlan } from './edit.ts'
export { applyEdits, editsByFile, overlapping, replaceSymbol, insertSymbol } from './edit.ts'
export { renameSymbol, unrewritableOccurrences } from './rename.ts'
export type { Compiler } from './compiler.ts'
export {
  createCompiler,
  toFileEdits,
  newFilesIn,
  describeDiagnostic,
  compilerOptions,
  formatSettings,
  userPreferences,
} from './compiler.ts'
export { typeOf, membersOf } from './types.ts'
export { diagnostics, codeFixes, applyCodeFix, organizeImports } from './diagnostics.ts'
export { callers, testsForSymbol, blastRadius } from './reach.ts'
export { implementations, moduleGraph, unusedExports } from './graph.ts'
export { symbolMetrics, escapeHatchIndex } from './inspect.ts'
export { deleteSymbol, symbolDiff } from './review.ts'
export { moveSymbol, renameFile, specifierFor } from './move.ts'
export type { SignatureChange } from './signature.ts'
export { changeSignature } from './signature.ts'
export { availableRefactors, applyRefactor } from './refactor.ts'
export type { Snapshot, FileReader } from './checkpoint.ts'
export {
  takeSnapshot,
  snapshotOfWorkspace,
  changedSince,
  restorePlan,
  describeSnapshot,
} from './checkpoint.ts'
export { combinePlans } from './batch.ts'
export { unifiedDiff, previewPlan } from './preview.ts'
export type { CallOptions } from './options.ts'
export { callTool } from './dispatch.ts'
