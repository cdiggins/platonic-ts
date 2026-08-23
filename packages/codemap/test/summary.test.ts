import { describe, it, expect } from 'vitest'
import { summarize } from '../src/summary.ts'

describe('summarize', () => {
  it('has nothing to describe for an empty population', () => {
    expect(summarize([])).toBeUndefined()
  })

  it('reports every statistic as the single value of a one-member population', () => {
    const summary = summarize([7])
    expect(summary).toEqual({
      count: 1,
      min: 7,
      max: 7,
      mean: 7,
      p20: 7,
      p25: 7,
      p40: 7,
      p50: 7,
      p60: 7,
      p75: 7,
      p80: 7,
      p90: 7,
      p95: 7,
      p99: 7,
    })
  })

  it('sorts the population itself', () => {
    const shuffled = summarize([5, 1, 4, 2, 3])
    expect(shuffled?.min).toBe(1)
    expect(shuffled?.max).toBe(5)
    expect(shuffled?.p50).toBe(3)
  })

  it('uses nearest rank, so every percentile is an observed value', () => {
    // Interpolating (the R-7 convention) would report p25 = 3.25 and p95 = 9.55 here.
    const summary = summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(summary?.p25).toBe(3)
    expect(summary?.p95).toBe(10)
    expect(summary?.p50).toBe(5)
  })

  it('takes the lower of the two middle values of an even population', () => {
    // A consequence of nearest rank: the median is a member, not the average of two members.
    expect(summarize([1, 2, 3, 4])?.p50).toBe(2)
  })

  it('reports the mean as a true mean, not an order statistic', () => {
    const summary = summarize([1, 1, 1, 97])
    expect(summary?.mean).toBe(25)
    expect(summary?.p50).toBe(1)
  })

  it('counts repeated values separately', () => {
    const summary = summarize([2, 2, 2])
    expect(summary?.count).toBe(3)
    expect(summary?.min).toBe(2)
    expect(summary?.max).toBe(2)
  })
})
