// Composition of the tools onto the wire: one request in, one line of JSON out.
// Nothing here decides anything a pure module could decide; dispatch owns the
// tools and this owns the protocol.
import { callTool } from './dispatch.ts'
import type { CallOptions } from './options.ts'
import type { ToolOutput } from './query.ts'
import {
  encodeResponse,
  errorOf,
  internalErrorCode,
  invalidParamsCode,
  methodNotFoundCode,
  parseLine,
  resultOf,
  type RpcRequest,
  type RpcResponse,
} from './protocol.ts'
import { readText } from './schema.ts'
import { toolSpecs } from './tools.ts'

// Configuration for the JSON-RPC server.
export type ServerOptions = {
  readonly repoDir: string
  readonly baselinePath: string
  readonly write: (line: string) => void
  readonly log: (message: string) => void
}

const protocolVersion = '2025-06-18'

const serverInfo = { name: 'platonic', version: '0.0.1' }

// The clock is read here, at the edge, and handed to the tools as a value
// (PS-045): `checkpoint` needs a default label and nothing below this line may
// ask what time it is.
const callOptions = (options: ServerOptions): CallOptions => ({
  repoDir: options.repoDir,
  baselinePath: options.baselinePath,
  now: Date.now(),
})

const toolResult = (output: ToolOutput): unknown => ({
  content: [{ type: 'text', text: output.text }],
  isError: !output.ok,
})

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// A tool that throws reports the failure as tool output rather than as a
// protocol error, so the caller sees it as a result it can act on.
const guarded = async (
  options: ServerOptions,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<unknown> =>
  toolResult(
    await callTool(callOptions(options), name, args).catch((error: unknown) => ({
      ok: false,
      text: `${name} failed: ${errorText(error)}`,
    })),
  )

// Process an RPC request and return a response.
export const handleRequest = async (
  options: ServerOptions,
  request: RpcRequest,
): Promise<RpcResponse | undefined> => {
  const id = request.id
  if (id === undefined) return undefined
  switch (request.method) {
    case 'initialize':
      return resultOf(id, { protocolVersion, capabilities: { tools: {} }, serverInfo })
    case 'ping':
      return resultOf(id, {})
    case 'tools/list':
      return resultOf(id, { tools: toolSpecs })
    case 'tools/call': {
      const name = readText(request.params, 'name')
      const args = request.params['arguments']
      if (name === undefined) return errorOf(id, invalidParamsCode, 'no tool name')
      return resultOf(
        id,
        await guarded(options, name, typeof args === 'object' && args !== null ? { ...args } : {}),
      )
    }
    default:
      return errorOf(id, methodNotFoundCode, `unknown method: ${request.method}`)
  }
}

// Parse and handle one line of input, returning a response if applicable.
export const handleLine = async (
  options: ServerOptions,
  line: string,
): Promise<RpcResponse | undefined> => {
  const parsed = parseLine(line)
  if (!parsed.ok)
    return parsed.id === undefined
      ? undefined
      : errorOf(parsed.id, parsed.error.code, parsed.error.message)
  return handleRequest(options, parsed.request).catch((error: unknown) =>
    parsed.request.id === undefined
      ? undefined
      : errorOf(parsed.request.id, internalErrorCode, errorText(error)),
  )
}

// Requests are answered in arrival order rather than concurrently: two edit
// plans computed against the same workspace and applied in either order is the
// one failure mode this server must not have.
export const serve = (options: ServerOptions, input: NodeJS.ReadableStream): void => {
  let remainder = ''
  let pending: Promise<void> = Promise.resolve()
  input.setEncoding('utf8')
  input.on('data', (chunk: string) => {
    const parts = (remainder + chunk).split('\n')
    remainder = parts[parts.length - 1] ?? ''
    for (const line of parts.slice(0, -1).filter((part) => part.trim().length > 0)) {
      pending = pending.then(async () => {
        const response = await handleLine(options, line)
        if (response !== undefined) options.write(encodeResponse(response))
      })
    }
  })
  options.log(`platonic mcp: ${toolSpecs.length} tools over ${options.repoDir}`)
}
