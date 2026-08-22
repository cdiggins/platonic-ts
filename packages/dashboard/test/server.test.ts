import { afterEach, describe, expect, it } from 'vitest'
import { startDashboard, type SnapshotProvider } from '../src/server.ts'
import type { DashboardSnapshot } from '../../core/src/index.ts'

const snapshot: DashboardSnapshot = {
  generatedAt: 1_700_000_000_000,
  agents: [
    {
      file: 'a.jsonl',
      sessionId: 's1',
      label: 'agent-a',
      isSidechain: false,
      lastActivityAt: 1_700_000_000_000,
      lastModel: 'claude-sonnet-5',
      lastTool: 'Read',
      lastSnippet: 'looked at a file',
      totalInputTokens: 1234,
      totalOutputTokens: 5678,
      active: true,
    },
  ],
  usage: {
    totalInputTokens: 1234,
    totalOutputTokens: 5678,
    totalCacheReadTokens: 100,
    totalCacheCreationTokens: 50,
    byModel: [
      {
        model: 'claude-sonnet-5',
        inputTokens: 1234,
        outputTokens: 5678,
        cacheReadTokens: 100,
        cacheCreationTokens: 50,
        messages: 12,
      },
    ],
    outputTokensPerMinute: 42,
    windowMs: 60_000,
  },
  backlog: [
    {
      id: 'BL-0001',
      title: 'Do the thing',
      type: 'feature',
      status: 'in-progress',
      priority: 'p1',
      effort: 'M',
      risk: 'low',
      area: 'core',
      sprint: undefined,
      owner: 'S',
      created: '2026-08-22',
      closed: undefined,
      links: [],
      file: 'backlog/BL-0001-do-the-thing.md',
      body: 'body text',
    },
  ],
  docs: [
    {
      file: 'NOTES.md',
      title: 'Notes',
      modifiedAt: 1_700_000_000_000,
      sizeBytes: 2048,
    },
  ],
}

const okProvider: SnapshotProvider = () => Promise.resolve(snapshot)

// `Response#json()` and `JSON.parse` are typed `any`; narrow to `unknown` immediately so
// assigning the parsed value never trips no-unsafe-assignment.
const readJson = async (res: Response): Promise<unknown> => (await res.json()) as unknown
const parseJson = (text: string): unknown => JSON.parse(text) as unknown

describe('startDashboard', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (close) {
      await close()
      close = undefined
    }
  })

  it('serves the HTML dashboard on GET /', async () => {
    const started = await startDashboard({ port: 0, provider: okProvider, pollIntervalMs: 50 })
    close = started.close

    const res = await fetch(`http://localhost:${started.port}/`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('platonic')
  })

  it('serves the snapshot as JSON on GET /api/state', async () => {
    const started = await startDashboard({ port: 0, provider: okProvider, pollIntervalMs: 50 })
    close = started.close

    const res = await fetch(`http://localhost:${started.port}/api/state`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await readJson(res)
    expect(body).toEqual(snapshot)
  })

  it('returns 500 from /api/state when the provider throws', async () => {
    const failingProvider: SnapshotProvider = () => Promise.reject(new Error('boom'))
    const started = await startDashboard({ port: 0, provider: failingProvider, pollIntervalMs: 50 })
    close = started.close

    const res = await fetch(`http://localhost:${started.port}/api/state`)
    expect(res.status).toBe(500)
  })

  it('streams snapshots over SSE on GET /api/events', async () => {
    const started = await startDashboard({ port: 0, provider: okProvider, pollIntervalMs: 30 })
    close = started.close

    const controller = new AbortController()
    const res = await fetch(`http://localhost:${started.port}/api/events`, {
      signal: controller.signal,
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    const reader = res.body?.getReader()
    expect(reader).toBeDefined()

    const decoder = new TextDecoder()
    let buffered = ''
    while (!buffered.includes('\n\n')) {
      const { value, done } = await reader!.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
    }
    controller.abort()

    const dataLine = buffered
      .split('\n')
      .find((line) => line.startsWith('data: '))
    expect(dataLine).toBeDefined()
    const parsed = parseJson(dataLine!.slice('data: '.length))
    expect(parsed).toEqual(snapshot)
  })

  it('returns 404 for unknown paths', async () => {
    const started = await startDashboard({ port: 0, provider: okProvider, pollIntervalMs: 50 })
    close = started.close

    const res = await fetch(`http://localhost:${started.port}/nope`)
    expect(res.status).toBe(404)
  })

  it('close() stops the server and frees the port', async () => {
    const started = await startDashboard({ port: 0, provider: okProvider, pollIntervalMs: 50 })
    await started.close()
    close = undefined

    await expect(fetch(`http://localhost:${started.port}/`)).rejects.toThrow()
  })
})
