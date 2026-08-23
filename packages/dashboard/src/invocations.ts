// Dashboard-local incremental tail for tool/skill invocations (BL-0012). The
// dashboard's fence this wave does not include packages/transcripts, and
// pollTranscripts only returns AgentActivity (one record per line, first
// tool_use block folded away) — not enough to show a per-invocation history. This
// module re-tails the same transcript files independently, tracking its own byte
// offsets, and runs parseToolInvocations (already exported from
// packages/transcripts, read-only import here) over newly appended lines.
//
// Mirrors packages/transcripts's pollTranscripts shape deliberately (offset +
// remainder per file, reset on shrink) so the two tails behave identically even
// though they are separate readers of the same files.

import { open, stat } from 'node:fs/promises'
import { splitJsonlChunk } from '../../core/src/index.ts'
import { discoverTranscriptFiles, parseToolInvocations, type ToolInvocation } from '../../transcripts/src/index.ts'

type FileTailState = {
  readonly offset: number
  readonly remainder: string
}

// Tracks file offsets and line remainders for incremental polling of tool invocations.
export type InvocationTailState = {
  readonly files: ReadonlyMap<string, FileTailState>
}

// Creates initial state for polling invocations with no prior tail positions.
export const createInvocationTailState = (): InvocationTailState => ({ files: new Map() })

const readAppended = async (file: string, size: number, offset: number): Promise<string> => {
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
  readonly tail: FileTailState
  readonly invocations: readonly ToolInvocation[]
}

// Re-discovers `dirs`, reads only the bytes appended since the last call, and
// parses tool_use invocations out of the new lines. Files that vanish between
// polls are silently dropped from the returned state (not retained
// speculatively), matching pollTranscripts's behavior.
export const pollInvocations = async (
  dirs: readonly string[],
  state: InvocationTailState,
): Promise<{ readonly state: InvocationTailState; readonly invocations: readonly ToolInvocation[] }> => {
  const files = await discoverTranscriptFiles(dirs)

  const results = await Promise.all(
    files.map(async (file): Promise<FilePollResult | undefined> => {
      let size: number
      try {
        const st = await stat(file)
        size = st.size
      } catch {
        return undefined
      }

      const prev = state.files.get(file) ?? { offset: 0, remainder: '' }
      const shrunk = size < prev.offset
      const offset = shrunk ? 0 : prev.offset
      const remainder = shrunk ? '' : prev.remainder

      const chunk = await readAppended(file, size, offset)
      const { lines, rest } = splitJsonlChunk(remainder, chunk)

      const invocations = lines.flatMap((line) => parseToolInvocations(file, line))

      return { file, tail: { offset: size, remainder: rest }, invocations }
    }),
  )

  const kept = results.filter((r): r is FilePollResult => r !== undefined)
  const nextFiles = new Map(kept.map((r) => [r.file, r.tail] as const))
  const invocations = kept.flatMap((r) => r.invocations)

  return { state: { files: nextFiles }, invocations }
}
