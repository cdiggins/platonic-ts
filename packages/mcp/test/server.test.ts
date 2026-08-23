import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { handleLine } from '../src/server.ts'
import { toolSpecs } from '../src/tools.ts'

const repoDir = resolve(import.meta.dirname, '..', '..', '..')

const options = {
  repoDir,
  baselinePath: resolve(repoDir, 'ratchet.json'),
  write: () => undefined,
  log: () => undefined,
}

const call = (message: unknown): Promise<unknown> =>
  handleLine(options, JSON.stringify(message)).then((response) => response?.result)

describe('handleLine', () => {
  it('answers initialize with a protocol version and the tools capability', async () => {
    const result = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    expect(result).toEqual({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'platonic', version: '0.0.1' },
    })
  })

  it('lists every tool with a schema', async () => {
    const result = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(result).toEqual({ tools: toolSpecs })
    expect(toolSpecs.every((spec) => spec.inputSchema.type === 'object')).toBe(true)
    expect(toolSpecs.every((spec) => spec.description.length > 20)).toBe(true)
  })

  it('says nothing to a notification', async () => {
    expect(await handleLine(options, '{"method":"notifications/initialized"}')).toBe(undefined)
  })

  it('reports an unknown method as an error on the same id', async () => {
    const response = await handleLine(options, '{"id":3,"method":"resources/list"}')
    expect(response?.error?.code).toBe(-32601)
    expect(response?.id).toBe(3)
  })

  it('ignores a line that is not JSON', async () => {
    expect(await handleLine(options, 'garbage')).toBe(undefined)
  })

  it('reports an unknown tool as tool output rather than a protocol error', async () => {
    const response = await handleLine(
      options,
      JSON.stringify({ id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } }),
    )
    expect(response?.error).toBe(undefined)
    expect(JSON.stringify(response?.result)).toContain('unknown tool')
  })
}, 60_000)
