// One tool call to one answer. Everything above this is protocol and
// everything below it is pure, so this is the only place that knows both which
// tools exist and how to reach the disk.
import { runCheck, type StepName } from '../../check/src/index.ts'
import {
  heldSnapshot,
  loadCompiler,
  loadHeadTexts,
  loadWorkspace,
  moveFile,
  takeCheckpoint,
  textsOf,
  writeEdits,
} from './io.ts'
import type { Compiler } from './compiler.ts'
import type { Workspace } from './workspace.ts'
import { outline, repoMap, search, symbolSource, usages, type ToolOutput } from './query.ts'
import { membersOf, typeOf } from './types.ts'
import { blastRadius, callers, testsForSymbol } from './reach.ts'
import { implementations, moduleGraph, unusedExports } from './graph.ts'
import { escapeHatchIndex, symbolMetrics } from './inspect.ts'
import type { EditPlan } from './edit.ts'
import { symbolDiff } from './review.ts'
import { codeFixes, diagnostics } from './diagnostics.ts'
import { availableRefactors } from './refactor.ts'
import { describeSnapshot } from './checkpoint.ts'
import { previewPlan } from './preview.ts'
import { batchPlan, planTool } from './plan.ts'
import type { CallOptions } from './options.ts'
import {
  readCount,
  readFlag,
  readRecordList,
  readText,
  readTextList,
} from './schema.ts'

const missing = (parameter: string): ToolOutput => ({
  ok: false,
  text: `missing required parameter: ${parameter}`,
})

const stepNames: readonly StepName[] = ['typecheck', 'lint', 'ratchet', 'tests']

const isStepName = (value: string): value is StepName => stepNames.some((step) => step === value)

const runGate = async (
  options: CallOptions,
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

// A plan is computed against one reading of the repository and written against
// a fresh one, which is what lets `writeEdits` notice that the repository moved
// underneath it.
const applyPlan = async (
  options: CallOptions,
  plan: EditPlan,
  wanted: boolean,
): Promise<ToolOutput> => {
  if (!plan.ok) return { ok: false, text: plan.text }
  const workspace = await loadWorkspace(options.repoDir)
  if (wanted) return previewPlan(workspace, plan)
  const written = await writeEdits(options.repoDir, workspace, plan.edits)
  return written.ok
    ? { ok: true, text: `${plan.summary}\nwrote ${written.files.join(', ')}` }
    : { ok: false, text: written.text }
}

// The read tools, grouped by what they need. Nothing here loads a bound
// program unless the branch reached actually asks the checker something.
const readTool = async (
  options: CallOptions,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<ToolOutput | undefined> => {
  const workspace = (): Promise<Workspace> => loadWorkspace(options.repoDir)
  const compiler = (): Promise<Compiler> => loadCompiler(options.repoDir)
  const symbol = readText(args, 'name')
  const file = readText(args, 'file')
  const folder = readText(args, 'folder')
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
    case 'type_of':
      return symbol === undefined ? missing('name') : typeOf(await compiler(), symbol, file)
    case 'members_of':
      return symbol === undefined ? missing('name') : membersOf(await compiler(), symbol, file)
    case 'diagnostics': {
      const files = readTextList(args, 'files')
      return files === undefined ? missing('files') : diagnostics(await compiler(), files)
    }
    case 'code_fixes': {
      const target = readText(args, 'file')
      return target === undefined
        ? missing('file')
        : codeFixes(await compiler(), target, readCount(args, 'line'))
    }
    case 'refactorings':
      return symbol === undefined
        ? missing('name')
        : availableRefactors(await compiler(), symbol, file)
    case 'callers':
      return symbol === undefined
        ? missing('name')
        : callers(await workspace(), symbol, file, readCount(args, 'depth') ?? 2)
    case 'implementations':
      return symbol === undefined ? missing('name') : implementations(await workspace(), symbol, file)
    case 'tests_for_symbol':
      return symbol === undefined ? missing('name') : testsForSymbol(await workspace(), symbol, file)
    case 'blast_radius':
      return symbol === undefined ? missing('name') : blastRadius(await workspace(), symbol, file)
    case 'module_graph':
      return moduleGraph(await workspace(), folder)
    case 'unused_exports':
      return unusedExports(await workspace(), folder)
    case 'symbol_metrics':
      return symbol === undefined ? missing('name') : symbolMetrics(await workspace(), symbol, file)
    case 'escape_hatch_index':
      return escapeHatchIndex(await workspace(), folder)
    case 'symbol_diff': {
      const current = await workspace()
      return symbolDiff(current, await loadHeadTexts(options.repoDir, current))
    }
    case 'checkpoint': {
      const label = readText(args, 'label') ?? new Date(options.now).toISOString()
      const current = await workspace()
      const held = heldSnapshot(label)
      return held === undefined
        ? {
            ok: true,
            text: `checkpoint ${label} — ${takeCheckpoint(current, label, options.now).files.size} files recorded`,
          }
        : describeSnapshot(held, textsOf(current))
    }
    case 'check':
      return runGate(options, readTextList(args, 'steps'))
    default:
      return undefined
  }
}

// `rename_file` is the one tool whose work is not entirely an edit plan: the
// importers are rewritten by the plan and the file itself still has to move.
const finishRename = async (
  options: CallOptions,
  args: Readonly<Record<string, unknown>>,
  result: ToolOutput,
): Promise<ToolOutput> => {
  const from = readText(args, 'file')
  const to = readText(args, 'newPath')
  if (!result.ok || from === undefined || to === undefined) return result
  const problem = await moveFile(options.repoDir, from, to)
  return problem === undefined
    ? { ok: true, text: `${result.text}\nmoved ${from} to ${to}` }
    : { ok: false, text: `${result.text}\nbut the file did not move: ${problem}` }
}

export const callTool = async (
  options: CallOptions,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<ToolOutput> => {
  const answered = await readTool(options, name, args)
  if (answered !== undefined) return answered
  const wanted = readFlag(args, 'preview')
  if (name === 'batch_edit') {
    const steps = readRecordList(args, 'steps')
    return steps === undefined
      ? missing('steps')
      : applyPlan(options, await batchPlan(options, steps), wanted)
  }
  const plan = await planTool(options, name, args)
  if (plan === undefined) return { ok: false, text: `unknown tool: ${name}` }
  const result = await applyPlan(options, plan, wanted)
  return name === 'rename_file' && !wanted ? finishRename(options, args, result) : result
}
