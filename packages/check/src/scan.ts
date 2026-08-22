// IO: collect *.ts files under packages/*/src and packages/*/test, recursively,
// skipping node_modules, and sum their escape-hatch counts.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { countEscapeHatches, sumCounts, type RatchetCounts } from './ratchet.ts'

const walkTsFiles = async (dir: string): Promise<readonly string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const found = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === 'node_modules') return []
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return walkTsFiles(full)
      return entry.isFile() && entry.name.endsWith('.ts') ? [full] : []
    }),
  )
  return found.flat()
}

export const collectSourceFiles = async (repoDir: string): Promise<readonly string[]> => {
  const packagesDir = join(repoDir, 'packages')
  const packageDirs = await readdir(packagesDir, { withFileTypes: true }).catch(() => [])
  const roots = packageDirs
    .filter((d) => d.isDirectory())
    .flatMap((d) => [join(packagesDir, d.name, 'src'), join(packagesDir, d.name, 'test')])
  const files = await Promise.all(roots.map(walkTsFiles))
  return files.flat()
}

export const scanRepo = async (repoDir: string): Promise<RatchetCounts> => {
  const files = await collectSourceFiles(repoDir)
  const counts = await Promise.all(
    files.map(async (file) => countEscapeHatches(file, await readFile(file, 'utf8'))),
  )
  return sumCounts(counts)
}
