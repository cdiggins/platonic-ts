import { describe, expect, it } from 'vitest'
import { colorForIndex, computePieArcs, pieSvg, type PieSlice } from '../src/pie.ts'

const slices = (values: readonly number[]): readonly PieSlice[] =>
  values.map((value, i) => ({ label: `s${i}`, value, color: colorForIndex(i) }))

describe('computePieArcs', () => {
  it('returns [] for empty input or all non-positive values', () => {
    expect(computePieArcs([], 100)).toEqual([])
    expect(computePieArcs(slices([0, -1, 0]), 100)).toEqual([])
  })

  it('drops zero/negative slices and sweeps only over positive ones', () => {
    const arcs = computePieArcs(slices([10, 0, -5, 30]), 100)
    expect(arcs).toHaveLength(2)
    expect(arcs.map((a) => a.slice.value)).toEqual([10, 30])
  })

  it('angles are contiguous and sum to a full turn (2*PI)', () => {
    const arcs = computePieArcs(slices([1, 1, 2]), 100)
    expect(arcs).toHaveLength(3)
    const first = arcs[0]
    const second = arcs[1]
    const third = arcs[2]
    expect(first?.startAngle).toBe(0)
    expect(first?.endAngle).toBeCloseTo(second?.startAngle ?? NaN, 10)
    expect(second?.endAngle).toBeCloseTo(third?.startAngle ?? NaN, 10)
    expect(third?.endAngle).toBeCloseTo(Math.PI * 2, 10)
  })

  it('every arc has a non-empty SVG path string', () => {
    const arcs = computePieArcs(slices([5, 3, 1]), 80)
    for (const arc of arcs) {
      expect(arc.path.startsWith('M')).toBe(true)
      expect(arc.path.trim().length).toBeGreaterThan(0)
    }
  })

  it('a single positive slice still produces one drawable full-circle arc', () => {
    const arcs = computePieArcs(slices([42]), 60)
    expect(arcs).toHaveLength(1)
    expect(arcs[0]?.path).toContain('A 30 30')
  })
})

describe('pieSvg', () => {
  it('renders a neutral ring when there is nothing to draw', () => {
    const svg = pieSvg([], 100)
    expect(svg).toContain('<svg')
    expect(svg).toContain('circle')
    expect(svg).not.toContain('<path')
  })

  it('renders one <path> per positive slice, escaping label/color text', () => {
    const svg = pieSvg(
      [
        { label: 'a & b', value: 5, color: '#111' },
        { label: '<x>', value: 5, color: '#222' },
      ],
      100,
    )
    const pathCount = svg.split('<path').length - 1
    expect(pathCount).toBe(2)
    expect(svg).toContain('a &amp; b')
    expect(svg).toContain('&lt;x&gt;')
    expect(svg).not.toContain('<x>')
  })
})

describe('colorForIndex', () => {
  it('cycles through the fixed palette', () => {
    const a = colorForIndex(0)
    const wrapped = colorForIndex(8) // palette has 8 entries
    expect(wrapped).toBe(a)
  })
})
