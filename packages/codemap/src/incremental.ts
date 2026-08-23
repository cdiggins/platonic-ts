// Pure rules for reusing a code index across rebuilds: what a change to a file
// invalidates, and how the facts that survive merge with freshly computed ones.
// The IO that produces the fresh facts lives in io.ts.
import type {
  CodeIndex,
  FileEntry,
  SourceSpan,
  SymbolId,
  SymbolInfo,
  SymbolReference,
} from '../../core/src/index.ts'
import { folderMetrics } from './metrics.ts'

// What a rebuild found out about the files it re-read. `symbols` is the whole
// merged symbol set rather than only the fresh ones: reference collection needs
// it before the new index exists, so the caller merges symbols first and hands
// the result back here.
export type IndexUpdate = {
  readonly now: number
  readonly changed: ReadonlySet<string>
  readonly rewalked: ReadonlySet<string>
  readonly entries: readonly FileEntry[]
  readonly symbols: readonly SymbolInfo[]
  readonly references: readonly SymbolReference[]
}

// A symbol id is `${file}#${offset}`.
export const fileOfSymbolId = (id: SymbolId): string => id.slice(0, id.lastIndexOf('#'))

// Files whose modification time appeared, vanished, or moved.
export const changedPaths = (
  previous: ReadonlyMap<string, number>,
  current: ReadonlyMap<string, number>,
): readonly string[] =>
  [...new Set([...previous.keys(), ...current.keys()])]
    .filter((file) => previous.get(file) !== current.get(file))
    .sort()

// A reference recorded in a file that did not change is still true unless the
// declaration it points at moved, so every file that referenced a changed file
// is walked again. Nothing outside this set can have gained or lost a
// reference: a file refers to something new only when its own text changes.
export const referenceRewalkSet = (
  previous: CodeIndex,
  changed: ReadonlySet<string>,
): ReadonlySet<string> =>
  new Set([
    ...changed,
    ...previous.references
      .filter((reference) => changed.has(fileOfSymbolId(reference.symbolId)))
      .map((reference) => reference.file),
  ])

const outside = <T>(
  items: readonly T[],
  fileOf: (item: T) => string,
  dropped: ReadonlySet<string>,
): readonly T[] => items.filter((item) => !dropped.has(fileOf(item)))

type Located = { readonly file: string; readonly span: SourceSpan }

const byFile = (left: { readonly file: string }, right: { readonly file: string }): number =>
  left.file < right.file ? -1 : left.file > right.file ? 1 : 0

// Source order, so that a merged index is byte-for-byte what a full rebuild
// would have produced.
export const byPosition = (left: Located, right: Located): number =>
  left.file === right.file ? left.span.start - right.span.start : byFile(left, right)

// The previous symbol set with everything the changed files declared replaced.
export const mergeSymbols = (
  previous: readonly SymbolInfo[],
  changed: ReadonlySet<string>,
  fresh: readonly SymbolInfo[],
): readonly SymbolInfo[] => [...outside(previous, (symbol) => symbol.file, changed), ...fresh]

// The previous index with everything the re-read files contributed replaced.
export const mergeIndex = (previous: CodeIndex, update: IndexUpdate): CodeIndex => {
  const files = [
    ...outside(previous.files, (entry) => entry.file, update.changed),
    ...update.entries,
  ].sort(byFile)
  return {
    generatedAt: update.now,
    root: previous.root,
    files,
    folders: folderMetrics(files),
    symbols: [...update.symbols].sort(byPosition),
    references: [
      ...outside(previous.references, (reference) => reference.file, update.rewalked),
      ...update.references,
    ].sort(byPosition),
  }
}
