// Building the text a rewrite inserts. Every function here takes strings and returns
// strings: it decides how the new code is spelled, never what it should be. `extract.ts`
// makes those decisions and calls in here for the spelling.
//
// The house style is what this emits: arrow consts, no semicolons, named exports, relative
// imports that keep the `.ts` extension (PS-022, PS-028, PS-032).

// An expression whose value is a function can be shared as one declaration and referred to
// by name. Anything else has to stay a function even when it takes no arguments, because
// moving it to the top level would move when it runs.
export type ExtractedForm = 'value' | 'function'

export type ParameterSource = {
  readonly name: string
  // Omitted when no type checker was available. The result then needs a type before it
  // compiles under `noImplicitAny`, which is why the plan says so.
  readonly type: string | undefined
}

export type FunctionSource = {
  readonly name: string
  readonly form: ExtractedForm
  readonly parameters: readonly ParameterSource[]
  readonly returnType: string | undefined
  readonly body: string
  readonly isAsync: boolean
  readonly exported: boolean
}

// An arrow whose body starts with `{` would read as a block, so it is parenthesized.
const bodyText = (body: string): string => (body.startsWith('{') ? `(${body})` : body)

const parameterText = (parameter: ParameterSource): string =>
  parameter.type === undefined ? parameter.name : `${parameter.name}: ${parameter.type}`

const returnText = (returnType: string | undefined): string =>
  returnType === undefined ? '' : `: ${returnType}`

export const functionSource = (source: FunctionSource): string => {
  const prefix = source.exported ? 'export const' : 'const'
  if (source.form === 'value') return `${prefix} ${source.name} = ${bodyText(source.body)}`
  const parameters = source.parameters.map(parameterText).join(', ')
  const asyncPrefix = source.isAsync ? 'async ' : ''
  return (
    `${prefix} ${source.name} = ${asyncPrefix}(${parameters})` +
    `${returnText(source.returnType)} => ${bodyText(source.body)}`
  )
}

export type CallSource = {
  readonly name: string
  readonly arguments: readonly string[]
  readonly form: ExtractedForm
  readonly awaited: boolean
  // True where the surrounding expression binds tighter than `await`, as in
  // `(await parse(text)).length`.
  readonly parenthesize: boolean
}

// What replaces one occurrence.
export const callSource = (call: CallSource): string => {
  if (call.form === 'value') return call.name
  const text = `${call.name}(${call.arguments.join(', ')})`
  if (!call.awaited) return text
  return call.parenthesize ? `(await ${text})` : `await ${text}`
}

// ---------------------------------------------------------------------------
// Moving text between positions.
// ---------------------------------------------------------------------------

const leadingSpaces = (line: string): number => line.length - line.trimStart().length

// An expression lifted out of a nested position keeps the indentation of its later lines,
// which was relative to a statement it no longer sits under. `columns` is how far that
// statement was indented; removing that much from each line after the first restores them.
//
// Never more than the shallowest line has, though. The lines of a multi-line expression are
// indented relative to their statement, not to the column the expression starts at, so
// taking the start column off them would strip the structure out of the body.
export const dedentBy = (text: string, columns: number): string => {
  const [first, ...rest] = text.split('\n')
  const filled = rest.filter((line) => line.trim() !== '')
  const shallowest = filled.reduce(
    (least, line) => Math.min(least, leadingSpaces(line)),
    Number.POSITIVE_INFINITY,
  )
  const remove = Math.min(columns, shallowest)
  return [first ?? '', ...rest.map((line) => line.slice(Math.min(leadingSpaces(line), remove)))].join(
    '\n',
  )
}

// ---------------------------------------------------------------------------
// Imports.
// ---------------------------------------------------------------------------

const sharedPrefix = (left: readonly string[], right: readonly string[]): number => {
  const differs = left.findIndex((segment, index) => right[index] !== segment)
  return differs === -1 ? Math.min(left.length, right.length) : differs
}

// The specifier `fromFile` would use to import `toFile`, both repo-relative and
// forward-slashed. The `.ts` extension stays: this repository imports source, not build
// output, and has no path aliases.
export const relativeImport = (fromFile: string, toFile: string): string => {
  const fromDirectory = fromFile.split('/').slice(0, -1)
  const toSegments = toFile.split('/')
  const shared = sharedPrefix(fromDirectory, toSegments.slice(0, -1))
  const up = fromDirectory.length - shared
  const down = toSegments.slice(shared).join('/')
  return up === 0 ? `./${down}` : `${'../'.repeat(up)}${down}`
}

// The repo-relative file a relative specifier points at, seen from `fromFile`. Package
// specifiers resolve to nothing: this repository has no runtime dependencies, and a bare
// name is never one of its own files.
export const resolveImport = (fromFile: string, specifier: string): string | undefined => {
  if (!specifier.startsWith('.')) return undefined
  const segments = [...fromFile.split('/').slice(0, -1), ...specifier.split('/')]
  const resolved = segments.reduce<readonly string[]>(
    (path, segment) =>
      segment === '.' ? path : segment === '..' ? path.slice(0, -1) : [...path, segment],
    [],
  )
  return resolved.join('/')
}

export const importSource = (name: string, specifier: string): string =>
  `import { ${name} } from '${specifier}'`
