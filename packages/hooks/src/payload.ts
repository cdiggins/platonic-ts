// Shared, dependency-free helpers for reading untrusted JSON payloads (hook stdin, event
// lines). Kept tiny and duplicated in spirit from packages/transcripts/src/index.ts's style.

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
