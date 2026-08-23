import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createInvocationTailState, pollInvocations } from '../src/invocations.ts'

const assistantLine = (tool: string, extraInput: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-22T10:00:00.000Z',
    sessionId: 's1',
    message: { model: 'm', content: [{ type: 'tool_use', name: tool, input: extraInput }] },
  })

describe('pollInvocations', () => {
  it('returns [] on the first poll of an empty directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dashboard-invocations-empty-'))
    try {
      const state = createInvocationTailState()
      const result = await pollInvocations([dir], state)
      expect(result.invocations).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('tails appended bytes incrementally, same as the transcripts tailer', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dashboard-invocations-tail-'))
    try {
      const file = join(dir, 'session.jsonl')
      await writeFile(file, assistantLine('Read', { file_path: 'foo.ts' }) + '\n')

      let state = createInvocationTailState()
      const first = await pollInvocations([dir], state)
      expect(first.invocations).toHaveLength(1)
      expect(first.invocations[0]?.tool).toBe('Read')
      state = first.state

      const second = await pollInvocations([dir], state)
      expect(second.invocations).toHaveLength(0)
      state = second.state

      await writeFile(file, assistantLine('Skill', { skill: 'caveman' }) + '\n', { flag: 'a' })
      const third = await pollInvocations([dir], state)
      expect(third.invocations).toHaveLength(1)
      expect(third.invocations[0]?.tool).toBe('Skill')
      expect(third.invocations[0]?.skill).toBe('caveman')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('resets its offset when the file shrinks (truncation)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dashboard-invocations-shrink-'))
    try {
      const file = join(dir, 'session.jsonl')
      await writeFile(file, assistantLine('Bash', { command: 'ls' }) + '\n')

      let state = createInvocationTailState()
      const first = await pollInvocations([dir], state)
      expect(first.invocations).toHaveLength(1)
      state = first.state

      await writeFile(file, assistantLine('Grep', { pattern: 'x' }) + '\n')
      const second = await pollInvocations([dir], state)
      expect(second.invocations).toHaveLength(1)
      expect(second.invocations[0]?.tool).toBe('Grep')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('drops files that vanish between polls', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dashboard-invocations-vanish-'))
    try {
      const file = join(dir, 'session.jsonl')
      await writeFile(file, assistantLine('Read', {}) + '\n')

      let state = createInvocationTailState()
      const first = await pollInvocations([dir], state)
      state = first.state

      await rm(file)
      const second = await pollInvocations([dir], state)
      expect(second.invocations).toEqual([])
      expect(second.state.files.size).toBe(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
