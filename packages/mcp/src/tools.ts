// The tool catalogue: what the server advertises, and how a call's arguments
// are read. Descriptions are part of the contract — an agent picks a tool from
// the description alone, so each one says what it replaces and what it costs.

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

const text = (description: string): Readonly<Record<string, unknown>> => ({
  type: 'string',
  description,
})

const textList = (description: string): Readonly<Record<string, unknown>> => ({
  type: 'array',
  items: { type: 'string' },
  description,
})

const flag = (description: string): Readonly<Record<string, unknown>> => ({
  type: 'boolean',
  description,
})

const symbolName = text('Symbol name, exactly as declared.')

const symbolFile = text(
  'Repo-relative file the symbol is declared in. Only needed when the name is ambiguous; the error lists candidates when it is.',
)

const tool = (
  name: string,
  description: string,
  properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  required: readonly string[],
): ToolSpec => ({ name, description, inputSchema: { type: 'object', properties, required } })

export const toolSpecs: readonly ToolSpec[] = [
  tool(
    'outline',
    'Signatures of every declaration in one or more TypeScript files, with line numbers. Use instead of reading a whole file when you need to know what is in it — costs roughly a tenth of the tokens.',
    {
      files: textList('Repo-relative paths.'),
      all: flag('Include nested declarations — members and locals — not just top-level ones (default false).'),
    },
    ['files'],
  ),
  tool(
    'symbol',
    'The full source of one declaration, with its leading comment and location. Use instead of grep-then-read when you know the name.',
    { name: symbolName, file: symbolFile },
    ['name'],
  ),
  tool(
    'usages',
    'Every place a symbol is used, resolved by the TypeScript type checker rather than by text match, one line of context each. Unlike grep it finds no same-named strangers and misses no aliased imports.',
    { name: symbolName, file: symbolFile },
    ['name'],
  ),
  tool(
    'search',
    'Find declarations whose name contains a string, across the repo. Returns kind, location, and signature.',
    {
      query: text('Substring of the name, case-insensitive.'),
      kind: text('Optional filter: function, variable, type, interface, class, enum, method, property.'),
      all: flag('Include non-exported declarations (default false).'),
    },
    ['query'],
  ),
  tool(
    'repo_map',
    'One line per folder: file count, lines, and the quality score. Use to orient in an unfamiliar repository before reading anything.',
    {},
    [],
  ),
  tool(
    'replace_symbol',
    'Replace one declaration with new source, addressed by name. Unlike a text edit it needs no surrounding context to match, cannot hit the wrong occurrence, and rejects source that does not parse.',
    { name: symbolName, file: symbolFile, source: text('The complete new declaration, including any leading comment and the export keyword.') },
    ['name', 'source'],
  ),
  tool(
    'insert_symbol',
    'Add a declaration to a file, after a named declaration or at the end. Rejects source that does not parse.',
    {
      file: text('Repo-relative path.'),
      source: text('The complete new declaration.'),
      after: text('Optional: name of the declaration to insert after. Default is end of file.'),
    },
    ['file', 'source'],
  ),
  tool(
    'rename_symbol',
    'Rename a declaration and every use of it across the repository, resolved by the type checker. Refuses rather than guesses when an occurrence is one it cannot rewrite safely.',
    { name: symbolName, file: symbolFile, newName: text('The new identifier.') },
    ['name', 'newName'],
  ),
  tool(
    'check',
    'Run the repository gate — typecheck, lint, escape-hatch ratchet, tests — and report the first failure. This is the only definition of green.',
    { steps: textList('Optional subset and order of: typecheck, lint, ratchet, tests.') },
    [],
  ),
]

export const readText = (
  args: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined => (typeof args[key] === 'string' ? args[key] : undefined)

export const readFlag = (args: Readonly<Record<string, unknown>>, key: string): boolean =>
  args[key] === true

export const readTextList = (
  args: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] | undefined => {
  const value = args[key]
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined
}
