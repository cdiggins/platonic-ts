import { describe, it, expect } from 'vitest'
import { encodeResponse, errorOf, parseLine, resultOf } from '../src/protocol.ts'

describe('parseLine', () => {
  it('reads a request with params', () => {
    const parsed = parseLine('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"outline"}}')
    expect(parsed.ok && parsed.request).toEqual({
      id: 1,
      method: 'tools/call',
      params: { name: 'outline' },
    })
  })

  it('reads a notification as a request with no id', () => {
    const parsed = parseLine('{"jsonrpc":"2.0","method":"notifications/initialized"}')
    expect(parsed.ok && parsed.request.id).toBe(undefined)
  })

  it('defaults missing params to an empty record', () => {
    const parsed = parseLine('{"id":"a","method":"ping"}')
    expect(parsed.ok && parsed.request.params).toEqual({})
  })

  it('reports unparseable text without an id', () => {
    const parsed = parseLine('not json')
    expect(parsed.ok).toBe(false)
    expect(!parsed.ok && parsed.id).toBe(undefined)
  })

  it('answers a methodless request on the id it carried', () => {
    const parsed = parseLine('{"id":7}')
    expect(!parsed.ok && parsed.id).toBe(7)
  })
})

describe('encodeResponse', () => {
  it('ends every message with a newline', () => {
    expect(encodeResponse(resultOf(1, { ok: true }))).toBe('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n')
  })

  it('carries code and message on an error', () => {
    expect(errorOf('a', -32601, 'nope').error).toEqual({ code: -32601, message: 'nope' })
  })
})
