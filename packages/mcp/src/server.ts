// Composition of the tools onto the wire: one request in, one line of JSON out.
// Nothing here decides anything a pure module could decide; it loads the
// workspace, dispatches, and writes plans to disk.
import { runCheck, type StepName } from '../../check/src/index.ts'
import { loadWorkspace, writeEdits } from './io.ts'
import type { Workspace } from './workspace.ts'
import { insertSymbol, replaceSymbol, type EditPlan } from './edit.ts'
import { outline, repoMap, search, symbolSource, usages, type ToolOutput } from './query.ts'
import { renameSymbol } from './rename.ts'
import {
  encodeResponse,
  errorOf,
  internalErrorCode,
  invalidParamsCode,
  methodNotFoundCode,
  parseLine,
  resultOf,
  type RpcRequest,
  type RpcResponse,
} from './protocol.ts'
import { readFlag, readText, readTextList, toolSpecs } from './tools.ts'

export type ServerOptions = {
  readonly repoDir: string
  readonly baselinePath: string
  readonly write: (line: string) => void
  readonly log: (message: string) => void
}

const protocolVersion = '2025-06-18'

const serverInfo = { name: 'platonic', version: '0.0.1' }

const missing = (parameter: string): ToolOutput => ({
  ok: false,
  text: `missing required parameter: ${parameter}`,
})

const stepNames: readonly StepName[] = ['typecheck', 'lint', 'ratchet', 'tests']

const isStepName = (value: string): value is StepName => stepNames.some((step) => step === value)

const runGate = async (
  options: ServerOptions,
  steps: readonly string[] | undefined,
): Promise<ToolOutput> => {
  const chosen = steps?.filter(isStepName)
  if (steps !== undefined && chosen?.length !== steps.length)
    return { ok: false, text: `steps must be drawn from ${stepNames.join(', ')}` }
  const report = await runCheck({
    repoDir: options.repoDir,
    baselinePath: options.baselinePath,
    ...(chosen === undefined || chosen.length === 0 ? {} : { steps: chosen }),
  })
  return {
    ok: report.ok,
    text: report.steps
      .map(
        (step) =>
          `${step.ok ? 'PASS' : 'FAIL'} ${step.name} ${Math.round(step.durationMs)}ms — ${step.detail}`,
      )
      .join('\n'),
  }
}

// An edit plan is written immediately: a plan the caller has to confirm would
// double the round trips, which is the cost this server exists to remove.
const applyPlan = async (options: ServerOptions, plan: EditPlan): Promise<ToolOutput> => {
  if (!plan.ok) return { ok: false, text: plan.text }
  const workspace = await loadWorkspace(options.repoDir)
  const written = await writeEdits(options.repoDir, workspace, plan.edits)
  return written.ok
    ? { ok: true, text: `${plan.summary}\nwrote ${written.files.join(', ')}` }
    : { ok: false, text: written.text }
}

const callTool = async (
  options: ServerOptions,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<ToolOutput> => {
  // Loaded per branch rather than up front: the gate and a mistyped tool name
  // should not pay for indexing the repository.
  const workspace = (): Promise<Workspace> => loadWorkspace(options.repoDir)
  const symbol = readText(args, 'name')
  const file = readText(args, 'file')
  const source = readText(args, 'source')
  switch (name) {
    case 'outline': {
      const files = readTextList(args, 'files')
      return files === undefined
        ? missing('files')
        : outline(await workspace(), files, readFlag(args, 'all'))
    }
    case 'symbol':
      return symbol === undefined ? missing('name') : symbolSource(await workspace(), symbol, file)
    case 'usages':
      return symbol === undefined ? missing('name') : usages(await workspace(), symbol, file)
    case 'search': {
      const query = readText(args, 'query')
      return query === undefined
        ? missing('query')
        : search(await workspace(), query, readText(args, 'kind'), readFlag(args, 'all'))
    }
    case 'repo_map':
      return repoMap(await workspace())
    case 'replace_symbol':
      return symbol === undefined
        ? missing('name')
        : source === undefined
          ? missing('source')
          : applyPlan(options, replaceSymbol(await workspace(), symbol, file, source))
    case 'insert_symbol': {
      const target = readText(args, 'file')
      return target === undefined
        ? missing('file')
        : source === undefined
          ? missing('source')
          : applyPlan(options, insertSymbol(await workspace(), target, source, readText(args, 'after')))
    }
    case 'rename_symbol': {
      const newName = readText(args, 'newName')
      return symbol === undefined
        ? missing('name')
        : newName === undefined
          ? missing('newName')
          : applyPlan(options, renameSymbol(await workspace(), symbol, file, newName))
    }
    case 'check':
      return runGate(options, readTextList(args, 'steps'))
    default:
      return { ok: false, text: `unknown tool: ${name}` }
  }
}

const toolResult = (output: ToolOutput): unknown => ({
  content: [{ type: 'text', text: output.text }],
  isError: !output.ok,
})

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// A tool that throws reports the failure as tool output rather than as a
// protocol error, so the caller sees it as a result it can act on.
const guarded = async (
  options: ServerOptions,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<unknown> =>
  toolResult(
    await callTool(options, name, args).catch((error: unknown) => ({
      ok: false,
      text: `${name} failed: ${errorText(error)}`,
    })),
  )

export const handleRequest = async (
  options: ServerOptions,
  request: RpcRequest,
): Promise<RpcResponse | undefined> => {
  const id = request.id
  if (id === undefined) return undefined
  switch (request.method) {
    case 'initialize':
      return resultOf(id, { protocolVersion, capabilities: { tools: {} }, serverInfo })
    case 'ping':
      return resultOf(id, {})
    case 'tools/list':
      return resultOf(id, { tools: toolSpecs })
    case 'tools/call': {
      const name = readText(request.params, 'name')
      const args = request.params['arguments']
      if (name === undefined) return errorOf(id, invalidParamsCode, 'no tool name')
      return resultOf(
        id,
        await guarded(options, name, typeof args === 'object' && args !== null ? { ...args } : {}),
      )
    }
    default:
      return errorOf(id, methodNotFoundCode, `unknown method: ${request.method}`)
  }
}

export const handleLine = async (
  options: ServerOptions,
  line: string,
): Promise<RpcResponse | undefined> => {
  const parsed = parseLine(line)
  if (!parsed.ok)
    return parsed.id === undefined
      ? undefined
      : errorOf(parsed.id, parsed.error.code, parsed.error.message)
  return handleRequest(options, parsed.request).catch((error: unknown) =>
    parsed.request.id === undefined
      ? undefined
      : errorOf(parsed.request.id, internalErrorCode, errorText(error)),
  )
}

// Requests are answered in arrival order rather than concurrently: two edit
// plans computed against the same workspace and applied in either order is the
// one failure mode this server must not have.
export const serve = (options: ServerOptions, input: NodeJS.ReadableStream): void => {
  let remainder = ''
  let pending: Promise<void> = Promise.resolve()
  input.setEncoding('utf8')
  input.on('data', (chunk: string) => {
    const parts = (remainder + chunk).split('\n')
    remainder = parts[parts.length - 1] ?? ''
    for (const line of parts.slice(0, -1).filter((part) => part.trim().length > 0)) {
      pending = pending.then(async () => {
        const response = await handleLine(options, line)
        if (response !== undefined) options.write(encodeResponse(response))
      })
    }
  })
  options.log(`platonic mcp: ${toolSpecs.length} tools over ${options.repoDir}`)
}
