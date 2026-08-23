// Order statistics for a population of numbers. Deliberately domain-free: nothing here
// knows what a function or an AST node is, which is what lets the same summariser describe
// function lengths today and any other measured population later.
//
// Percentiles use the nearest-rank convention: the value at position `ceil(p/100 * n)` of
// the ascending order, one-based. Every reported percentile is therefore a value that some
// member of the population actually has, so "p99 is 116 lines" can always be followed by
// "which one is that". The alternative — interpolating between neighbours, the R-7 default
// used by numpy and most spreadsheets — reports 117.4 for the same population and answers
// that follow-up question with a number no function has. On the populations here (a few
// hundred functions) the two conventions differ visibly, so the choice is stated rather
// than inherited from a library.

export type Summary = {
  readonly count: number
  readonly min: number
  readonly max: number
  readonly mean: number
  readonly p20: number
  readonly p25: number
  readonly p40: number
  readonly p50: number
  readonly p60: number
  readonly p75: number
  readonly p80: number
  readonly p90: number
  readonly p95: number
  readonly p99: number
}

// A population with at least one member. Percentiles of an empty population are not zero,
// they are undefined, and `summarize` says so in its return type rather than inventing a
// value the caller would have to know to distrust (PS-042).
type Population = readonly [number, ...(readonly number[])]

const isPopulated = (values: readonly number[]): values is Population => values.length > 0

// `sorted[index]` is `number | undefined` under noUncheckedIndexedAccess even though the
// index is clamped into range; `sorted[0]` on a non-empty tuple is the one element the
// compiler knows is there, so it stands in for a case that cannot happen.
const nearestRank = (sorted: Population, percentile: number): number => {
  const rank = Math.ceil((percentile / 100) * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return sorted[index] ?? sorted[0]
}

const ascending = (values: Population): Population => {
  const sorted = [...values].sort((left, right) => left - right)
  return isPopulated(sorted) ? sorted : values
}

const summarizePopulation = (values: Population): Summary => {
  const sorted = ascending(values)
  return {
    count: sorted.length,
    min: nearestRank(sorted, 0),
    max: nearestRank(sorted, 100),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p20: nearestRank(sorted, 20),
    p25: nearestRank(sorted, 25),
    p40: nearestRank(sorted, 40),
    p50: nearestRank(sorted, 50),
    p60: nearestRank(sorted, 60),
    p75: nearestRank(sorted, 75),
    p80: nearestRank(sorted, 80),
    p90: nearestRank(sorted, 90),
    p95: nearestRank(sorted, 95),
    p99: nearestRank(sorted, 99),
  }
}

// Order statistics of `values`, or undefined when there is nothing to describe.
export const summarize = (values: readonly number[]): Summary | undefined =>
  isPopulated(values) ? summarizePopulation(values) : undefined
