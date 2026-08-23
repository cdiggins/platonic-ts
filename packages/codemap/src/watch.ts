// Noticing that the repository changed, by the two means available: the
// operating system's file-change notifications, and a scan of modification
// times for callers that cannot use them. Neither decides what to do about a
// change — that is io.ts, which re-reads whatever is named here.
import { existsSync, watch } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { collectSourceFiles } from '../../check/src/scan.ts'
import { collectMarkdownFiles } from './io.ts'
import { toRepoRelative } from './symbols.ts'

// Releases the operating-system handles. Watching a repository holds one handle
// per watched directory, and a process that forgets to close them never exits.
export type RepoWatch = { readonly close: () => void }

// Where indexed files live, relative to the repository root. The root itself is
// watched separately and without recursion, for the markdown files sitting there.
const watchedDirectories: readonly string[] = ['packages', 'docs', 'decisions', 'backlog']

const isIndexedPath = (file: string): boolean =>
  !file.includes('node_modules') && (file.endsWith('.ts') || file.endsWith('.md'))

// Watching is a hint, not a contract: the operating system coalesces events,
// names a directory instead of a file in some cases, and offers no recursive
// watch at all on some platforms — which is what the undefined return means,
// leaving the caller to fall back to scanTimestamps. Every path reported is
// re-read, so a spurious event costs one cheap rebuild.
export const watchRepo = (
  repoDir: string,
  onChange: (file: string) => void,
): RepoWatch | undefined => {
  const report = (prefix: string, name: string | Buffer | null): void => {
    if (name === null) return
    const file = `${prefix}${name.toString().split('\\').join('/')}`
    if (isIndexedPath(file)) onChange(file)
  }
  const directories = ['', ...watchedDirectories].filter((directory) =>
    existsSync(join(repoDir, directory)),
  )
  try {
    const watchers = directories.map((directory) =>
      watch(join(repoDir, directory), { recursive: directory !== '' }, (_event, name) =>
        report(directory === '' ? '' : `${directory}/`, name),
      ),
    )
    watchers.forEach((watcher) => {
      watcher.on('error', () => undefined)
      watcher.unref()
    })
    return { close: () => watchers.forEach((watcher) => watcher.close()) }
  } catch {
    return undefined
  }
}

// Modification times for every file the index covers, keyed the way the index
// keys them. Two of these, compared by changedPaths, are what a caller that
// cannot watch uses to find out what changed.
export const scanTimestamps = async (repoDir: string): Promise<ReadonlyMap<string, number>> => {
  const paths = [...(await collectSourceFiles(repoDir)), ...(await collectMarkdownFiles(repoDir))]
  const times = await Promise.all(
    paths.map(
      async (path) =>
        [
          toRepoRelative(repoDir, path),
          await stat(path)
            .then((info) => info.mtimeMs)
            .catch(() => 0),
        ] as const,
    ),
  )
  return new Map(times)
}
