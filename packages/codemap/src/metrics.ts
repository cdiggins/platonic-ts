// Pure quality metrics and the platonic score.
// STUB — Track G fills these in. Signatures are the wave contract.
import ts from 'typescript'
import type {
  CodeMetrics,
  FileEntry,
  FolderEntry,
  FunctionMetrics,
} from '../../core/src/index.ts'

export const emptyMetrics: CodeMetrics = {
  lines: 0,
  statements: 0,
  maxNestingDepth: 0,
  parameters: 0,
  mutableBindings: 0,
  classes: 0,
  throwStatements: 0,
  explicitAny: 0,
  asCasts: 0,
  nonNullAssertions: 0,
  tsDirectives: 0,
  eslintDisables: 0,
  exportedSymbols: 0,
  imports: 0,
  platonicScore: 100,
}

// Component-wise sum; platonicScore is recomputed from the summed components.
export const sumMetrics = (_metrics: readonly CodeMetrics[]): CodeMetrics => emptyMetrics

// 0..100. Deterministic function of the counts above.
export const scoreMetrics = (_metrics: CodeMetrics): number => 100

export const fileMetrics = (_sourceFile: ts.SourceFile, _sourceText: string): CodeMetrics =>
  emptyMetrics

export const functionMetrics = (
  _root: string,
  _sourceFile: ts.SourceFile,
): readonly FunctionMetrics[] => []

export const folderMetrics = (_files: readonly FileEntry[]): readonly FolderEntry[] => []
