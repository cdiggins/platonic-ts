import { afterEach, describe, expect, it } from 'vitest'
import {
  startDashboard,
  type ActivitiesProvider,
  type CommitsProvider,
  type InvocationsProvider,
  type SnapshotProvider,
} from '../src/server.ts'
import type { AgentActivity, DashboardSnapshot } from '../../core/src/index.ts'
import type { ToolInvocation } from '../../transcripts/src/index.ts'
import type { CommitRow } from '../src/commits.ts'

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
      approach: 'undecided',
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

// Guard-based drill into a snapshot body's usage field, so range assertions need no cast.
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const usageField = (body: unknown, key: string): unknown =>
  isRecord(body) && isRecord(body['usage']) ? body['usage'][key] : undefined

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

  it('leaves usage untouched when no activitiesProvider is supplied, even with ?range=', async () => {
    const started = await startDashboard({ port: 0, provider: okProvider, pollIntervalMs: 50 })
    close = started.close

    const res = await fetch(`http://localhost:${started.port}/api/state?range=last-hour`)
    const body = await readJson(res)
    expect(body).toEqual(snapshot)
  })

  it('re-summarizes usage over the selected range when activitiesProvider is supplied', async () => {
    const now = snapshot.generatedAt
    const activities: readonly AgentActivity[] = [
      {
        file: 'a.jsonl',
        sessionId: 's1',
        timestamp: now - 2 * 60 * 60_000, // 2h ago: outside last-hour
        kind: 'assistant',
        model: 'claude-sonnet-5',
        toolName: undefined,
        inputTokens: 900,
        outputTokens: 900,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        snippet: undefined,
        isSidechain: false,
      },
      {
        file: 'a.jsonl',
        sessionId: 's1',
        timestamp: now - 30_000, // 30s ago: inside last-hour
        kind: 'assistant',
        model: 'claude-sonnet-5',
        toolName: undefined,
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 1,
        cacheCreationTokens: 2,
        snippet: undefined,
        isSidechain: false,
      },
    ]
    const activitiesProvider: ActivitiesProvider = () => Promise.resolve(activities)
    const started = await startDashboard({
      port: 0,
      provider: okProvider,
      pollIntervalMs: 50,
      activitiesProvider,
    })
    close = started.close

    const resAll = await fetch(`http://localhost:${started.port}/api/state?range=all`)
    const bodyAll = await readJson(resAll)
    expect(usageField(bodyAll, 'totalInputTokens')).toBe(910)
    expect(usageField(bodyAll, 'outputTokensPerMinute')).toBe(snapshot.usage.outputTokensPerMinute)

    const resHour = await fetch(`http://localhost:${started.port}/api/state?range=last-hour`)
    const bodyHour = await readJson(resHour)
    expect(usageField(bodyHour, 'totalInputTokens')).toBe(10)
    expect(usageField(bodyHour, 'totalOutputTokens')).toBe(20)

    // Unknown/missing range falls back to the default rather than erroring.
    const resDefault = await fetch(`http://localhost:${started.port}/api/state`)
    expect(resDefault.status).toBe(200)
  })

  it('returns 404 for /api/invocations when no invocationsProvider is supplied', async () => {
    const started = await startDashboard({ port: 0, provider: okProvider, pollIntervalMs: 50 })
    close = started.close

    const res = await fetch(`http://localhost:${started.port}/api/invocations`)
    expect(res.status).toBe(404)
  })

  it('serves recent invocations as JSON on GET /api/invocations', async () => {
    const invocations: readonly ToolInvocation[] = [
      { file: 'a.jsonl', sessionId: 's1', timestamp: '2026-08-22T10:00:00.000Z', tool: 'Skill', skill: 'caveman', detail: undefined },
      { file: 'a.jsonl', sessionId: 's1', timestamp: '2026-08-22T09:59:00.000Z', tool: 'Read', skill: undefined, detail: 'foo.ts' },
    ]
    const invocationsProvider: InvocationsProvider = () => Promise.resolve(invocations)
    const started = await startDashboard({ port: 0, provider: okProvider, pollIntervalMs: 50, invocationsProvider })
    close = started.close

    const res = await fetch(`http://localhost:${started.port}/api/invocations`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await readJson(res)
    expect(body).toEqual(invocations)
  })

  it('returns 500 from /api/invocations when the provider throws', async () => {
    const failing: InvocationsProvider = () => Promise.reject(new Error('boom'))
    const started = await startDashboard({ port: 0, provider: okProvider, pollIntervalMs: 50, invocationsProvider: failing })
    close = started.close

    const res = await fetch(`http://localhost:${started.port}/api/invocations`)
    expect(res.status).toBe(500)
  })

  it('returns 404 for /api/commits when no commitsProvider is supplied', async () => {
    const started = await startDashboard({ port: 0, provider: okProvider, pollIntervalMs: 50 })
    close = started.close

    const res = await fetch(`http://localhost:${started.port}/api/commits`)
    expect(res.status).toBe(404)
  })

  it('serves commit rows as JSON on GET /api/commits', async () => {
    const rows: readonly CommitRow[] = [
      { hash: 'abc123', shortHash: 'abc123', subject: 'do a thing', timestamp: '2026-08-22T10:00:00.000Z', sessionLabel: 's1', confidence: 'trailer' },
    ]
    const commitsProvider: CommitsProvider = () => Promise.resolve(rows)
    const started = await startDashboard({ port: 0, provider: okProvider, pollIntervalMs: 50, commitsProvider })
    close = started.close

    const res = await fetch(`http://localhost:${started.port}/api/commits`)
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(body).toEqual(rows)
  })

  it('returns 500 from /api/commits when the provider throws', async () => {
    const failing: CommitsProvider = () => Promise.reject(new Error('boom'))
    const started = await startDashboard({ port: 0, provider: okProvider, pollIntervalMs: 50, commitsProvider: failing })
    close = started.close

    const res = await fetch(`http://localhost:${started.port}/api/commits`)
    expect(res.status).toBe(500)
  })

  it('close() stops the server and frees the port', async () => {
    const started = await startDashboard({ port: 0, provider: okProvider, pollIntervalMs: 50 })
    await started.close()
    close = undefined

    await expect(fetch(`http://localhost:${started.port}/`)).rejects.toThrow()
  })
})
