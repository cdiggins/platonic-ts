import { describe, it, expect } from 'vitest'
import {
  countEscapeHatches,
  sumCounts,
  compareToBaseline,
  type RatchetCounts,
} from '../src/ratchet.ts'

const zero: RatchetCounts = {
  explicitAny: 0,
  asCasts: 0,
  nonNullAssertions: 0,
  tsDirectives: 0,
  eslintDisables: 0,
}

describe('countEscapeHatches', () => {
  it('counts explicit any across variable, param, and return positions', () => {
    const src = 'const x: any = 1\nfunction f(a: any): any { return a }'
    expect(countEscapeHatches('f.ts', src).explicitAny).toBe(3)
  })

  it('counts as-casts but excludes as const', () => {
    const src = 'const a = x as Foo\nconst b = 1 as const\nconst c = y as Bar'
    expect(countEscapeHatches('f.ts', src).asCasts).toBe(2)
  })

  it('counts non-null assertions', () => {
    const src = 'const a = foo!.bar\nconst b = maybe()!'
    expect(countEscapeHatches('f.ts', src).nonNullAssertions).toBe(2)
  })

  it('counts ts-directive comments (ignore, expect-error, nocheck)', () => {
    const src = [
      '// @ts-ignore',
      'const a: string = 1',
      '// @ts-expect-error',
      'const b = 2',
      '// @ts-nocheck',
    ].join('\n')
    expect(countEscapeHatches('f.ts', src).tsDirectives).toBe(3)
  })

  it('counts eslint-disable comments (bare, next-line, trailing line)', () => {
    const src = [
      '// eslint-disable-next-line no-console',
      'doSomething() // eslint-disable-line',
      '/* eslint-disable no-explicit-any */',
    ].join('\n')
    expect(countEscapeHatches('f.ts', src).eslintDisables).toBe(3)
  })

  it('reports all zero for a clean file', () => {
    const src = 'export const add = (a: number, b: number): number => a + b'
    expect(countEscapeHatches('f.ts', src)).toEqual(zero)
  })
})

describe('sumCounts', () => {
  it('sums fields across multiple counts', () => {
    const a: RatchetCounts = { ...zero, explicitAny: 1, asCasts: 2, tsDirectives: 1 }
    const b: RatchetCounts = { ...zero, explicitAny: 3, nonNullAssertions: 1, eslintDisables: 2 }
    expect(sumCounts([a, b])).toEqual({
      explicitAny: 4,
      asCasts: 2,
      nonNullAssertions: 1,
      tsDirectives: 1,
      eslintDisables: 2,
    })
  })

  it('returns zero for an empty list', () => {
    expect(sumCounts([])).toEqual(zero)
  })
})

describe('compareToBaseline', () => {
  const baseline: RatchetCounts = { ...zero, explicitAny: 2, asCasts: 2, nonNullAssertions: 2 }

  it('is ok when equal to baseline', () => {
    expect(compareToBaseline(baseline, baseline)).toEqual({ verdict: 'ok', regressions: [] })
  })

  it('is improved when some dimensions drop and none rise', () => {
    const current = { ...baseline, explicitAny: 1 }
    expect(compareToBaseline(current, baseline)).toEqual({ verdict: 'improved', regressions: [] })
  })

  it('is regressed when any dimension rises, regardless of others improving', () => {
    const current = { ...baseline, explicitAny: 1, asCasts: 3 }
    const result = compareToBaseline(current, baseline)
    expect(result.verdict).toBe('regressed')
    expect(result.regressions).toEqual(['asCasts'])
  })
})
