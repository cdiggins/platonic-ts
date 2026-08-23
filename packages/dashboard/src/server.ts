// HTTP + SSE dashboard server. node:http only, zero runtime deps.
// Depends only on core types + an injected provider — no filesystem access here.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AgentActivity, DashboardSnapshot } from '../../core/src/index.ts'
import { summarizeUsage } from '../../transcripts/src/index.ts'
import { renderPage } from './ui.ts'
import { parseUsageRange, sliceActivitiesByRange } from './range.ts'

export type SnapshotProvider = () => Promise<DashboardSnapshot>

// Optional: raw activities behind the snapshot's usage totals, so the server can
// re-summarize over a selected range (BL-0008) without packages/core changes.
// When omitted, the `range` query param is accepted but has no effect — the
// snapshot's own all-time usage passes through unchanged.
export type ActivitiesProvider = () => Promise<readonly AgentActivity[]>

// Re-summarizes `snapshot.usage` over the activities that fall in `range`, keeping
// `outputTokensPerMinute` (a live rate, not a historical total) from the original
// snapshot regardless of range.
const applyUsageRange = (
  snapshot: DashboardSnapshot,
  activities: readonly AgentActivity[],
  range: ReturnType<typeof parseUsageRange>,
): DashboardSnapshot => {
  const sliced = sliceActivitiesByRange(activities, range, snapshot.generatedAt)
  const ranged = summarizeUsage(sliced, snapshot.generatedAt, snapshot.usage.windowMs)
  return {
    ...snapshot,
    usage: { ...ranged, outputTokensPerMinute: snapshot.usage.outputTokensPerMinute },
  }
}

const resolveSnapshot = async (
  provider: SnapshotProvider,
  activitiesProvider: ActivitiesProvider | undefined,
  rangeParam: string | undefined,
): Promise<DashboardSnapshot> => {
  const snapshot = await provider()
  if (!activitiesProvider) return snapshot
  const activities = await activitiesProvider()
  return applyUsageRange(snapshot, activities, parseUsageRange(rangeParam))
}

type SseClient = {
  readonly res: ServerResponse
  readonly interval: ReturnType<typeof setInterval>
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const handleState = async (
  res: ServerResponse,
  provider: SnapshotProvider,
  activitiesProvider: ActivitiesProvider | undefined,
  rangeParam: string | undefined,
): Promise<void> => {
  try {
    const snapshot = await resolveSnapshot(provider, activitiesProvider, rangeParam)
    sendJson(res, 200, snapshot)
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

const handleEvents = (
  res: ServerResponse,
  req: IncomingMessage,
  provider: SnapshotProvider,
  activitiesProvider: ActivitiesProvider | undefined,
  rangeParam: string | undefined,
  pollIntervalMs: number,
  clients: Set<SseClient>,
): void => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  // `range` is read once from the connection's initial query string, matching the
  // dropdown value the client connected with. A range change reconnects with a new
  // query string (see ui.ts) rather than pushing range over an open stream.
  const tick = async (): Promise<void> => {
    try {
      const snapshot = await resolveSnapshot(provider, activitiesProvider, rangeParam)
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`)
    } catch {
      // provider error: skip this tick, keep connection alive
    }
  }

  void tick()
  const interval = setInterval(() => {
    void tick()
  }, pollIntervalMs)
  const client: SseClient = { res, interval }
  clients.add(client)

  const cleanup = (): void => {
    clearInterval(interval)
    clients.delete(client)
  }
  req.on('close', cleanup)
  res.on('close', cleanup)
}

export const startDashboard = (options: {
  readonly port: number
  readonly provider: SnapshotProvider
  readonly pollIntervalMs: number
  // Optional: enables range-scoped usage (BL-0008) via a `?range=` query param on
  // /api/state and /api/events. Omit to keep pre-existing all-time-only behavior.
  readonly activitiesProvider?: ActivitiesProvider
}): Promise<{ readonly port: number; readonly close: () => Promise<void> }> => {
  const { provider, pollIntervalMs, activitiesProvider } = options
  const sseClients = new Set<SseClient>()

  const server = createServer((req, res) => {
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname

    if (method !== 'GET') {
      res.writeHead(404).end()
      return
    }

    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(renderPage())
      return
    }

    if (pathname === '/api/state') {
      void handleState(res, provider, activitiesProvider, url.searchParams.get('range') ?? undefined)
      return
    }

    if (pathname === '/api/events') {
      handleEvents(
        res,
        req,
        provider,
        activitiesProvider,
        url.searchParams.get('range') ?? undefined,
        pollIntervalMs,
        sseClients,
      )
      return
    }

    res.writeHead(404).end()
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, () => {
      const address = server.address()
      const actualPort = address !== null && typeof address === 'object' ? address.port : options.port

      const close = (): Promise<void> =>
        new Promise<void>((resolveClose, rejectClose) => {
          for (const client of sseClients) {
            clearInterval(client.interval)
            client.res.end()
          }
          sseClients.clear()
          server.close((err) => {
            if (err) rejectClose(err)
            else resolveClose()
          })
        })

      resolve({ port: actualPort, close })
    })
  })
}
