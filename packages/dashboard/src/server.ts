// HTTP + SSE dashboard server. node:http only, zero runtime deps.
// Depends only on core types + an injected provider — no filesystem access here.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { DashboardSnapshot } from '../../core/src/index.ts'
import { renderPage } from './ui.ts'

export type SnapshotProvider = () => Promise<DashboardSnapshot>

type SseClient = {
  readonly res: ServerResponse
  readonly interval: ReturnType<typeof setInterval>
}

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const handleState = async (res: ServerResponse, provider: SnapshotProvider): Promise<void> => {
  try {
    const snapshot = await provider()
    sendJson(res, 200, snapshot)
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
}

const handleEvents = (
  res: ServerResponse,
  req: IncomingMessage,
  provider: SnapshotProvider,
  pollIntervalMs: number,
  clients: Set<SseClient>,
): void => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const tick = async (): Promise<void> => {
    try {
      const snapshot = await provider()
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
}): Promise<{ readonly port: number; readonly close: () => Promise<void> }> => {
  const { provider, pollIntervalMs } = options
  const sseClients = new Set<SseClient>()

  const server = createServer((req, res) => {
    const method = req.method ?? 'GET'
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

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
      void handleState(res, provider)
      return
    }

    if (pathname === '/api/events') {
      handleEvents(res, req, provider, pollIntervalMs, sseClients)
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
