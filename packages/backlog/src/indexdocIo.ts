// Filesystem half of the src-folder INDEX.md generator: finds every folder that must carry an
// INDEX.md and reads the purpose text each of its entries publishes, for indexdoc.ts to render.
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  leadingPurpose,
  openingStatement,
  type FolderIndex,
  type IndexEntry,
} from './indexdoc.ts'

const readText = (path: string): Promise<string | undefined> =>
  readFile(path, 'utf-8').then(
    (text) => text,
    () => undefined,
  )

const hasSourceFiles = async (dir: string): Promise<boolean> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.ts')) return true
    if (entry.isDirectory() && (await hasSourceFiles(join(dir, entry.name)))) return true
  }
  return false
}

const scanFolder = async (absDir: string, folder: string): Promise<readonly FolderIndex[]> => {
  const dirEntries = await readdir(absDir, { withFileTypes: true }).catch(() => [])

  const files = await Promise.all(
    dirEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map(async (entry): Promise<IndexEntry> => {
        const source = await readText(join(absDir, entry.name))
        return {
          name: entry.name,
          kind: 'file',
          description: (source === undefined ? undefined : leadingPurpose(source)) ?? '',
        }
      }),
  )

  const subdirFlags = await Promise.all(
    dirEntries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => ({
        name: entry.name,
        hasSource: await hasSourceFiles(join(absDir, entry.name)),
      })),
  )
  const sourceDirs = subdirFlags.filter((entry) => entry.hasSource).map((entry) => entry.name)

  const folders = await Promise.all(
    sourceDirs.map(async (name): Promise<IndexEntry> => {
      const index = await readText(join(absDir, name, 'INDEX.md'))
      return {
        name,
        kind: 'folder',
        description: (index === undefined ? undefined : openingStatement(index)) ?? '',
      }
    }),
  )

  const indexContent = await readText(join(absDir, 'INDEX.md'))
  const self: FolderIndex = { folder, entries: [...files, ...folders], indexContent }

  const children = await Promise.all(
    sourceDirs.map((name) => scanFolder(join(absDir, name), `${folder}/${name}`)),
  )
  return [self, ...children.flat()]
}

// Every `packages/*/src` folder that exists and, recursively, every subfolder of one holding
// source files, with each entry's harvested purpose text. Folders come back in a stable
// order — packages alphabetically, each parent before its subfolders.
export const readFolderIndexes = async (repoDir: string): Promise<readonly FolderIndex[]> => {
  const packagesDir = join(repoDir, 'packages')
  const packageDirs = await readdir(packagesDir, { withFileTypes: true }).catch(() => [])

  const roots = await Promise.all(
    packageDirs
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .map(async (name) => {
        const srcDir = join(packagesDir, name, 'src')
        const isDir = await stat(srcDir)
          .then((info) => info.isDirectory())
          .catch(() => false)
        return isDir ? { abs: srcDir, rel: `packages/${name}/src` } : undefined
      }),
  )

  const found = roots.filter(
    (root): root is { readonly abs: string; readonly rel: string } => root !== undefined,
  )
  const scanned = await Promise.all(found.map((root) => scanFolder(root.abs, root.rel)))
  return scanned.flat()
}
