import { describe, it, expect } from 'vitest'
import { toolSpecs } from '../src/tools.ts'

// The catalogue is a contract with the agent that reads it, and it is sent on
// every request. These are the properties that make it usable and the one that
// keeps it affordable.
describe('toolSpecs', () => {
  it('names every tool once', () => {
    const names = toolSpecs.map((spec) => spec.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('carries the tools the four layers built', () => {
    const names = new Set(toolSpecs.map((spec) => spec.name))
    const expected = [
      'outline', 'symbol', 'usages', 'search', 'repo_map',
      'type_of', 'members_of', 'diagnostics', 'code_fixes', 'refactorings',
      'callers', 'implementations', 'tests_for_symbol', 'blast_radius',
      'module_graph', 'unused_exports', 'symbol_metrics', 'escape_hatch_index', 'symbol_diff',
      'replace_symbol', 'insert_symbol', 'rename_symbol', 'delete_symbol',
      'organize_imports', 'apply_code_fix',
      'move_symbol', 'rename_file', 'change_signature', 'apply_refactor',
      'checkpoint', 'revert', 'batch_edit', 'check',
    ]
    expect(expected.filter((name) => !names.has(name))).toEqual([])
    expect(names.size).toBe(expected.length)
  })

  it('gives every tool a description that says more than its name', () => {
    const thin = toolSpecs.filter((spec) => spec.description.length < 60)
    expect(thin.map((spec) => spec.name)).toEqual([])
  })

  it('offers preview on every tool that changes a file', () => {
    const writers = [
      'replace_symbol', 'insert_symbol', 'rename_symbol', 'delete_symbol',
      'organize_imports', 'apply_code_fix', 'move_symbol', 'rename_file',
      'change_signature', 'apply_refactor', 'revert', 'batch_edit',
    ]
    const without = writers.filter((name) => {
      const spec = toolSpecs.find((candidate) => candidate.name === name)
      return spec === undefined || spec.inputSchema.properties['preview'] === undefined
    })
    expect(without).toEqual([])
  })

  it('requires nothing it does not describe', () => {
    const undescribed = toolSpecs.flatMap((spec) =>
      spec.inputSchema.required
        .filter((key) => spec.inputSchema.properties[key] === undefined)
        .map((key) => `${spec.name}.${key}`),
    )
    expect(undescribed).toEqual([])
  })

  // Every description is sent on every request. This is not a style rule: it is
  // the running cost of the catalogue, and it should move deliberately.
  it('stays within its token budget', () => {
    const characters = JSON.stringify(toolSpecs).length
    expect(characters).toBeLessThan(24000)
  })
})
