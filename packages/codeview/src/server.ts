// HTTP server for the code browser. node:http only, zero runtime deps.
// Depends on core types plus injected providers — no filesystem access here.
// STUB — Track H fills this in. Signatures are the wave contract.
import type {
  CodeIndex,
  FeedbackInput,
  FeedbackResult,
  FileView,
  SymbolReference,
} from '../../core/src/index.ts'

export type IndexProvider = () => Promise<CodeIndex>
export type FileViewProvider = (file: string) => Promise<FileView | undefined>
export type ReferenceProvider = (symbolId: string) => Promise<readonly SymbolReference[]>
export type FeedbackSink = (input: FeedbackInput) => Promise<FeedbackResult>

export type CodeViewOptions = {
  readonly port: number
  readonly index: IndexProvider
  readonly fileView: FileViewProvider
  readonly references: ReferenceProvider
  readonly feedback: FeedbackSink
}

export const startCodeView = (
  _options: CodeViewOptions,
): Promise<{ readonly port: number; readonly close: () => Promise<void> }> =>
  Promise.resolve({ port: 0, close: () => Promise.resolve() })
