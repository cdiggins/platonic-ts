import { describe, it, expect } from 'vitest'
import { formatSizeReport } from '../src/report.ts'
import type { SizeReport } from '../src/stats.ts'
import { summarize } from '../src/summary.ts'

const report: SizeReport = {
  fileCount: 2,
  populations: [
    {
      population: 'function-lines',
      zones: [
        { zone: 'all', summary: summarize([1, 2, 3, 4]) },
        { zone: 'core', summary: summarize([1, 2, 3, 4]) },
        { zone: 'root', summary: undefined },
        { zone: 'test', summary: undefined },
      ],
    },
  ],
}

const lineStartingWith = (text: string, prefix: string): string =>
  text.split('\n').find((line) => line.startsWith(prefix)) ?? ''

describe('formatSizeReport', () => {
  it('heads the report with the number of files it describes', () => {
    expect(formatSizeReport(report)).toContain('size distributions over 2 TypeScript files')
  })

  it('names each population and gives it a row per zone', () => {
    const text = formatSizeReport(report)
    expect(text).toContain('function length (lines)')
    expect(lineStartingWith(text, 'core')).toContain('4')
    expect(lineStartingWith(text, 'all')).not.toBe('')
  })

  it('marks a zone with no observations rather than printing zeros', () => {
    const row = lineStartingWith(formatSizeReport(report), 'root')
    expect(row).toContain('—')
    expect(row).not.toContain('0')
  })

  it('aligns every row of a table to the same width', () => {
    const rows = formatSizeReport(report)
      .split('\n')
      .filter((line) => /^(all|core|root|test|zone)/.test(line))
    const widths = new Set(rows.map((row) => row.replace(/\s+$/, '').length))
    expect(rows).toHaveLength(5)
    expect(widths.size).toBe(1)
  })
})
