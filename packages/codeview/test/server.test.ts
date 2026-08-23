import { afterEach, describe, expect, it } from 'vitest'
import { startCodeView, type CodeViewOptions } from '../src/server.ts'
import type {
  CodeIndex,
  CodeMetrics,
  FeedbackInput,
  FeedbackResult,
  FileView,
  SymbolInfo,
  SymbolReference,
} from '../../core/src/index.ts'

const metrics: CodeMetrics = {
  lines: 10,
  statements: 4,
  maxNestingDepth: 1,
  parameters: 2,
  mutableBindings: 0,
  classes: 0,
  throwStatements: 0,
  explicitAny: 0,
  asCasts: 0,
  nonNullAssertions: 0,
  tsDirectives: 0,
  eslintDisables: 0,
  exportedSymbols: 1,
  imports: 1,
  platonicScore: 97,
}

const symbol: SymbolInfo = {
  id: 'packages/core/src/index.ts#42',
  name: 'truncate',
  kind: 'function',
  file: 'packages/core/src/index.ts',
  span: { start: 42, length: 8 },
  line: 3,
  exported: true,
  containerName: undefined,
  signature: '(text: string, max: number) => string',
}

const reference: SymbolReference = {
  symbolId: symbol.id,
  file: 'packages/core/src/index.ts',
  span: { start: 42, length: 8 },
  line: 3,
  isDefinition: true,
}

const index: CodeIndex = {
  generatedAt: 1_700_000_000_000,
  root: '/repo',
  files: [
    {
      file: 'packages/core/src/index.ts',
      kind: 'typescript',
      sizeBytes: 128,
      metrics,
      functions: [{ symbolId: symbol.id, name: 'truncate', line: 3, metrics }],
    },
  ],
  folders: [{ path: 'packages/core/src', fileCount: 1, metrics }],
  symbols: [symbol],
  references: [reference],
}

const fileView: FileView = {
  file: 'packages/core/src/index.ts',
  kind: 'typescript',
  html: '<pre>source</pre>',
  metrics,
  functions: [{ symbolId: symbol.id, name: 'truncate', line: 3, metrics }],
  symbols: [symbol],
}

const filed: FeedbackResult = { id: 'BL-0099', file: 'backlog/BL-0099-note.md' }

// `Response#json()` is typed `any`; narrow to `unknown` immediately so assigning the parsed
// value never trips no-unsafe-assignment.
const readJson = async (response: Response): Promise<unknown> => {
  const value: unknown = await response.json()
  return value
}

const baseOptions: Omit<CodeViewOptions, 'port'> = {
  index: () => Promise.resolve(index),
  fileView: (file) => Promise.resolve(file === fileView.file ? fileView : undefined),
  references: (symbolId) =>
    Promise.resolve(index.references.filter((r) => r.symbolId === symbolId)),
  feedback: () => Promise.resolve(filed),
}

const failing = (): Promise<never> => Promise.reject(new Error('boom'))

describe('startCodeView', () => {
  let close: (() => Promise<void>) | undefined

  const start = async (overrides: Partial<CodeViewOptions> = {}): Promise<string> => {
    const started = await startCodeView({ port: 0, ...baseOptions, ...overrides })
    close = started.close
    return `http://localhost:${started.port}`
  }

  afterEach(async () => {
    if (close) {
      await close()
      close = undefined
    }
  })

  it('serves the browser page on GET /', async () => {
    const base = await start()
    const response = await fetch(`${base}/`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toContain('<')
  })

  it('serves the code index as JSON on GET /api/index', async () => {
    const base = await start()
    const response = await fetch(`${base}/api/index`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await readJson(response)).toEqual(index)
  })

  it('serves a file view on GET /api/file', async () => {
    const base = await start()
    const response = await fetch(
      `${base}/api/file?path=${encodeURIComponent('packages/core/src/index.ts')}`,
    )
    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual(fileView)
  })

  it('404s with a JSON error when the file is unknown', async () => {
    const base = await start()
    const response = await fetch(`${base}/api/file?path=packages/nope.ts`)
    expect(response.status).toBe(404)
    expect(await readJson(response)).toEqual({ error: 'unknown file' })
  })

  it('400s when the path parameter is missing', async () => {
    const base = await start()
    const response = await fetch(`${base}/api/file`)
    expect(response.status).toBe(400)
  })

  it.each([
    '../secrets.txt',
    'packages/../../etc/passwd',
    '/etc/passwd',
    'C:/Windows/win.ini',
    'packages\\core\\src\\index.ts',
  ])('400s on the traversal-shaped path %s', async (path) => {
    const base = await start()
    const response = await fetch(`${base}/api/file?path=${encodeURIComponent(path)}`)
    expect(response.status).toBe(400)
    expect(await readJson(response)).toEqual({ error: 'path must be repo-relative' })
  })

  it('serves references on GET /api/references', async () => {
    const base = await start()
    const response = await fetch(
      `${base}/api/references?symbol=${encodeURIComponent(symbol.id)}`,
    )
    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual([reference])
  })

  it('400s when the symbol parameter is missing', async () => {
    const base = await start()
    const response = await fetch(`${base}/api/references`)
    expect(response.status).toBe(400)
  })

  it('files feedback on POST /api/feedback', async () => {
    const seen: FeedbackInput[] = []
    const base = await start({
      feedback: (input) => {
        seen.push(input)
        return Promise.resolve(filed)
      },
    })
    const response = await fetch(`${base}/api/feedback`, {
      method: 'POST',
      body: JSON.stringify({ text: 'this file is too long', file: 'a.ts', symbol: 'a.ts#1' }),
    })
    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual(filed)
    expect(seen).toEqual([{ text: 'this file is too long', file: 'a.ts', symbol: 'a.ts#1' }])
  })

  it('leaves file and symbol undefined when the body omits them', async () => {
    const seen: FeedbackInput[] = []
    const base = await start({
      feedback: (input) => {
        seen.push(input)
        return Promise.resolve(filed)
      },
    })
    await fetch(`${base}/api/feedback`, { method: 'POST', body: JSON.stringify({ text: 'hi' }) })
    expect(seen).toEqual([{ text: 'hi', file: undefined, symbol: undefined }])
  })

  it.each(['not json at all', '{"text":""}', '{"text":"   "}', '{"nope":1}', '[]'])(
    '400s on the malformed feedback body %s',
    async (body) => {
      const base = await start()
      const response = await fetch(`${base}/api/feedback`, { method: 'POST', body })
      expect(response.status).toBe(400)
      const parsed = await readJson(response)
      expect(parsed).toHaveProperty('error')
    },
  )

  it('413s on a feedback body over 64 KB', async () => {
    const base = await start()
    const response = await fetch(`${base}/api/feedback`, {
      method: 'POST',
      body: JSON.stringify({ text: 'x'.repeat(70_000) }),
    })
    expect(response.status).toBe(413)
  })

  it.each([
    ['/api/index', { index: failing }],
    ['/api/file?path=packages/core/src/index.ts', { fileView: failing }],
    ['/api/references?symbol=x', { references: failing }],
  ])('500s with a JSON error when the provider for %s rejects', async (path, overrides) => {
    const base = await start(overrides)
    const response = await fetch(`${base}${path}`)
    expect(response.status).toBe(500)
    expect(await readJson(response)).toEqual({ error: 'boom' })
  })

  it('500s and survives when the feedback sink rejects', async () => {
    const base = await start({ feedback: failing })
    const response = await fetch(`${base}/api/feedback`, {
      method: 'POST',
      body: JSON.stringify({ text: 'hello' }),
    })
    expect(response.status).toBe(500)
    // The server is still up afterwards.
    expect((await fetch(`${base}/api/index`)).status).toBe(200)
  })

  it('404s unknown paths and non-GET methods', async () => {
    const base = await start()
    expect((await fetch(`${base}/nope`)).status).toBe(404)
    expect((await fetch(`${base}/api/index`, { method: 'DELETE' })).status).toBe(404)
    expect((await fetch(`${base}/api/feedback`)).status).toBe(404)
  })

  it('close() stops the server and frees the port', async () => {
    const started = await startCodeView({ port: 0, ...baseOptions })
    await started.close()
    close = undefined
    await expect(fetch(`http://localhost:${started.port}/`)).rejects.toThrow()
  })
})
