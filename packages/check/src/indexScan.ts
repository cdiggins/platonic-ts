// IO: locates every folder that needs an INDEX.md — each `packages/*/src` root, plus any
// of its subfolders that hold `.ts` source files — and reads what each folder actually has
// on disk plus its INDEX.md content, for indexTable.ts to validate.
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { FolderCheck } from './indexTable.ts'

const hasSourceFiles = async (dir: string): Promise<boolean> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.ts')) return true
    if (entry.isDirectory() && (await hasSourceFiles(join(dir, entry.name)))) return true
  }
  return false
}

const scanFolder = async (absDir: string, relFolder: string): Promise<readonly FolderCheck[]> => {
  const entries = await readdir(absDir, { withFileTypes: true }).catch(() => [])
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => entry.name)
    .sort()

  const dirEntries = entries.filter((entry) => entry.isDirectory())
  const sourceDirFlags = await Promise.all(
    dirEntries.map(async (entry) => ({
      name: entry.name,
      hasSource: await hasSourceFiles(join(absDir, entry.name)),
    })),
  )
  const sourceDirs = sourceDirFlags.filter((d) => d.hasSource).map((d) => d.name).sort()

  const indexContent = await readFile(join(absDir, 'INDEX.md'), 'utf8').catch(() => undefined)
  const self: FolderCheck = { folder: relFolder, expectedNames: [...files, ...sourceDirs], indexContent }

  const children = await Promise.all(
    sourceDirs.map((name) => scanFolder(join(absDir, name), `${relFolder}/${name}`)),
  )
  return [self, ...children.flat()]
}

// Finds every `packages/*/src` folder that exists and, recursively, every subfolder of one
// that holds source files — the full set of folders BL-0032's INDEX.md gate applies to.
export const scanIndexFolders = async (repoDir: string): Promise<readonly FolderCheck[]> => {
  const packagesDir = join(repoDir, 'packages')
  const packageDirs = await readdir(packagesDir, { withFileTypes: true }).catch(() => [])

  const roots = await Promise.all(
    packageDirs
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const srcDir = join(packagesDir, entry.name, 'src')
        const isDir = await stat(srcDir)
          .then((s) => s.isDirectory())
          .catch(() => false)
        return isDir ? { abs: srcDir, rel: `packages/${entry.name}/src` } : undefined
      }),
  )

  const found = roots.filter((r): r is { readonly abs: string; readonly rel: string } => r !== undefined)
  const results = await Promise.all(found.map((r) => scanFolder(r.abs, r.rel)))
  return results.flat()
}
