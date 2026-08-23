// JSON-RPC 2.0 over newline-delimited JSON: the framing the Model Context
// Protocol uses on a stdio transport. Pure — text in, values out. Dispatch and
// the transport itself live in server.ts.
//
// Written by hand rather than taken from the reference SDK because the wire
// format is a dozen lines of JSON and the repo carries no runtime dependencies.

export type RequestId = string | number

// `id` is absent on notifications, which must never be answered.
export type RpcRequest = {
  readonly id: RequestId | undefined
  readonly method: string
  readonly params: Readonly<Record<string, unknown>>
}

export type RpcError = {
  readonly code: number
  readonly message: string
}

export type RpcResponse = {
  readonly jsonrpc: '2.0'
  readonly id: RequestId
  readonly result?: unknown
  readonly error?: RpcError
}

export type ParsedLine =
  | { readonly ok: true; readonly request: RpcRequest }
  | { readonly ok: false; readonly error: RpcError; readonly id: RequestId | undefined }

export const parseErrorCode = -32700
export const invalidRequestCode = -32600
export const methodNotFoundCode = -32601
export const invalidParamsCode = -32602
export const internalErrorCode = -32603

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readJson = (text: string): unknown => {
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    return undefined
  }
}

const readRequestId = (value: unknown): RequestId | undefined =>
  typeof value === 'string' || typeof value === 'number' ? value : undefined

// One line of stdin becomes a request or a reportable error. A malformed line
// carrying a usable id is answered on that id, so a client waiting on it is
// never left hanging.
export const parseLine = (line: string): ParsedLine => {
  const value = readJson(line)
  if (!isRecord(value))
    return { ok: false, error: { code: parseErrorCode, message: 'not JSON' }, id: undefined }
  const id = readRequestId(value['id'])
  if (typeof value['method'] !== 'string')
    return { ok: false, error: { code: invalidRequestCode, message: 'no method' }, id }
  const params = value['params']
  return { ok: true, request: { id, method: value['method'], params: isRecord(params) ? params : {} } }
}

export const resultOf = (id: RequestId, result: unknown): RpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
})

export const errorOf = (id: RequestId, code: number, message: string): RpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
})

export const encodeResponse = (response: RpcResponse): string => `${JSON.stringify(response)}\n`
