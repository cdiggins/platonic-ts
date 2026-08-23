// The vocabulary the tool catalogue is written in, and the readers that take a
// call's arguments back out. Separate from the catalogue itself so the
// catalogue can be split across files without any of them importing each other.
export type ToolSchema = {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly required: readonly string[]
}

export type ToolSpec = {
  readonly name: string
  readonly description: string
  readonly inputSchema: ToolSchema
}

export const text = (description: string): Readonly<Record<string, unknown>> => ({
  type: 'string',
  description,
})

export const textList = (description: string): Readonly<Record<string, unknown>> => ({
  type: 'array',
  items: { type: 'string' },
  description,
})

export const flag = (description: string): Readonly<Record<string, unknown>> => ({
  type: 'boolean',
  description,
})

export const count = (description: string): Readonly<Record<string, unknown>> => ({
  type: 'integer',
  description,
})

export const symbolName = text('Symbol name, exactly as declared.')

export const symbolFile = text(
  'Repo-relative file the symbol is declared in. Only needed when the name is ambiguous; the error lists candidates when it is.',
)

// Every tool that changes a file takes this, so a caller can look before it
// leaps without a second tool and a second round trip.
export const preview = flag(
  'Return the diff this call would produce and write nothing (default false).',
)

export const folder = text('Repo-relative folder to limit the answer to. Default is the whole repository.')

export const tool = (
  name: string,
  description: string,
  properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  required: readonly string[],
): ToolSpec => ({ name, description, inputSchema: { type: 'object', properties, required } })

export const readText = (
  args: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined => (typeof args[key] === 'string' ? args[key] : undefined)

export const readFlag = (args: Readonly<Record<string, unknown>>, key: string): boolean =>
  args[key] === true

export const readCount = (
  args: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined => {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export const readTextList = (
  args: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | undefined => {
  const value = args[key]
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined
}

export const readRecordList = (
  args: Readonly<Record<string, unknown>>,
  key: string,
): readonly Readonly<Record<string, unknown>>[] | undefined => {
  const value = args[key]
  return Array.isArray(value) &&
    value.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item))
    ? value
    : undefined
}
