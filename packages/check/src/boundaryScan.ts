// IO: reads the source files each forbidden-edge rule applies to — every `.ts` file under a
// rule's `from` directory (repo-relative, forward slashes) — for boundary.ts to validate.
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BoundaryRule, BoundarySourceFile } from './boundary.ts'

const walkTsFiles = async (absDir: string, relDir: string): Promise<readonly string[]> => {
  const entries = await readdir(absDir, { withFileTypes: true }).catch(() => [])
  const found = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === 'node_modules') return []
      const rel = `${relDir}/${entry.name}`
      if (entry.isDirectory()) return walkTsFiles(join(absDir, entry.name), rel)
      return entry.isFile() && entry.name.endsWith('.ts') ? [rel] : []
    }),
  )
  return found.flat()
}

// Collects every `.ts` file (repo-relative posix path plus content) under the `from`
// directory of each rule, deduplicated across rules that share a `from`.
export const collectBoundaryFiles = async (
  repoDir: string,
  rules: readonly BoundaryRule[],
): Promise<readonly BoundarySourceFile[]> => {
  const roots = [...new Set(rules.map((rule) => rule.from))]
  const paths = (await Promise.all(roots.map((root) => walkTsFiles(join(repoDir, ...root.split('/')), root)))).flat()
  return Promise.all(
    paths.map(async (path) => ({
      path,
      source: await readFile(join(repoDir, ...path.split('/')), 'utf8'),
    })),
  )
}
