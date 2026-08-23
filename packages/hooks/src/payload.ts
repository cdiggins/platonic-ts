// Shared, dependency-free helpers for reading untrusted JSON payloads (hook stdin, event
// lines). Kept tiny and duplicated in spirit from packages/transcripts/src/index.ts's style.

// Type guard: true if the value is a plain object (not an array or primitive).
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// Coerces a value to string if it is one, otherwise undefined.
export const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
