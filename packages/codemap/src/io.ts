// IO edge for the code index: creates the program and walks the repo.
// STUB — Track F fills these in. Signatures are the wave contract.
import ts from 'typescript'
import type { CodeIndex } from '../../core/src/index.ts'

// A program over the repo's tsconfig.json include set.
export const buildProgram = (_repoDir: string): ts.Program =>
  ts.createProgram([], { noEmit: true })

// The whole index: files, folders, symbols, references, metrics.
export const indexRepo = (repoDir: string, now: number): Promise<CodeIndex> =>
  Promise.resolve({
    generatedAt: now,
    root: repoDir,
    files: [],
    folders: [],
    symbols: [],
    references: [],
  })
