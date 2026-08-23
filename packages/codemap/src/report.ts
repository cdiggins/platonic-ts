// Rendering a size report as a fixed-width table. Presentation only: the numbers are
// decided in `stats.ts`, and this module never computes one.
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
