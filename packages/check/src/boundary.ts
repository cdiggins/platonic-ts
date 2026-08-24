// Pure import-boundary check: flags import specifiers in one package's files that resolve
// into a package it must not depend on. IO (walking a rule's `from` directory) lives in
// boundaryScan.ts.
//
// The edge it currently holds: `packages/check` must never import from `packages/codemap`,
// because codemap already imports check/src/scan.ts, so the reverse edge would be a
// package-level cycle. See docs/decisions/2026-08-23-index-md-generated-by-docsgen.md.
import { posix } from 'node:path'

// One source file to check: a repo-relative posix path and its full text.
export type BoundarySourceFile = {
  readonly path: string
  readonly source: string
}

// One forbidden dependency edge: no file under `from` may import a module under `to`.
// Both are repo-relative posix directory prefixes, e.g. 'packages/check'.
export type BoundaryRule = {
  readonly from: string
  readonly to: string
}

// The dependency edges `npm run check` refuses. Extend here when a new ruling forbids one.
export const forbiddenEdges: readonly BoundaryRule[] = [
  { from: 'packages/check', to: 'packages/codemap' },
]

// One import that crosses a forbidden boundary.
export type BoundaryIssue = {
  readonly file: string
  readonly line: number
  readonly specifier: string
  readonly rule: BoundaryRule
}

// Matches the specifier of static imports, re-exports, side-effect imports, and dynamic
// import() calls. Type-only imports count too: the ruling forbids the edge, not just the
// runtime dependency.
const specifierPatterns: readonly RegExp[] = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /^\s*import\s+['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
]

const specifiersOf = (line: string): readonly string[] =>
  specifierPatterns.flatMap((pattern) =>
    [...line.matchAll(pattern)].flatMap((m) => (m[1] === undefined ? [] : [m[1]])),
  )

// Resolves a specifier to a repo-relative posix path when it is relative; bare package
// specifiers (node:*, npm deps) resolve to themselves and never match a repo prefix.
const resolveSpecifier = (filePath: string, specifier: string): string =>
  specifier.startsWith('.')
    ? posix.normalize(posix.join(posix.dirname(filePath), specifier))
    : specifier

const isUnder = (path: string, dirPrefix: string): boolean =>
  path === dirPrefix || path.startsWith(`${dirPrefix}/`)

// Finds every import in `files` that crosses one of `rules`' forbidden edges. File paths
// must be repo-relative with forward slashes; only files under a rule's `from` can violate it.
export const findBoundaryViolations = (
  files: readonly BoundarySourceFile[],
  rules: readonly BoundaryRule[],
): readonly BoundaryIssue[] =>
  files.flatMap((file) =>
    file.source.split(/\r?\n/).flatMap((text, index) =>
      specifiersOf(text).flatMap((specifier) => {
        const resolved = resolveSpecifier(file.path, specifier)
        return rules
          .filter((rule) => isUnder(file.path, rule.from) && isUnder(resolved, rule.to))
          .map(
            (rule): BoundaryIssue => ({ file: file.path, line: index + 1, specifier, rule }),
          )
      }),
    ),
  )
