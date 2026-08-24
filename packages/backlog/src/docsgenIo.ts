// Filesystem half of `npm run docs:regen`: reads the inventory sources (root and package
// manifests, vendored SKILL.md frontmatter) and rewrites or audits the documents' blocks.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildBlocks,
  missingDescriptions,
  parseSkillFrontmatter,
  spliceBlocks,
  staleBlockNames,
  unknownBlockNames,
  type DocsSources,
  type PackageEntry,
  type ScriptEntry,
  type SkillEntry,
} from './docsgen.ts'

// Documents that carry generated blocks, relative to the repository root.
export const docsTargets: readonly string[] = ['README.md', 'docs/tools-and-process.md']

// What regeneration found in one document.
export type DocsFileResult = {
  readonly file: string
  readonly stale: readonly string[]
  readonly unknown: readonly string[]
  readonly written: boolean
}

// Outcome of a whole regeneration pass. `ok` is false when a document is stale or names an
// unknown block, or when a source row has no description to print.
export type DocsRegenReport = {
  readonly files: readonly DocsFileResult[]
  readonly missing: readonly string[]
  readonly ok: boolean
}

const readText = (path: string): Promise<string | undefined> =>
  readFile(path, 'utf-8').then(
    (text) => text,
    () => undefined,
  )

const readJson = async (path: string): Promise<unknown> => {
  const raw = await readText(path)
  if (raw === undefined) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    return value
  } catch {
    return undefined
  }
}

const stringField = (value: unknown, key: string): string | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const field: unknown = Reflect.get(value, key)
  return typeof field === 'string' ? field : undefined
}

const stringMap = (value: unknown, key: string): ReadonlyMap<string, string> => {
  if (typeof value !== 'object' || value === null) return new Map()
  const field: unknown = Reflect.get(value, key)
  if (typeof field !== 'object' || field === null) return new Map()
  return new Map(
    Object.keys(field).flatMap((name) => {
      const entry: unknown = Reflect.get(field, name)
      return typeof entry === 'string' ? [[name, entry] as const] : []
    }),
  )
}

const subdirectories = async (dir: string): Promise<readonly string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

const readScripts = async (repoDir: string): Promise<readonly ScriptEntry[]> => {
  const root = await readJson(join(repoDir, 'package.json'))
  const descriptions = stringMap(root, 'scriptDescriptions')
  return [...stringMap(root, 'scripts')].map(([name, command]) => ({
    name,
    command,
    description: descriptions.get(name) ?? '',
  }))
}

const readPackages = async (repoDir: string): Promise<readonly PackageEntry[]> => {
  const dirs = await subdirectories(join(repoDir, 'packages'))
  return Promise.all(
    dirs.map(async (dir): Promise<PackageEntry> => {
      const manifest = await readJson(join(repoDir, 'packages', dir, 'package.json'))
      return {
        dir,
        name: stringField(manifest, 'name') ?? dir,
        description: stringField(manifest, 'description') ?? '',
      }
    }),
  )
}

const readSkills = async (repoDir: string): Promise<readonly SkillEntry[]> => {
  const skillsDir = join(repoDir, '.claude', 'skills')
  const dirs = await subdirectories(skillsDir)
  const entries = await Promise.all(
    dirs.map(async (dir) => {
      const content = await readText(join(skillsDir, dir, 'SKILL.md'))
      return content === undefined ? undefined : parseSkillFrontmatter(content)
    }),
  )
  return entries.filter((entry): entry is SkillEntry => entry !== undefined)
}

// Collects every inventory source in the repository.
export const readDocsSources = async (repoDir: string): Promise<DocsSources> => {
  const [scripts, packages, skills] = await Promise.all([
    readScripts(repoDir),
    readPackages(repoDir),
    readSkills(repoDir),
  ])
  return { scripts, packages, skills }
}

// Regenerates every target document's blocks. In `check` mode nothing is written and a stale
// document is reported instead; in `write` mode a document is rewritten only if it changed.
export const regenerateDocs = async (
  repoDir: string,
  mode: 'write' | 'check',
): Promise<DocsRegenReport> => {
  const sources = await readDocsSources(repoDir)
  const blocks = buildBlocks(sources)
  const missing = missingDescriptions(sources)

  const files = await Promise.all(
    docsTargets.map(async (file): Promise<DocsFileResult> => {
      const path = join(repoDir, file)
      const md = await readText(path)
      if (md === undefined) {
        return { file, stale: [], unknown: [], written: false }
      }
      const stale = staleBlockNames(md, blocks)
      const unknown = unknownBlockNames(md, blocks)
      const shouldWrite = mode === 'write' && stale.length > 0
      if (shouldWrite) await writeFile(path, spliceBlocks(md, blocks), 'utf-8')
      return { file, stale, unknown, written: shouldWrite }
    }),
  )

  const clean =
    missing.length === 0 &&
    files.every((f) => f.unknown.length === 0 && (mode === 'write' || f.stale.length === 0))
  return { files, missing, ok: clean }
}
