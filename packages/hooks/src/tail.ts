// Incremental tailing of hook event logs. Reads only appended bytes since the last
// poll, tracks file offsets and partial lines (remainder), parses via parseHookEventLine,
// skips malformed lines, handles missing files and truncation.

import { open, stat } from 'node:fs/promises'

import { splitJsonlChunk } from '../../core/src/index.ts'
import { parseHookEventLine, type HookEvent } from './index.ts'

// Opaque type tracking per-file state: byte offset and partial-line remainder.
type FileHookTailState = {
  readonly offset: number
  readonly remainder: string
}

export type HookTailState = {
  readonly files: ReadonlyMap<string, FileHookTailState>
}

export const createHookTailState = (): HookTailState => ({ files: new Map() })

// Reads a range [offset, offset+length) from a file.
const readAppended = async (
  file: string,
  size: number,
  offset: number,
): Promise<string> => {
  if (size <= offset) return ''
  const handle = await open(file, 'r')
  try {
    const length = size - offset
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, offset)
    return buffer.toString('utf8')
  } finally {
    await handle.close()
  }
}

type FilePollResult = {
  readonly file: string
  readonly tail: FileHookTailState
  readonly events: readonly HookEvent[]
}

// Pure. One JSONL line -> HookEvent, skipping malformed/empty lines.
const parseLineOrSkip = (line: string): HookEvent | undefined => parseHookEventLine(line)

// Polls a single hook event file, returning only events appended since the last poll.
// Handles missing file (returns undefined, no throw) and truncation (resets to offset 0).
const pollFile = async (
  file: string,
  prev: FileHookTailState,
): Promise<FilePollResult | undefined> => {
  let size: number
  try {
    const st = await stat(file)
    size = st.size
  } catch {
    // Missing file: return undefined so it is dropped from the new state.
    return undefined
  }

  // Detect truncation: if file size shrunk below our stored offset, reset.
  const shrunk = size < prev.offset
  const offset = shrunk ? 0 : prev.offset
  const remainder = shrunk ? '' : prev.remainder

  const chunk = await readAppended(file, size, offset)
  const { lines, rest } = splitJsonlChunk(remainder, chunk)

  const events = lines
    .map((line) => parseLineOrSkip(line))
    .filter((e): e is HookEvent => e !== undefined)

  return { file, tail: { offset: size, remainder: rest }, events }
}

// Polls a single hook event file for new events since the last poll state.
// Reads only appended bytes since the last offset, parses lines via parseHookEventLine,
// skips malformed lines, handles missing files (no throw, empty result), and resets on
// file truncation (offset > size).
export const pollHookEvents = async (
  file: string,
  state: HookTailState,
): Promise<{ readonly state: HookTailState; readonly events: readonly HookEvent[] }> => {
  const prev = state.files.get(file) ?? { offset: 0, remainder: '' }
  const result = await pollFile(file, prev)

  if (result === undefined) {
    // File missing/unreadable: drop from state, return empty events.
    const nextFiles = new Map([...state.files].filter(([k]) => k !== file))
    return { state: { files: nextFiles }, events: [] }
  }

  // Update state with new offset and remainder.
  const nextFiles = new Map([...state.files, [result.file, result.tail]])

  return { state: { files: nextFiles }, events: result.events }
}
