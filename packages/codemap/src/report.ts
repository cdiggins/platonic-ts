// Rendering this package's reports as fixed-width text. Presentation only: the numbers are
// decided in `stats.ts` and `clones.ts`, and this module never computes one.
import type { ExpressionOccurrence, ShapeGroup } from './clones.ts'
import type { PopulationName, PopulationReport, SizeReport, ZoneSummary } from './stats.ts'
import type { Summary } from './summary.ts'

const labels: Record<PopulationName, string> = {
  'function-lines': 'function length (lines)',
  'function-nodes': 'function size (AST nodes)',
  'function-arity': 'function arity (parameters)',
  'statement-nodes': 'statement size (AST nodes)',
  'statement-lines': 'statement length (lines)',
  'expression-nodes': 'compound expression size (AST nodes)',
}

const columns: readonly string[] = [
  'zone',
  'count',
  'min',
  'mean',
  'p20',
  'p25',
  'p40',
  'p50',
  'p60',
  'p75',
  'p80',
  'p90',
  'p95',
  'p99',
  'max',
]

// One decimal on the mean and none anywhere else: every other column is a nearest-rank
// order statistic, so it is a value some member of the population actually has, and
// printing it as `7.0` would suggest an interpolation that did not happen.
const cellsOf = (summary: Summary): readonly string[] => [
  String(summary.count),
  String(summary.min),
  summary.mean.toFixed(1),
  String(summary.p20),
  String(summary.p25),
  String(summary.p40),
  String(summary.p50),
  String(summary.p60),
  String(summary.p75),
  String(summary.p80),
  String(summary.p90),
  String(summary.p95),
  String(summary.p99),
  String(summary.max),
]

const emptyCells: readonly string[] = columns.slice(1).map(() => '—')

const rowOf = (entry: ZoneSummary): readonly string[] => [
  entry.zone,
  ...(entry.summary === undefined ? emptyCells : cellsOf(entry.summary)),
]

const widthsOf = (rows: readonly (readonly string[])[]): readonly number[] =>
  columns.map((heading, column) =>
    rows.reduce((widest, row) => Math.max(widest, (row[column] ?? '').length), heading.length),
  )

// The zone column reads as a label, the rest as numbers, so only the first is left-aligned.
const padCell = (text: string, width: number, column: number): string =>
  column === 0 ? text.padEnd(width) : text.padStart(width)

const lineOf = (cells: readonly string[], widths: readonly number[]): string =>
  cells
    .map((cell, column) => padCell(cell, widths[column] ?? cell.length, column))
    .join('  ')
    .trimEnd()

const tableOf = (report: PopulationReport): readonly string[] => {
  const rows = report.zones.map(rowOf)
  const widths = widthsOf(rows)
  return [
    labels[report.population],
    lineOf(columns, widths),
    lineOf(
      widths.map((width) => '-'.repeat(width)),
      widths,
    ),
    ...rows.map((row) => lineOf(row, widths)),
  ]
}

export const formatSizeReport = (report: SizeReport): string =>
  [
    `size distributions over ${report.fileCount} TypeScript files`,
    'percentiles are nearest-rank: every one is a value some member of the population has',
    '',
    ...report.populations.flatMap((population) => [...tableOf(population), '']),
  ]
    .join('\n')
    .trimEnd()

// ---------------------------------------------------------------------------
// Repeated shapes.
// ---------------------------------------------------------------------------

const oneLine = (text: string, width: number): string => {
  const collapsed = text.replace(/\s+/gu, ' ')
  return collapsed.length <= width ? collapsed : `${collapsed.slice(0, width - 1)}…`
}

// The names are the ones this occurrence would pass, so a reader can see at a glance
// whether the group is one function called four ways or four unrelated pipelines.
const occurrenceLine = (occurrence: ExpressionOccurrence): string =>
  [
    `    ${occurrence.file}:${occurrence.line}  (${occurrence.parameters.join(', ')})`,
    `      ${oneLine(occurrence.text, 96)}`,
  ].join('\n')

const groupBlock = (group: ShapeGroup, rank: number): readonly string[] => [
  `#${rank}  x${group.occurrences.length}  ${group.nodes} nodes  ` +
    `${group.parameterCount} parameter(s)  ~${group.savedNodes} nodes saved`,
  ...group.occurrences.map(occurrenceLine),
  '',
]

export const formatCloneReport = (groups: readonly ShapeGroup[]): string =>
  (groups.length === 0
    ? ['no expression shape repeats under these settings']
    : [
        `${groups.length} expression shape(s) repeat, ranked by the nodes an extraction would remove`,
        'each occurrence is listed with the arguments it would pass',
        '',
        ...groups.flatMap((group, index) => groupBlock(group, index + 1)),
      ]
  )
    .join('\n')
    .trimEnd()
