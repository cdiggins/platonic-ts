// One write tool, one edit plan. Nothing here writes: a plan is a value, which
// is what lets `batch_edit` ask for several and combine them before any of them
// reaches the disk, and what lets `preview` render one instead of applying it.
import { loadCompiler, loadWorkspace, heldLabels, heldSnapshot, textsOf } from './io.ts'
import type { Compiler } from './compiler.ts'
import type { Workspace } from './workspace.ts'
import { insertSymbol, replaceSymbol, type EditPlan } from './edit.ts'
import { renameSymbol } from './rename.ts'
import { applyCodeFix, organizeImports } from './diagnostics.ts'
import { deleteSymbol } from './review.ts'
import { moveSymbol, renameFile } from './move.ts'
import { changeSignature } from './signature.ts'
import { applyRefactor } from './refactor.ts'
import { restorePlan } from './checkpoint.ts'
import { combinePlans } from './batch.ts'
import { readCount, readText, readTextList } from './schema.ts'
import type { CallOptions } from './options.ts'

const declined = (text: string): EditPlan => ({ ok: false, text })

// Every branch returns a plan rather than writing one, so `batch_edit` can ask
// for the same plans and combine them before anything reaches the disk.
export const planTool = async (
  options: CallOptions,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<EditPlan | undefined> => {
  const workspace = (): Promise<Workspace> => loadWorkspace(options.repoDir)
  const compiler = (): Promise<Compiler> => loadCompiler(options.repoDir)
  const symbol = readText(args, 'name')
  const file = readText(args, 'file')
  const source = readText(args, 'source')
  switch (name) {
    case 'replace_symbol':
      return symbol === undefined
        ? declined('missing required parameter: name')
        : source === undefined
          ? declined('missing required parameter: source')
          : replaceSymbol(await workspace(), symbol, file, source)
    case 'insert_symbol': {
      const target = readText(args, 'file')
      return target === undefined
        ? declined('missing required parameter: file')
        : source === undefined
          ? declined('missing required parameter: source')
          : insertSymbol(await workspace(), target, source, readText(args, 'after'))
    }
    case 'rename_symbol': {
      const newName = readText(args, 'newName')
      return symbol === undefined
        ? declined('missing required parameter: name')
        : newName === undefined
          ? declined('missing required parameter: newName')
          : renameSymbol(await workspace(), symbol, file, newName)
    }
    case 'delete_symbol':
      return symbol === undefined
        ? declined('missing required parameter: name')
        : deleteSymbol(await workspace(), symbol, file)
    case 'organize_imports': {
      const files = readTextList(args, 'files')
      return files === undefined
        ? declined('missing required parameter: files')
        : organizeImports(await compiler(), files)
    }
    case 'apply_code_fix': {
      const target = readText(args, 'file')
      return target === undefined
        ? declined('missing required parameter: file')
        : applyCodeFix(
            await compiler(),
            target,
            readCount(args, 'line'),
            readText(args, 'fixName'),
          )
    }
    case 'move_symbol': {
      const toFile = readText(args, 'toFile')
      return symbol === undefined
        ? declined('missing required parameter: name')
        : toFile === undefined
          ? declined('missing required parameter: toFile')
          : moveSymbol(await workspace(), symbol, file, toFile)
    }
    case 'rename_file': {
      const target = readText(args, 'file')
      const newPath = readText(args, 'newPath')
      return target === undefined
        ? declined('missing required parameter: file')
        : newPath === undefined
          ? declined('missing required parameter: newPath')
          : renameFile(await compiler(), target, newPath)
    }
    case 'change_signature': {
      const parameters = readTextList(args, 'parameters')
      const argumentList = readTextList(args, 'arguments')
      return symbol === undefined
        ? declined('missing required parameter: name')
        : parameters === undefined || argumentList === undefined
          ? declined('change_signature needs both parameters and arguments.')
          : changeSignature(await workspace(), symbol, file, {
              parameters,
              arguments: argumentList,
            })
    }
    case 'apply_refactor': {
      const refactor = readText(args, 'refactor')
      const action = readText(args, 'action')
      return symbol === undefined
        ? declined('missing required parameter: name')
        : refactor === undefined || action === undefined
          ? declined('apply_refactor needs both refactor and action; call refactorings first.')
          : applyRefactor(await compiler(), symbol, file, refactor, action)
    }
    case 'revert': {
      const label = readText(args, 'label')
      const held = heldSnapshot(label)
      return held === undefined
        ? declined(
            heldLabels().length === 0
              ? 'no checkpoint has been taken.'
              : `no checkpoint named ${label ?? ''}; held: ${heldLabels().join(', ')}`,
          )
        : restorePlan(held, textsOf(await workspace()))
    }
    default:
      return undefined
  }
}

// One step of a batch is one write tool's plan, computed the same way it would
// be if the caller had asked for it directly.
export const batchPlan = async (
  options: CallOptions,
  steps: readonly Readonly<Record<string, unknown>>[],
): Promise<EditPlan> => {
  const plans = await steps.reduce<Promise<readonly EditPlan[]>>(async (sofar, step) => {
    const before = await sofar
    const name = readText(step, 'tool')
    const stepArgs = step['arguments']
    if (name === undefined) return [...before, declined('a step has no tool name.')]
    const plan = await planTool(
      options,
      name,
      typeof stepArgs === 'object' && stepArgs !== null ? { ...stepArgs } : {},
    )
    return [...before, plan ?? declined(`${name} is not a tool that changes files.`)]
  }, Promise.resolve([]))
  return combinePlans(plans)
}
