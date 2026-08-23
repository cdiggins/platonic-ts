// HTTP server for the code browser. node:http only, zero runtime deps.
// Depends on core types plus injected providers — no filesystem access here.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type {
  CodeIndex,
  FeedbackInput,
  FeedbackResult,
  FileView,
  SymbolReference,
} from '../../core/src/index.ts'
import { renderPage } from './ui.ts'

// Function that returns the code index.
export type IndexProvider = () => Promise<CodeIndex>
// Function that returns the view (source and metadata) for a file, or undefined if not found.
export type FileViewProvider = (file: string) => Promise<FileView | undefined>
// Function that returns all references to a symbol.
export type ReferenceProvider = (symbolId: string) => Promise<readonly SymbolReference[]>
// Function that accepts feedback and persists it, returning the result.
export type FeedbackSink = (input: FeedbackInput) => Promise<FeedbackResult>

// Configuration for the code view server.
export type CodeViewOptions = {
  readonly port: number
  readonly index: IndexProvider
  readonly fileView: FileViewProvider
  readonly references: ReferenceProvider
  readonly feedback: FeedbackSink
}

// A feedback note is prose typed into a textarea; anything past this is not feedback.
const maxFeedbackBytes = 64 * 1024

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

// Every failure leaves the wire as JSON so the page never has to sniff the body type.
const sendError = (response: ServerResponse, status: number, error: string): void =>
  sendJson(response, status, { error })

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// `path` and `symbol` arrive from the browser. This server never touches the filesystem —
// the injected provider does the lookup — but a traversal-shaped value is never a legitimate
// repo-relative key, so it is rejected here rather than trusted to whatever the provider does
// with it. Repo-relative keys are forward-slash, root-relative, drive-letter-free by contract
// (see the CodeIndex comment in packages/core), so this check rejects nothing valid.
const isSafeRepoPath = (path: string): boolean =>
  path.length > 0 &&
  !path.startsWith('/') &&
  !path.includes('\\') &&
  !/^[A-Za-z]:/.test(path) &&
  !path.split('/').includes('..')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const parseJson = (text: string): unknown => {
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    return undefined
  }
}

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const parseFeedback = (text: string): FeedbackInput | undefined => {
  const value = parseJson(text)
  if (!isRecord(value)) return undefined
  const feedbackText = value['text']
  if (typeof feedbackText !== 'string' || feedbackText.trim() === '') return undefined
  return {
    text: feedbackText,
    file: optionalString(value['file']),
    symbol: optionalString(value['symbol']),
  }
}

type BodyRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: 'too-large' | 'aborted' }

// Oversized bodies are drained rather than destroyed: destroying the socket mid-request loses
// the 413 response, and this server only ever listens on localhost.
const readBody = (request: IncomingMessage, limitBytes: number): Promise<BodyRead> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let overflow = false
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limitBytes) overflow = true
      else chunks.push(chunk)
    })
    request.on('end', () =>
      resolve(
        overflow
          ? { ok: false, reason: 'too-large' }
          : { ok: true, text: Buffer.concat(chunks).toString('utf8') },
      ),
    )
    request.on('error', () => resolve({ ok: false, reason: 'aborted' }))
  })

const handleIndex = async (response: ServerResponse, index: IndexProvider): Promise<void> => {
  try {
    sendJson(response, 200, await index())
  } catch (error) {
    sendError(response, 500, errorMessage(error))
  }
}

const handleFile = async (
  response: ServerResponse,
  url: URL,
  fileView: FileViewProvider,
): Promise<void> => {
  const path = url.searchParams.get('path')
  if (path === null || path === '') {
    sendError(response, 400, 'missing path parameter')
    return
  }
  if (!isSafeRepoPath(path)) {
    sendError(response, 400, 'path must be repo-relative')
    return
  }
  try {
    const view = await fileView(path)
    if (view === undefined) sendError(response, 404, 'unknown file')
    else sendJson(response, 200, view)
  } catch (error) {
    sendError(response, 500, errorMessage(error))
  }
}

const handleReferences = async (
  response: ServerResponse,
  url: URL,
  references: ReferenceProvider,
): Promise<void> => {
  const symbol = url.searchParams.get('symbol')
  if (symbol === null || symbol === '') {
    sendError(response, 400, 'missing symbol parameter')
    return
  }
  try {
    sendJson(response, 200, await references(symbol))
  } catch (error) {
    sendError(response, 500, errorMessage(error))
  }
}

const handleFeedback = async (
  request: IncomingMessage,
  response: ServerResponse,
  feedback: FeedbackSink,
): Promise<void> => {
  const declaredLength = Number(request.headers['content-length'] ?? '0')
  if (declaredLength > maxFeedbackBytes) {
    sendError(response, 413, 'feedback too large')
    return
  }
  const body = await readBody(request, maxFeedbackBytes)
  if (!body.ok) {
    if (body.reason === 'too-large') sendError(response, 413, 'feedback too large')
    else sendError(response, 400, 'could not read request body')
    return
  }
  const input = parseFeedback(body.text)
  if (input === undefined) {
    sendError(response, 400, 'body must be JSON with a non-empty text field')
    return
  }
  try {
    sendJson(response, 200, await feedback(input))
  } catch (error) {
    sendError(response, 500, errorMessage(error))
  }
}

export const startCodeView = (
  options: CodeViewOptions,
): Promise<{ readonly port: number; readonly close: () => Promise<void> }> => {
  const server = createServer((request, response) => {
    const method = request.method ?? 'GET'
    const url = new URL(request.url ?? '/', 'http://localhost')

    if (url.pathname === '/api/feedback') {
      if (method === 'POST') void handleFeedback(request, response, options.feedback)
      else sendError(response, 404, 'not found')
      return
    }

    if (method !== 'GET') {
      sendError(response, 404, 'not found')
      return
    }

    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(renderPage())
      return
    }

    if (url.pathname === '/api/index') {
      void handleIndex(response, options.index)
      return
    }

    if (url.pathname === '/api/file') {
      void handleFile(response, url, options.fileView)
      return
    }

    if (url.pathname === '/api/references') {
      void handleReferences(response, url, options.references)
      return
    }

    sendError(response, 404, 'not found')
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, () => {
      const address = server.address()
      const actualPort =
        address !== null && typeof address === 'object' ? address.port : options.port

      const close = (): Promise<void> =>
        new Promise<void>((resolveClose, rejectClose) => {
          // Keep-alive sockets from fetch() would otherwise hold the port open past close().
          server.closeAllConnections()
          server.close((error) => {
            if (error) rejectClose(error)
            else resolveClose()
          })
        })

      resolve({ port: actualPort, close })
    })
  })
}
