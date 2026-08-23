// Pure symbol extraction and reference resolution over a TypeScript program.
// STUB — Track F fills these in. Signatures are the wave contract.
import ts from 'typescript'
import type { SymbolInfo, SymbolReference } from '../../core/src/index.ts'

// Absolute path -> repo-relative path with forward slashes.
export const toRepoRelative = (root: string, absolutePath: string): string =>
  absolutePath.slice(root.length).split('\\').join('/').replace(/^\//, '')

// Every declaration in one file, in source order.
export const extractSymbols = (_root: string, _sourceFile: ts.SourceFile): readonly SymbolInfo[] => []

// Every identifier occurrence that resolves to one of `symbols`, definitions included.
export const collectReferences = (
  _root: string,
  _program: ts.Program,
  _symbols: readonly SymbolInfo[],
): readonly SymbolReference[] => []
