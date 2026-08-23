import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { appendHookEvent } from '../src/io.ts'
import { formatHookEvent, parseHookEventLine, type HookEvent } from '../src/index.ts'
import { buildEvent as buildPostToolUseEvent, skillNameFrom } from '../src/postToolUse.ts'
import { buildEvent as buildSessionStartEvent } from '../src/sessionStart.ts'

describe('formatHookEvent / parseHookEventLine round-trip', () => {
  it('round-trips a tool event with all optional fields', () => {
    const event: HookEvent = {
      type: 'tool',
      timestamp: '2026-08-22T12:00:00.000Z',
      sessionId: 'sess-1',
      tool: 'Read',
      skill: 'caveman',
      cwd: 'C:/repo',
    }
    expect(parseHookEventLine(formatHookEvent(event))).toEqual(event)
  })

  it('round-trips a session-start event with only required fields', () => {
    const event: HookEvent = {
      type: 'session-start',
      timestamp: '2026-08-22T12:00:00.000Z',
      sessionId: 'sess-2',
    }
    expect(parseHookEventLine(formatHookEvent(event))).toEqual(event)
  })
})

describe('parseHookEventLine tolerance', () => {
  it('returns undefined for an empty line', () => {
    expect(parseHookEventLine('')).toBeUndefined()
    expect(parseHookEventLine('   ')).toBeUndefined()
  })

  it('returns undefined for invalid JSON', () => {
    expect(parseHookEventLine('not json {')).toBeUndefined()
  })

  it('returns undefined for JSON that is not an object', () => {
    expect(parseHookEventLine('42')).toBeUndefined()
    expect(parseHookEventLine('[1,2,3]')).toBeUndefined()
    expect(parseHookEventLine('"hi"')).toBeUndefined()
  })

  it('returns undefined for an unrecognized type', () => {
    expect(parseHookEventLine(JSON.stringify({ type: 'other', timestamp: 't', sessionId: 's' }))).toBeUndefined()
  })

  it('returns undefined when timestamp or sessionId is missing', () => {
    expect(parseHookEventLine(JSON.stringify({ type: 'tool', sessionId: 's' }))).toBeUndefined()
    expect(parseHookEventLine(JSON.stringify({ type: 'tool', timestamp: 't' }))).toBeUndefined()
  })

  it('ignores non-string optional fields rather than failing', () => {
    const line = JSON.stringify({ type: 'tool', timestamp: 't', sessionId: 's', tool: 42 })
    expect(parseHookEventLine(line)).toEqual({ type: 'tool', timestamp: 't', sessionId: 's' })
  })
})

describe('postToolUse payload mapping', () => {
  it('maps a plain tool call', () => {
    const event = buildPostToolUseEvent({ session_id: 'sess-1', cwd: 'C:/repo', tool_name: 'Read' })
    expect(event?.type).toBe('tool')
    expect(event?.sessionId).toBe('sess-1')
    expect(event?.tool).toBe('Read')
    expect(event?.cwd).toBe('C:/repo')
    expect(event?.skill).toBeUndefined()
    expect(typeof event?.timestamp).toBe('string')
  })

  it('extracts the skill name for a Skill tool call', () => {
    const event = buildPostToolUseEvent({
      session_id: 'sess-1',
      tool_name: 'Skill',
      tool_input: { skill: 'caveman', args: 'ignored' },
    })
    expect(event?.tool).toBe('Skill')
    expect(event?.skill).toBe('caveman')
  })

  it('skillNameFrom is undefined for non-Skill input shapes', () => {
    expect(skillNameFrom(undefined)).toBeUndefined()
    expect(skillNameFrom({ other: 'x' })).toBeUndefined()
    expect(skillNameFrom({ skill: 'ok' })).toBe('ok')
  })

  it('returns undefined without a session id', () => {
    expect(buildPostToolUseEvent({ tool_name: 'Read' })).toBeUndefined()
  })

  it('returns undefined for a malformed (non-object) payload', () => {
    expect(buildPostToolUseEvent(undefined)).toBeUndefined()
    expect(buildPostToolUseEvent('nope')).toBeUndefined()
    expect(buildPostToolUseEvent([1, 2])).toBeUndefined()
  })
})

describe('sessionStart payload mapping', () => {
  it('maps a session-start payload', () => {
    const event = buildSessionStartEvent({ session_id: 'sess-9', cwd: 'C:/repo', source: 'startup' })
    expect(event?.type).toBe('session-start')
    expect(event?.sessionId).toBe('sess-9')
    expect(event?.cwd).toBe('C:/repo')
  })

  it('omits cwd when absent rather than storing undefined', () => {
    const event = buildSessionStartEvent({ session_id: 'sess-9' })
    expect(event).toBeDefined()
    expect(Object.hasOwn(event ?? {}, 'cwd')).toBe(false)
  })

  it('returns undefined for a malformed payload', () => {
    expect(buildSessionStartEvent(null)).toBeUndefined()
    expect(buildSessionStartEvent({})).toBeUndefined()
  })
})

describe('appendHookEvent', () => {
  it('creates the events dir and appends one JSONL line per call', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'platonic-hooks-'))
    try {
      const eventA: HookEvent = { type: 'session-start', timestamp: 't1', sessionId: 's1' }
      const eventB: HookEvent = { type: 'tool', timestamp: 't2', sessionId: 's1', tool: 'Read' }

      appendHookEvent(dir, eventA)
      appendHookEvent(dir, eventB)

      const content = await readFile(join(dir, '.claude', 'events', 'events.jsonl'), 'utf8')
      const lines = content.split('\n').filter((l) => l.length > 0)

      expect(lines).toHaveLength(2)
      expect(parseHookEventLine(lines[0] ?? '')).toEqual(eventA)
      expect(parseHookEventLine(lines[1] ?? '')).toEqual(eventB)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
