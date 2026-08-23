import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  createHookTailState,
  formatHookEvent,
  pollHookEvents,
  type HookEvent,
} from '../src/index.ts'

describe('pollHookEvents', () => {
  it('returns empty events for a missing file', async () => {
    const state = createHookTailState()
    const nonexistent = '/nonexistent/file/path/events.jsonl'
    const result = await pollHookEvents(nonexistent, state)

    expect(result.events).toHaveLength(0)
    expect(result.state.files.has(nonexistent)).toBe(false)
  })

  it('reads all events from a new file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'platonic-tail-'))
    try {
      const file = join(dir, 'events.jsonl')

      const event1: HookEvent = {
        type: 'session-start',
        timestamp: '2026-08-22T10:00:00.000Z',
        sessionId: 'sess-1',
      }
      const event2: HookEvent = {
        type: 'tool',
        timestamp: '2026-08-22T10:00:01.000Z',
        sessionId: 'sess-1',
        tool: 'Read',
        cwd: '/repo',
      }

      await writeFile(file, `${formatHookEvent(event1)}\n${formatHookEvent(event2)}\n`)

      const state = createHookTailState()
      const result = await pollHookEvents(file, state)

      expect(result.events).toHaveLength(2)
      expect(result.events[0]).toEqual(event1)
      expect(result.events[1]).toEqual(event2)
      const fileState = result.state.files.get(file)
      expect(fileState).toBeDefined()
      expect(typeof fileState?.offset).toBe('number')
      expect(fileState?.remainder).toBe('')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns only appended events on subsequent polls', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'platonic-tail-'))
    try {
      const file = join(dir, 'events.jsonl')

      const event1: HookEvent = {
        type: 'session-start',
        timestamp: '2026-08-22T10:00:00.000Z',
        sessionId: 'sess-1',
      }
      const event2: HookEvent = {
        type: 'tool',
        timestamp: '2026-08-22T10:00:01.000Z',
        sessionId: 'sess-1',
        tool: 'Read',
      }
      const event3: HookEvent = {
        type: 'tool',
        timestamp: '2026-08-22T10:00:02.000Z',
        sessionId: 'sess-1',
        tool: 'Write',
      }

      await writeFile(file, `${formatHookEvent(event1)}\n${formatHookEvent(event2)}\n`)

      const state1 = createHookTailState()
      const result1 = await pollHookEvents(file, state1)
      expect(result1.events).toHaveLength(2)

      // Append a new event
      await appendFile(file, `${formatHookEvent(event3)}\n`)

      const result2 = await pollHookEvents(file, result1.state)
      expect(result2.events).toHaveLength(1)
      expect(result2.events[0]).toEqual(event3)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('holds an incomplete final line until the next poll', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'platonic-tail-'))
    try {
      const file = join(dir, 'events.jsonl')

      const event1: HookEvent = {
        type: 'session-start',
        timestamp: '2026-08-22T10:00:00.000Z',
        sessionId: 'sess-1',
      }

      // Write event1 and an incomplete second line (no newline at end)
      const incompleteEvent = JSON.stringify({
        type: 'tool',
        timestamp: '2026-08-22T10:00:01.000Z',
        sessionId: 'sess-1',
        tool: 'Read',
      })
      await writeFile(file, `${formatHookEvent(event1)}\n${incompleteEvent}`)

      const state1 = createHookTailState()
      const result1 = await pollHookEvents(file, state1)

      // Should only parse event1; the incomplete line is held in remainder
      expect(result1.events).toHaveLength(1)
      expect(result1.events[0]).toEqual(event1)

      // Complete the line with a newline and add a third event
      const event3: HookEvent = {
        type: 'tool',
        timestamp: '2026-08-22T10:00:02.000Z',
        sessionId: 'sess-1',
        tool: 'Write',
      }
      await appendFile(file, `\n${formatHookEvent(event3)}\n`)

      const result2 = await pollHookEvents(file, result1.state)

      // Should now parse the completed event2 and event3
      expect(result2.events).toHaveLength(2)
      expect(result2.events[0]?.type).toBe('tool')
      expect(result2.events[0]?.tool).toBe('Read')
      expect(result2.events[1]).toEqual(event3)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('skips malformed lines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'platonic-tail-'))
    try {
      const file = join(dir, 'events.jsonl')

      const event1: HookEvent = {
        type: 'session-start',
        timestamp: '2026-08-22T10:00:00.000Z',
        sessionId: 'sess-1',
      }
      const event2: HookEvent = {
        type: 'tool',
        timestamp: '2026-08-22T10:00:01.000Z',
        sessionId: 'sess-1',
        tool: 'Read',
      }

      // Write valid event, invalid line, valid event
      await writeFile(
        file,
        `${formatHookEvent(event1)}\nnot valid json\n${formatHookEvent(event2)}\n`,
      )

      const state = createHookTailState()
      const result = await pollHookEvents(file, state)

      // Should parse both valid events and skip the malformed line
      expect(result.events).toHaveLength(2)
      expect(result.events[0]).toEqual(event1)
      expect(result.events[1]).toEqual(event2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('resets offset to 0 when file is truncated', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'platonic-tail-'))
    try {
      const file = join(dir, 'events.jsonl')

      const event1: HookEvent = {
        type: 'session-start',
        timestamp: '2026-08-22T10:00:00.000Z',
        sessionId: 'sess-1',
      }
      const event2: HookEvent = {
        type: 'tool',
        timestamp: '2026-08-22T10:00:01.000Z',
        sessionId: 'sess-1',
        tool: 'Read',
      }

      await writeFile(file, `${formatHookEvent(event1)}\n${formatHookEvent(event2)}\n`)

      const state1 = createHookTailState()
      const result1 = await pollHookEvents(file, state1)
      expect(result1.events).toHaveLength(2)

      // Truncate the file (write a much smaller content)
      const event3: HookEvent = {
        type: 'session-start',
        timestamp: '2026-08-22T10:00:03.000Z',
        sessionId: 'sess-2',
      }
      await writeFile(file, `${formatHookEvent(event3)}\n`)

      const result2 = await pollHookEvents(file, result1.state)

      // After truncation, should re-read from offset 0 and get event3
      expect(result2.events).toHaveLength(1)
      expect(result2.events[0]).toEqual(event3)
      expect(result2.state.files.get(file)?.offset).toBeLessThan(result1.state.files.get(file)?.offset ?? 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('preserves remainder across multiple partial-line polls', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'platonic-tail-'))
    try {
      const file = join(dir, 'events.jsonl')

      const event1: HookEvent = {
        type: 'session-start',
        timestamp: '2026-08-22T10:00:00.000Z',
        sessionId: 'sess-1',
      }

      // Write event1 and a partial event (no closing brace)
      await writeFile(file, `${formatHookEvent(event1)}\n{"type":"tool","timestamp":"t"`)

      const state1 = createHookTailState()
      const result1 = await pollHookEvents(file, state1)
      expect(result1.events).toHaveLength(1)

      // Append more of the incomplete event
      await appendFile(file, ',"sessionId":"s1","tool":"Read"}')

      const result2 = await pollHookEvents(file, result1.state)
      expect(result2.events).toHaveLength(0) // Still incomplete (no newline)

      // Complete with newline and a full event
      const event2: HookEvent = {
        type: 'tool',
        timestamp: '2026-08-22T10:00:01.000Z',
        sessionId: 'sess-1',
        tool: 'Write',
      }
      await appendFile(file, `\n${formatHookEvent(event2)}\n`)

      const result3 = await pollHookEvents(file, result2.state)
      expect(result3.events).toHaveLength(2)
      expect(result3.events[0]?.type).toBe('tool')
      expect(result3.events[0]?.tool).toBe('Read')
      expect(result3.events[1]).toEqual(event2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('handles empty lines (only whitespace)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'platonic-tail-'))
    try {
      const file = join(dir, 'events.jsonl')

      const event1: HookEvent = {
        type: 'session-start',
        timestamp: '2026-08-22T10:00:00.000Z',
        sessionId: 'sess-1',
      }
      const event2: HookEvent = {
        type: 'tool',
        timestamp: '2026-08-22T10:00:01.000Z',
        sessionId: 'sess-1',
        tool: 'Read',
      }

      // Write with blank lines and whitespace-only lines
      await writeFile(
        file,
        `${formatHookEvent(event1)}\n\n  \n${formatHookEvent(event2)}\n\n`,
      )

      const state = createHookTailState()
      const result = await pollHookEvents(file, state)

      // Should skip empty/whitespace lines
      expect(result.events).toHaveLength(2)
      expect(result.events[0]).toEqual(event1)
      expect(result.events[1]).toEqual(event2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
