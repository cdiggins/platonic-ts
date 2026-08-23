// Composition root: wires the code index, the renderers, and the feedback sink
// into the code browser server. Supervisor-owned. Run with: npm run codeview
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CodeIndex, FileView, SymbolReference } from '../../core/src/index.ts'
import {
  changedPaths,
  openSession,
  scanTimestamps,
  updateSession,
  watchRepo,
} from '../../codemap/src/index.ts'
import { renderMarkdown, renderSourceHtml } from './render.ts'
import { appendFeedbackItem } from './io.ts'
import { startCodeView } from './server.ts'

const repoDir = resolve(import.meta.dirname, '..', '..', '..')

const main = async (): Promise<void> => {
  // The watcher reports a change as it happens; the timestamp scan cannot miss
  // one. Both feed the same rebuild, which re-reads only the files named and so
  // is cheap enough to run on every request: about 50ms after one edit against
  // 1.6s for a full index of this repository.
  const touched = new Set<string>()
  watchRepo(repoDir, (file) => touched.add(file))
  let session = await openSession(repoDir, Date.now())
  let timestamps = await scanTimestamps(repoDir)

  const index = async (): Promise<CodeIndex> => {
    const scanned = await scanTimestamps(repoDir)
    const changed = [...new Set([...touched, ...changedPaths(timestamps, scanned)])]
    touched.clear()
    timestamps = scanned
    session = await updateSession(session, changed, Date.now())
    return session.index
  }

  const fileView = async (file: string): Promise<FileView | undefined> => {
    const current = await index()
    const entry = current.files.find((f) => f.file === file)
    if (entry === undefined) return undefined
    const source = await readFile(join(repoDir, file), 'utf8').catch(() => undefined)
    if (source === undefined) return undefined
    const symbols = current.symbols.filter((s) => s.file === file)
    const references = current.references.filter((r) => r.file === file)
    return {
      file,
      kind: entry.kind,
      html:
        entry.kind === 'markdown'
          ? renderMarkdown(source)
          : renderSourceHtml(source, symbols, references),
      metrics: entry.metrics,
      functions: entry.functions,
      symbols,
    }
  }

  const references = async (symbolId: string): Promise<readonly SymbolReference[]> =>
    (await index()).references.filter((r) => r.symbolId === symbolId)

  const port = Number(process.env['PORT'] ?? 4848)
  const started = await startCodeView({
    port,
    index,
    fileView,
    references,
    feedback: (input) => appendFeedbackItem(join(repoDir, 'backlog'), input, Date.now()),
  })
  console.log(`platonic codeview: http://localhost:${started.port}`)
  console.log(`indexing: ${repoDir}`)
}

void main()
