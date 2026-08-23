// Composition root: wires the code index, the renderers, and the feedback sink
// into the code browser server. Supervisor-owned. Run with: npm run codeview
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { CodeIndex, FileView, SymbolReference } from '../../core/src/index.ts'
import { indexRepo } from '../../codemap/src/index.ts'
import { renderMarkdown, renderSourceHtml } from './render.ts'
import { appendFeedbackItem } from './io.ts'
import { startCodeView } from './server.ts'

const repoDir = resolve(import.meta.dirname, '..', '..', '..')
const indexTtlMs = 5_000

const main = async (): Promise<void> => {
  let cached: CodeIndex | undefined = undefined

  const index = async (): Promise<CodeIndex> => {
    const now = Date.now()
    if (cached === undefined || now - cached.generatedAt > indexTtlMs) {
      cached = await indexRepo(repoDir, now)
    }
    return cached
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
