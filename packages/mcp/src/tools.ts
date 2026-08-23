// The catalogue the server advertises, in the order a caller meets it: find
// something, ask the compiler about it, analyse what depends on it, change it,
// undo the change.
//
// The list is not free. Every entry's name, description, and schema is sent on
// every request, so a tool used once a month costs more in catalogue than it
// saves in work. Adding one is a claim that an agent will reach for it often.
import { analysisTools, navigationTools, typeTools } from './toolsRead.ts'
import { editingTools, safetyTools, transformTools } from './toolsWrite.ts'
import { tool, textList, type ToolSpec } from './schema.ts'

const gateTool: ToolSpec = tool(
  'check',
  'Run the repository gate — typecheck, lint, escape-hatch ratchet, tests — and report the first failure. This is the only definition of green; diagnostics is not.',
  { steps: textList('Optional subset and order of: typecheck, lint, ratchet, tests.') },
  [],
)

export const toolSpecs: readonly ToolSpec[] = [
  ...navigationTools,
  ...typeTools,
  ...analysisTools,
  ...editingTools,
  ...transformTools,
  ...safetyTools,
  gateTool,
]
